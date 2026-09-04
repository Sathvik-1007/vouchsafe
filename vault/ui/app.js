/**
 * @file The vault's interface.
 *
 * Responsible for: rendering the redacted reference, the permission list, the
 * disclosure figures, the file editor and the ledger, and wiring every control.
 *
 * NOT responsible for: any policy decision. Every control here calls into
 * `grants.js`, the only module allowed to widen access, and every change is
 * followed by `sync()` so the browser's registry and the screen never disagree.
 */

import { COMMIT, BUILT_AT } from '../build.js';
import {
  SEED_FACTS,
  APPLICANTS,
  readFacts,
  writeFact,
  resetFacts,
  loadApplicant,
  currentApplicantId,
  CREDIT_BANDS,
} from '../lib/facts.js';
import { PREDICATES, findPredicate } from '../lib/predicates.js';
import { compareDisclosure, counterfactualFor } from '../lib/counterfactual.js';
import { activeProbes, MAX_DISTINCT_PROBES } from '../lib/probe.js';
import { fieldLabel, FIELD_GROUPS, permissionQuestion, redactedValue } from '../lib/labels.js';
import { hostOrigin } from '../config.js';
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
import {
  sync,
  registerManagementTools,
  onRegistryChange,
  liveToolNames,
  webmcpAvailable,
} from '../lib/registry.js';

/** Bits at which the meter turns: nine one-bit answers is the whole ordinary check. */
const BITS_ROUTINE = 9;

/**
 * Bits at which the meter turns red.
 *
 * Anything above the nine one-bit answers of an ordinary check means a raw
 * disclosure is live. The cheapest of those, an exact salary, costs 9.8, so a
 * routine check plus one raw disclosure is 18.8 and must read as alarming. An
 * earlier value of 20 sat above the most expensive single tool in the
 * catalogue, at 19.9, so the red state was unreachable.
 */
const BITS_ALARMING = 12;

/** The nine permissions an ordinary English letting check actually needs. */
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

/** Currently selected letting agent. */
let selected = KNOWN_ORIGINS[0]?.origin ?? '';

/** Permissions that changed on the last render, so only those animate. */
let freshlyGranted = new Set();

const $ = (id) => document.getElementById(id);

/**
 * Escape text bound for an HTML string.
 *
 * Facts are typed by the user and appear inside the redaction bars, so they
 * reach the DOM as markup and must be escaped at every insertion point.
 *
 * @param {unknown} value
 * @returns {string}
 */
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

function renderStatus() {
  const available = webmcpAvailable();
  const pill = $('mcp-status');
  // "Ready", not "connected". Nothing is connected to anything; the page is
  // checking whether this browser can hand tools to an assistant at all.
  pill.textContent = available ? 'Ready for your assistant' : 'Your browser cannot do this yet';
  pill.className = 'tag ' + (available ? 'live' : 'off');
  $('origin-label').textContent = location.origin;
  // So a reader can match what is running to what is in the repository.
  $('build-stamp').textContent = COMMIT + ' \u00b7 ' + BUILT_AT;

  if (available) return;
  $('notice-slot').innerHTML =
    '<div class="notice"><strong>Your browser cannot hand this page to an assistant yet.</strong> ' +
    'Everything here still works, and your details are still only on this computer. To let an ' +
    'assistant answer for you, open this page in Chrome 149 or later. ' +
    '<a href="https://developer.chrome.com/docs/ai/webmcp" target="_blank" rel="noopener">How to turn it on</a>.</div>';
}

function renderOriginPicker() {
  $('origin-picker').innerHTML = KNOWN_ORIGINS.map(
    (o) => '<option value="' + esc(o.origin) + '">' + esc(o.label) + '</option>'
  ).join('');
  $('origin-picker').value = selected;
}

/**
 * The hero. One row per granted permission: what a letting agency would hold,
 * blacked out, and beside it the single word they actually get.
 */
