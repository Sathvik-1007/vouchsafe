/**
 * @file Record the submission video, narration and all, with nothing on camera
 *       that a human had to hit on cue.
 *
 * Responsible for: producing one finished mp4 of the real product, driven
 * through its real tools across both origins, with spoken narration that is in
 * sync by construction rather than by editing.
 *
 * NOT responsible for: faking any of it. Every scene action below calls the
 * same tools an agent would call, against the two deployed origins. If
 * federation broke, the recording would visibly break with it.
 *
 * ## Why it is built this way
 *
 * The obvious approach is to screen-record a browser window. On a Wayland
 * session that means capturing through XWayland, which is unreliable, and it
 * puts whatever else is on the desktop at risk of appearing in frame. So the
 * browser runs headless and the frames come out of the debugging protocol.
 * Nothing on the machine can wander into shot.
 *
 * ## How it stays in sync
 *
 * Narration is generated first, one clip per scene, and each clip is measured.
 * A scene's length is then *defined* as its narration plus a tail pause, and the
 * audio track is built by padding each clip out to exactly that length. Sync is
 * not something adjusted afterwards; there is no arrangement in which the two
 * tracks can disagree.
 *
 * This is also why a scene is never cut short. The recorder holds until the
 * narration for that scene has finished, so the film can lose whole scenes off
 * the end if it runs long, but it can never cut in the middle of a sentence.
 *
 * Usage:
 *   node tools/film.mjs [out.mp4]
 */

import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HOST = 'https://vouchsafe-lettings.vercel.app';
const VAULT = 'https://vouchsafe-vault.vercel.app';
const PROOF = HOST + '/proof.html';

const WIDTH = 1920;
const HEIGHT = 1080;

/** Frames per second the finished video is built at. */
const FPS = 12;

/** The voice. Downloaded separately; the script says so if it is missing. */
const VOICE = join(process.env.HOME, '.local/share/piper-voices/v.onnx');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The film.
 *
 * `say` is spoken. `act` runs at the start of the scene and the scene then
 * holds for the whole of its narration, so an action always has its own
 * sentence over it rather than the one after.
 *
 * `tail` is the silence after the sentence, in ms. It is what stops the thing
 * sounding like a list being read out.
 *
 * @typedef {object} Scene
 * @property {string} say
 * @property {number} [tail]
 * @property {(d: Driver) => Promise<void>} [act]
 */

/**
 * @param {Driver} d
 * @returns {Scene[]}
 */
const scenes = (d) => [
  {
    say: 'To rent a flat in Britain, you upload your payslips, your bank statements '
      + 'and your passport to six letting agents. They keep them forever.',
    tail: 700,
    act: async () => { await d.goto(HOST); },
  },
  {
    say: 'None of them wanted your salary. They wanted one answer. '
      + 'Does your income cover three times the rent. Yes, or no.',
    tail: 900,
    act: async () => { await d.look(HOST, '#graph'); },
  },
  {
    say: 'This is Vouchsafe. Your facts stay on your own origin, in your own browser, '
      + 'and nothing on this page can send them anywhere.',
    tail: 800,
    act: async () => { await d.look(HOST, '#vault-frame'); },
  },
  {
    say: 'Right now, this letting agency knows nothing at all about you. Watch the diagram.',
    tail: 900,
    act: async () => {
      await d.clickIn(VAULT, '#revoke-all');
      await d.confirmIn(VAULT);
      await d.look(HOST, '#graph');
    },
  },
  {
    say: 'You allow nine questions, in your own file. Each one is a question they may ask. '
      + 'Not a document they may keep.',
    tail: 1100,
    act: async () => { await d.clickIn(VAULT, '#grant-typical'); },
  },
  {
    say: 'Those nine questions just became answerable across the boundary between two '
      + 'different websites. Your file offered them. The agency asked for them. '
      + 'There is no server in between.',
    tail: 900,
    act: async () => { await d.look(HOST, '#graph'); },
  },
  {
    say: 'Now the agency runs its checks. Nine questions, and nine one word answers.',
    tail: 800,
    act: async () => {
      await d.look(HOST, '#assessment');
      await d.callTool(HOST, 'check_eligibility', { listing_id: 'ml-114' });
    },
  },
  {
    say: 'You qualify. And this site still holds nothing about you.',
    tail: 900,
    act: async () => { await d.callTool(HOST, 'what_this_site_knows', {}); },
  },
  {
    say: 'Now suppose the agency gets greedy, and starts guessing your salary '
      + 'by moving the threshold it asks about.',
    tail: 600,
    act: async () => { await d.look(HOST, '#graph'); },
  },
  {
    say: 'Every one of those answers was legitimate on its own. The run of them is not. '
      + 'Your file noticed, and it stopped answering.',
    tail: 1100,
    act: async () => { await d.probe(); },
  },
  {
    say: 'Change your mind, and the question stops being answerable. '
      + 'Nothing is asked to cooperate. The tool simply stops existing on their side.',
    tail: 900,
    act: async () => {
      await d.look(HOST, '#graph');
      await d.revokeOne('income_meets_multiple');
    },
  },
  {
    say: 'Gone, in the middle of the conversation. That check can no longer run.',
    tail: 1000,
    act: async () => {
      await d.look(HOST, '#assessment');
      await d.callTool(HOST, 'check_eligibility', { listing_id: 'ml-114' });
    },
  },
  {
    say: 'Authority here is not a permission check. It is whether the tool exists. '
      + 'This page reads the browser’s own registry, and registers nothing itself.',
    tail: 1000,
    act: async () => { await d.goto(PROOF); },
  },
  {
    say: 'The letting agent gets an answer. Not your life.',
    tail: 1600,
    act: async () => { await d.goto(HOST); },
  },
];

