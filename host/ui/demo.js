/**
 * @file Guided demo: the whole argument, driven automatically, with captions.
 *
 * Responsible for: running the real flow end to end so a visitor who has no
 * WebMCP-capable agent still sees what the product does, and so the story can
 * be filmed in one take without a human hitting marks.
 *
 * NOT responsible for: faking anything. Every step calls the same tools an
 * agent would call, against the same two origins, and reads the same results.
 * If federation were broken the demo would visibly fail, which is the point of
 * driving the real thing rather than playing a recording.
 *
 * The vault is a cross-origin frame, so this cannot click inside it. Steps that
 * need a grant changed ask the vault to do it over `postMessage`, and the vault
 * decides whether to obey. That is the same trust boundary as everywhere else
 * here: this origin can request, and only the other origin can act.
 */

import { federatedHandles, PROXY_PREFIX } from '../lib/federation.js';
import { vaultOrigin } from '../config.js';
import { escapeHtml as esc } from '../lib/util.js';

/** Beat between steps, in ms. Slow enough to read, short enough for 3 minutes. */
const BEAT_MS = 2600;

/** Shorter beat for steps that only narrate. */
const QUICK_MS = 1700;

/**
 * @typedef {object} Step
 * @property {string} say      caption shown while the step runs
 * @property {string} [detail] smaller line under the caption
 * @property {number} [wait]   override the beat
 * @property {string} [look]   selector for what this step is about; the page moves to it
 * @property {() => Promise<string | void>} [act] the thing actually done
 */

/**
 * Bring the thing being talked about into view.
 *
 * A walkthrough that narrates something off-screen is worse than no walkthrough,
 * because the reader looks for what is being described and does not find it.
 * Honours reduced motion by jumping rather than gliding.
 *
 * @param {string} selector
 * @returns {void}
 */
function look(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
}

/** True while a run is in progress, so the button cannot start two. */
let running = false;

/** Set when someone presses the close control, read between every beat. */
let stopped = false;

/**
 * Stop the walkthrough at the next beat.
 *
 * Not mid-step: a step that has asked the other origin for something is left to
 * finish, so the two sides cannot be left disagreeing about what was granted.
 *
 * @returns {void}
 */
export function stopDemo() {
  stopped = true;
}

/**
 * Call one of this origin's own tools, the way an agent would.
 *
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @returns {Promise<string>}
 */
async function callOwnTool(name, args) {
  const tools = await document.modelContext.getTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) return 'Error: ' + name + ' is not registered';
  // `executeTool` takes its arguments as a JSON string, not an object.
  const result = await document.modelContext.executeTool(tool, JSON.stringify(args));
  return result === null || result === undefined ? '' : String(result);
}

/**
 * How long to wait for the vault to answer, in ms.
 *
 * The vault applies the change and re-syncs its registry before replying, which
 * is a handful of synchronous writes. Past this, the vault is not listening,
 * which is a real condition the walkthrough must report rather than paper over.
 */
const VAULT_REPLY_TIMEOUT_MS = 4000;

/**
 * Ask the vault to change a grant, and wait to hear whether it did.
 *
 * The vault is a separate origin, so this is a request and the vault is free to
 * refuse. An earlier version posted the message and resolved on a fixed timer,
 * so the walkthrough carried on narrating whether or not anything happened:
 * with permission to drive switched off, a viewer saw the caption "You allow
 * nine questions" over an empty diagram. A walkthrough that describes things
 * that did not happen is worse than no walkthrough at all.
 *
 * The vault now replies with what it actually did, so the caller can tell done
 * from refused from not listening.
 *
 * @param {'grant-typical' | 'revoke' | 'revoke-all'} action
 * @param {string} [predicate]
 * @returns {Promise<{ok: true, granted: number} | {ok: false, reason: 'refused' | 'silent'}>}
 */
function askVault(action, predicate) {
  const frame = document.getElementById('vault-frame');
  const target = vaultOrigin();
  if (!frame?.contentWindow) return Promise.resolve({ ok: false, reason: 'silent' });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReply);
      resolve({ ok: false, reason: 'silent' });
    }, VAULT_REPLY_TIMEOUT_MS);

    function onReply(event) {
      // Origin before payload. A reply that did not come from the vault is not
      // a reply.
      if (event.origin !== target) return;
      if (event.data?.source !== 'bureau-vault') return;
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      resolve(
        event.data.ok
          ? { ok: true, granted: Number(event.data.granted) || 0 }
          : { ok: false, reason: 'refused' }
      );
    }

    window.addEventListener('message', onReply);
    // Targeted, not "*", so the message cannot be read by whatever else the
    // frame might navigate to.
    frame.contentWindow.postMessage({ source: 'bureau-demo', action, predicate }, target);
  });
}

/**
 * Turn a vault reply into either output to show, or a reason to stop.
 *
 * The walkthrough drives switches that belong to somebody else. When the vault
 * declines, the only honest thing to do is stop and say so, because every
 * caption after that point would be describing a state that was never reached.
 *
 * @param {{ok: true, granted: number} | {ok: false, reason: 'refused' | 'silent'}} reply
 * @returns {string | {halt: string, detail: string}}
 */
