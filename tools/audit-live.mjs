/**
 * @file Hard audit of the deployed product, against production, in a browser.
 *
 * Responsible for: proving the thing a judge will actually open works. Every
 * link resolves, every asset loads, the tools register on both origins,
 * federation carries them across, and revocation takes them away again.
 *
 * NOT responsible for: unit behaviour. That is what the test suite is for.
 * This one only cares about the deployed artefact, because a passing suite
 * against a local server is exactly what was green while both live pages were
 * rendering blank.
 *
 * Usage:
 *   node tools/audit-live.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HOST = 'https://vouchsafe-lettings.vercel.app';
const VAULT = 'https://vouchsafe-vault.vercel.app';
const PROOF = HOST + '/proof.html';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {Array<{what: string, good: boolean, detail: string}>} */
const results = [];

/** @param {string} what @param {boolean} good @param {string} [detail] */
const note = (what, good, detail = '') => {
  results.push({ what, good: Boolean(good), detail });
  console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${what}${detail ? '  ' + detail : ''}`);
};

async function freePort() {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

class Page {
  #ws; #id = 0; #pending = new Map();

  proc = null;
  profile = '';
  vaultSession = '';
  failed = [];
  errors = [];

  static async open() {
    const bin = [process.env.BROWSER, '/usr/bin/brave', '/usr/bin/google-chrome',
      '/usr/bin/chromium'].filter(Boolean).find((b) => existsSync(b));
    if (!bin) throw new Error('no browser found');

    const p = new Page();
    const port = await freePort();
    p.profile = await mkdtemp(join(tmpdir(), 'vouchsafe-audit-'));
    p.proc = spawn(bin, ['--headless=new', '--enable-features=WebMCP',
      '--enable-blink-features=WebMCP', `--remote-debugging-port=${port}`,
      `--user-data-dir=${p.profile}`, '--no-first-run', '--window-size=1440,900'],
    { stdio: 'ignore', detached: true });

    let target = null;
    for (let i = 0; i < 80 && !target; i += 1) {
      try {
        const list = await (await fetch(`http://localhost:${port}/json`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* not up yet */ }
      if (!target) await sleep(300);
    }
    if (!target) throw new Error('browser never exposed a page');

    p.#ws = new WebSocket(target.webSocketDebuggerUrl);
    p.#ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && p.#pending.has(m.id)) {
        p.#pending.get(m.id)(m); p.#pending.delete(m.id); return;
      }
      if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') {
        p.vaultSession = m.params.sessionId;
        p.send('Runtime.enable', {}, 5000, p.vaultSession).catch(() => {});
      }
      if (m.method === 'Network.loadingFailed') p.failed.push(m.params);
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
        p.failed.push({ url: m.params.response.url, status: m.params.response.status });
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        p.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        p.errors.push('uncaught: ' + (m.params.exceptionDetails?.exception?.description
          ?? m.params.exceptionDetails?.text ?? '?'));
      }
    };
    await new Promise((r) => { p.#ws.onopen = r; });
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Network.enable');
    await p.send('Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    return p;
  }

  send(method, params = {}, timeout = 15000, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeout);
      this.#pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      this.#ws.send(JSON.stringify(
        sessionId ? { id, method, params, sessionId } : { id, method, params }
      ));
    });
  }

  async goto(url, settle = 4000) {
    this.failed = []; this.errors = []; this.vaultSession = '';
    await this.send('Page.navigate', { url });
    await sleep(settle);
  }

  async evalTop(expression) {
    try {
      const r = await this.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, 20000);
      if (r.result?.exceptionDetails) return null;
      return r.result?.result?.value;
    } catch { return null; }
  }

  async evalVault(expression) {
    if (!this.vaultSession) return null;
    try {
      const r = await this.send('Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true }, 20000, this.vaultSession);
      if (r.result?.exceptionDetails) return null;
      return r.result?.result?.value;
    } catch { return null; }
  }

  close() {
    try { process.kill(-this.proc.pid, 'SIGKILL'); } catch { /* gone */ }
    if (this.profile) {
      try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* fine */ }
    }
  }
}

