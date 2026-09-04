/**
 * @file The WebMCP surface of the vault origin.
 *
 * Responsible for: turning grants into live `document.modelContext` tools, and
 * tearing them down the instant a grant is withdrawn.
 *
 * NOT responsible for: what a predicate computes, or who is allowed to call it.
 *
 * Two classes of tool are registered here.
 *
 *   Predicate tools are exposed cross-origin. One registration per predicate,
 *   carrying every origin that has been granted it in `exposedTo`. One
 *   registration and not one per grant, because Chrome refuses a duplicate tool
 *   name outright, so the same predicate cannot be registered twice under one
 *   name. Withdrawing a single origin therefore means re-registering the
 *   predicate with a shorter `exposedTo`, which is what `sync()` does.
 *
 *   Management tools are same-origin only. They carry no `exposedTo`, so they
 *   are reachable by an agent operating in the vault's own tab and by nobody
 *   else. This is what lets a person say "revoke everything" to their own agent.
 */

import { readFacts, writeFact, SEED_FACTS, errText } from './facts.js';
import { PREDICATES, findPredicate } from './predicates.js';
import { compareDisclosure, counterfactualFor } from './counterfactual.js';
import {
  readGrants,
  grant,
  revoke,
  revokeAll,
  disclosedBits,
  appendLedger,
  readLedger,
  isSecureOrigin,
  KNOWN_ORIGINS,
} from './grants.js';

/**
 * Live registrations, keyed by tool name.
 *
 * Holding the controller is what makes revocation instant: aborting it removes
 * the tool from the browser's registry, which fires `toolchange` in every frame
 * that can see it, including the letting agent's page.
 *
 * @type {Map<string, AbortController>}
 */
const live = new Map();

/** Fires after every `sync()` so the UI can redraw. @type {Set<() => void>} */
const listeners = new Set();

/**
 * Is WebMCP available in this browser?
 *
 * Checked rather than assumed, because the vault must still render, edit facts
 * and explain itself in a browser with no WebMCP at all. Only the tool surface
 * is unavailable there, not the product.
 *
 * @returns {boolean}
 */
export function webmcpAvailable() {
  return typeof document !== 'undefined' && typeof document.modelContext?.registerTool === 'function';
}

/**
 * Subscribe to registry changes.
 *
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onRegistryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Notify subscribers. Listener failures are contained so one bad view cannot stall the rest. */
function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error('[vault] registry listener failed:', errText(err));
    }
  }
}

/**
 * Bring the live tool registry in line with the current grants.
 *
 * Idempotent and safe to call after any change. Computes the desired
 * `exposedTo` set per predicate, then adds, removes or re-registers only what
 * differs, so an unrelated grant change does not disturb a tool an agent may be
 * mid-call on.
 *
 * @returns {Promise<{registered: string[], removed: string[]}>}
 */
export async function sync() {
  if (!webmcpAvailable()) return { registered: [], removed: [] };

  /** @type {Map<string, string[]>} predicate name to the origins granted it */
  const wanted = new Map();
  for (const [origin, names] of Object.entries(readGrants())) {
    for (const name of names) {
      if (!findPredicate(name)) continue;
      wanted.set(name, [...(wanted.get(name) ?? []), origin]);
    }
  }

  const registered = [];
  const removed = [];

  // Withdraw predicates that no longer have any audience.
  for (const name of [...live.keys()]) {
    if (name.startsWith('vault_')) continue; // management tools are not grant-driven
    if (!wanted.has(name)) {
      live.get(name)?.abort();
      live.delete(name);
      removed.push(name);
    }
  }

  // Register, or re-register with a changed audience.
  for (const [name, origins] of wanted) {
    const signature = name + '::' + [...origins].sort().join(',');
    if (live.get(name)?.signal?.reason === signature) continue; // unchanged

    // Any existing registration is torn down first: Chrome rejects a duplicate
    // name, so widening or narrowing `exposedTo` means abort then re-register.
    if (live.has(name)) {
      live.get(name)?.abort(signature);
      live.delete(name);
    }

    const ok = await registerPredicate(name, origins, signature);
    if (ok) registered.push(name);
  }

  emit();
  return { registered, removed };
}