function renderReference() {
  const facts = readFacts();
  const granted = readGrants()[selected] ?? [];
  const box = $('reference');
  const empty = $('reference-empty');

  if (granted.length === 0) {
    box.innerHTML = '';
    empty.textContent =
      'Nothing is allowed yet, so this agent holds nothing at all. Allow a question below and it appears here.';
    return;
  }
  empty.textContent = '';

  box.innerHTML = granted
    .map((name) => {
      const predicate = findPredicate(name);
      if (!predicate) return '';
      const covered = redactedValue(name, facts);
      const raw = predicate.category === 'raw disclosure';
      const isFresh = freshlyGranted.has(name);
      return (
        '<div class="reference-row">' +
        '<div>' +
        '<p class="reference-q">' + esc(permissionQuestion(name)) + '</p>' +
        '<p class="perm-reveals" style="margin-top:.3rem">They would have seen ' +
        '<span class="redacted' + (isFresh ? ' is-wiping' : '') + '">' + esc(covered) + '</span>' +
        '</p>' +
        '</div>' +
        (raw
          ? '<span class="stamp no' + (isFresh ? ' is-fresh' : '') + '">disclosed</span>'
          : '<span class="stamp' + (isFresh ? ' is-fresh' : '') + '">yes or no</span>') +
        '</div>'
      );
    })
    .join('');
}

function renderPermissions() {
  const parts = [];
  const seenCategory = [];

  for (const p of PREDICATES) {
    if (!seenCategory.includes(p.category)) {
      seenCategory.push(p.category);
      parts.push(
        '<h3 style="font-family:var(--serif);font-variation-settings:\'opsz\' 24;' +
          'font-size:var(--t-base);font-weight:600;margin:1.6rem 0 .2rem;color:var(--ink-mid)">' +
          esc(p.category === 'raw disclosure' ? 'The old way, for comparison' : p.category) +
          '</h3>'
      );
    }

    const live = isGranted(selected, p.name);
    const costly = p.disclosureBits > 1;
    parts.push(
      '<div class="perm' + (live ? ' is-live' : '') + '">' +
        '<div>' +
        '<p class="perm-title">' + esc(permissionQuestion(p.name)) + '</p>' +
        '<p class="perm-reveals">' + esc(p.reveals) + '</p>' +
        '<span class="perm-name">' + esc(p.name) + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:.75rem;align-items:center">' +
        '<span class="cost' + (costly ? ' high' : '') + '">' + p.disclosureBits + ' bit' +
        (p.disclosureBits === 1 ? '' : 's') + '</span>' +
        '<button class="' + (live ? 'revoke' : 'grant') + '" data-act="' +
        (live ? 'revoke' : 'grant') + '" data-name="' + esc(p.name) + '">' +
        (live ? 'Withdraw' : 'Allow') + '</button>' +
        '</div>' +
        '</div>'
    );
  }
  $('permission-list').innerHTML = parts.join('');
}

function renderDisclosure() {
  const bits = disclosedBits(selected);
  const count = (readGrants()[selected] ?? []).length;

  $('bits-total').textContent = Number.isInteger(bits) ? String(bits) : bits.toFixed(1);
  $('bits-total').className = 'figure ' + (bits >= BITS_ALARMING ? 'refused' : 'stamped');
  $('bits-label').textContent =
    count === 0 ? 'nothing handed over' : 'bits about you handed over, across ' + count + ' question' + (count === 1 ? '' : 's');

  const bar = $('bits-bar');
  bar.style.width = Math.min(100, (bits / BITS_ALARMING) * 100) + '%';
  bar.className = bits >= BITS_ALARMING ? 'over' : '';

  $('bits-explain').textContent =
    bits === 0
      ? 'This agent knows nothing about you.'
      : bits <= BITS_ROUTINE
        ? 'Every one of these is a single yes or no, and it expires the moment you withdraw it. The documents that answer the same questions would have been a copy, kept.'
        : bits < BITS_ALARMING
          ? 'Past the ordinary check. Something here gives away more than a yes or no.'
          : 'A raw disclosure is live. This agent can identify you directly.';
}

