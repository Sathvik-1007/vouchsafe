/**
 * @file A live, self-verifying view of the WebMCP tool registry on both origins.
 *
 * Responsible for: reading `document.modelContext` back out of the browser and
 * showing what is there, on this origin and across the boundary, redrawing
 * whenever the browser says the set has moved.
 *
 * NOT responsible for: any application behaviour. It registers nothing, grants
 * nothing and asks the vault for nothing. It is a window onto state the rest of
 * the product produces.
 *
 * Why it exists. The claim this project rests on is that a withheld permission
 * is not a guarded tool but an absent one, and that withdrawing a permission
 * removes a tool from a different origin's registry while an agent is mid
 * conversation. Both are claims about the browser, not about our code, and a
 * reader should not have to take our word for either. This page lets them read
 * the browser directly, with no agent, no extension and no console.
 */

import { COMMIT, BUILT_AT } from '../build.js';
import { vaultOrigin, hostOrigin } from '../config.js';
import { escapeHtml as esc, errText } from '../lib/util.js';

/** Most events kept in the log. Older ones are dropped from the view, not hidden. */
const MAX_EVENTS = 40;

/** Events seen since the page opened. @type {Array<{at: Date, own: number, borrowed: number, delta: string}>} */
const events = [];

/** Last counts, so a change can be described rather than merely announced. */
let last = { own: 0, borrowed: 0 };

const $ = (id) => document.getElementById(id);

/**
 * Is WebMCP present?
 *
 * @returns {boolean}
 */
function available() {
  return typeof document.modelContext?.getTools === 'function';
}

/**
 * Read both halves of the registry.
 *
 * `getTools({fromOrigins})` widens rather than filters: it returns this origin's
 * own tools alongside the remote ones, so each handle's `origin` is the only
 * thing that separates borrowed from local.
 *
 * @returns {Promise<{own: string[], borrowed: string[]}>}
 */
async function readRegistry() {
  const vault = vaultOrigin();
  const [mine, everything] = await Promise.all([
    document.modelContext.getTools(),
    document.modelContext.getTools({ fromOrigins: [vault] }),
  ]);
  return {
    own: mine.map((t) => String(t.name)).sort(),
    borrowed: everything
      .filter((t) => t?.origin === vault)
      .map((t) => String(t.name))
      .sort(),
  };
}

/**
 * Describe what moved between two readings.
 *
 * @param {{own: number, borrowed: number}} before
 * @param {{own: number, borrowed: number}} after
 * @returns {string}
 */
function describe(before, after) {
  const parts = [];
  const ownDelta = after.own - before.own;
  const borrowedDelta = after.borrowed - before.borrowed;
  if (ownDelta !== 0) parts.push((ownDelta > 0 ? '+' : '') + ownDelta + ' registered here');
  if (borrowedDelta !== 0) parts.push((borrowedDelta > 0 ? '+' : '') + borrowedDelta + ' borrowed');
  return parts.length > 0 ? parts.join(', ') : 'no change in either count';
}

/**
 * @param {string[]} names
 * @param {'own' | 'borrowed'} kind
 * @returns {string}
 */