const page = await Page.open();
try {
  // ---- every page loads clean --------------------------------------------
  for (const [name, url] of [['agency', HOST], ['your file', VAULT], ['proof', PROOF]]) {
    console.log(`\n${name}  ${url}`);
    await page.goto(url);
    const shape = await page.evalTop(`({
      title: document.title,
      text: document.body.innerText.trim().length,
      nodes: document.querySelectorAll('*').length,
      links: [...document.querySelectorAll('a[href]')]
        .map(a=>a.getAttribute('href'))
        .filter(h=>h && !h.startsWith('#') && !h.startsWith('mailto:')),
      buttons: document.querySelectorAll('button').length,
      images: [...document.images].filter(i=>!i.complete||i.naturalWidth===0).length
    })`);
    note(`${name}: renders`, shape && shape.text > 400,
      `${shape?.text ?? 0} chars, ${shape?.nodes ?? 0} nodes, ${shape?.buttons ?? 0} buttons`);
    note(`${name}: has a title`, Boolean(shape?.title), shape?.title ?? '');
    note(`${name}: no broken images`, shape?.images === 0, `${shape?.images ?? '?'} broken`);
    note(`${name}: no failed requests`, page.failed.length === 0,
      page.failed.slice(0, 3)
        .map((f) => `${f.status ?? f.errorText} ${String(f.url ?? '').slice(0, 60)}`).join(' | '));
    note(`${name}: no console errors`, page.errors.length === 0, page.errors.slice(0, 2).join(' | '));
    note(`${name}: WebMCP present`, await page.evalTop('!!document.modelContext'));

    const links = [...new Set(shape?.links ?? [])];
    const broken = [];
    for (const href of links) {
      const abs = href.startsWith('http') ? href : new URL(href, url).href;
      try {
        const r = await fetch(abs, { redirect: 'follow' });
        if (!r.ok) broken.push(`${r.status} ${abs}`);
      } catch { broken.push(`unreachable ${abs}`); }
    }
    note(`${name}: all ${links.length} links resolve`, broken.length === 0, broken.slice(0, 3).join(' | '));
  }

  // ---- the federation round trip, live -----------------------------------
  console.log('\nfederation, on the deployed pair');
  await page.goto(HOST, 5500);
  note('the vault frame is attached', Boolean(page.vaultSession));

  const vaultTools = await page.evalVault('(async()=>(await document.modelContext.getTools()).length)()');
  note('your file registers its own tools', typeof vaultTools === 'number' && vaultTools > 0, `${vaultTools}`);

  await page.evalVault("document.getElementById('revoke-all')?.click()");
  await sleep(700);
  await page.evalVault(`[...document.querySelectorAll('.confirm button, dialog button')]
    .find(b=>/withdraw|yes|confirm|remove/i.test(b.textContent))?.click()`);
  await sleep(1800);

  const bare = await page.evalTop(`(async()=>(await document.modelContext.getTools())
    .map(t=>String(t.name)).filter(n=>n.startsWith('applicant_')).length)()`);
  note('with nothing allowed, no borrowed tool exists', bare === 0, `${bare} present`);

  await page.evalVault("document.getElementById('grant-typical')?.click()");
  await sleep(2800);

  const total = await page.evalTop('(async()=>(await document.modelContext.getTools()).length)()');
  const borrowed = await page.evalTop(`(async()=>(await document.modelContext.getTools())
    .map(t=>String(t.name)).filter(n=>n.startsWith('applicant_')).length)()`);
  note('granting republishes tools on the agency origin', borrowed > 0, `${borrowed} borrowed of ${total}`);

  const answer = await page.evalTop(`(async()=>{
    const ts = await document.modelContext.getTools();
    const t = ts.find(x=>String(x.name).includes('income_meets_multiple'));
    if(!t) return 'MISSING';
    return String(await document.modelContext.executeTool(t,
      JSON.stringify({monthly_rent_gbp:1150, multiple:3}))).slice(0,60);
  })()`);
  note('a borrowed tool answers across the origin boundary',
    Boolean(answer) && answer !== 'MISSING' && !String(answer).startsWith('Error'), String(answer));

  const check = await page.evalTop(`(async()=>{
    const ts = await document.modelContext.getTools();
    const t = ts.find(x=>x.name==='check_eligibility');
    if(!t) return 'MISSING';
    return String(await document.modelContext.executeTool(t,
      JSON.stringify({listing_id:'ml-114'}))).slice(0,90);
  })()`);
  note("the agency's own assessment runs", check !== 'MISSING' && Boolean(check),
    String(check).replace(/\n/g, ' '));

  await page.evalVault(`(()=>{const b=document.querySelector(
    '#permission-list button[data-act="revoke"][data-name="income_meets_multiple"]');
    if(!b) return 'MISSING'; b.click(); return 'clicked';})()`);
  await sleep(2200);
  const after = await page.evalTop(`(async()=>(await document.modelContext.getTools())
    .map(t=>String(t.name)).filter(n=>n==='applicant_income_meets_multiple').length)()`);
  note('withdrawing deregisters the tool on the other origin', after === 0, `${after} still present`);
  note('no console errors during the whole exchange', page.errors.length === 0,
    page.errors.slice(0, 2).join(' | '));

  // ---- the probe guard ----------------------------------------------------
  console.log('\nthe probe guard');
  await page.evalVault("document.getElementById('grant-typical')?.click()");
  await sleep(2400);
  const probe = await page.evalTop(`(async()=>{
    const ts = await document.modelContext.getTools();
    const t = ts.find(x=>String(x.name).includes('income_meets_multiple'));
    if(!t) return 'MISSING';
    const out=[];
    for (const rent of [2000,1500,1300,1200,1175,1160]) {
      const r = String(await document.modelContext.executeTool(t,
        JSON.stringify({monthly_rent_gbp:rent, multiple:3})));
      const stopped = r.startsWith('Error') || /refus/i.test(r);
      out.push(stopped ? 'REFUSED' : 'answered');
      if (stopped) break;
    }
    return out.join(',');
  })()`);
  note('a threshold search is answered, then refused', String(probe).includes('REFUSED'), String(probe));

  // ---- the proof page -----------------------------------------------------
  console.log('\nthe proof page');
  await page.goto(PROOF, 5000);
  const own = await page.evalTop('(async()=>(await document.modelContext.getTools()).length)()');
  note('proof page registers nothing of its own', own === 0, `${own} registered`);
  const figures = await page.evalTop(`[...document.querySelectorAll('.stage-figure')].map(e=>e.textContent.trim().slice(0,20)).slice(0,3)`);
  note('proof page reads figures back', Array.isArray(figures) && figures.length > 0,
    JSON.stringify(figures ?? []));
  note('proof page: no console errors', page.errors.length === 0, page.errors.slice(0, 2).join(' | '));

  // ---- the privacy claim, checked rather than asserted --------------------
  console.log('\nprivacy claims');
  await page.goto(HOST, 5000);
  const hosts = await page.evalTop(`[...new Set(performance.getEntriesByType('resource')
    .map(e=>{try{return new URL(e.name).host}catch{return ''}}).filter(Boolean))]`);
  const foreign = (hosts ?? []).filter((h) => !h.includes('vouchsafe') && !h.includes('vercel.app'));
  note('no third party requests from either origin', foreign.length === 0, foreign.join(', '));
} finally {
  page.close();
}

const bad = results.filter((r) => !r.good);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
if (bad.length) {
  console.log('\nFAILED:');
  for (const b of bad) console.log(`  ${b.what}  ${b.detail}`);
  process.exit(1);
}
console.log('the deployed product is sound.');
