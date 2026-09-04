/**
 * @file Cross-origin tool federation for the letting agent's origin.
 *
 * Responsible for: discovering the tools a renter's vault has exposed to this
 * origin, re-publishing them so an external agent can see them, and taking them
 * back down the moment the renter withdraws consent.
 *
 * NOT responsible for: storing anything about the applicant. Nothing learned
 * here is persisted. The assessment lives in memory for the length of a page
 * view and dies with it.
 *
 * Why a proxy layer exists at all, measured rather than assumed. A document's
 * own `getTools()` returns only same-origin tools. Tools registered by a
 * cross-origin iframe, even one carrying `allow="tools"`, appear solely through
 * `getTools({fromOrigins: [...]})`, and an external agent such as ChatGPT does
 * not call that on our behalf. So for a granted predicate to become reachable
 * by the agent the renter is actually talking to, this origin must register a
 * tool of its own that forwards to it.
 *
 * That constraint turns out to be the honest shape of the thing. The agent's
 * tool list is exactly the set of capabilities the renter granted, nothing more,
 * and when a grant is withdrawn the corresponding tool vanishes from the list
 * mid-conversation.
 */

import { errText } from './util.js';

/** Prefix on every proxied tool, so a renter can tell borrowed from native. */
export const PROXY_PREFIX = 'applicant_';

/**
 * How long a single federated call may run before it is abandoned, in ms.
 *
 * A vault predicate is pure computation over local storage and returns in under
 * a millisecond. A call still pending after this has hit something pathological,
 * and the agent is better served by a clear timeout than an open promise.
 */
export const CALL_TIMEOUT_MS = 10_000;

/**
 * Debounce window for rediscovery, in ms.
 *
 * `toolchange` fires once per registration, so granting nine permissions emits
 * nine events in a few milliseconds. Rediscovering on each one does the same
 * work nine times and produces a burst of half-complete tool sets. Coalescing
 * them into a single pass at the end is both cheaper and correct.
 */
export const REDISCOVER_DEBOUNCE_MS = 120;

/**
 * Normalise the `inputSchema` on a tool handle into the shape `registerTool`
 * will accept.
 *
 * Measured in Chrome 152, and the reason a federated tool cannot simply be
 * handed back to the browser: `getTools()` returns `inputSchema` as a JSON
 * **string**, while `registerTool()` requires an **object** and rejects a
 * string with "Failed to convert value to 'object'". Round-tripping a borrowed
 * tool therefore requires a parse in between. The asymmetry is not in the
 * explainer and appears in no other entry we are aware of, because reproducing
 * it requires cross-origin federation.
 *
 * @param {unknown} schema value of `handle.inputSchema`
 * @returns {object} a schema object; an empty object schema when unparseable,
 *                   so a malformed schema costs the tool its arguments rather
 *                   than costing the page the whole registration
 */
export function normaliseSchema(schema) {
  if (schema !== null && typeof schema === 'object') return schema;
  if (typeof schema === 'string') {
    try {
      const parsed = JSON.parse(schema);
      if (parsed !== null && typeof parsed === 'object') return parsed;
    } catch {
      // Fall through to the empty schema below.
    }
  }
  return { type: 'object', properties: {}, required: [] };
}

/**
 * Live proxy registrations, keyed by proxy tool name.
 * @type {Map<string, AbortController>}
 */
const proxies = new Map();

/** Last discovery result, kept so the UI can render without re-querying. */
let lastDiscovery = { at: 0, handles: [], tools: [], error: null };

/** @type {Set<(state: DiscoveryState) => void>} */
const listeners = new Set();

/**
 * @typedef {object} DiscoveryState
 * @property {number} at              epoch ms of the last discovery
 * @property {Array<{name: string, origin: string, description: string}>} tools
 * @property {string[]} proxied       proxy tool names currently registered
 * @property {string | null} error    discovery failure, if any
 */

/**
 * Is WebMCP present in this browser?
 *
 * @returns {boolean}
 */
export function webmcpAvailable() {
  return typeof document !== 'undefined' && typeof document.modelContext?.getTools === 'function';
}

/**
 * Subscribe to federation state changes.
 *
 * @param {(state: DiscoveryState) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onFederationChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current federation state, for a first render before any discovery has run. */