/**
 * The three numbers on the stage: what was given, what was withheld, and the
 * ratio between them. Hidden entirely when nothing is allowed, because zeroes
 * with a triumphant label are worse than no claim at all.
 */
function renderStage() {
  const granted = readGrants()[selected] ?? [];
  const bits = disclosedBits(selected);
  const c = compareDisclosure(granted);
  const n = granted.length;

  // The headline states what is true right now. An earlier version asserted
  // "they asked nine questions" while the counters underneath read zero, which
  // is a claim the interface itself contradicts.
  $('stage-claim').innerHTML =
    n === 0
      ? 'They will ask. Your file answers in <em>one word</em>.'
      : 'They asked ' + spell(n) + ' question' + (n === 1 ? '' : 's') +
        '. They received <em>' + spell(n) + ' word' + (n === 1 ? '' : 's') + '</em>.';

  $('stage-sub').textContent =
    n === 0
      ? 'Nothing is allowed yet, so this agent holds nothing at all. Everything a letting agency normally demands is already here, and there is no code on this page that could send it anywhere.'
      : 'Everything they would normally have held about you is still here, on your side of the line, and there is no code on this page that could send it anywhere.';

  $('stage-bits').textContent = Number.isInteger(bits) ? String(bits) : bits.toFixed(1);
  $('stage-avoided').textContent = String(c.extraFacts);
  $('stage-ratio').textContent = c.ratio > 0 ? c.ratio + '\u00d7' : '\u2014';
}

/**
 * Small numbers read better as words in a headline set at display size, where
 * a lone numeral looks like a typo rather than a claim.
 *
 * @param {number} n
 * @returns {string}
 */
function spell(n) {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
                 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen'];
  return words[n] ?? String(n);
}

function renderCounterfactual() {
  const granted = readGrants()[selected] ?? [];
  const box = $('counterfactual');

  if (granted.length === 0) {
    box.innerHTML = '';
    return;
  }

  const c = compareDisclosure(granted);
  if (c.documents.length === 0) {
    box.innerHTML =
      '<p class="note">These are raw disclosures. There is no document they spare you, ' +
      'because they hand over the contents directly.</p>';
    return;
  }

  box.innerHTML =
    '<h2 style="font-family:var(--serif);font-size:var(--t-md);font-weight:600;margin:0 0 .35rem">' +
    'Still yours</h2>' +
    '<p class="note" style="margin:0 0 .9rem">' + c.extraFacts +
    ' things about you that nobody asked for, in ' + c.documents.length +
    ' documents you did not send.</p>' +
    '<ul class="plain">' +
    c.documents
      .map(
        (d) =>
          '<li style="padding:.4rem 0;border-bottom:1px solid var(--rule-soft);font-size:var(--t-sm)">' +
          '<span class="redacted">' + esc(d) + '</span></li>'
      )
      .join('') +
    '</ul>' +
    '<p class="note" style="margin-top:.9rem">Roughly ' + c.ratio +
    ' times less given away than the usual way.</p>';
}