/**
 * Register one predicate, exposed to exactly the origins that were granted it.
 *
 * @param {string} name
 * @param {string[]} origins already validated as secure and allowlisted by `grant()`
 * @param {string} signature stored on the abort reason so `sync()` can detect drift
 * @returns {Promise<boolean>} true when the browser accepted the registration
 */
async function registerPredicate(name, origins, signature) {
  const predicate = findPredicate(name);
  if (!predicate) return false;

  const exposedTo = origins.filter(isSecureOrigin);
  if (exposedTo.length === 0) return false;

  const controller = new AbortController();

  try {
    await document.modelContext.registerTool(
      {
        name: predicate.name,
        description: predicate.description,
        inputSchema: predicate.inputSchema,
        annotations: {
          // Every predicate reads and never writes, so the agent is free to
          // call one without asking the user to confirm a side effect.
          readOnlyHint: predicate.readOnly,
          // The answer is derived from facts the user typed. Treated as
          // untrusted so an agent applies scrutiny rather than obeying it.
          untrustedContentHint: true,
        },
        execute: async (args) => runPredicate(predicate, args ?? {}, exposedTo),
      },
      { signal: controller.signal, exposedTo }
    );
  } catch (err) {
    // A registration failure is reported, never thrown. The vault stays usable
    // with the tools that did register.
    console.error('[vault] could not register ' + name + ':', errText(err));
    return false;
  }

  // Park the signature on the controller so `sync()` can tell an unchanged
  // registration from one whose audience has shifted, without a second map.
  Object.defineProperty(controller.signal, 'reason', { value: signature, configurable: true });
  live.set(name, controller);
  return true;
}

/**
 * Evaluate one predicate and record the call.
 *
 * Returns a plain string in every case, including failure. Two measured Chrome
 * behaviours force this shape: a thrown Error reaches the agent as a generic
 * `UnknownError` with the message stripped, and a returned `{content:[...]}`
 * wrapper arrives as raw unparsed JSON. So errors are returned as readable
 * text, which also lets the agent correct its arguments and retry.
 *
 * @param {import('./predicates.js').Predicate} predicate
 * @param {Record<string, unknown>} args
 * @param {string[]} audience origins currently able to reach this tool
 * @returns {Promise<string>}
 */
async function runPredicate(predicate, args, audience) {
  const caller = audience.length === 1 ? audience[0] : audience.join(' | ');

  let outcome;
  try {
    outcome = predicate.evaluate(readFacts(), args);
  } catch (err) {
    // A predicate that throws is a bug in this repository, not agent input.
    // Recorded loudly and reported as text so the agent is not left guessing.
    const message = 'vault error evaluating ' + predicate.name + ': ' + errText(err);
    appendLedger({ kind: 'error', origin: caller, predicate: predicate.name, args, error: message });
    emit();
    return message;
  }

  if (!outcome.ok) {
    appendLedger({
      kind: 'rejected',
      origin: caller,
      predicate: predicate.name,
      args,
      error: outcome.error,
    });
    emit();
    return 'Error: ' + outcome.error;
  }

  appendLedger({
    kind: 'answer',
    origin: caller,
    predicate: predicate.name,
    args,
    answer: outcome.answer,
  });
  emit();
  return outcome.answer;
}

/**
 * Register the vault's own management tools.
 *
 * Same-origin only: no `exposedTo` is passed, so the default applies and a
 * letting agent's page cannot reach these however many predicates it holds.
 * Call once at startup.
 *
 * @returns {Promise<string[]>} names of the tools that registered successfully
 */