function halted(reply) {
  if (reply.ok) {
    return reply.granted === 0
      ? 'Your file now allows nothing.'
      : 'Your file now allows ' + reply.granted + ' question' + (reply.granted === 1 ? '' : 's') + '.';
  }
  if (reply.reason === 'refused') {
    return {
      halt: 'Your file declined, so the walkthrough stopped here.',
      detail:
        'This site cannot change your permissions unless you let it. Tick "Let the walkthrough use these switches" in your file, then start again.',
    };
  }
  return {
    halt: 'Your file did not answer, so the walkthrough stopped here.',
    detail: 'It may still be loading. Give it a moment and start again.',
  };
}

/**
 * The script.
 *
 * @returns {Step[]}
 */
function steps() {
  return [
    {
      say: 'Renting normally means uploading your payslips, your bank statements and your passport.',
      look: '#graph',
      detail: 'To six agencies. Six copies of your life, kept indefinitely.',
      wait: QUICK_MS,
    },
    {
      say: 'None of them wanted your salary. They wanted one answer.',
      look: '#graph',
      detail: 'Does your income cover three times the rent. Yes or no.',
      wait: QUICK_MS,
    },
    {
      say: 'Right now this agency knows nothing about you.',
      look: '#graph',
      detail: 'Watch the diagram.',
      act: async () => halted(await askVault('revoke-all')),
    },
    {
      say: 'You allow nine questions, in your own file, on your own website.',
      look: '#graph',
      detail: 'Each is a question they may ask. Not a document they may keep.',
      act: async () => halted(await askVault('grant-typical')),
    },
    {
      say: 'Nine questions just became answerable across the boundary between two websites.',
      look: '#graph',
      detail: 'Your file offered them. This site asked for them. No server in between.',
    },
    {
      say: 'Now the agency runs its checks.',
      look: '#assessment',
      detail: 'Nine questions. Nine one-word answers.',
      act: async () => callOwnTool('check_eligibility', { listing_id: 'ml-114' }),
      wait: 3200,
    },
    {
      say: 'You qualify. And this site still holds nothing about you.',
      look: '#assessment',
      act: async () => callOwnTool('what_this_site_knows', {}),
    },
    {
      say: 'Now suppose the agency gets greedy and starts guessing your salary.',
      look: '#graph',
      detail: 'Every single answer is legitimate. The run of them is not.',
      act: async () => {
        const handle = federatedHandles().find((t) => String(t.name) === 'income_meets_multiple');
        if (!handle) return 'that question is not allowed';
        const lines = [];
        for (const rent of [2000, 1500, 1300, 1200, 1175, 1160]) {
          const out = await document.modelContext.executeTool(
            handle,
            JSON.stringify({ monthly_rent_gbp: rent, multiple: 3 })
          );
          lines.push('rent ' + rent + ' -> ' + String(out).slice(0, 70));
          if (String(out).startsWith('Error')) break;
        }
        return lines.join('\n');
      },
      wait: 4200,
    },
    {
      say: 'Your file noticed, and stopped answering.',
      look: '#vault-frame',
      detail: 'Five numbers allowed, the sixth refused, and you were told who was asking.',
      wait: 3000,
    },
    {
      say: 'Change your mind, and the question stops being answerable.',
      look: '#graph',
      detail: 'Nothing is asked to cooperate. It simply stops existing on their side.',
      act: async () => askVault('revoke', 'income_meets_multiple'),
      wait: 3000,
    },
    {
      say: 'Gone, mid-conversation. That check can no longer run.',
      look: '#assessment',
      act: async () => callOwnTool('check_eligibility', { listing_id: 'ml-114' }),
      wait: 3400,
    },
    {
      say: 'The agency gets an answer, not your life.',
      look: '#graph',
      detail: 'Your file. Their question. One word back.',
      wait: 4000,
    },
  ];
}

/**
 * Run the demo.
 *
 * @param {(state: {caption: string, detail: string, output: string,
 *                  index: number, total: number} | null) => void} onUpdate
 * @returns {Promise<void>}
 */
export async function runDemo(onUpdate) {
  if (running) return;
  running = true;

  const script = steps();
  stopped = false;
  try {
    for (let i = 0; i < script.length; i += 1) {
      if (stopped) return;
      const step = script[i];
      if (step.look) look(step.look);
      onUpdate({
        caption: step.say,
        detail: step.detail ?? '',
        output: '',
        index: i + 1,
        total: script.length,
      });

      let output = '';
      if (step.act) {
        let result;
        try {
          result = await step.act();
        } catch (err) {
          result = 'Error: ' + (err instanceof Error ? err.message : String(err));
        }

        // A step can end the run. Every caption after a declined request would
        // be describing a state that was never reached, so we stop on the truth
        // rather than narrate past it.
        if (result !== null && typeof result === 'object' && 'halt' in result) {
          onUpdate({
            caption: result.halt,
            detail: result.detail ?? '',
            output: '',
            index: i + 1,
            total: script.length,
            halted: true,
          });
          await new Promise((r) => setTimeout(r, 6000));
          return;
        }

        output = String(result ?? '');
        onUpdate({
          caption: step.say,
          detail: step.detail ?? '',
          output,
          index: i + 1,
          total: script.length,
        });
      }

      await new Promise((r) => setTimeout(r, step.wait ?? BEAT_MS));
      if (stopped) return;
    }
  } finally {
    running = false;
    onUpdate(null);
  }
}

/** Is a demo currently running? */
export function demoRunning() {
  return running;
}

/** Proxy-name helper, so captions can name the tool the way the agent sees it. */
export function proxyName(predicate) {
  return PROXY_PREFIX + predicate;
}

/** Escape helper re-exported so the caption renderer does not import twice. */
export { esc };