function renderProbes() {
  const probes = activeProbes();
  const panel = $('probe-panel');
  if (probes.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $('probe-report').innerHTML =
    'A question you allowed is being asked over and over with different numbers, ' +
    'which works out the figure behind it. Each answer was legitimate. The run is not.' +
    '<ul class="plain" style="margin-top:.6rem">' +
    probes
      .map(
        (p) =>
          '<li style="margin-bottom:.35rem"><b>' + esc(permissionQuestion(p.predicate)) +
          '</b> asked ' + p.probes + ' times, narrowing the figure by about ' + p.bits + ' bits.</li>'
      )
      .join('') +
    '</ul><p class="note" style="margin:.6rem 0 0">Answers stop after ' + MAX_DISTINCT_PROBES +
    ' different numbers. Withdrawing the question stops it now.</p>';
}

function renderLiveTools() {
  const names = liveToolNames();
  $('live-tools').innerHTML = names.length
    ? names
        .map((n) => {
          const own = n.startsWith('vault_');
          return (
            '<li style="display:flex;justify-content:space-between;gap:.75rem;padding:.35rem 0;' +
            'border-bottom:1px solid var(--rule-soft)">' +
            '<span class="perm-name">' + esc(n) + '</span>' +
            '<span class="tag' + (own ? '' : ' live') + '">' + (own ? 'yours only' : 'shared') + '</span></li>'
          );
        })
        .join('')
    : '<li class="note">Nothing is answerable yet.</li>';
}

function renderLedger() {
  const entries = readLedger().slice(0, 40);
  $('ledger').innerHTML = entries.length
    ? entries
        .map((e) => {
          const time = String(e.at ?? '').slice(11, 19);
          const verb =
            { grant: 'allowed', revoke: 'withdrew', answer: 'answered', rejected: 'refused',
              blocked: 'stopped', error: 'failed' }[e.kind] ?? String(e.kind);
          const cls = e.kind === 'answer' ? 'answer' : e.kind === 'blocked' || e.kind === 'rejected' ? 'denied' : '';
          const detail = e.answer ? ' — ' + esc(e.answer) : e.error ? ' — ' + esc(e.error) : '';
          return (
            '<li><time>' + esc(time) + '</time>' +
            '<span class="what"><span class="' + cls + '">' + esc(verb) + '</span> ' +
            '<b>' + esc(permissionQuestion(e.predicate)) + '</b>' + detail + '</span></li>'
          );
        })
        .join('')
    : '<li><span class="what note">Nothing has been asked yet.</span></li>';
}

/**
 * Draw the sample-applicant picker.
 *
 * Three of them rather than one, because a product that only ever shows a pass
 * never shows what it is for. Each qualifies for exactly one of the five
 * properties, so a reader can reach a yes, a no and a not-yet without editing a
 * single field by hand.
 */
function renderApplicantPicker() {
  const current = currentApplicantId();
  const picker = $('applicant-picker');

  picker.innerHTML = APPLICANTS.map(
    (a) =>
      '<option value="' + esc(a.id) + '"' + (a.id === current ? ' selected' : '') + '>' +
      esc(a.label) + '</option>'
  ).join('') + (current === null ? '<option value="" selected>Your own edits</option>' : '');

  $('applicant-summary').textContent =
    APPLICANTS.find((a) => a.id === current)?.summary ??
    'You have edited the details, so this no longer matches any of the samples.';
}

function renderFacts() {
  const facts = readFacts();
  const byGroup = new Map(FIELD_GROUPS.map((g) => [g, []]));

  for (const key of Object.keys(SEED_FACTS)) {
    const meta = fieldLabel(key);
    const value = facts[key];
    let control;

    if (key === 'creditBand') {
      control =
        '<select data-fact="' + esc(key) + '" id="f-' + esc(key) + '">' +
        CREDIT_BANDS.map(
          (b) =>
            '<option value="' + b + '"' + (b === value ? ' selected' : '') + '>' +
            b.replace('_', ' ') + '</option>'
        ).join('') + '</select>';
    } else if (typeof SEED_FACTS[key] === 'boolean') {
      control =
        '<select data-fact="' + esc(key) + '" id="f-' + esc(key) + '">' +
        '<option value="true"' + (value ? ' selected' : '') + '>Yes</option>' +
        '<option value="false"' + (!value ? ' selected' : '') + '>No</option></select>';
    } else {
      const isDate = key.endsWith('Iso');
      const type = isDate ? 'date' : typeof SEED_FACTS[key] === 'number' ? 'number' : 'text';
      control =
        '<input type="' + type + '" data-fact="' + esc(key) + '" id="f-' + esc(key) +
        '" value="' + esc(value) + '">';
    }

    (byGroup.get(meta.group) ?? byGroup.get('You')).push(
      '<label style="margin-bottom:.9rem">' +
        '<span class="field-label">' + esc(meta.label) +
        (meta.unit ? ' <span class="note">(' + esc(meta.unit) + ')</span>' : '') + '</span>' +
        control +
        (meta.hint ? '<span class="note" style="display:block;margin-top:.2rem">' + esc(meta.hint) + '</span>' : '') +
        '</label>'
    );
  }

  $('facts-form').innerHTML = FIELD_GROUPS.map(
    (g) =>
      '<fieldset style="border:0;padding:0;margin:0 0 1.5rem">' +
      '<legend style="font-family:var(--serif);font-variation-settings:\'opsz\' 24;' +
      'font-size:var(--t-base);font-weight:600;padding:0;margin-bottom:.6rem">' + esc(g) + '</legend>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:0 1.25rem">' +
      (byGroup.get(g) ?? []).join('') +
      '</div></fieldset>'
  ).join('');
}

/** Redraw everything that depends on grant or fact state. */
function renderAll() {
  renderStage();
  renderReference();
  renderPermissions();
  renderDisclosure();
  renderCounterfactual();
  renderProbes();
  renderLiveTools();
  renderLedger();
  // Animations play once, on the render that follows the change that caused them.
  freshlyGranted = new Set();
}

/**
 * Ask a destructive button to be pressed twice.
 *
 * `window.confirm` was the obvious choice and the wrong one. Chrome suppresses
 * dialogs from a cross-origin iframe, and this panel spends most of its life
 * embedded in a letting agent's page, so the guard would have been absent
 * exactly where the button is easiest to hit by accident. It also blocks the
 * page, which no confirmation needs to.
 *
 * So the button asks for itself again, in place, and gives up after a few
 * seconds. Nothing is destroyed on a single press.
 *
 * @param {HTMLButtonElement} button
 * @param {string} prompt what the second press will do
 * @returns {boolean} true when this is the confirming press
 */
function confirmTwice(button, prompt) {
  if (button.dataset.armed === 'yes') {
    clearTimeout(Number(button.dataset.timer));
    button.dataset.armed = 'no';
    button.textContent = button.dataset.restLabel ?? button.textContent;
    return true;
  }

  button.dataset.restLabel = button.textContent;
  button.dataset.armed = 'yes';
  button.textContent = prompt;
  button.dataset.timer = String(
    setTimeout(() => {
      button.dataset.armed = 'no';
      button.textContent = button.dataset.restLabel ?? button.textContent;
    }, 5000)
  );
  return false;
}

/**
 * Say what just happened.
 *
 * Every control that changes something says so. Before this, granting,
 * withdrawing, clearing the log and restoring the sample all changed state in
 * silence, and the only way to tell a working button from a broken one was to
 * go looking for the effect.
 *
 * @param {string} message
 * @param {'good' | 'bad'} [tone]
 * @returns {void}
 */
function announce(message, tone = 'good') {
  $('notice-slot').innerHTML =
    '<div class="notice ' + tone + '">' + esc(message) + '</div>';
  clearTimeout(announce.timer);
  // Confirmations are transient; errors stay until something else replaces them.
  if (tone === 'good') {
    announce.timer = setTimeout(() => {
      if ($('notice-slot').textContent === message) $('notice-slot').innerHTML = '';
    }, 6000);
  }
}

/**
 * Put a validation message into the words the field is labelled with.
 *
 * The stores validate against wire names, because that is what they hold. The
 * person is looking at a field called "People moving in, including you" and
 * being told "householdSize cannot exceed 32", which reads as someone else's
 * error leaking through.
 *
 * @param {string} key   fact key the message is about
 * @param {string} error message as the store phrased it
 * @returns {string}
 */
function humanise(key, error) {
  const label = fieldLabel(key).label;
  return error.startsWith(key)
    ? label + error.slice(key.length)
    : label + ': ' + error;
}

/* -------------------------------------------------------------------------- */
/* actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Apply a grant change, reconcile the registry, then redraw.
 *
 * `sync()` is what publishes or withdraws the tool, so redrawing before it
 * returns would show a permission as live while the browser had not registered
 * it.
 *
 * @param {() => {ok: boolean, error?: string}} mutate
 * @param {string[]} [animate] permission names that should play their reveal
 */
async function applyChange(mutate, animate = [], said = '') {
  const result = mutate();
  if (!result.ok) {
    announce(result.error ?? 'That change could not be saved. Nothing has been altered.', 'bad');
    return;
  }
  freshlyGranted = new Set(animate);
  await sync();
  renderAll();

  // Registration can fail after the grant has been recorded, and a row reading
  // "allowed" beside a tool that does not exist is the one state this product
  // must never show. Reconcile before claiming success.
  const missing = (readGrants()[selected] ?? []).filter((n) => !liveToolNames().includes(n));
  if (missing.length > 0) {
    announce(
      'Saved, but ' + missing.length + ' of these could not be made answerable in this browser. ' +
        'They are recorded, and will work when you open this page in a browser that supports it.',
      'bad'
    );
    return;
  }
  if (said) announce(said);
  else $('notice-slot').innerHTML = '';
}

function wireEvents() {
  $('origin-picker').addEventListener('change', (e) => {
    selected = e.target.value;
    renderAll();
  });

  $('permission-list').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    const name = button.dataset.name;
    const granting = button.dataset.act === 'grant';
    const question = permissionQuestion(name).replace(/\?$/, '');
    applyChange(
      () => (granting ? grant(selected, name) : revoke(selected, name)),
      granting ? [name] : [],
      granting
        ? 'Allowed. They may now ask: ' + question + '.'
        : 'Withdrawn. That question can no longer be asked, and the tool has gone from their side.'
    );
  });

  $('grant-typical').addEventListener('click', () =>
    applyChange(() => {
      for (const name of TYPICAL_GRANTS) {
        const r = grant(selected, name);
        if (!r.ok) return r;
      }
      return { ok: true };
    }, TYPICAL_GRANTS, 'Allowed all nine. That is the whole of an ordinary letting check, and it is nine bits.')
  );

  $('revoke-all').addEventListener('click', () => {
    const held = (readGrants()[selected] ?? []).length;
    if (held === 0) {
      announce('There was nothing to withdraw. This agent already holds no permissions.');
      return;
    }
    // Irreversible, and it sits next to the button that grants.
    if (!confirmTwice($('revoke-all'), 'Press again to withdraw all ' + held)) return;
    applyChange(() => revokeAll(selected), [], 'Withdrew all ' + held + '. This agent can no longer ask anything.');
  });

  $('clear-ledger').addEventListener('click', () => {
    const entries = readLedger().length;
    if (entries === 0) {
      announce('The log is already empty.');
      return;
    }
    if (!confirmTwice($('clear-ledger'), 'Press again to clear ' + entries)) return;
    const result = clearLedger();
    if (!result.ok) {
      announce('The log could not be cleared: ' + result.error, 'bad');
      return;
    }
    renderLedger();
    announce('Log cleared.');
  });

  $('applicant-picker').addEventListener('change', (e) => {
    const result = loadApplicant(e.target.value);
    if (!result.ok) {
      $('notice-slot').innerHTML = '<div class="notice bad">' + esc(result.error) + '</div>';
      return;
    }
    renderFacts();
    renderApplicantPicker();
    renderAll();
    announce('Switched to ' + e.target.selectedOptions[0].textContent + '. Every answer below now comes from their details.');
  });

  $('reset-facts').addEventListener('click', () => {
    if (!confirmTwice($('reset-facts'), 'Press again to discard your edits')) return;
    const result = resetFacts();
    if (!result.ok) {
      $('notice-slot').innerHTML = '<div class="notice bad">' + esc(result.error) + '</div>';
      return;
    }
    renderFacts();
    renderApplicantPicker();
    renderAll();
    announce('Sample details restored.');
  });

  $('facts-form').addEventListener('change', (e) => {
    const field = e.target.closest('[data-fact]');
    if (!field) return;
    const key = field.dataset.fact;
    const result = writeFact(key, field.value);
    if (!result.ok) {
      $('notice-slot').innerHTML =
        '<div class="notice bad">' + esc(humanise(key, result.error)) + '</div>';
      renderFacts();
      return;
    }
    announce(fieldLabel(key).label + ' updated. Every answer that uses it has changed.');
    renderAll();
  });
}

