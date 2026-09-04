/**
 * @file The letting agent's user interface.
 *
 * Responsible for: rendering listings, running assessments, drawing the
 * capability graph, and keeping all three in step with what the vault currently
 * exposes.
 *
 * NOT responsible for: deciding what it may ask. That is entirely the vault's
 * call, and this page can only discover the answer by asking and being refused.
 */

import { LISTINGS, findListing, depositFor } from '../lib/listings.js';
import { discover, watchForChanges, federationState, onFederationChange, webmcpAvailable, federatedHandles, PROXY_PREFIX } from '../lib/federation.js';
import { assess, summarise, resultsFor, clearResults } from '../lib/assessment.js';
import { registerHostTools, hostToolNames } from '../lib/agentsurface.js';
import { escapeHtml as esc, gbp, errText } from '../lib/util.js';
import { drawGraph, shortOrigin } from './graph.js';
import { runDemo, demoRunning } from './demo.js';
import { vaultOrigin, hostOrigin } from '../config.js';

/** Listing the user is currently looking at. */
let activeListing = LISTINGS[0].id;

/** True while an assessment is running, so the button cannot be double-fired. */
let assessing = false;

const $ = (id) => document.getElementById(id);

/* -------------------------------------------------------------------------- */
/* rendering                                                                  */
/* -------------------------------------------------------------------------- */

function renderStatus() {
  const pill = $('mcp-status');
  const available = webmcpAvailable();
  pill.textContent = available ? 'connected' : 'no agent support';
  pill.className = 'tag ' + (available ? 'live' : 'off');
  $('origin-label').textContent = location.origin;

  if (available) return;
  $('notice-slot').innerHTML =
    '<div class="notice"><strong>This browser cannot talk to agents.</strong> ' +
    'The site works, but no question can be asked and no check can run. Open in Chrome 149 ' +
    'or later, or switch on <code style="font-family:var(--mono)">chrome://flags/#enable-webmcp-testing</code>.</div>';
}

function renderGraph() {
  drawGraph($('graph'), {
    vaultOrigin: vaultOrigin(),
    hostOrigin: hostOrigin(),
    borrowed: federatedHandles().map((t) => ({ name: String(t.name) })),
    vaultReachable: webmcpAvailable(),
  });
  const n = federatedHandles().length;
  $('graph-caption').textContent =
    n === 0
      ? 'Nothing yet. Allow a question in your file and it appears here.'
      : 'You have allowed us ' + n + ' question' + (n === 1 ? '' : 's') + '. That is all we can ask.';
}

function renderListings() {
  $('listings').innerHTML = LISTINGS.map((l) => {
    const active = l.id === activeListing;
    return (
      '<div class="perm' + (active ? ' is-live' : '') + '">' +
      '<div>' +
      '<p class="perm-title">' + esc(l.title) + '</p>' +
      '<p class="perm-reveals">' + esc(l.area) + ' &middot; ' + gbp(l.monthlyRentGbp) +
      ' a month &middot; ' + l.bedrooms + ' bed &middot; deposit ' + gbp(depositFor(l.monthlyRentGbp)) + '</p>' +
      '<p class="perm-reveals">' + (l.allowsPets ? 'Pets welcome' : 'No pets') +
      ' &middot; up to ' + l.maxOccupants + ' people &middot; free from ' + esc(l.availableFromIso) + '</p>' +
      '</div>' +
      '<button class="' + (active ? 'primary' : 'quiet') + '" data-listing="' + esc(l.id) + '">' +
      (active ? 'Check this one' : 'Choose') + '</button>' +
      '</div>'
    );
  }).join('');
}

function renderAssessment() {
  const listing = findListing(activeListing);
  const checks = resultsFor(activeListing);
  const box = $('assessment');
  const lede = $('assess-lede');

  if (assessing) {
    lede.textContent = 'Asking your file, one question at a time.';
    box.innerHTML = '';
    return;
  }

  if (checks.length === 0) {
    lede.textContent = 'Nothing checked yet for ' + listing.title + '.';
    box.innerHTML =
      '<p class="note">Press <em>Check this one</em>, or ask your assistant to run the checks.</p>';
    return;
  }

  const summary = summarise(checks);
  lede.textContent =
    summary.decision === 'eligible'
      ? 'Everything we need came back yes.'
      : summary.decision === 'not_eligible'
        ? 'One of the requirements came back no.'
        : 'We are still waiting on permission for something.';

  const rows = checks
    .map((c) => {
      const word =
        c.status === 'pass' ? 'yes' : c.status === 'fail' ? 'no'
          : c.status === 'blocked' ? 'not allowed' : 'error';
      const cls = c.status === 'pass' ? '' : c.status === 'fail' ? 'no' : 'pending';
      return (
        '<div class="reference-row">' +
        '<div>' +
        '<p class="reference-q" style="font-size:var(--t-base)">' + esc(c.label) + '</p>' +
        '<p class="perm-reveals" style="margin-top:.2rem">' + esc(c.detail) + '</p>' +
        '</div>' +
        '<span class="stamp ' + cls + ' is-fresh">' + word + '</span>' +
        '</div>'
      );
    })
    .join('');

  const verdict =
    summary.decision === 'eligible'
      ? '<div class="notice good"><strong>You qualify.</strong> We asked ' + checks.length +
        ' questions and received ' + checks.length + ' one-word answers. No documents changed hands.</div>'
      : summary.decision === 'not_eligible'
        ? '<div class="notice bad"><strong>Not this one.</strong> ' + esc(summary.reason) + '</div>'
        : '<div class="notice"><strong>Not finished.</strong> ' + esc(summary.reason) + '</div>';

  box.innerHTML = verdict + '<div class="reference">' + rows + '</div>';
}

