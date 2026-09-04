/**
 * @file End-to-end tests: a real browser, real cross-origin federation, every control.
 *
 * The unit suite covers pure logic and cannot see a button. This drives an
 * actual Chromium with WebMCP enabled, serves both origins, and exercises the
 * interface the way a person does: click, assert what changed, click again.
 *
 * It asserts on three surfaces at once, because in this product they can
 * disagree and a bug that matters is exactly a disagreement between them:
 *   1. the DOM the person is looking at,
 *   2. the browser's own tool registry via `document.modelContext.getTools()`,
 *   3. what the *other* origin can see across the boundary.
 *
 * Run: node tests/e2e.mjs
 * Needs: a Chromium with WebMCP (Chrome 149+, or any build launched with
 *        --enable-features=WebMCP). Set BROWSER=/path/to/binary to override.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VAULT_PORT = 4401;
const HOST_PORT = 4402;
const VAULT_ORIGIN = `http://localhost:${VAULT_PORT}`;
const HOST_ORIGIN = `http://localhost:${HOST_PORT}`;
const DEBUG_PORT = 9333;

/** Candidate browser binaries, in preference order. */
const BROWSERS = [
  process.env.BROWSER,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/brave',
].filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* -------------------------------------------------------------------------- */
/* harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Serve one directory, refusing any path that escapes it.
 *
 * @param {string} dir
 * @param {number} port
 * @returns {Promise<import('node:http').Server>}
 */