export function federationState() {
  return {
    at: lastDiscovery.at,
    tools: lastDiscovery.tools,
    proxied: [...proxies.keys()].sort(),
    error: lastDiscovery.error,
  };
}

function emit() {
  const state = federationState();
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error('[host] federation listener failed:', errText(err));
    }
  }
}

/**
 * Ask the vault origin which of its tools this origin may see.
 *
 * A vault that has granted nothing returns an empty list and no error, which is
 * indistinguishable at the API level from a vault that is not open in any tab.
 * Both are reported as "no capabilities available" rather than as a failure,
 * because from this origin's position they genuinely are the same situation.
 *
 * @param {string} vaultOrigin secure origin of the renter's vault
 * @returns {Promise<Array<object>>} the raw tool handles, usable with executeTool
 */
export async function discover(vaultOrigin) {
  // A second pass entering while the first is still registering proxies would
  // race it and try to register the same name twice, which Chrome rejects.
  if (discovering) return lastDiscovery.handles ?? [];
  discovering = true;
  try {
    return await runDiscovery(vaultOrigin);
  } finally {
    discovering = false;
  }
}

/** True while a discovery pass is in flight. */
let discovering = false;

/**
 * The body of `discover`, split out so the re-entrancy guard above stays legible.
 *
 * @param {string} vaultOrigin
 * @returns {Promise<Array<object>>}
 */
async function runDiscovery(vaultOrigin) {
  if (!webmcpAvailable()) {
    lastDiscovery = { at: Date.now(), handles: [], tools: [], error: 'WebMCP is not available in this browser' };
    emit();
    return [];
  }

  let tools = [];
  try {
    tools = await document.modelContext.getTools({ fromOrigins: [vaultOrigin] });
  } catch (err) {
    lastDiscovery = { at: Date.now(), handles: [], tools: [], error: errText(err) };
    emit();
    return [];
  }

  // `getTools` with `fromOrigins` returns same-origin tools too. Keep only what
  // genuinely came from the vault, so a tool this origin registered itself can
  // never be mistaken for a borrowed capability.
  const foreign = tools.filter((t) => t?.origin === vaultOrigin);

  lastDiscovery = {
    at: Date.now(),
    handles: foreign,
    tools: foreign.map((t) => ({
      name: String(t.name ?? ''),
      origin: String(t.origin ?? ''),
      description: String(t.description ?? ''),
    })),
    error: null,
  };

  await syncProxies(foreign);
  emit();
  return foreign;
}

/**
 * Bring the proxy registrations in line with what the vault currently exposes.
 *
 * Adds a proxy for each newly granted capability and aborts the proxy for each
 * withdrawn one. Aborting is what makes revocation visible to the agent: the
 * tool leaves this document's registry, and the agent's next tool listing is
 * one item shorter.
 *
 * @param {Array<object>} foreignTools handles returned by `discover`
 * @returns {Promise<{added: string[], dropped: string[]}>}
 */
async function syncProxies(foreignTools) {
  const wanted = new Map(foreignTools.map((t) => [PROXY_PREFIX + String(t.name), t]));

  const dropped = [];
  for (const name of [...proxies.keys()]) {
    if (!wanted.has(name)) {
      proxies.get(name)?.abort();
      proxies.delete(name);
      dropped.push(name);
    }
  }

  const added = [];
  for (const [proxyName, handle] of wanted) {
    if (proxies.has(proxyName)) continue;
    if (await registerProxy(proxyName, handle)) added.push(proxyName);
  }

  return { added, dropped };
}

/**
 * Publish one borrowed capability under this origin's own tool surface.
 *
 * The proxy keeps the vault's input schema verbatim, so an agent that can call
 * the original can call the proxy with the same arguments. The description is
 * rewritten to name the origin the answer comes from, because an agent choosing
 * between tools should be able to see that this one crosses a trust boundary.
 *
 * @param {string} proxyName
 * @param {object} handle tool handle from `getTools`
 * @returns {Promise<boolean>}
 */
