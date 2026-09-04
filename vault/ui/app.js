/**
 * @file The vault's user interface.
 *
 * Responsible for: rendering the consent surface, the disclosure meter, the
 * live tool list and the ledger, and wiring the controls that change grants.
 *
 * NOT responsible for: any policy decision. Every button here calls into
 * `grants.js`, which is the only module allowed to widen access, and every
 * change is followed by `sync()` so the browser's tool registry and the screen
 * never disagree.
 */

import { SEED_FACTS, readFacts, writeFact, resetFacts, CREDIT_BANDS } from '../lib/facts.js';
import { PREDICATES, predicateCategories } from '../lib/predicates.js';
import {
  KNOWN_ORIGINS,
  readGrants,
  grant,
  revoke,
  revokeAll,
  disclosedBits,
  readLedger,
  clearLedger,
  isGranted,
} from '../lib/grants.js';
import { compareDisclosure } from '../lib/counterfactual.js';
import {
  sync,
  registerManagementTools,
  onRegistryChange,
  liveToolNames,
  webmcpAvailable,
} from '../lib/registry.js';

/**
 * Bits at which the disclosure meter turns amber.
 *
 * Nine one-bit predicates is the full ordinary letting check, so anything at or
 * under that is routine. Past it, the renter is being asked for something the
 * standard check never needed, and the meter should say so.
 */
const BITS_ROUTINE = 9;

/** Bits at which the meter turns red: a raw identity disclosure has been made. */
const BITS_ALARMING = 20;

/** The nine predicates a normal English letting check actually requires. */
const TYPICAL_GRANTS = Object.freeze([
  'income_meets_multiple',
  'deposit_available',
  'has_no_eviction_record',
  'right_to_rent_valid',
  'references_at_least',
  'employment_months_min',
  'can_move_in_by',
  'household_size_at_most',
  'pets_compatible',
]);

/** Currently selected origin in the picker. */
let selected = KNOWN_ORIGINS[0]?.origin ?? '';

const $ = (id) => document.getElementById(id);

/** Escape text destined for an HTML string. */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* -------------------------------------------------------------------------- */
/* rendering                                                                  */
/* -------------------------------------------------------------------------- */

/** Draw the availability banner and status pill. */
function renderStatus() {
  const pill = $('mcp-status');
  const available = webmcpAvailable();
  pill.textContent = available ? 'webmcp live' : 'webmcp unavailable';
  pill.className = 'pill ' + (available ? 'ok' : 'no');
  $('origin-label').textContent = location.origin;

  const slot = $('banner-slot');
  if (available) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML =
    '<div class="banner bad"><strong>This browser has no WebMCP.</strong> ' +
    'The vault still works and your facts are still yours, but no tools can be published. ' +
    'Open in Chrome 149 or later, or enable <code>chrome://flags/#enable-webmcp-testing</code>, ' +
    'to see permissions become callable capabilities.</div>';
}

/** Draw the origin picker. */
function renderOriginPicker() {
  const picker = $('origin-picker');
  picker.innerHTML = KNOWN_ORIGINS.map(
    (o) =>
      '<option value="' + esc(o.origin) + '">' + esc(o.label) + ' — ' + esc(o.origin) + '</option>'
  ).join('');
  picker.value = selected;
}

/** Draw the predicate catalogue with per-predicate grant state. */
function renderPredicates() {
  const container = $('predicate-list');
  const parts = [];

  for (const category of predicateCategories()) {
    parts.push(
      '<div style="padding:9px 14px;background:var(--panel-2);border-top:1px solid var(--line);' +
        'border-bottom:1px solid var(--line);font-family:var(--mono);font-size:10.5px;' +
        'letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint)">' +
        esc(category) +
        '</div>'
    );

    for (const p of PREDICATES.filter((x) => x.category === category)) {
      const live = isGranted(selected, p.name);
      const costly = p.disclosureBits > 1;
      parts.push(
        '<div class="cap' +
          (live ? ' is-live' : '') +
          '">' +
          '<div>' +
          '<div class="cap-name">' +
          esc(p.name) +
          '</div>' +
          '<div class="cap-title">' +
          esc(p.title) +
          '</div>' +
          '<div class="cap-reveals">' +
          esc(p.reveals) +
          '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
          '<span class="bits ' +
          (costly ? 'is-costly' : 'is-cheap') +
          '">' +
          p.disclosureBits +
          ' bit' +
          (p.disclosureBits === 1 ? '' : 's') +
          '</span>' +
          '<button class="' +
          (live ? 'revoke' : 'grant') +
          '" data-act="' +
          (live ? 'revoke' : 'grant') +
          '" data-name="' +
          esc(p.name) +
          '">' +
          (live ? 'revoke' : 'grant') +
          '</button>' +
          '</div>' +
          '</div>'
      );
    }
  }
  container.innerHTML = parts.join('');
}