/* -------------------------------------------------------------------------- */
/* demo mode                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Is the embedding page allowed to drive these switches?
 *
 * Off unless the person turns it on, and never persisted, so it dies with the
 * tab. Without this the letting agent could message itself a permission, which
 * would make the whole consent model theatre. A demonstration of a consent
 * model is worth nothing if the model is suspended while it plays.
 */
let demoArmed = false;

/**
 * Answer a request from the embedding page.
 *
 * Every request gets a reply, refusals included. Silence was the old behaviour,
 * and it let the walkthrough carry on narrating a grant that never happened.
 * Saying no out loud is what lets the other side stop.
 *
 * @param {MessageEvent} event
 * @param {boolean} ok
 * @returns {void}
 */
function replyToHost(event, ok) {
  event.source?.postMessage(
    { source: 'bureau-vault', ok, granted: (readGrants()[selected] ?? []).length },
    event.origin
  );
}

function listenForDemoRequests() {
  window.addEventListener('message', async (event) => {
    if (event.origin !== hostOrigin()) return;
    if (event.data?.source !== 'bureau-demo') return;

    if (!demoArmed) {
      replyToHost(event, false);
      return;
    }

    const { action, predicate } = event.data;
    if (action === 'grant-typical') {
      await applyChange(() => {
        for (const name of TYPICAL_GRANTS) {
          const r = grant(selected, name);
          if (!r.ok) return r;
        }
        return { ok: true };
      }, TYPICAL_GRANTS);
    } else if (action === 'revoke-all') {
      await applyChange(() => revokeAll(selected));
    } else if (action === 'revoke' && typeof predicate === 'string') {
      await applyChange(() => revoke(selected, predicate));
    } else {
      replyToHost(event, false);
      return;
    }

    // Replied only after the change has landed and the registry has re-synced,
    // so the count the other side receives is the count that is actually live.
    replyToHost(event, true);
  });
}