async function registerProxy(proxyName, handle) {
  const controller = new AbortController();
  const sourceName = String(handle.name ?? '');
  const sourceOrigin = String(handle.origin ?? '');

  // Chrome caps a tool description at 500 characters before it starts costing
  // the agent real context, so the provenance note is kept short and the vault's
  // own wording is truncated rather than dropped.
  const provenance = ' (answered by the applicant’s own vault at ' + sourceOrigin + '; this site never receives the underlying data)';
  const description = String(handle.description ?? '').slice(0, 500 - provenance.length) + provenance;

  try {
    await document.modelContext.registerTool(
      {
        name: proxyName,
        description,
        inputSchema: normaliseSchema(handle.inputSchema),
        annotations: {
          // Every borrowed capability in this demonstration is a read. The
          // vault would reject a write regardless, since it holds the authority.
          readOnlyHint: true,
          // The answer originates outside this origin and is not under its
          // control, which is exactly the case this hint exists to mark.
          untrustedContentHint: true,
        },
        execute: async (args, options) => callFederated(handle, args ?? {}, options?.signal),
      },
      { signal: controller.signal }
    );
  } catch (err) {
    console.error('[host] could not publish proxy ' + proxyName + ':', errText(err));
    return false;
  }

  proxies.set(proxyName, controller);
  return true;
}

/**
 * Execute one borrowed capability against the origin that owns it.
 *
 * Two measured Chrome behaviours shape this function. `executeTool` requires
 * its arguments as a JSON string and rejects an object outright. And a thrown
 * Error reaches the agent as a bare `UnknownError` with the message discarded,
 * so every failure is returned as readable text instead.
 *
 * @param {object} handle tool handle from `getTools`
 * @param {Record<string, unknown>} args
 * @param {AbortSignal} [outerSignal] the agent's own cancellation signal
 * @returns {Promise<string>}
 */
export async function callFederated(handle, args, outerSignal) {
  let payload;
  try {
    payload = JSON.stringify(args ?? {});
  } catch {
    return 'Error: arguments could not be encoded as JSON';
  }

  // Cancel on whichever comes first: the agent giving up, or our own ceiling.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), CALL_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort('cancelled by agent');
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    const result = await document.modelContext.executeTool(handle, payload, {
      signal: controller.signal,
    });
    // A tool that navigates resolves to null. Reported plainly rather than as
    // the string "null", which an agent would read as an answer.
    if (result === null || result === undefined) {
      return 'The vault returned no answer for ' + String(handle.name) + '.';
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    if (controller.signal.aborted) {
      return 'Error: call to ' + String(handle.name) + ' was ' + String(controller.signal.reason ?? 'aborted');
    }
    return 'Error: the vault could not answer ' + String(handle.name) + ': ' + errText(err);
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Re-run discovery whenever the set of visible tools changes anywhere.
 *
 * `toolchange` is what carries a revocation across the origin boundary. The
 * vault aborts its registration, the browser fires the event here, and this
 * listener drops the matching proxy. No polling, no server, no message channel.
 *
 * @param {string} vaultOrigin
 * @returns {() => void} stop listening
 */
export function watchForChanges(vaultOrigin) {
  if (!webmcpAvailable() || typeof document.modelContext.addEventListener !== 'function') {
    return () => {};
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;
  const handler = () => {
    // `toolchange` arrives once per registration, so a nine-permission grant
    // emits nine events in a few milliseconds. They are coalesced into one
    // rediscovery. Failures are logged rather than thrown, because this runs
    // outside any call the user is waiting on.
    clearTimeout(pending);
    pending = setTimeout(() => {
      discover(vaultOrigin).catch((err) => console.error('[host] rediscovery failed:', errText(err)));
    }, REDISCOVER_DEBOUNCE_MS);
  };
  document.modelContext.addEventListener('toolchange', handler);
  return () => {
    clearTimeout(pending);
    document.modelContext.removeEventListener('toolchange', handler);
  };
}

/**
 * The tool handles currently borrowed from the vault.
 *
 * Owned here rather than mirrored into the view. An earlier version kept a copy
 * in the page and refreshed it after each discovery, which raced: the change
 * event fires from inside `discover`, so the listener ran while the page's copy
 * was still the previous one and filtered it down to nothing. One owner, read
 * through a getter, removes the race rather than sequencing around it.
 *
 * @returns {Array<object>} live handles, safe to pass to `callFederated`
 */
export function federatedHandles() {
  return lastDiscovery.handles ?? [];
}

/**
 * Proxy tool names currently published by this origin.
 *
 * @returns {string[]} sorted
 */
export function proxiedToolNames() {
  return [...proxies.keys()].sort();
}
