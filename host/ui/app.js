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
  pill.textContent = available ? 'webmcp live' : 'webmcp unavailable';
  pill.className = 'pill ' + (available ? 'ok' : 'no');
  $('origin-label').textContent = location.origin;

  if (available) return;
  $('banner-slot').innerHTML =
    '<div class="banner bad"><strong>This browser has no WebMCP.</strong> ' +
    'The site renders, but no capability can be borrowed and no check can run. ' +
    'Open in Chrome 149 or later, or enable <code>chrome://flags/#enable-webmcp-testing</code>.</div>';
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
    n === 0 ? 'nothing borrowed' : n + ' capabilit' + (n === 1 ? 'y' : 'ies') + ' borrowed';
}

function renderListings() {
  $('listings').innerHTML = LISTINGS.map((l) => {
    const active = l.id === activeListing;
    return (
      '<div class="cap' + (active ? ' is-live' : '') + '">' +
      '<div>' +
      '<div class="cap-name">' + esc(l.title) + '</div>' +
      '<div class="cap-title">' + esc(l.area) + ' · ' + gbp(l.monthlyRentGbp) + '/month · ' +
      l.bedrooms + ' bed · deposit ' + gbp(depositFor(l.monthlyRentGbp)) + '</div>' +
      '<div class="cap-reveals">' + (l.allowsPets ? 'Pets welcome' : 'No pets') +
      ' · up to ' + l.maxOccupants + ' occupants · available ' + esc(l.availableFromIso) + '</div>' +
      '</div>' +
      '<button class="' + (active ? 'primary' : '') + '" data-listing="' + esc(l.id) + '">' +
      (active ? 'run checks' : 'select') + '</button>' +
      '</div>'
    );
  }).join('');
}

function renderAssessment() {
  const listing = findListing(activeListing);
  const checks = resultsFor(activeListing);
  const box = $('assessment');

  if (assessing) {
    $('assess-caption').textContent = 'running';
    box.innerHTML = '<p class="note" style="margin:0">Asking the vault, one question at a time…</p>';
    return;
  }

  if (checks.length === 0) {
    $('assess-caption').textContent = '';
    box.innerHTML =
      '<p class="note" style="margin:0">No checks have run for ' + esc(listing.title) + '. ' +
      'Press <em>run checks</em>, or ask your agent to call <code>check_eligibility</code>.</p>';
    return;
  }

  const summary = summarise(checks);
  $('assess-caption').textContent = summary.decision.replace('_', ' ');

  const rows = checks
    .map((c) => {
      const cls = c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'no' : 'wait';
      const word =
        c.status === 'pass' ? 'yes' : c.status === 'fail' ? 'no' : c.status === 'blocked' ? 'not granted' : 'error';
      return (
        '<li style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;' +
        'padding:9px 0;border-bottom:1px solid var(--line)">' +
        '<div><div style="font-size:13px">' + esc(c.label) + (c.mandatory ? '' : ' <span class="note">(optional)</span>') + '</div>' +
        '<div class="cap-reveals" style="font-family:var(--mono)">' + esc(PROXY_PREFIX + c.predicate) + ' → ' + esc(c.detail) + '</div></div>' +
        '<span class="pill ' + cls + '">' + word + '</span></li>'
      );
    })
    .join('');

  const banner =
    summary.decision === 'eligible'
      ? '<div class="banner" style="border-color:var(--live);background:var(--live-dim);color:#c8f0d6">' +
        '<strong>Eligible.</strong> ' + esc(summary.reason) +
        ' We received ' + checks.length + ' yes-or-no answers and not one document.</div>'
      : '<div class="banner' + (summary.decision === 'not_eligible' ? ' bad' : '') + '"><strong>' +
        (summary.decision === 'not_eligible' ? 'Not eligible.' : 'Incomplete.') + '</strong> ' +
        esc(summary.reason) + '</div>';

  box.innerHTML = banner + '<ul class="reset">' + rows + '</ul>';
}

function renderTools() {
  const own = hostToolNames();
  const proxied = federationState().proxied;
  $('tool-count').textContent = own.length + proxied.length + ' published';

  const row = (name, kind, cls) =>
    '<li style="padding:6px 14px;border-bottom:1px solid var(--line);display:flex;' +
    'justify-content:space-between;gap:10px"><span>' + esc(name) + '</span>' +
    '<span class="pill ' + cls + '">' + kind + '</span></li>';

  $('tool-list').innerHTML =
    own.map((n) => row(n, 'ours', '')).join('') +
    (proxied.length
      ? proxied.map((n) => row(n, 'borrowed', 'ok')).join('')
      : '<li style="padding:8px 14px;color:var(--ink-faint)">no borrowed capabilities</li>');
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
    $('banner-slot').innerHTML = '<div class="banner bad">' + esc(errText(err)) + '</div>';
  } finally {
    assessing = false;
    renderAssessment();
  }
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
  document.getElementById('banner-slot').innerHTML =
    '<div class="banner bad">This site failed to start: ' + esc(String(err)) + '</div>';
});