function renderTools() {
  const own = hostToolNames();
  const proxied = federationState().proxied;
  $('tool-count').textContent = own.length + proxied.length + ' in total';

  const row = (name, kind, cls) =>
    '<li style="display:flex;justify-content:space-between;gap:.75rem;padding:.35rem 0;' +
    'border-bottom:1px solid var(--rule-soft)">' +
    '<span class="perm-name">' + esc(name) + '</span>' +
    '<span class="tag' + cls + '">' + kind + '</span></li>';

  $('tool-list').innerHTML =
    own.map((n) => row(n, 'ours', '')).join('') +
    (proxied.length
      ? proxied.map((n) => row(n, 'borrowed', ' live')).join('')
      : '<li class="note" style="padding:.35rem 0">Nothing borrowed from you.</li>');

  $('held-figure').textContent = 'Nothing';
}

function renderAll() {
  renderGraph();
  renderListings();
  renderAssessment();
  renderTools();
}

/* -------------------------------------------------------------------------- */
/* actions                                                                    */
/* -------------------------------------------------------------------------- */

async function runChecks() {
  if (assessing) return;
  assessing = true;
  renderAssessment();
  try {
    await assess(activeListing, federatedHandles());
  } catch (err) {
    $('notice-slot').innerHTML = '<div class="notice bad">' + esc(errText(err)) + '</div>';
  } finally {
    assessing = false;
    renderAssessment();
  }
}

/**
 * Render one beat of the guided demo, or clear the stage when it ends.
 *
 * @param {{caption: string, detail: string, output: string, index: number, total: number} | null} state
 */
function renderDemo(state) {
  const stage = $('demo-stage');
  const button = $('play-demo');

  if (state === null) {
    stage.hidden = true;
    button.disabled = false;
    button.textContent = 'Watch how it works';
    return;
  }

  stage.hidden = false;
  button.disabled = true;
  button.textContent = 'Playing';
  $('demo-progress').textContent = 'Step ' + state.index + ' of ' + state.total;
  $('demo-caption').textContent = state.caption;
  $('demo-detail').textContent = state.detail;

  const out = $('demo-output');
  out.hidden = state.output.length === 0;
  out.textContent = state.output;
}

function wireEvents() {
  $('listings').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-listing]');
    if (!button) return;
    const id = button.dataset.listing;
    if (id === activeListing) {
      runChecks();
      return;
    }
    activeListing = id;
    // A different property has different thresholds, so previous verdicts no
    // longer describe this application.
    clearResults();
    renderAll();
  });

  $('open-vault').addEventListener('click', () => window.open(vaultOrigin(), '_blank', 'noopener'));

  $('play-demo').addEventListener('click', () => {
    if (demoRunning()) return;
    runDemo(renderDemo).catch((err) => {
      renderDemo(null);
      $('notice-slot').innerHTML = '<div class="notice bad">The walkthrough stopped: ' + esc(errText(err)) + '</div>';
    });
  });
}

/* -------------------------------------------------------------------------- */
/* boot                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  renderStatus();
  $('vault-frame').src = vaultOrigin();
  wireEvents();

  await registerHostTools({
    handles: federatedHandles,
    onChange: () => renderAll(),
  });

  // Any change to the visible tool set, from any frame, means re-discovering.
  // This is the channel a revocation travels down: no polling, no server.
  onFederationChange(() => renderAll());

  const refresh = async () => {
    await discover(vaultOrigin());
    // Verdicts were produced under the old permission set, so they are dropped
    // rather than left on screen describing a grant that no longer exists.
    clearResults();
    renderAll();
  };

  watchForChanges(vaultOrigin());

  // The vault frame registers its tools after it loads, so the first discovery
  // waits for that load rather than racing it.
  $('vault-frame').addEventListener('load', () => {
    refresh().catch((err) => console.error('[host] discovery failed:', errText(err)));
  });

  await refresh();
  renderAll();
}

boot().catch((err) => {
  console.error('[host] boot failed:', err);
  document.getElementById('notice-slot').innerHTML =
    '<div class="notice bad"><strong>This site could not start.</strong> ' + esc(String(err)) + '</div>';
});