/** Draw the bits meter for the selected origin. */
function renderDisclosure() {
  const bits = disclosedBits(selected);
  $('bits-total').textContent = bits.toFixed(1);

  const bar = $('bits-bar');
  const pct = Math.min(100, (bits / BITS_ALARMING) * 100);
  bar.style.width = pct + '%';
  bar.className = bits >= BITS_ALARMING ? 'over' : bits > BITS_ROUTINE ? 'hot' : '';

  const count = (readGrants()[selected] ?? []).length;
  $('grant-summary').textContent = count === 0 ? 'none granted' : count + ' granted';

  let verdict;
  if (bits === 0) {
    verdict = 'Nothing granted. This origin knows nothing about you.';
  } else if (bits <= BITS_ROUTINE) {
    verdict =
      'Every grant is a single yes-or-no. Uploading the documents that answer these same ' +
      'nine questions would disclose thousands of times more, permanently.';
  } else if (bits < BITS_ALARMING) {
    verdict = 'Past the routine check. Something here reveals more than a threshold answer.';
  } else {
    verdict = 'A raw disclosure is live. This origin can now identify you directly.';
  }
  $('bits-explain').textContent = verdict;
}

/**
 * Draw the comparison between what was granted and what would have been uploaded.
 *
 * This is the panel that makes "one bit" mean something. A number without its
 * alternative beside it is not information, it is decoration.
 */
function renderCounterfactual() {
  const granted = readGrants()[selected] ?? [];
  const box = $('counterfactual');

  if (granted.length === 0) {
    box.innerHTML =
      '<p class="note" style="margin:0">Grant something and this will show the documents ' +
      'you would otherwise have uploaded to answer the same questions.</p>';
    return;
  }

  const c = compareDisclosure(granted);
  if (c.documents.length === 0) {
    box.innerHTML =
      '<p class="note" style="margin:0">These grants are raw disclosures. There is no document ' +
      'they save you from, because they hand over the contents directly.</p>';
    return;
  }

  box.innerHTML =
    '<div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px">' +
    '<div><div class="big" style="color:var(--live)">' + c.predicateBits + '</div>' +
    '<div class="note">bits you gave</div></div>' +
    '<div style="color:var(--ink-faint);font-size:20px">vs</div>' +
    '<div><div class="big" style="color:var(--deny)">' + c.documentBits + '</div>' +
    '<div class="note">bits the documents would have</div></div>' +
    '<div style="margin-left:auto;text-align:right"><div class="big">' + c.ratio + '&times;</div>' +
    '<div class="note">less disclosed</div></div>' +
    '</div>' +
    '<p style="margin:0 0 8px">Still on your side of the boundary: <strong>' + c.extraFacts +
    ' facts</strong> nobody asked for.</p>' +
    '<ul class="reset" style="font-size:12.5px">' +
    c.documents
      .map(
        (d) =>
          '<li style="padding:5px 0;border-bottom:1px solid var(--line);color:var(--ink-dim)">' +
          '<span style="color:var(--deny);font-family:var(--mono);font-size:11px">not sent</span> ' +
          esc(d) + '</li>'
      )
      .join('') +
    '</ul>';
}

/** Draw the list of tools actually registered on document.modelContext. */
function renderLiveTools() {
  const names = liveToolNames();
  $('tool-count').textContent = names.length + ' registered';
  $('live-tools').innerHTML = names.length
    ? names
        .map((n) => {
          const managed = n.startsWith('vault_');
          return (
            '<li style="padding:6px 14px;border-bottom:1px solid var(--line);display:flex;' +
            'justify-content:space-between;gap:10px">' +
            '<span>' +
            esc(n) +
            '</span><span class="pill ' +
            (managed ? '' : 'ok') +
            '">' +
            (managed ? 'same-origin' : 'exposed') +
            '</span></li>'
          );
        })
        .join('')
    : '<li style="padding:10px 14px;color:var(--ink-faint)">nothing registered</li>';
}

/** Draw the audit ledger. */
function renderLedger() {
  const entries = readLedger().slice(0, 40);
  $('ledger').innerHTML = entries.length
    ? entries
        .map((e) => {
          const time = String(e.at ?? '').slice(11, 19);
          const detail =
            esc(e.predicate ?? '') +
            (e.answer ? ' → ' + esc(e.answer) : '') +
            (e.error ? ' → ' + esc(e.error) : '');
          return (
            '<li><span class="t">' +
            esc(time) +
            '</span><span class="k ' +
            esc(e.kind) +
            '">' +
            esc(e.kind) +
            '</span><span class="d">' +
            detail +
            '</span></li>'
          );
        })
        .join('')
    : '<li style="grid-template-columns:1fr;color:var(--ink-faint)">no calls yet</li>';
}

