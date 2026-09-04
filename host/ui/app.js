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

import { COMMIT, BUILT_AT } from '../build.js';
import { LISTINGS, findListing, depositFor } from '../lib/listings.js';
import { discover, watchForChanges, federationState, onFederationChange, webmcpAvailable, federatedHandles } from '../lib/federation.js';
import { assess, summarise, resultsFor, clearResults } from '../lib/assessment.js';
import { registerHostTools, hostToolNames } from '../lib/agentsurface.js';
import { escapeHtml as esc, gbp, errText } from '../lib/util.js';
import { drawGraph } from './graph.js';
import { compareDisclosure } from '../lib/counterfactual.js';
import { runDemo, demoRunning, stopDemo } from './demo.js';
import { vaultOrigin, hostOrigin } from '../config.js';
import { notify } from './toast.js';

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

/**
 * Draw the property list.
 *
 * The glyph is a plan, not a photograph. Every letting site is pictures of empty
 * rooms, this one has no real property to photograph, and a stock image would be
 * a lie about a flat that does not exist. So the glyph is drawn from the facts
 * that are true: one cell per bedroom, filled up to the occupancy limit.
 */
function renderListings() {
  // Counted, not written. The copy said "three" for some time after there were
  // five, which is the kind of small lie that makes a reader doubt the numbers
  // that matter.
  const count = LISTINGS.length;
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const spelled = words[count] ?? String(count);
  $('listings-lede').textContent =
    spelled.charAt(0).toUpperCase() + spelled.slice(1) +
    ' propert' + (count === 1 ? 'y' : 'ies') +
    ' in south Manchester. Each one asks for something slightly different.';

  $('listings').innerHTML = LISTINGS.map((l) => {
    const active = l.id === activeListing;
    const cells = Math.max(l.bedrooms, 4);
    const cols = Math.ceil(Math.sqrt(cells));
    const plan = Array.from({ length: cols * cols }, (_, i) =>
      '<i' + (i < l.bedrooms ? ' class="filled"' : '') + '></i>').join('');

    return (
      '<article class="listing' + (active ? ' is-active' : '') + '">' +
      '<div class="plan" aria-hidden="true" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
      plan + '</div>' +
      '<div>' +
      '<h3 class="listing-title">' + esc(l.title) + '</h3>' +
      '<p class="listing-meta">' + esc(l.area) + ' &middot; ' + l.bedrooms + ' bed &middot; ' +
      (l.allowsPets ? 'pets welcome' : 'no pets') + ' &middot; up to ' + l.maxOccupants + ' people</p>' +
      '<p class="listing-meta">Deposit ' + gbp(depositFor(l.monthlyRentGbp)) +
      ' &middot; free from ' + esc(l.availableFromIso) + '</p>' +
      '</div>' +
      '<div style="text-align:right">' +
      '<p class="listing-price">' + gbp(l.monthlyRentGbp) + '</p>' +
      '<p class="listing-meta" style="margin:0 0 .5rem">a month</p>' +
      '<button class="' + (active ? 'primary' : 'quiet') + '" data-listing="' + esc(l.id) + '">' +
      (active ? 'Check again' : 'Check this one') + '</button>' +
      '</div>' +
      '</article>'
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
    $('apply-controls').hidden = true;
    return;
  }

  if (checks.length === 0) {
    lede.textContent = 'Nothing checked yet for ' + listing.title + '.';
    box.innerHTML =
      '<p class="note">Press <em>Check this one</em>, or ask your assistant to run the checks.</p>';
    $('apply-controls').hidden = true;
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
          : c.status === 'blocked' ? 'not yet' : 'no answer';
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

  // The control appears once there is something to apply for. Marking every
  // unmet requirement on load would tell someone they had failed before they
  // had done anything, and by the time it mattered they would have stopped
  // seeing it.
  $('apply-controls').hidden = false;
  $('apply-note').textContent =
    summary.decision === 'eligible'
      ? 'Everything this landlord asks for has been answered.'
      : '';
}

function renderTools() {
  const own = hostToolNames();
  const proxied = federationState().proxied;
  $('tool-count').textContent = own.length + proxied.length + ' in total right now.';

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

  renderStageFigures();
}

/**
 * The three numbers on the stage.
 *
 * Deliberately the same three facts the whole argument rests on: how much was
 * allowed, how much is held, and how much was never asked for. The third is the
 * one nobody else can show, because it only exists if the questions replaced
 * documents.
 */
/**
 * Call one of this origin's own tools, the way an assistant would.
 *
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
async function callTool(name, args) {
  const tools = await document.modelContext.getTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) return 'Error: ' + name + ' is not available';
  // executeTool takes its arguments as a JSON string, not an object.
  return String(await document.modelContext.executeTool(tool, JSON.stringify(args)) ?? '');
}

function renderStageFigures() {
  const borrowed = federatedHandles().map((t) => String(t.name));
  $('fig-questions').textContent = String(borrowed.length);
  $('fig-held').textContent = 'Nothing';
  const c = compareDisclosure(borrowed);
  $('fig-avoided').textContent = String(c.extraFacts);
}

function renderAll() {
  renderGraph();
  renderStageFigures();
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
    notify('The checks could not run.', { tone: 'bad', detail: errText(err) });
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
    stage.classList.remove('is-halted');
    button.disabled = false;
    button.textContent = 'Watch how it works';
    return;
  }

  stage.hidden = false;
  button.disabled = true;
  button.textContent = 'Playing';
  $('demo-progress').textContent = state.halted
    ? 'Stopped at step ' + state.index + ' of ' + state.total
    : 'Step ' + state.index + ' of ' + state.total;
  $('demo-caption').textContent = state.caption;
  $('demo-detail').textContent = state.detail;

  // A stopped walkthrough must not look like a finished one. It carries the
  // weight of an error, because something the viewer was promised did not
  // happen and they need to know why.
  stage.classList.toggle('is-halted', Boolean(state.halted));

  const out = $('demo-output');
  out.hidden = state.output.length === 0;
  out.textContent = state.output;
}

function wireEvents() {
  $('listings').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-listing]');
    if (!button) return;
    const id = button.dataset.listing;

    if (id !== activeListing) {
      activeListing = id;
      // A different property has different thresholds, so the previous verdicts
      // no longer describe this application.
      clearResults();
      renderAll();
    }
    // One press, one answer. Requiring a second press to actually run the check
    // meant the button relabelled itself under the cursor and did nothing the
    // first time, which reads as a broken control.
    runChecks();
  });

  $('open-vault').addEventListener('click', () => window.open(vaultOrigin(), '_blank', 'noopener'));

  $('apply').addEventListener('click', async () => {
    const checks = resultsFor(activeListing);
    const summary = summarise(checks);

    if (summary.decision === 'eligible') {
      const out = await callTool('submit_application', { listing_id: activeListing });
      notify(out.startsWith('Error') ? 'That could not be submitted.' : 'Application sent.', {
        tone: out.startsWith('Error') ? 'bad' : 'good',
        detail: out,
      });
      return;
    }

    // Mark exactly the rows in the way, now that they have tried.
    const rows = [...document.querySelectorAll('#assessment .reference-row')];
    let marked = 0;
    checks.forEach((check, index) => {
      const blocking = check.mandatory && check.status !== 'pass';
      rows[index]?.classList.toggle('is-required', blocking);
      if (blocking) marked += 1;
    });

    $('apply-note').textContent = marked + ' marked with an asterisk still to settle.';
    notify(
      marked === 1 ? 'One requirement is still in the way.' : marked + ' requirements are still in the way.',
      { tone: 'bad', detail: summary.reason }
    );
    rows.find((r) => r.classList.contains('is-required'))
      ?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  });

  $('demo-stop').addEventListener('click', () => {
    stopDemo();
    renderDemo(null);
    notify('Walkthrough closed.', { tone: 'plain' });
  });

  $('play-demo').addEventListener('click', () => {
    if (demoRunning()) return;
    runDemo(renderDemo).catch((err) => {
      renderDemo(null);
      notify('The walkthrough could not finish.', { tone: 'bad', detail: errText(err) });
    });
  });
}

/* -------------------------------------------------------------------------- */
/* boot                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  renderStatus();
  // Tell the vault which origin embedded it. Cross-origin WebMCP is symmetric:
  // the vault must name this origin in `exposedTo` for anything to cross, and it
  // cannot learn that from its own URL.
  //
  // `location.origin` and not `hostOrigin()`. The configured value is a default
  // for whoever needs to *refer* to this site; the page itself knows where it is
  // actually running, and the two differ the moment it is served from anywhere
  // but the expected port. Naming the wrong origin here silently exposes nothing
  // at all, with no error on either side.
  //
  // In production the vault ignores this parameter, because its override accepts
  // localhost only, so a crafted link cannot redirect a grant at an origin the
  // person did not choose.
  $('vault-frame').src = vaultOrigin() + '?host=' + encodeURIComponent(location.origin);
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