function serve(dir, port) {
  const root = join(ROOT, dir);
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    if (rel === '/' || rel === '\\') file = join(root, 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

/** Minimal CDP client with per-frame evaluation. */
class Browser {
  #ws; #id = 0; #pending = new Map(); #contexts = []; #logs = [];

  static async launch() {
    const bin = BROWSERS.find((b) => existsSync(b));
    if (!bin) throw new Error('no Chromium found; set BROWSER=/path/to/chrome');
    const profile = await mkdtemp(join(tmpdir(), 'bureau-e2e-'));
    const proc = spawn(bin, [
      '--enable-features=WebMCP',
      '--enable-blink-features=WebMCP',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1600,1000',
      'about:blank',
    ], { stdio: 'ignore', detached: true });

    // Poll rather than sleep a fixed amount: a cold profile takes longer.
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://localhost:${DEBUG_PORT}/json`)).json();
        if (list.some((t) => t.type === 'page')) break;
      } catch { /* not up yet */ }
      await sleep(500);
    }
    const b = new Browser();
    b.proc = proc;
    await b.attach();
    return b;
  }

  async attach() {
    const list = await (await fetch(`http://localhost:${DEBUG_PORT}/json`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('browser started but exposed no page');
    this.#ws = new WebSocket(page.webSocketDebuggerUrl);
    this.#ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.#pending.has(m.id)) { this.#pending.get(m.id)(m); this.#pending.delete(m.id); return; }
      if (m.method === 'Runtime.executionContextCreated') this.#contexts.push(m.params.context);
      if (m.method === 'Runtime.executionContextsCleared') this.#contexts = [];
      if (m.method === 'Runtime.exceptionThrown') {
        this.#logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.#logs.push('console.error ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    };
    await new Promise((r) => { this.#ws.onopen = r; });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  }

  send(method, params = {}) {
    return new Promise((r) => {
      const id = ++this.#id;
      this.#pending.set(id, r);
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Console errors seen since the last drain. */
  drainErrors() { const l = this.#logs; this.#logs = []; return l; }

  async goto(url, settleMs = 2500) {
    this.#contexts = [];
    await this.send('Page.navigate', { url });
    await sleep(settleMs);
  }

  /**
   * Evaluate in the frame whose origin matches, so the vault iframe can be
   * driven directly rather than through its parent.
   *
   * @param {string} origin
   * @param {string} expression
   * @returns {Promise<unknown>}
   */
  async evalIn(origin, expression) {
    const candidates = [...this.#contexts].reverse().filter((c) => c.origin === origin);
    if (candidates.length === 0) {
      throw new Error(`no execution context for ${origin} (have: ${[...new Set(this.#contexts.map((c) => c.origin))].join(', ')})`);
    }
    // Contexts accumulate across navigations and a detached one answers with
    // an error rather than a value, so walk newest-first until one responds.
    let lastError = null;
    for (const ctx of candidates) {
      const res = await this.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, contextId: ctx.id,
      });
      if (res.error) { lastError = res.error.message; continue; }
      if (res.result?.exceptionDetails) {
        throw new Error('eval threw in ' + origin + ': ' +
          (res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text));
      }
      return res.result?.result?.value;
    }
    throw new Error(`every context for ${origin} rejected the call: ${lastError}`);
  }

  close() { try { this.proc?.kill(); } catch { /* already gone */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------------------- */
/* assertions                                                                 */
/* -------------------------------------------------------------------------- */

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  pass  ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  FAIL  ' + name + '\n        ' + (err instanceof Error ? err.message : String(err)));
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function ok(value, what) {
  if (!value) throw new Error(what);
}

/* -------------------------------------------------------------------------- */
/* the suite                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  const servers = [await serve('vault', VAULT_PORT), await serve('host', HOST_PORT)];
  const browser = await Browser.launch();
  console.log(`\nBureau end-to-end\n  vault ${VAULT_ORIGIN}\n  host  ${HOST_ORIGIN}\n`);

  /** Tool names registered in a given origin's document. */
  const toolsIn = (origin) =>
    browser.evalIn(origin, `(async()=>(await document.modelContext.getTools()).map(t=>t.name).sort())()`);

  /** Tool names the host can see across the boundary. */
  const federatedFromVault = () =>
    browser.evalIn(HOST_ORIGIN,
      `(async()=>(await document.modelContext.getTools({fromOrigins:['${VAULT_ORIGIN}']}))
        .filter(t=>t.origin==='${VAULT_ORIGIN}').map(t=>t.name).sort())()`);

  const clickVault = (sel) => browser.evalIn(VAULT_ORIGIN,
    `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'MISSING'; e.click(); return 'ok';})()`);

  const textIn = (origin, sel) => browser.evalIn(origin,
    `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e?e.textContent.replace(/\\s+/g,' ').trim():'MISSING';})()`);

  // ---- the vault, standalone ---------------------------------------------
  console.log('vault, on its own');
  await browser.goto(`${VAULT_ORIGIN}/?host=${encodeURIComponent(HOST_ORIGIN)}`, 3500);

  await check('page loads with WebMCP available', async () => {
    eq(await browser.evalIn(VAULT_ORIGIN, '!!document.modelContext'), true, 'modelContext');
    // Assert the state the pill reports, not the sentence it uses. A copy edit
    // should not fail a behaviour test.
    eq(
      await browser.evalIn(VAULT_ORIGIN, `document.getElementById('mcp-status').className`),
      'tag live',
      'status pill does not report a working WebMCP'
    );
  });

  await check('management tools register, and only same-origin ones', async () => {
    const tools = await toolsIn(VAULT_ORIGIN);
    ok(tools.includes('vault_list_grants'), 'vault_list_grants missing');
    ok(tools.includes('vault_probe_report'), 'vault_probe_report missing');
    ok(tools.every((t) => t.startsWith('vault_')), 'a predicate leaked before any grant: ' + tools.join(','));
  });

  await check('nothing is granted on a clean load', async () => {
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '0', 'bits');
    ok((await textIn(VAULT_ORIGIN, '#reference-empty')).includes('Nothing is allowed'), 'empty state copy');
  });

  await check('the headline states what is true, not a fixed claim', async () => {
    // It previously asserted "they asked nine questions" while the counters
    // underneath read zero. An interface that contradicts itself is worse than
    // one that says less.
    const idle = await textIn(VAULT_ORIGIN, '#stage-claim');
    ok(!/nine/i.test(idle), 'headline claims nine with nothing allowed: ' + idle);
    eq(await textIn(VAULT_ORIGIN, '#stage-bits'), '0', 'bits should be zero here');
  });

  await check('"Allow the standard nine" registers nine predicates', async () => {
    eq(await clickVault('#grant-typical'), 'ok', 'button present');
    await sleep(900);
    const tools = await toolsIn(VAULT_ORIGIN);
    const predicates = tools.filter((t) => !t.startsWith('vault_'));
    eq(predicates.length, 9, 'predicate count');
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '9', 'bits after granting nine');
  });

  await check('the headline updates once questions are allowed', async () => {
    const claim = await textIn(VAULT_ORIGIN, '#stage-claim');
    ok(/nine/i.test(claim), 'headline did not follow the state: ' + claim);
    eq(await textIn(VAULT_ORIGIN, '#stage-bits'), '9', 'stage bits');
  });

  await check('the redacted reference renders one row per allowed question', async () => {
    const rows = await browser.evalIn(VAULT_ORIGIN, `document.querySelectorAll('#reference .reference-row').length`);
    eq(rows, 9, 'reference rows');
    const bars = await browser.evalIn(VAULT_ORIGIN, `document.querySelectorAll('#reference .redacted').length`);
    eq(bars, 9, 'redaction bars');
  });

  await check('no underlying value is legible in the reference', async () => {
    // The bar covers the text visually, but the text is still in the DOM. What
    // matters is that it never leaves this origin, which the federation tests
    // below assert. Here we only check the bar is actually applied.
    const covered = await browser.evalIn(VAULT_ORIGIN,
      `getComputedStyle(document.querySelector('#reference .redacted')).color`);
    ok(covered.includes('rgba(0, 0, 0, 0)') || covered === 'transparent', 'redaction text is not transparent: ' + covered);
  });

  await check('every permission row has a working toggle', async () => {
    const count = await browser.evalIn(VAULT_ORIGIN, `document.querySelectorAll('#permission-list button[data-act]').length`);
    eq(count, 13, 'one button per predicate');
  });

  await check('withdrawing one permission unregisters exactly that tool', async () => {
    eq(await clickVault('#permission-list button[data-name="income_meets_multiple"]'), 'ok', 'button');
    await sleep(800);
    const tools = await toolsIn(VAULT_ORIGIN);
    ok(!tools.includes('income_meets_multiple'), 'tool still registered after withdrawal');
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '8', 'bits after withdrawing one');
  });

  await check('allowing it again re-registers it', async () => {
    eq(await clickVault('#permission-list button[data-name="income_meets_multiple"]'), 'ok', 'button');
    await sleep(800);
    ok((await toolsIn(VAULT_ORIGIN)).includes('income_meets_multiple'), 'tool did not come back');
  });

  await check('a raw disclosure costs visibly more', async () => {
    eq(await clickVault('#permission-list button[data-name="disclose_exact_income"]'), 'ok', 'button');
    await sleep(700);
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '18.8', 'bits after a raw disclosure');
    eq(await clickVault('#permission-list button[data-name="disclose_exact_income"]'), 'ok', 'withdraw');
    await sleep(700);
  });

  await check('editing a fact changes what the answers are computed from', async () => {
    await browser.evalIn(VAULT_ORIGIN, `(()=>{const i=document.querySelector('[data-fact="annualIncomeGbp"]');
      i.value='12000'; i.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`);
    await sleep(600);
    const answer = await browser.evalIn(VAULT_ORIGIN,
      `(async()=>{const t=(await document.modelContext.getTools()).find(x=>x.name==='income_meets_multiple');
        return await document.modelContext.executeTool(t, '{"monthly_rent_gbp":1150,"multiple":3}');})()`);
    ok(String(answer).startsWith('no'), 'a 12k income should fail a 1150/month check, got: ' + answer);
  });

  await check('an invalid fact is refused with a readable reason', async () => {
    await browser.evalIn(VAULT_ORIGIN, `(()=>{const i=document.querySelector('[data-fact="householdSize"]');
      i.value='9999'; i.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`);
    await sleep(400);
    const notice = await textIn(VAULT_ORIGIN, '#notice-slot');
    ok(notice.includes('householdSize') || notice.includes('exceed'), 'no explanation shown, got: ' + notice);
  });

  await check('"Restore the sample" puts the file back', async () => {
    eq(await clickVault('#reset-facts'), 'ok', 'button');
    await sleep(500);
    const value = await browser.evalIn(VAULT_ORIGIN, `document.querySelector('[data-fact="annualIncomeGbp"]').value`);
    eq(value, '41400', 'income restored');
  });

  await check('the ledger records what happened, and clears', async () => {
    const before = await browser.evalIn(VAULT_ORIGIN, `document.querySelectorAll('#ledger li').length`);
    ok(before > 0, 'ledger is empty after all that activity');
    eq(await clickVault('#clear-ledger'), 'ok', 'button');
    await sleep(400);
    const after = await textIn(VAULT_ORIGIN, '#ledger');
    ok(after.includes('Nothing has been asked'), 'ledger did not clear, shows: ' + after);
  });

  await check('"Withdraw everything" leaves no predicate registered', async () => {
    eq(await clickVault('#revoke-all'), 'ok', 'button');
    await sleep(900);
    const tools = await toolsIn(VAULT_ORIGIN);
    ok(tools.every((t) => t.startsWith('vault_')), 'predicates survived a full withdrawal: ' + tools.join(','));
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '0', 'bits');
  });

  await check('the walkthrough switch is hidden when the vault is not embedded', async () => {
    eq(await browser.evalIn(VAULT_ORIGIN, `document.getElementById('demo-slot').hidden`), true, 'demo slot');
  });

  // ---- the two origins together -------------------------------------------
  console.log('\nboth origins, federated');
  await browser.goto(`${HOST_ORIGIN}/?vault=${encodeURIComponent(VAULT_ORIGIN)}`, 6000);

  await check('the letting agent registers its own tools and borrows none yet', async () => {
    const own = await toolsIn(HOST_ORIGIN);
    ok(own.includes('check_eligibility'), 'check_eligibility missing');
    ok(own.includes('what_this_site_knows'), 'what_this_site_knows missing');
    ok(!own.some((t) => t.startsWith('applicant_')), 'borrowed a tool with nothing granted');
  });

  await check('the walkthrough switch appears once the vault is embedded', async () => {
    eq(await browser.evalIn(VAULT_ORIGIN, `document.getElementById('demo-slot').hidden`), false, 'demo slot');
  });

  await check('the vault cannot be driven by the host until armed', async () => {
    await browser.evalIn(HOST_ORIGIN,
      `document.getElementById('vault-frame').contentWindow.postMessage(
         {source:'bureau-demo',action:'grant-typical'}, '${VAULT_ORIGIN}')`);
    await sleep(900);
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '0', 'an unarmed vault granted on request');
  });

  await check('granting in the embedded vault crosses the origin boundary', async () => {
    eq(await clickVault('#grant-typical'), 'ok', 'button');
    await sleep(1600);
    const federated = await federatedFromVault();
    eq(federated.length, 9, 'tools visible across the boundary');
    ok(federated.includes('income_meets_multiple'), 'income question not visible');
  });

  await check('the letting agent republishes each one as a proxy', async () => {
    const own = await toolsIn(HOST_ORIGIN);
    const proxies = own.filter((t) => t.startsWith('applicant_'));
    eq(proxies.length, 9, 'proxy count');
    const shown = await textIn(HOST_ORIGIN, '#tool-count');
    ok(shown.includes(String(own.length)), 'the page does not report its own tool count: ' + shown);
  });

  await check('the capability graph draws one line per allowed question', async () => {
    const lines = await browser.evalIn(HOST_ORIGIN, `document.querySelectorAll('#graph path').length`);
    // one curve plus one stub per lane
    eq(lines, 18, 'graph paths');
    ok((await textIn(HOST_ORIGIN, '#graph-caption')).includes('9 questions'), 'caption');
  });

  await check('running the checks answers every one from the other origin', async () => {
    const out = await browser.evalIn(HOST_ORIGIN,
      `(async()=>{const t=(await document.modelContext.getTools()).find(x=>x.name==='check_eligibility');
        return await document.modelContext.executeTool(t,'{"listing_id":"ml-114"}');})()`);
    ok(String(out).includes('Decision: eligible'), 'not eligible: ' + String(out).slice(0, 200));
    eq((String(out).match(/PASS/g) ?? []).length, 9, 'nine passes');
  });

  await check('the letting agent holds nothing about the applicant', async () => {
    const out = await browser.evalIn(HOST_ORIGIN,
      `(async()=>{const t=(await document.modelContext.getTools()).find(x=>x.name==='what_this_site_knows');
        return await document.modelContext.executeTool(t,'{}');})()`);
    ok(String(out).startsWith('Stored about the applicant: nothing'), 'claim changed: ' + out);
  });

  await check('the assessment renders a stamp per check in the interface', async () => {
    await browser.evalIn(HOST_ORIGIN, `document.querySelector('#listings button[data-listing="ml-114"]').click()`);
    await sleep(2200);
    const stamps = await browser.evalIn(HOST_ORIGIN, `document.querySelectorAll('#assessment .stamp').length`);
    eq(stamps, 9, 'stamps rendered');
    ok((await textIn(HOST_ORIGIN, '#assessment')).includes('You qualify'), 'verdict copy');
  });

  await check('choosing a different property clears the previous verdict', async () => {
    await browser.evalIn(HOST_ORIGIN, `document.querySelector('#listings button[data-listing="ml-330"]').click()`);
    await sleep(700);
    const stamps = await browser.evalIn(HOST_ORIGIN, `document.querySelectorAll('#assessment .stamp').length`);
    eq(stamps, 0, 'stale verdict left on screen for a different property');
  });

  await check('a threshold binary search is refused', async () => {
    const out = await browser.evalIn(HOST_ORIGIN, `(async()=>{
      const t=(await document.modelContext.getTools()).find(x=>x.name==='applicant_income_meets_multiple');
      const said=[];
      for (const rent of [2000,1500,1300,1200,1175,1160,1155]) {
        const r = await document.modelContext.executeTool(t, JSON.stringify({monthly_rent_gbp:rent, multiple:3}));
        said.push(String(r));
        if (String(r).startsWith('Error')) break;
      }
      return said;})()`);
    ok(out.at(-1).startsWith('Error'), 'the search was never stopped: ' + JSON.stringify(out));
    ok(out.at(-1).includes('Refused'), 'refusal did not explain itself');
    ok(out.length <= 7, 'took too many probes to stop: ' + out.length);
  });

  await check('the vault warns the person that someone is guessing', async () => {
    eq(await browser.evalIn(VAULT_ORIGIN, `document.getElementById('probe-panel').hidden`), false, 'probe panel hidden');
    ok((await textIn(VAULT_ORIGIN, '#probe-report')).includes('over and over'), 'warning copy');
  });

  await check('withdrawing one permission removes the proxy from the other origin', async () => {
    const before = (await toolsIn(HOST_ORIGIN)).length;
    eq(await clickVault('#permission-list button[data-name="income_meets_multiple"]'), 'ok', 'button');
    await sleep(1800);
    const after = await toolsIn(HOST_ORIGIN);
    eq(after.length, before - 1, 'published tool count');
    ok(!after.includes('applicant_income_meets_multiple'), 'proxy survived withdrawal');
  });

  await check('the check that depended on it now reports the permission is gone', async () => {
    const out = await browser.evalIn(HOST_ORIGIN,
      `(async()=>{const t=(await document.modelContext.getTools()).find(x=>x.name==='check_eligibility');
        return await document.modelContext.executeTool(t,'{"listing_id":"ml-114"}');})()`);
    ok(String(out).includes('NOT GRANTED  income_meets_multiple'), 'did not report the gap: ' + String(out).slice(0, 200));
    ok(String(out).includes('Decision: incomplete'), 'decision did not drop to incomplete');
  });

  await check('withdrawing everything empties the graph', async () => {
    eq(await clickVault('#revoke-all'), 'ok', 'button');
    await sleep(1800);
    const own = await toolsIn(HOST_ORIGIN);
    ok(!own.some((t) => t.startsWith('applicant_')), 'proxies survived: ' + own.join(','));
    ok((await textIn(HOST_ORIGIN, '#graph-caption')).includes('Nothing yet'), 'caption did not reset');
  });

  // ---- the walkthrough -----------------------------------------------------
  console.log('\nthe walkthrough');

  await check('an unarmed vault refuses, and the walkthrough stops and says so', async () => {
    // The defect this pins: the walkthrough used to post a request, wait a fixed
    // 900ms, and narrate onward whether or not anything happened. A visitor who
    // had not armed the vault saw "You allow nine questions" over an empty
    // diagram, then "Nine questions. Nine one-word answers." over nine
    // NOT GRANTED lines.
    await clickVault('#revoke-all');
    await sleep(1200);
    await browser.evalIn(VAULT_ORIGIN, `(() => {
      const t = document.getElementById('demo-toggle');
      if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event('change')); }
      return 'unarmed';
    })()`);

    await browser.evalIn(HOST_ORIGIN, `document.getElementById('play-demo').click()`);
    // Steps 1 and 2 only narrate; step 3 is the first that asks the vault.
    await sleep(9000);

    const caption = await textIn(HOST_ORIGIN, '#demo-caption');
    ok(/declined|did not answer/i.test(caption), 'the walkthrough narrated past a refusal: ' + caption);
    ok(
      (await textIn(HOST_ORIGIN, '#demo-progress')).startsWith('Stopped'),
      'a stopped walkthrough must not present itself as a running one'
    );
    ok(
      /Let the walkthrough use these switches/i.test(await textIn(HOST_ORIGIN, '#demo-detail')),
      'the refusal must point at the control that resolves it'
    );
    // Nothing was granted behind the viewer's back.
    eq(await textIn(VAULT_ORIGIN, '#stage-bits'), '0', 'an unarmed vault granted anyway');
  });

  await check('an armed vault lets the walkthrough run to the end', async () => {
    await browser.evalIn(VAULT_ORIGIN, `(() => {
      const t = document.getElementById('demo-toggle');
      t.checked = true; t.dispatchEvent(new Event('change'));
      return 'armed';
    })()`);
    await sleep(7000);   // let the halted run release the button

    await browser.evalIn(HOST_ORIGIN, `document.getElementById('play-demo').click()`);
    await sleep(14000);  // through the grant and the first check

    const borrowed = await federatedFromVault();
    eq(borrowed.length, 9, 'the walkthrough did not actually grant anything');
    ok(
      !(await textIn(HOST_ORIGIN, '#demo-progress')).startsWith('Stopped'),
      'an armed run stopped anyway: ' + (await textIn(HOST_ORIGIN, '#demo-caption'))
    );
  });

  // ---- quality floor -------------------------------------------------------
  console.log('\nquality floor');

  await check('every control is reachable and labelled for a screen reader', async () => {
    const problems = await browser.evalIn(HOST_ORIGIN, `(() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, a[href], select, input')) {
        const name = (el.getAttribute('aria-label') || el.textContent || el.value || '').trim();
        if (!name) bad.push(el.tagName + '#' + (el.id || '?') + ' has no accessible name');
        if (el.tabIndex < 0) bad.push(el.tagName + '#' + (el.id || '?') + ' is not focusable');
      }
      for (const img of document.querySelectorAll('svg[role="img"]')) {
        if (!img.getAttribute('aria-label')) bad.push('svg has no aria-label');
      }
      return bad;
    })()`);
    eq(problems.length, 0, 'accessibility problems: ' + problems.join('; '));
  });

  await check('keyboard focus is visible, and reaches the controls', async () => {
    // A programmatic .focus() does not satisfy :focus-visible in Chromium, so a
    // test that calls it measures the wrong thing and passes or fails for the
    // wrong reason. Press the key a person would press.
    await browser.evalIn(HOST_ORIGIN, `document.body.focus()`);
    /** @type {string[]} */
    const seen = [];
    for (let i = 0; i < 12; i += 1) {
      await browser.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab',
      });
      await browser.send('Input.dispatchKeyEvent', {
        type: 'keyUp', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab',
      });
      const state = await browser.evalIn(HOST_ORIGIN, `(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          tag: el.tagName + '#' + (el.id || ''),
          outline: s.outlineStyle + ' ' + s.outlineWidth,
          matches: el.matches(':focus-visible'),
        };
      })()`);
      if (state) seen.push(state);
    }
    ok(seen.length > 0, 'Tab reached no control at all');
    const invisible = seen.filter((s) => s.matches && s.outline.startsWith('none'));
    eq(invisible.length, 0,
      'controls with keyboard focus but no outline: ' + invisible.map((s) => s.tag).join(', '));
  });

  await check('the page does not scroll sideways on a phone', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    });
    await sleep(700);
    const overflow = await browser.evalIn(HOST_ORIGIN,
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await sleep(400);
    ok(overflow <= 1, 'horizontal overflow of ' + overflow + 'px at 390px wide');
  });

  await check('body text meets the contrast floor against the paper', async () => {
    const ratio = await browser.evalIn(HOST_ORIGIN, `(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\\d+/g).slice(0, 3).map(Number).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const s = getComputedStyle(document.body);
      const a = lum(s.color), b = lum(s.backgroundColor);
      const [hi, lo] = a > b ? [a, b] : [b, a];
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    })()`);
    ok(ratio >= 4.5, 'body contrast is ' + ratio + ':1, below the 4.5:1 floor');
  });

  await check('motion is dropped when the viewer asks for less of it', async () => {
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await sleep(400);
    const animated = await browser.evalIn(VAULT_ORIGIN, `(() => {
      const el = document.querySelector('.stamp') || document.querySelector('.redacted');
      if (!el) return 'none';
      el.classList.add('is-fresh', 'is-wiping');
      return getComputedStyle(el).animationName;
    })()`);
    await browser.send('Emulation.setEmulatedMedia', { features: [] });
    ok(animated === 'none', 'animation still runs under reduced motion: ' + animated);
  });

  await check('both typefaces actually loaded, so the design is what shipped', async () => {
    const loaded = await browser.evalIn(HOST_ORIGIN,
      `(async()=>{ await document.fonts.ready;
         return [...document.fonts].map(f=>f.family+':'+f.status).sort(); })()`);
    ok(loaded.some((f) => f.startsWith('Fraunces') && f.endsWith('loaded')), 'Fraunces did not load: ' + loaded.join(','));
    ok(loaded.some((f) => f.startsWith('Public Sans') && f.endsWith('loaded')), 'Public Sans did not load: ' + loaded.join(','));
  });

  await check('neither origin requests anything from a third party', async () => {
    const external = await browser.evalIn(HOST_ORIGIN, `(() =>
      performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => !u.startsWith(location.origin) && !u.startsWith('data:') && !u.startsWith('${VAULT_ORIGIN}'))
    )()`);
    eq(external.length, 0, 'third-party requests: ' + external.join(', '));
  });

  await check('no page logged an error or threw during any of that', async () => {
    const errors = browser.drainErrors();
    eq(errors.length, 0, 'console was not clean:\n        ' + errors.join('\n        '));
  });

  // ---- report --------------------------------------------------------------
  browser.close();
  for (const s of servers) s.close();

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAILED: ${f.name}\n  ${f.err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nharness error:', err);
  process.exit(1);
});
