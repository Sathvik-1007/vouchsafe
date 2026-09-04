/**
 * @file Does the deployed site actually render?
 *
 * This exists because of a real outage that 108 passing tests said nothing
 * about. Two modules were added to `vault/ui/app.js` and not deployed. The
 * server returned 200 for every page, every test passed against a local
 * directory where the files were present, and both live origins rendered
 * completely blank, because one 404 in a module graph takes the whole graph
 * down.
 *
 * So a 200 is not the check. The check is whether anything was painted.
 *
 * Runs in its own browser with its own profile on its own port, so it never
 * touches a window anyone is using.
 *
 * Usage:
 *   node tools/verify-deploy.mjs                 # the live origins
 *   node tools/verify-deploy.mjs http://localhost:4002 http://localhost:4001
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Its own port, so a browser someone is driving on 9222 is left alone. */
const PORT = 9411;

const DEFAULT_TARGETS = [
  'https://vouchsafe-lettings.vercel.app/',
  'https://vouchsafe-lettings.vercel.app/proof.html',
  'https://vouchsafe-vault.vercel.app/',
];

const BROWSERS = [
  process.env.BROWSER,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/brave',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * What a rendered page must show. Anything less means the module graph died.
 *
 * Deliberately about visible substance rather than a marker element, because a
 * marker can be in the HTML while every script that fills the page has failed.
 */
async function inspect(send, url) {
  const probe = `(() => {
    const errors = [];
    return {
      title: document.title,
      // Text a human would see, with script and style content excluded.
      visibleText: (document.body.innerText || '').trim().length,
      elements: document.querySelectorAll('body *').length,
      // Did the modules run? Each page fills at least one of these.
      populated: [...document.querySelectorAll('[id]')]
        .filter((el) => el.children.length > 0 || (el.textContent || '').trim().length > 0)
        .length,
      fontsLoaded: document.fonts ? document.fonts.size : -1,
    };
  })()`;
  const res = await send('Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: true });
  return res.result?.result?.value ?? null;
}

async function main() {
  const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TARGETS;
  const bin = BROWSERS.find((b) => existsSync(b));
  if (!bin) {
    console.error('no Chromium found; set BROWSER=/path/to/chrome');
    process.exit(2);
  }

  const profile = await mkdtemp(join(tmpdir(), 'vouchsafe-verify-'));
  const proc = spawn(bin, [
    '--enable-features=WebMCP',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Headless, like every other tool here. A verification run should not put a
    // window on anyone's screen.
    '--headless=new',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore', detached: true });

  let ws = null;
  const failures = [];
  try {
    let page = null;
    for (let i = 0; i < 60 && !page; i += 1) {
      try {
        const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
        page = list.find((t) => t.type === 'page');
      } catch { /* not up yet */ }
      if (!page) await sleep(500);
    }
    if (!page) throw new Error('the browser never exposed a page');

    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const consoleErrors = [];
    const failedRequests = [];

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(message.params.exceptionDetails.exception?.description
          ?? message.params.exceptionDetails.text);
      }
      if (message.method === 'Network.loadingFailed') {
        failedRequests.push(message.params.errorText);
      }
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
        // The browser asks for /favicon.ico whether or not the page mentions
        // one. That is the browser's request, not the page's, and failing a
        // render check on it hides the failures that matter.
        if (!/\/favicon\.ico$/.test(message.params.response.url)) {
          failedRequests.push(message.params.response.status + ' ' + message.params.response.url);
        }
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const next = ++id;
      pending.set(next, resolve);
      ws.send(JSON.stringify({ id: next, method, params }));
    });

    await new Promise((resolve) => { ws.onopen = resolve; });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    for (const url of targets) {
      consoleErrors.length = 0;
      failedRequests.length = 0;
      await send('Page.navigate', { url });
      await sleep(4500);

      const state = await inspect(send, url);
      const problems = [];
      if (!state) problems.push('the page could not be inspected at all');
      else {
        if (state.visibleText < 200) problems.push(`only ${state.visibleText} characters of visible text`);
        if (state.elements < 30) problems.push(`only ${state.elements} elements in the body`);
        if (state.populated < 5) problems.push(`only ${state.populated} filled elements, so the scripts did not run`);
      }
      for (const failure of failedRequests) problems.push('failed request: ' + failure);
      for (const error of consoleErrors) problems.push('threw: ' + String(error).split('\n')[0]);

      if (problems.length === 0) {
        console.log(`  ok    ${url}  (${state.visibleText} chars, ${state.elements} elements)`);
      } else {
        console.log(`  FAIL  ${url}`);
        for (const p of problems) console.log(`          ${p}`);
        failures.push(url);
      }
    }
  } finally {
    ws?.close();
    // SIGKILL, not the default SIGTERM. Chrome handles SIGTERM by shutting down
    // gracefully, which means it writes to its profile after the delete below
    // has run and the directory comes back. Five of them survived every run of
    // this script, at roughly 100MB each against a 3.8G tmpfs.
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    await once(proc, 'exit').catch(() => {});
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log(failures.length === 0
    ? `\n${targets.length} page(s) render.\n`
    : `\n${failures.length} of ${targets.length} page(s) are broken.\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-deploy could not run:', err.message);
  process.exit(2);
});
