/**
 * @file Screenshot a page in a browser nobody is looking at.
 *
 * Headless, its own profile, and a port the kernel picks. Earlier screenshot
 * scripts drove whatever browser happened to be listening on a fixed port,
 * which meant they hijacked a window someone was using and left blank tabs
 * behind. Nothing here touches a browser it did not start, and it starts one
 * that never appears on screen.
 *
 * Usage:
 *   node tools/shoot.mjs <url> <out.png> [width] [height] ["js to run first"]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [, , url, out, width = '1440', height = '900', setup = ''] = process.argv;
if (!url || !out) {
  console.error('usage: node tools/shoot.mjs <url> <out.png> [w] [h] ["setup js"]');
  process.exit(2);
}

const BROWSERS = [process.env.BROWSER, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/brave']
  .filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the kernel for a port nobody is using. @returns {Promise<number>} */
async function freePort() {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

const bin = BROWSERS.find((b) => existsSync(b));
if (!bin) {
  console.error('no Chromium found; set BROWSER=/path/to/chrome');
  process.exit(2);
}

const port = await freePort();
const profile = await mkdtemp(join(tmpdir(), 'vouchsafe-shot-'));
const proc = spawn(bin, [
  '--headless=new',
  '--enable-features=WebMCP',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--window-size=${width},${height}`,
], { stdio: 'ignore', detached: true });

let ws = null;
try {
  let page = null;
  for (let i = 0; i < 60 && !page; i += 1) {
    try {
      const list = await (await fetch(`http://localhost:${port}/json`)).json();
      page = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!page) await sleep(400);
  }
  if (!page) throw new Error('the browser never exposed a page');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const next = ++id;
    pending.set(next, resolve);
    ws.send(JSON.stringify({ id: next, method, params }));
  });

  await new Promise((r) => { ws.onopen = r; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: Number(width) < 500,
  });
  await send('Page.navigate', { url });
  await sleep(4500);

  if (setup) {
    await send('Runtime.evaluate', { expression: setup, awaitPromise: true });
    await sleep(2200);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(out, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', out);
} finally {
  ws?.close();
  try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