function renderDemoSwitch() {
  const slot = $('demo-slot');
  // Only meaningful when embedded; standalone there is nothing to talk to.
  if (window.top === window) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.innerHTML =
    '<label style="display:flex;gap:.6rem;align-items:flex-start;cursor:pointer">' +
    '<input type="checkbox" id="demo-toggle" style="width:auto;margin-top:.35rem"' +
    (demoArmed ? ' checked' : '') + '>' +
    '<span><span style="font-weight:600">Let the walkthrough use these switches</span>' +
    '<span class="note" style="display:block">Off by default. Without it the letting agent ' +
    'cannot change a single permission, which is rather the point.</span></span></label>';

  $('demo-toggle').addEventListener('change', (e) => {
    demoArmed = e.target.checked;
  });
}

/* -------------------------------------------------------------------------- */
/* boot                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  // Embedded, the page around this one has already explained what it is, so the
  // explanatory sections are dropped and the controls come first.
  if (window.top !== window) document.body.classList.add('embedded');

  renderStatus();
  renderOriginPicker();
  renderFacts();
  renderApplicantPicker();
  renderDemoSwitch();
  listenForDemoRequests();
  wireEvents();

  // The vault is open twice: standalone, and embedded in the letting agent's
  // page. They share one grant record, so a change in either must reach the
  // other. `storage` fires only in the *other* documents of an origin.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && !String(event.key).startsWith('bureau.')) return;
    sync().then(renderAll).catch((err) => console.error('[vault] cross-tab sync failed:', err));
  });

  // Changes can also originate from an agent calling a management tool, so the
  // view subscribes rather than assuming it caused every change itself.
  onRegistryChange(renderAll);

  await registerManagementTools();
  await sync();
  renderAll();
}

boot().catch((err) => {
  console.error('[vault] boot failed:', err);
  $('notice-slot').innerHTML =
    '<div class="notice bad"><strong>Your file could not open.</strong> ' + esc(String(err)) + '</div>';
});