/** Draw the fact editor. */
function renderFacts() {
  const facts = readFacts();
  const form = $('facts-form');
  form.innerHTML = Object.keys(SEED_FACTS)
    .map((key) => {
      const value = facts[key];
      let control;
      if (key === 'creditBand') {
        control =
          '<select data-fact="' +
          esc(key) +
          '">' +
          CREDIT_BANDS.map(
            (b) =>
              '<option value="' + b + '"' + (b === value ? ' selected' : '') + '>' + b + '</option>'
          ).join('') +
          '</select>';
      } else if (typeof SEED_FACTS[key] === 'boolean') {
        control =
          '<select data-fact="' +
          esc(key) +
          '"><option value="true"' +
          (value ? ' selected' : '') +
          '>true</option><option value="false"' +
          (!value ? ' selected' : '') +
          '>false</option></select>';
      } else {
        const type = typeof SEED_FACTS[key] === 'number' ? 'number' : 'text';
        control =
          '<input type="' + type + '" data-fact="' + esc(key) + '" value="' + esc(value) + '">';
      }
      return (
        '<label style="display:block"><span class="note" style="display:block;margin-bottom:3px">' +
        esc(key) +
        '</span>' +
        control +
        '</label>'
      );
    })
    .join('');
}

/** Redraw everything that depends on state. */
function renderAll() {
  renderPredicates();
  renderDisclosure();
  renderCounterfactual();
  renderLiveTools();
  renderLedger();
}

/* -------------------------------------------------------------------------- */
/* events                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Apply a grant change, then reconcile the tool registry before redrawing.
 *
 * Order matters. `sync()` is what actually publishes or withdraws the tool, so
 * redrawing before it returns would show a permission as live while the browser
 * had not yet registered it.
 *
 * @param {() => {ok: boolean, error?: string}} mutate
 */
async function applyChange(mutate) {
  const result = mutate();
  if (!result.ok) {
    $('banner-slot').innerHTML = '<div class="banner bad">' + esc(result.error ?? 'failed') + '</div>';
    return;
  }
  await sync();
  renderAll();
}

function wireEvents() {
  $('origin-picker').addEventListener('change', (e) => {
    selected = e.target.value;
    renderAll();
  });

  $('predicate-list').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const name = button.dataset.name;
    applyChange(() =>
      button.dataset.act === 'grant' ? grant(selected, name) : revoke(selected, name)
    );
  });

  $('grant-typical').addEventListener('click', () =>
    applyChange(() => {
      for (const name of TYPICAL_GRANTS) {
        const r = grant(selected, name);
        if (!r.ok) return r;
      }
      return { ok: true };
    })
  );

  $('revoke-all').addEventListener('click', () => applyChange(() => revokeAll(selected)));

  $('clear-ledger').addEventListener('click', () => {
    clearLedger();
    renderLedger();
  });

  $('reset-facts').addEventListener('click', () => {
    resetFacts();
    renderFacts();
    renderAll();
  });

  $('facts-form').addEventListener('change', (e) => {
    const field = e.target.closest('[data-fact]');
    if (!field) return;
    const result = writeFact(field.dataset.fact, field.value);
    if (!result.ok) {
      $('banner-slot').innerHTML = '<div class="banner bad">' + esc(result.error) + '</div>';
      renderFacts();
      return;
    }
    $('banner-slot').innerHTML = '';
    renderAll();
  });
}

/* -------------------------------------------------------------------------- */
/* boot                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  renderStatus();
  renderOriginPicker();
  renderFacts();
  wireEvents();

  // Registry changes can originate from an agent calling a management tool, not
  // just from a click, so the view subscribes rather than assuming it caused
  // every change itself.
  onRegistryChange(renderAll);

  // The vault is open twice: standalone in its own tab, and embedded in the
  // letting agent's page. They are the same origin and share one grant record,
  // so a revocation in either must reach the other. `storage` fires only in the
  // *other* documents of an origin, which is exactly the wiring needed.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && !String(event.key).startsWith('bureau.')) return;
    sync()
      .then(renderAll)
      .catch((err) => console.error('[vault] cross-tab sync failed:', err));
  });

  await registerManagementTools();
  await sync();
  renderAll();
}

boot().catch((err) => {
  console.error('[vault] boot failed:', err);
  document.getElementById('banner-slot').innerHTML =
    '<div class="banner bad">The vault failed to start: ' + esc(String(err)) + '</div>';
});