export async function registerManagementTools() {
  if (!webmcpAvailable()) return [];

  /** @type {Array<{name: string, description: string, inputSchema: object, readOnly: boolean,
   *                run: (args: Record<string, unknown>) => string}>} */
  const tools = [
    {
      name: 'vault_list_predicates',
      description:
        'List every question this vault can answer, with the cost in bits of granting each one. Use before granting anything.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () =>
        PREDICATES.map(
          (p) => p.name + ' [' + p.category + ', ' + p.disclosureBits + ' bits] ' + p.title
        ).join('\n'),
    },
    {
      name: 'vault_list_grants',
      description:
        'List which origins currently hold which permissions, and the total bits disclosed to each.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () => {
        const grants = readGrants();
        const origins = Object.keys(grants);
        if (origins.length === 0) return 'No origin holds any permission.';
        return origins
          .map((o) => o + ' (' + disclosedBits(o) + ' bits): ' + grants[o].join(', '))
          .join('\n');
      },
    },
    {
      name: 'vault_grant',
      description:
        'Grant one origin permission to ask one question. The origin must already be on the vault allowlist.',
      inputSchema: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Origin to grant to, such as https://example.com' },
          predicate: { type: 'string', description: 'Name of the question to allow.' },
        },
        required: ['origin', 'predicate'],
      },
      readOnly: false,
      run: (args) => {
        const result = grant(String(args.origin ?? ''), String(args.predicate ?? ''));
        return result.ok
          ? result.changed
            ? 'Granted ' + args.predicate + ' to ' + args.origin
            : args.predicate + ' was already granted to ' + args.origin
          : 'Error: ' + result.error;
      },
    },
    {
      name: 'vault_revoke',
      description: 'Withdraw one permission from one origin. Takes effect immediately.',
      inputSchema: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Origin to withdraw from.' },
          predicate: { type: 'string', description: 'Name of the question to withdraw.' },
        },
        required: ['origin', 'predicate'],
      },
      readOnly: false,
      run: (args) => {
        const result = revoke(String(args.origin ?? ''), String(args.predicate ?? ''));
        return result.ok
          ? result.changed
            ? 'Revoked ' + args.predicate + ' from ' + args.origin
            : args.predicate + ' was not granted to ' + args.origin
          : 'Error: ' + result.error;
      },
    },
    {
      name: 'vault_revoke_all',
      description:
        'Withdraw every permission held by one origin at once. Use when ending a relationship with a letting agent.',
      inputSchema: {
        type: 'object',
        properties: { origin: { type: 'string', description: 'Origin to cut off entirely.' } },
        required: ['origin'],
      },
      readOnly: false,
      run: (args) => {
        const result = revokeAll(String(args.origin ?? ''));
        return result.ok
          ? 'Revoked ' + result.revoked + ' permission(s) from ' + args.origin
          : 'Error: ' + result.error;
      },
    },
    {
      name: 'vault_disclosure_report',
      description:
        'Report how much this vault has given away, in bits, per origin, and which single grant is the most expensive.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () => {
        const grants = readGrants();
        const origins = Object.keys(grants);
        if (origins.length === 0) return 'Nothing has been disclosed. No origin holds a permission.';
        const lines = origins.map((o) => {
          const worst = grants[o]
            .map((n) => findPredicate(n))
            .filter(Boolean)
            .sort((a, b) => b.disclosureBits - a.disclosureBits)[0];
          return (
            o +
            ': ' +
            disclosedBits(o) +
            ' bits across ' +
            grants[o].length +
            ' permission(s), most expensive is ' +
            (worst ? worst.name + ' at ' + worst.disclosureBits + ' bits' : 'none')
          );
        });
        return lines.join('\n');
      },
    },
    {
      name: 'vault_read_ledger',
      description:
        'Show the most recent calls made against this vault: who asked, what they asked, and what they were told.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many recent entries to return, up to 50.' },
        },
        required: [],
      },
      readOnly: true,
      run: (args) => {
        const raw = Number(args.limit);
        const limit = Number.isFinite(raw) ? Math.max(1, Math.min(50, Math.trunc(raw))) : 10;
        const entries = readLedger().slice(0, limit);
        if (entries.length === 0) return 'The ledger is empty. Nothing has called this vault yet.';
        return entries
          .map(
            (e) =>
              e.at +
              '  ' +
              e.kind +
              '  ' +
              e.origin +
              '  ' +
              e.predicate +
              (e.answer ? '  -> ' + e.answer : '') +
              (e.error ? '  -> ' + e.error : '')
          )
          .join('\n');
      },
    },
    {
      name: 'vault_update_fact',
      description:
        'Correct one fact held in the vault, such as annual income or household size. Never leaves this browser.',
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: Object.keys(SEED_FACTS),
            description: 'Which fact to change.',
          },
          value: { type: 'string', description: 'The new value, as text.' },
        },
        required: ['key', 'value'],
      },
      readOnly: false,
      run: (args) => {
        const result = writeFact(String(args.key ?? ''), args.value);
        return result.ok ? 'Updated ' + args.key : 'Error: ' + result.error;
      },
    },
    {
      name: 'vault_compare_disclosure',
      description:
        'Compare what the current permissions reveal against the documents a letting agent would ordinarily demand to answer the same questions. Use when the applicant asks whether this is actually safer.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () => {
        const granted = Object.values(readGrants()).flat();
        if (granted.length === 0) return 'Nothing is granted, so nothing has been disclosed.';
        const c = compareDisclosure(granted);
        return [
          'Answered by permission: ' + c.predicateBits + ' bits across ' + c.predicateBits + ' yes-or-no answers.',
          'Avoided by not uploading: ' + c.documents.join('; ') + '.',
          'That is ' + c.extraFacts + ' facts about you that were never asked for and never handed over, roughly ' + c.documentBits + ' bits, about ' + c.ratio + ' times the disclosure.',
        ].join('\n');
      },
    },
    {
      name: 'vault_explain_permission',
      description:
        'Explain in plain language what granting one permission does and does not reveal, and which document it saves the applicant from uploading.',
      inputSchema: {
        type: 'object',
        properties: {
          predicate: { type: 'string', description: 'Name of the permission to explain.' },
        },
        required: ['predicate'],
      },
      readOnly: true,
      run: (args) => {
        const name = String(args.predicate ?? '');
        const p = findPredicate(name);
        if (!p) return 'Error: no such permission "' + name + '"';
        const lines = [
          p.title + ' (' + p.name + '), ' + p.disclosureBits + ' bit' + (p.disclosureBits === 1 ? '' : 's'),
          'Reveals: ' + p.reveals,
        ];
        const c = counterfactualFor(name);
        if (c) {
          lines.push('Replaces: ' + c.document + '.');
          lines.push('Which would also have revealed: ' + c.alsoReveals.join(', ') + '.');
        }
        return lines.join('\n');
      },
    },
    {
      name: 'vault_known_origins',
      description: 'List the origins this vault will consider granting permissions to.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () => KNOWN_ORIGINS.map((o) => o.origin + '  ' + o.label + '  (' + o.kind + ')').join('\n'),
    },
  ];

  const done = [];
  for (const tool of tools) {
    const controller = new AbortController();
    try {
      await document.modelContext.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: true },
          execute: async (args) => {
            let out;
            try {
              out = tool.run(args ?? {});
            } catch (err) {
              return 'Error: ' + errText(err);
            }
            // A management tool can change grants, so the tool surface may have
            // shifted underneath us. Re-sync before returning.
            if (!tool.readOnly) await sync();
            emit();
            return String(out);
          },
        },
        { signal: controller.signal }
      );
      live.set(tool.name, controller);
      done.push(tool.name);
    } catch (err) {
      console.error('[vault] could not register ' + tool.name + ':', errText(err));
    }
  }
  return done;
}

/**
 * Names of every tool this document currently has registered.
 *
 * @returns {string[]} sorted
 */
export function liveToolNames() {
  return [...live.keys()].sort();
}
