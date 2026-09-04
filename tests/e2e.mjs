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
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * The static servers take whatever ports are free, like the debugging port.
 *
 * Fixed ports meant an interrupted run left its servers holding 4401 and 4402,
 * and the next run died on EADDRINUSE before printing a single result. Nothing
 * in the suite needs a particular number: both applications learn each other's
 * origin from a query parameter, which exists precisely so they can be served
 * anywhere.
 *
 * Assigned in `main`.
 */
let VAULT_ORIGIN = '';
let HOST_ORIGIN = '';
/**
 * The debugging port is chosen at run time, never fixed.
 *
 * A fixed port is how this suite came to hang with a blank terminal. An
 * interrupted run leaves its browser alive and still listening, the next run
 * polls the same port, finds that browser's stale page, attaches to a renderer
 * that is gone, and waits forever on its first command. The failure looks like
 * the tests hanging and has nothing to do with the tests.
 *
 * Assigned in `Browser.launch`.
 */
let debugPort = 0;

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
function serve(dir) {
  const root = join(ROOT, dir);
  const server = createHttpServer(async (req, res) => {
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
  return new Promise((resolve, reject) => {
    // `listen` reports a failure by emitting 'error', not by rejecting, so an
    // unhandled one leaves this promise pending and the run looks like a blank
    // terminal rather than a failure with a cause.
    server.once('error', (err) => reject(new Error(`could not serve ${dir}: ${err.message}`)));
    // Port 0 asks the kernel for one nobody is using.
    server.listen(0, '127.0.0.1', () => {
      server.origin = `http://localhost:${server.address().port}`;
      resolve(server);
    });
  });
}

/** Minimal CDP client with per-frame evaluation. */
class Browser {
  #ws; #id = 0; #pending = new Map(); #contexts = []; #logs = [];

  /**
   * Ask the operating system for a port nobody is listening on.
   *
   * Binding to port 0 makes the kernel pick a free one and report it. There is
   * a moment between closing this and the browser binding it that nothing can
   * fully close, but it is far smaller than the certainty of collision a
   * hardcoded port carries once a run has been interrupted.
   *
   * @returns {Promise<number>}
   */
  static async freePort() {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address();
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  static async launch() {
    const bin = BROWSERS.find((b) => existsSync(b));
    if (!bin) throw new Error('no Chromium found; set BROWSER=/path/to/chrome');
    debugPort = await Browser.freePort();
    const profile = await mkdtemp(join(tmpdir(), 'bureau-e2e-'));
    const proc = spawn(bin, [
      '--enable-features=WebMCP',
      '--enable-blink-features=WebMCP',
      `--remote-debugging-port=${debugPort}`,
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
        const list = await (await fetch(`http://localhost:${debugPort}/json`)).json();
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
    const list = await (await fetch(`http://localhost:${debugPort}/json`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) {
      throw new Error(
        `the browser started but never exposed a page on port ${debugPort}. ` +
        `If another run is still alive, free it with: fuser -k ${debugPort}/tcp`
      );
    }
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

  /**
   * Send one protocol command and wait for its reply.
   *
   * The timeout is not optional. A blocked renderer never answers, and without
   * one the whole suite waits forever on a promise that will not settle: the
   * terminal shows the last test that passed and nothing after it, which is
   * indistinguishable from a slow machine and says nothing about where. A
   * rejection names the command that went unanswered.
   *
   * @param {string} method
   * @param {object} [params]
   * @param {number} [timeout] milliseconds
   * @returns {Promise<object>}
   */
  send(method, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(
          `${method} got no reply in ${timeout}ms; the page is most likely blocked ` +
          `(a synchronous dialog, or a loop in a render path)`
        ));
      }, timeout);
      this.#pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
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

  /**
   * Shut the browser down, including the children it spawned.
   *
   * `kill()` on the launcher alone leaves renderer and GPU processes behind,
   * still holding the debugging port. Killing the process group is what makes
   * the port genuinely free for the next run.
   */
  close() {
    try {
      process.kill(-this.proc.pid, 'SIGKILL');
    } catch {
      try { this.proc?.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for something to become true, rather than for a fixed number of
 * milliseconds.
 *
 * Every fixed wait in a browser test is a guess, and it is wrong twice: too
 * short on a slow machine, so the suite fails for no reason, and too long on a
 * fast one, so every run pays for the worst case. This polls, returns the
 * moment the condition holds, and reports what it was waiting for when it does
 * not.
 *
 * @template T
 * @param {() => Promise<T>} probe          read the state under test
 * @param {(value: T) => boolean} settled   has it arrived?
 * @param {object} [options]
 * @param {string} [options.what]           named in the timeout message
 * @param {number} [options.timeout]        give up after this, ms
 * @param {number} [options.interval]       how often to look, ms
 * @returns {Promise<T>} the settled value
 */
async function until(probe, settled, { what = 'a condition', timeout = 10000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await probe();
    if (settled(last)) return last;
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${timeout}ms waiting for ${what}; last saw ${JSON.stringify(last)}`
      );
    }
    await sleep(interval);
  }
}

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

function notEq(actual, unexpected, what) {
  if (actual === unexpected) {
    throw new Error(`${what}: expected something other than ${JSON.stringify(unexpected)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* the suite                                                                  */
/* -------------------------------------------------------------------------- */

async function main() {
  // Announced before anything slow happens. A suite that prints nothing for its
  // first thirty seconds is indistinguishable from one that has hung.
  console.log('\nBureau end-to-end');
  const vaultServer = await serve('vault');
  const hostServer = await serve('host');
  VAULT_ORIGIN = vaultServer.origin;
  HOST_ORIGIN = hostServer.origin;
  const servers = [vaultServer, hostServer];
  console.log(`  serving ${VAULT_ORIGIN} and ${HOST_ORIGIN}`);
  console.log('  launching a browser with WebMCP enabled…');
  const browser = await Browser.launch();
  console.log('  ready\n');

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

  /**
   * Press a destructive control and answer the confirmation it raises.
   *
   * The guard is a question anchored to the control, not a second press and not
   * a browser dialog, so a test answers it the way a person does.
   */
  const clickVaultAndConfirm = async (sel) => {
    const first = await clickVault(sel);
    if (first !== 'ok') return first;
    return until(
      () => browser.evalIn(VAULT_ORIGIN, `(() => {
        const box = document.querySelector('.confirm');
        if (!box) return 'no-dialog';
        const go = box.querySelector('.confirm-actions button.revoke');
        if (!go) return 'no-button';
        go.click();
        return 'ok';
      })()`),
      (result) => result === 'ok',
      { what: 'the confirmation for ' + sel, timeout: 4000 }
    );
  };

  /** Press a destructive control and decline the confirmation. */
  const clickVaultAndCancel = async (sel) => {
    await clickVault(sel);
    return until(
      () => browser.evalIn(VAULT_ORIGIN, `(() => {
        const box = document.querySelector('.confirm');
        if (!box) return 'no-dialog';
        box.querySelector('.confirm-actions button.quiet').click();
        return 'ok';
      })()`),
      (result) => result === 'ok',
      { what: 'the confirmation for ' + sel, timeout: 4000 }
    );
  };

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
    const tools = await until(
      () => toolsIn(VAULT_ORIGIN),
      (list) => list.filter((t) => !t.startsWith('vault_')).length === 9,
      { what: 'nine predicates to register' }
    );
    eq(tools.filter((t) => !t.startsWith('vault_')).length, 9, 'predicate count');
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
    await until(
      () => toolsIn(VAULT_ORIGIN),
      (list) => !list.includes('income_meets_multiple'),
      { what: 'the withdrawn tool to be unregistered' }
    );
    eq(await textIn(VAULT_ORIGIN, '#bits-total'), '8', 'bits after withdrawing one');
  });

  await check('allowing it again re-registers it', async () => {
    eq(await clickVault('#permission-list button[data-name="income_meets_multiple"]'), 'ok', 'button');
    await until(
      () => toolsIn(VAULT_ORIGIN),
      (list) => list.includes('income_meets_multiple'),
      { what: 'the tool to be registered again' }
    );
  });

  await check('a raw disclosure costs visibly more', async () => {
    eq(await clickVault('#permission-list button[data-name="disclose_exact_income"]'), 'ok', 'button');
    await until(() => textIn(VAULT_ORIGIN, '#bits-total'), (v) => v === '18.8',
      { what: 'the meter to price a raw disclosure' });
    eq(await clickVault('#permission-list button[data-name="disclose_exact_income"]'), 'ok', 'withdraw');
    await until(() => textIn(VAULT_ORIGIN, '#bits-total'), (v) => v === '9',
      { what: 'the meter to fall back' });
  });

  await check('editing a fact changes what the answers are computed from', async () => {
    await browser.evalIn(VAULT_ORIGIN, `(()=>{const i=document.querySelector('[data-fact="annualIncomeGbp"]');
      i.value='12000'; i.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';})()`);
    await until(() => browser.evalIn(VAULT_ORIGIN,
      `document.querySelector('[data-fact="annualIncomeGbp"]').value`),
      (v) => v === '12000', { what: 'the edited income to persist' });
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
    eq(await clickVaultAndConfirm('#reset-facts'), 'ok', 'button');
    await sleep(500);
    const value = await browser.evalIn(VAULT_ORIGIN, `document.querySelector('[data-fact="annualIncomeGbp"]').value`);
    eq(value, '41400', 'income restored');
  });

  await check('the ledger records what happened, and clears', async () => {
    const before = await browser.evalIn(VAULT_ORIGIN, `document.querySelectorAll('#ledger li').length`);
    ok(before > 0, 'ledger is empty after all that activity');
    eq(await clickVaultAndConfirm('#clear-ledger'), 'ok', 'button');
    await sleep(400);
    const after = await textIn(VAULT_ORIGIN, '#ledger');
    ok(after.includes('Nothing has been asked'), 'ledger did not clear, shows: ' + after);
  });

  await check('a destructive control asks before it destroys, and can be declined', async () => {
    // The guard is a question anchored to the control. `window.confirm` was the
    // obvious choice and the wrong one: Chrome suppresses dialogs from a
    // cross-origin iframe, which is where this panel spends most of its life,
    // so the guard would have been missing exactly where the button is easiest
    // to hit by accident.
    eq(await clickVault('#grant-typical'), 'ok', 'set something up to destroy');
    const before = (await until(
      () => toolsIn(VAULT_ORIGIN),
      (list) => list.filter((t) => !t.startsWith('vault_')).length === 9,
      { what: 'nine permissions to be allowed' }
    )).length;

    eq(await clickVault('#revoke-all'), 'ok', 'first press');
    const asked = await until(
      () => browser.evalIn(VAULT_ORIGIN, `(() => {
        const box = document.querySelector('.confirm');
        return box ? box.textContent.replace(/\\s+/g, ' ').trim() : null;
      })()`),
      (text) => text !== null,
      { what: 'the confirmation to open' }
    );
    ok(/Withdraw all 9/.test(asked), 'the question does not say what will happen: ' + asked);
    ok(/Keep it/.test(asked), 'there is no way to decline');
    eq((await toolsIn(VAULT_ORIGIN)).length, before, 'one press destroyed the permissions');

    eq(await clickVaultAndCancel('#revoke-all'), 'ok', 'decline');
    await sleep(400);
    eq((await toolsIn(VAULT_ORIGIN)).length, before, 'declining still destroyed the permissions');
    eq(
      await browser.evalIn(VAULT_ORIGIN, `document.querySelector('.confirm') === null`),
      true,
      'the confirmation stayed open after being declined'
    );
  });

  await check('"Withdraw everything" leaves no predicate registered', async () => {
    eq(await clickVaultAndConfirm('#revoke-all'), 'ok', 'button');
    const tools = await until(
      () => toolsIn(VAULT_ORIGIN),
      (list) => list.every((t) => t.startsWith('vault_')),
      { what: 'every predicate to be withdrawn' }
    );
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
    const federated = await until(federatedFromVault, (list) => list.length === 9,
      { what: 'nine tools to cross the origin boundary' });
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
    const stamps = await until(
      () => browser.evalIn(HOST_ORIGIN, `document.querySelectorAll('#assessment .stamp').length`),
      (n) => n === 9,
      { what: 'nine stamps to be rendered' }
    );
    ok((await textIn(HOST_ORIGIN, '#assessment')).includes('You qualify'), 'verdict copy');
  });

  await check('choosing a different property re-checks against that property', async () => {
    // ml-330 asks for a credit band that ml-114 does not, so a stale verdict
    // would be visible as the wrong number of rows rather than merely as the
    // wrong words.
    const before = await browser.evalIn(HOST_ORIGIN,
      `document.querySelectorAll('#assessment .stamp').length`);
    await browser.evalIn(HOST_ORIGIN,
      `document.querySelector('#listings button[data-listing="ml-330"]').click()`);
    await sleep(3000);

    const after = await browser.evalIn(HOST_ORIGIN,
      `document.querySelectorAll('#assessment .stamp').length`);
    ok(after > 0, 'choosing a property left no verdict at all');
    notEq(after, before, 'the verdict did not change with the property');
    ok(
      (await textIn(HOST_ORIGIN, '#assessment')).toLowerCase().includes('credit'),
      'the verdict does not include the requirement unique to this property'
    );
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
    const after = await until(() => toolsIn(HOST_ORIGIN), (list) => list.length === before - 1,
      { what: 'the proxy to disappear from the other origin' });
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
    eq(await clickVaultAndConfirm('#revoke-all'), 'ok', 'button');
    const own = await until(() => toolsIn(HOST_ORIGIN),
      (list) => !list.some((t) => t.startsWith('applicant_')),
      { what: 'every proxy to be torn down' });
    ok((await textIn(HOST_ORIGIN, '#graph-caption')).includes('Nothing yet'), 'caption did not reset');
  });

  // ---- the proof page ------------------------------------------------------
  console.log('\nthe proof page');

  await check('the proof page reads the registry rather than reporting on it', async () => {
    // The phase before this one ends by withdrawing everything, so there is
    // something to read.
    await browser.goto(`${HOST_ORIGIN}/proof.html?vault=${encodeURIComponent(VAULT_ORIGIN)}`, 5000);
    eq(await clickVault('#grant-typical'), 'ok', 'grant the standard nine');
    await until(() => textIn(HOST_ORIGIN, '#fig-borrowed'), (v) => v === '9',
      { what: 'the proof page to see nine borrowed tools' });
    // It registers nothing of its own, which is what makes it a witness rather
    // than a participant.
    eq(await textIn(HOST_ORIGIN, '#fig-own'), '0', 'the proof page registered tools of its own');
    eq(await textIn(HOST_ORIGIN, '#fig-borrowed'), '9', 'borrowed count');
    eq(
      await browser.evalIn(HOST_ORIGIN, `document.querySelectorAll('#borrowed-list li').length`),
      9,
      'borrowed list length'
    );
  });

  await check('an allowed permission can be called from the proof page', async () => {
    await browser.evalIn(HOST_ORIGIN, `document.getElementById('probe-missing').click()`);
    await sleep(1800);
    const out = await textIn(HOST_ORIGIN, '#probe-out');
    ok(/currently allowed/.test(out), 'expected a live call, got: ' + out.slice(0, 160));
    ok(/yes \(tested against/.test(out), 'the call did not return the vault answer: ' + out.slice(0, 160));
  });

  await check('a withdrawn permission leaves no tool to call at all', async () => {
    // The claim under test: authority is tool existence, not a runtime check.
    eq(await clickVault('#permission-list button[data-name="income_meets_multiple"]'), 'ok', 'withdraw');
    await sleep(1800);
    eq(await textIn(HOST_ORIGIN, '#fig-borrowed'), '8', 'the registry did not shrink');

    await browser.evalIn(HOST_ORIGIN, `document.getElementById('probe-missing').click()`);
    await sleep(1800);
    const out = await textIn(HOST_ORIGIN, '#probe-out');
    ok(/is not among them/.test(out), 'expected the handle to be absent, got: ' + out.slice(0, 200));
    ok(/does not exist/.test(out), 'the page did not state the consequence');
  });

  await check('the proof page logs a change only when the browser reports one', async () => {
    const seen = Number(await textIn(HOST_ORIGIN, '#fig-events'));
    ok(seen > 0, 'no toolchange events were recorded');
    ok(
      (await textIn(HOST_ORIGIN, '#event-log')).includes('borrowed'),
      'the log does not describe what moved'
    );
  });

  // Put it back and return to the application for the phases that follow.
  eq(await clickVault('#permission-list button[data-name="income_meets_multiple"]'), 'ok', 'restore');
  await sleep(1200);
  await browser.goto(`${HOST_ORIGIN}/?vault=${encodeURIComponent(VAULT_ORIGIN)}`, 5000);

  // ---- the walkthrough -----------------------------------------------------
  console.log('\nthe walkthrough');

  await check('an unarmed vault refuses, and the walkthrough stops and says so', async () => {
    // The defect this pins: the walkthrough used to post a request, wait a fixed
    // 900ms, and narrate onward whether or not anything happened. A visitor who
    // had not armed the vault saw "You allow nine questions" over an empty
    // diagram, then "Nine questions. Nine one-word answers." over nine
    // NOT GRANTED lines.
    await clickVaultAndConfirm('#revoke-all');
    await sleep(1200);
    await browser.evalIn(VAULT_ORIGIN, `(() => {
      const t = document.getElementById('demo-toggle');
      if (t && t.checked) { t.checked = false; t.dispatchEvent(new Event('change')); }
      return 'unarmed';
    })()`);

    await browser.evalIn(HOST_ORIGIN, `document.getElementById('play-demo').click()`);
    // Steps 1 and 2 only narrate; step 3 is the first that asks the vault, so
    // wait for the refusal to appear rather than for a guess at how long three
    // beats take.
    const caption = await until(
      () => textIn(HOST_ORIGIN, '#demo-caption'),
      (text) => /declined|did not answer/i.test(text),
      { what: 'the walkthrough to stop on the refusal', timeout: 20000 }
    );
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
    // Wait for the halted run to release the button rather than guessing.
    await until(
      () => browser.evalIn(HOST_ORIGIN, `document.getElementById('play-demo').disabled`),
      (disabled) => disabled === false,
      { what: 'the halted walkthrough to finish', timeout: 20000 }
    );

    await browser.evalIn(HOST_ORIGIN, `document.getElementById('play-demo').click()`);
    const borrowed = await until(federatedFromVault, (list) => list.length === 9, {
      what: 'the walkthrough to actually grant nine questions',
      timeout: 30000,
    });
    ok(
      !(await textIn(HOST_ORIGIN, '#demo-progress')).startsWith('Stopped'),
      'an armed run stopped anyway: ' + (await textIn(HOST_ORIGIN, '#demo-caption'))
    );
  });

  // ---- the eval contract ---------------------------------------------------
  console.log('\nthe eval contract (evals.json)');

  await check('every expected call in evals.json is executable as written', async () => {
    // `evals.json` is written in the format Chrome's own `webmcp-evals` harness
    // consumes, so the same file drives both. That harness resolves a browser
    // through a hardcoded system path under /opt and cannot be pointed at the
    // Chrome we have, so the contract is asserted here as well: every
    // expectedCall must name a tool that exists and accept the arguments given.
    const suite = JSON.parse(await readFile(new URL('../evals.json', import.meta.url), 'utf8'));
    ok(suite.length > 0, 'evals.json is empty');

    const failures = [];
    for (const testCase of suite) {
      for (const call of testCase.expectedCall) {
        const outcome = await browser.evalIn(HOST_ORIGIN, `(async () => {
          const tools = await document.modelContext.getTools();
          const tool = tools.find(t => t.name === ${JSON.stringify(call.functionName)});
          if (!tool) return { missing: true };
          try {
            const r = await document.modelContext.executeTool(tool, ${JSON.stringify(JSON.stringify(call.arguments))});
            return { result: String(r ?? '') };
          } catch (e) {
            return { threw: String(e && e.message || e) };
          }
        })()`);

        if (outcome.missing) {
          failures.push(testCase.name + ': no tool named ' + call.functionName);
        } else if (outcome.threw) {
          // A tool may legitimately refuse; it must never throw, because Chrome
          // replaces a thrown Error with a bare UnknownError and the agent is
          // left with nothing to act on.
          failures.push(testCase.name + ': ' + call.functionName + ' threw ' + outcome.threw);
        }
      }
    }
    eq(failures.length, 0, 'eval contract broken:\n        ' + failures.join('\n        '));
  });

  await check('a tool that cannot do what was asked says so, and does not throw', async () => {
    // Two cases from the suite that must fail gracefully: an id that does not
    // exist, and a submission before any check has run.
    const bad = await browser.evalIn(HOST_ORIGIN, `(async () => {
      const tools = await document.modelContext.getTools();
      const get = tools.find(t => t.name === 'get_listing');
      const submit = tools.find(t => t.name === 'submit_application');
      return {
        unknownId: String(await document.modelContext.executeTool(get, '{"listing_id":"zz-999"}')),
        early: String(await document.modelContext.executeTool(submit, '{"listing_id":"ml-330"}')),
      };
    })()`);
    ok(bad.unknownId.startsWith('Error:'), 'an unknown listing id was not reported: ' + bad.unknownId);
    ok(/no listing/i.test(bad.unknownId), 'the error does not say what was wrong: ' + bad.unknownId);
    ok(/Error|Cannot submit/i.test(bad.early), 'submitting before checking was allowed: ' + bad.early);
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
    // try/finally, not a straight line. An earlier version cleared the override
    // only on the happy path, so any failure in between left every later check
    // running against a 390px viewport, which reads as the page collapsing into
    // its mobile layout partway through a run and stalls the diagnosis on the
    // wrong thing entirely.
    let overflow;
    try {
      await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      });
      await sleep(700);
      overflow = await browser.evalIn(HOST_ORIGIN,
        `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    } finally {
      await browser.send('Emulation.clearDeviceMetricsOverride');
      await sleep(400);
    }
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
    let animated;
    try {
      await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await sleep(400);
      animated = await browser.evalIn(VAULT_ORIGIN, `(() => {
        const el = document.querySelector('.stamp') || document.querySelector('.redacted');
        if (!el) return 'none';
        el.classList.add('is-fresh', 'is-wiping');
        return getComputedStyle(el).animationName;
      })()`);
    } finally {
      await browser.send('Emulation.setEmulatedMedia', { features: [] });
    }
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