/** Ask the kernel for a port nobody is using. @returns {Promise<number>} */
async function freePort() {
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
}

/**
 * A browser, and the handful of things this film asks of it.
 *
 * Deliberately not the test harness: that one is built to fail loudly on the
 * first surprise, which is right for a test and wrong for a recording, where a
 * missing element should cost one gesture rather than the whole take.
 */
class Driver {
  #ws = null;
  #id = 0;
  #pending = new Map();
  #contexts = [];
  #port = 0;

  proc = null;
  profile = '';

  /** Session for the vault's out-of-process frame, once the browser attaches it. */
  vaultSession = '';

  /** @type {(frame: {data: string, at: number}) => void} */
  onFrame = () => {};

  static async launch() {
    const bin = [process.env.BROWSER, '/usr/bin/brave', '/usr/bin/brave-browser',
      '/usr/bin/google-chrome', '/usr/bin/chromium']
      .filter(Boolean).find((b) => existsSync(b));
    if (!bin) throw new Error('no browser found; set BROWSER=/path/to/brave');

    const d = new Driver();
    d.#port = await freePort();
    d.profile = await mkdtemp(join(tmpdir(), 'vouchsafe-film-'));
    d.proc = spawn(bin, [
      '--headless=new',
      '--enable-features=WebMCP',
      '--enable-blink-features=WebMCP',
      `--remote-debugging-port=${d.#port}`,
      `--user-data-dir=${d.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${WIDTH},${HEIGHT}`,
    ], { stdio: 'ignore', detached: true });

    let page = null;
    for (let i = 0; i < 80 && !page; i += 1) {
      try {
        const list = await (await fetch(`http://localhost:${d.#port}/json`)).json();
        page = list.find((t) => t.type === 'page');
      } catch { /* not up yet */ }
      if (!page) await sleep(300);
    }
    if (!page) throw new Error('the browser never exposed a page');

    d.#ws = new WebSocket(page.webSocketDebuggerUrl);
    d.#ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.id && d.#pending.has(m.id)) {
        d.#pending.get(m.id)(m);
        d.#pending.delete(m.id);
        return;
      }
      if (m.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = m.params;
        if (process.env.FILM_DEBUG) console.log('  attached:', targetInfo.type, targetInfo.url.slice(0, 60));
        // Matched on type alone: the target attaches before it has navigated,
        // so its url is still empty here and matching on that caught nothing.
        // The host page frames exactly one document, which is the vault.
        if (targetInfo.type === 'iframe') {
          d.vaultSession = sessionId;
          // The child session starts with nothing enabled, so ask for the
          // domains this needs before anything is evaluated through it.
          d.send('Runtime.enable', {}, 5000, sessionId).catch(() => {});
          d.send('Page.enable', {}, 5000, sessionId).catch(() => {});
        }
      }
      if (m.method === 'Page.screencastFrame') {
        d.onFrame({ data: m.params.data, at: Date.now() });
        d.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
      }
    };
    await new Promise((r) => { d.#ws.onopen = r; });
    await d.send('Page.enable');
    await d.send('Runtime.enable');
    await d.send('Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await d.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
    });
    return d;
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {number} [timeout]
   * @param {string} [sessionId] address a child target rather than the page
   */
  send(method, params = {}, timeout = 15000, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} got no reply in ${timeout}ms`));
      }, timeout);
      this.#pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      this.#ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  async goto(url, settle = 3000) {
    this.#contexts = [];
    await this.send('Page.navigate', { url });
    await sleep(settle);
  }

  /**
   * Evaluate in the frame belonging to an origin, so the vault can be driven
   * directly instead of being asked through its parent.
   */
  async evalIn(origin, expression) {
    // The vault is cross-origin, so it runs in its own process and is reachable
    // only through the session the browser attached for it. Everything else is
    // the top document, which is what `Runtime.evaluate` addresses by default.
    // An earlier version passed an explicit `contextId` collected from
    // `executionContextCreated`, and every call silently returned nothing: the
    // ids go stale across navigation and a stale one answers with an error
    // rather than a value, so the whole film played with no actions in it.
    const sessionId = origin === VAULT ? this.vaultSession : undefined;
    if (origin === VAULT && !sessionId) return null;
    try {
      const res = await this.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, 8000, sessionId);
      if (res.result?.exceptionDetails) return null;
      return res.result?.result?.value;
    } catch {
      return null;
    }
  }

  /** Bring a thing into shot. A narrated element off screen is a wasted scene. */
  async look(origin, selector) {
    await this.evalIn(origin, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});
      if(e) e.scrollIntoView({behavior:'smooth',block:'center'}); return !!e;})()`);
    await sleep(900);
  }

  async clickIn(origin, selector) {
    return this.evalIn(origin, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});
      if(!e) return 'MISSING'; e.click(); return 'ok';})()`);
  }

  /** Answer the vault's own confirmation, which stands in for window.confirm. */
  async confirmIn(origin) {
    await sleep(600);
    return this.evalIn(origin, `(()=>{
      const b=[...document.querySelectorAll('.confirm button, dialog button')]
        .find(x=>/withdraw|yes|confirm|remove/i.test(x.textContent));
      if(!b) return 'none'; b.click(); return 'ok';})()`);
  }

  /** Call one of an origin's own tools, exactly the way an agent would. */
  async callTool(origin, name, args) {
    return this.evalIn(origin, `(async()=>{
      const tools = await document.modelContext.getTools();
      const t = tools.find(x=>x.name===${JSON.stringify(name)});
      if(!t) return 'not registered';
      return String(await document.modelContext.executeTool(t, ${JSON.stringify(JSON.stringify(args))}));
    })()`);
  }

  /** The threshold search, run for real until the vault refuses it. */
  async probe() {
    return this.evalIn(HOST, `(async()=>{
      const tools = await document.modelContext.getTools();
      const t = tools.find(x=>String(x.name).endsWith('income_meets_multiple'));
      if(!t) return 'not allowed';
      const out=[];
      for (const rent of [2000,1500,1300,1200,1175,1160]) {
        const r = String(await document.modelContext.executeTool(t,
          JSON.stringify({monthly_rent_gbp: rent, multiple: 3})));
        out.push(rent+': '+r.slice(0,60));
        if (r.startsWith('Error')) break;
      }
      return out.join('\\n');
    })()`);
  }

  /** Withdraw one permission by pressing its own control in the vault. */
  async revokeOne(predicate) {
    return this.evalIn(VAULT, `(()=>{
      const rows=[...document.querySelectorAll('#permission-list [data-name]')];
      const row=rows.find(r=>r.dataset.name===${JSON.stringify(predicate)});
      const b=row?.querySelector('button[data-act]');
      if(!b) return 'MISSING'; b.click(); return 'ok';})()`);
  }

  close() {
    try { process.kill(-this.proc.pid, 'SIGKILL'); } catch { /* gone */ }
    if (this.profile) {
      try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* fine */ }
    }
  }
}

/** Length of an audio or video file, in seconds. */
async function duration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

/** Speak one line to a wav file. */
function speak(text, wav) {
  return new Promise((resolve, reject) => {
    const p = spawn('piper', ['-m', VOICE, '-f', wav]);
    p.stdin.end(text);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('piper exited ' + code))));
    p.on('error', reject);
  });
}

async function main() {
  const out = process.argv[2] || 'vouchsafe.mp4';
  if (!existsSync(VOICE)) {
    console.error(`no voice at ${VOICE}. Download a piper voice there first.`);
    process.exit(2);
  }

  const work = await mkdtemp(join(tmpdir(), 'vouchsafe-cut-'));
  const frameDir = join(work, 'frames');
  await mkdir(frameDir);

  const driver = await Driver.launch();
  const script = scenes(driver);

  // ---- narration first, because the scene lengths come from it -------------
  console.log(`speaking ${script.length} lines`);
  const clips = [];
  for (const [i, scene] of script.entries()) {
    const wav = join(work, `say-${String(i).padStart(2, '0')}.wav`);
    await speak(scene.say, wav);
    const secs = await duration(wav);
    clips.push({ wav, secs, tail: (scene.tail ?? 800) / 1000 });
    console.log(`  ${String(i + 1).padStart(2)}. ${secs.toFixed(1)}s  ${scene.say.slice(0, 56)}...`);
  }

  const total = clips.reduce((sum, c) => sum + c.secs + c.tail, 0);
  console.log(`\nnarration runs ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`);

  // ---- roll ---------------------------------------------------------------
  const frames = [];

  await driver.goto(HOST, 4500);

  // Frames are pulled on our own clock rather than pushed by the screencast.
  // `Page.screencastFrame` only fires when the compositor repaints, so a page
  // that is simply being read produces almost nothing: a first cut of this ran
  // 93 seconds on twelve frames, which is a slideshow with a voice over it.
  // Grabbing them in a loop costs more time per frame and is worth it, because
  // the result is actually a video.
  let rolling = true;
  const capture = (async () => {
    while (rolling) {
      try {
        const shot = await driver.send('Page.captureScreenshot',
          { format: 'jpeg', quality: 80, optimizeForSpeed: true }, 8000);
        const data = shot.result?.data;
        if (data) frames.push({ data, at: Date.now() });
      } catch { /* a navigation was in flight; the next pass gets it */ }
    }
  })();

  // A take costs a minute and a half, so prove both eval paths first: a film
  // whose actions silently do nothing looks exactly like one that worked.
  const reachHost = await driver.evalIn(HOST, `'ok ' + !!document.querySelector('#graph')`);
  const reachVault = await driver.evalIn(VAULT, `'ok ' + !!document.querySelector('#grant-typical')`);
  console.log(`  host frame:  ${reachHost}`);
  console.log(`  vault frame: ${reachVault}`);
  if (!reachHost || !reachVault) throw new Error('a frame is unreachable; the take would be empty');

  const started = Date.now();
  for (const [i, scene] of script.entries()) {
    const sceneStart = Date.now();
    process.stdout.write(`  scene ${i + 1}/${script.length}`);
    if (scene.act) await scene.act(driver).catch((e) => process.stdout.write(` (${e.message})`));
    // Hold for the whole sentence, however long the action took. A scene may
    // run long; it is never cut in the middle of a line.
    const want = (clips[i].secs + clips[i].tail) * 1000;
    const spent = Date.now() - sceneStart;
    if (spent < want) await sleep(want - spent);
    console.log(`  ${((Date.now() - sceneStart) / 1000).toFixed(1)}s`);
  }

  rolling = false;
  await capture;
  const filmed = (Date.now() - started) / 1000;
  driver.close();
  console.log(`\ncaptured ${frames.length} frames over ${filmed.toFixed(1)}s`);
  if (frames.length === 0) throw new Error('no frames were captured');

  // ---- assemble -----------------------------------------------------------
  // Frames arrive only when something changes, so their spacing is uneven. The
  // concat demuxer is given each frame's real on-screen time, which is what
  // keeps a still scene still rather than racing through it.
  const list = [];
  for (const [i, f] of frames.entries()) {
    const file = join(frameDir, `f${String(i).padStart(5, '0')}.jpg`);
    await writeFile(file, Buffer.from(f.data, 'base64'));
    const next = frames[i + 1] ? frames[i + 1].at : started + filmed * 1000;
    list.push(`file '${file}'`, `duration ${Math.max(0.02, (next - f.at) / 1000).toFixed(3)}`);
  }
  list.push(`file '${join(frameDir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`);
  const listFile = join(work, 'frames.txt');
  await writeFile(listFile, list.join('\n'));

  // Audio: each clip padded out to exactly its scene's length, so the track and
  // the picture are the same length by construction and cannot drift.
  const parts = [];
  for (const [i, c] of clips.entries()) {
    const padded = join(work, `pad-${String(i).padStart(2, '0')}.wav`);
    await run('ffmpeg', ['-v', 'error', '-y', '-i', c.wav,
      '-af', `apad=whole_dur=${(c.secs + c.tail).toFixed(3)}`, padded]);
    parts.push(`file '${padded}'`);
  }
  const audioList = join(work, 'audio.txt');
  await writeFile(audioList, parts.join('\n'));
  const track = join(work, 'track.wav');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0',
    '-i', audioList, '-c', 'copy', track]);

  console.log('encoding');
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-i', track,
    '-vf', `fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,`
      + `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0xf4f3ee,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    // Whichever track ends first ends the film. The audio is the shorter of the
    // two by design, so the picture is trimmed to the last spoken word rather
    // than a sentence being trimmed to fit the picture.
    '-shortest', '-movflags', '+faststart',
    out,
  ], { maxBuffer: 1 << 26 });

  const len = await duration(out);
  console.log(`\nwrote ${out}  ${Math.floor(len / 60)}:${String(Math.round(len % 60)).padStart(2, '0')}`);
  if (len >= 180) console.log('  OVER THREE MINUTES. Drop a scene from the end.');
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => { console.error(err); process.exit(1); });