function list(names, kind) {
  if (names.length === 0) {
    return '<li class="note" style="padding:.4rem 0">' +
      (kind === 'own' ? 'Nothing registered.' : 'Nothing is being lent to this origin.') +
      '</li>';
  }
  return names
    .map(
      (n) =>
        '<li style="display:flex;justify-content:space-between;gap:.75rem;padding:.35rem 0;' +
        'border-bottom:1px solid var(--rule-soft)">' +
        '<span class="perm-name">' + esc(n) + '</span>' +
        '<span class="tag' + (kind === 'borrowed' ? ' live' : '') + '">' +
        (kind === 'borrowed' ? esc(vaultOrigin().replace(/^https?:\/\//, '')) : 'local') +
        '</span></li>'
    )
    .join('');
}

/** Redraw everything from a fresh reading. @returns {Promise<void>} */
async function refresh(cause) {
  if (!available()) return;

  let registry;
  try {
    registry = await readRegistry();
  } catch (err) {
    $('notice-slot').innerHTML =
      '<div class="notice bad"><strong>The registry could not be read.</strong> ' +
      esc(errText(err)) + '</div>';
    return;
  }
  $('notice-slot').innerHTML = '';

  const now = { own: registry.own.length, borrowed: registry.borrowed.length };
  $('fig-own').textContent = String(now.own);
  $('fig-borrowed').textContent = String(now.borrowed);
  $('own-list').innerHTML = list(registry.own, 'own');
  $('borrowed-list').innerHTML = list(registry.borrowed, 'borrowed');

  if (cause) {
    events.unshift({ at: new Date(), own: now.own, borrowed: now.borrowed, delta: describe(last, now) });
    events.length = Math.min(events.length, MAX_EVENTS);
    $('fig-events').textContent = String(events.length);
    $('event-log').innerHTML = events
      .map(
        (e) =>
          '<li><time>' + e.at.toISOString().slice(11, 19) + '</time>' +
          '<span class="what"><b>' + esc(e.delta) + '</b> &mdash; ' +
          e.own + ' here, ' + e.borrowed + ' borrowed</span></li>'
      )
      .join('');
  }
  last = now;
}

/**
 * Try to call a tool that is not registered, and show exactly what comes back.
 *
 * This is the demonstration, not a description of one. If the permission has
 * been withdrawn the handle simply is not in the list, and there is nothing to
 * pass to `executeTool`.
 *
 * @returns {Promise<void>}
 */
async function probeMissing() {
  const out = $('probe-out');
  out.hidden = false;
  out.textContent = 'Looking for a tool called income_meets_multiple…';

  try {
    const vault = vaultOrigin();
    const tools = await document.modelContext.getTools({ fromOrigins: [vault] });
    const handle = tools.find((t) => String(t.name) === 'income_meets_multiple' && t.origin === vault);

    if (!handle) {
      out.textContent =
        'getTools({fromOrigins:["' + vault + '"]})\n' +
        '  -> ' + tools.filter((t) => t.origin === vault).length + ' tools from that origin\n' +
        '  -> income_meets_multiple is not among them\n\n' +
        'There is no handle to pass to executeTool. The question cannot be asked, ' +
        'because the thing that would ask it does not exist.';
      return;
    }

    const answer = await document.modelContext.executeTool(
      handle,
      JSON.stringify({ monthly_rent_gbp: 1150, multiple: 3 })
    );
    out.textContent =
      'The permission is currently allowed, so the tool is there:\n\n' +
      '  executeTool(income_meets_multiple, {monthly_rent_gbp:1150, multiple:3})\n' +
      '  -> ' + String(answer) + '\n\n' +
      'Withdraw it in the panel and press this again. The handle disappears.';
  } catch (err) {
    out.textContent = 'Error: ' + errText(err);
  }
}

async function boot() {
  const pill = $('mcp-status');
  pill.textContent = available() ? 'Reading the registry' : 'Your browser cannot do this yet';
  pill.className = 'tag ' + (available() ? 'live' : 'off');
  $('build-label').textContent = location.origin;
  $('build-stamp').textContent = COMMIT + ' \u00b7 ' + BUILT_AT;

  if (!available()) {
    $('notice-slot').innerHTML =
      '<div class="notice"><strong>Your browser cannot hand this page to an assistant yet.</strong> ' +
      'There is no registry to read. Open this page in Chrome 149 or later. ' +
      '<a href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noopener">How to turn it on</a>.</div>';
    return;
  }

  // The vault must know which origin embedded it, or it exposes to nobody. The
  // page itself knows where it is running; the configured value is only a
  // default for whoever needs to refer to it.
  $('vault-frame').src = vaultOrigin() + '?host=' + encodeURIComponent(location.origin);
  $('probe-missing').addEventListener('click', () => {
    probeMissing().catch((err) => console.error('[proof] probe failed:', errText(err)));
  });

  // The only trigger. Nothing here polls, and nothing redraws because this page
  // guessed something might have changed.
  document.modelContext.addEventListener('toolchange', () => {
    refresh('toolchange').catch((err) => console.error('[proof] refresh failed:', errText(err)));
  });

  $('vault-frame').addEventListener('load', () => {
    refresh().catch(() => {});
  });

  await refresh();
}

boot().catch((err) => {
  console.error('[proof] boot failed:', err);
  document.getElementById('notice-slot').innerHTML =
    '<div class="notice bad"><strong>This page could not start.</strong> ' + esc(String(err)) + '</div>';
});
