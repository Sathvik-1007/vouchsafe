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
 * Ask the vault to change a grant.
 *
 * The vault is a separate origin, so this is a request, not a command. It is
 * sent with an explicit target origin rather than "*", so the message cannot be
 * read by whatever else the frame might navigate to.
 *
 * @param {'grant-typical' | 'revoke' | 'revoke-all'} action
 * @param {string} [predicate]
 * @returns {Promise<void>}
 */
function askVault(action, predicate) {
  const frame = document.getElementById('vault-frame');
  frame?.contentWindow?.postMessage({ source: 'bureau-demo', action, predicate }, vaultOrigin());
  // The vault answers by changing its registrations, which reaches this page as
  // a `toolchange` event, so there is nothing to await on the message itself.
  return new Promise((resolve) => setTimeout(resolve, 900));
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
      look: '#demo-stage',
      detail: 'To six agencies. Six copies of your life, kept indefinitely.',
      wait: QUICK_MS,
    },
    {
      say: 'None of them wanted your salary. They wanted one answer.',
      look: '#demo-stage',
      detail: 'Does your income cover three times the rent. Yes or no.',
      wait: QUICK_MS,
    },
    {
      say: 'Right now this agency knows nothing about you.',
      look: '#graph',
      detail: 'Watch the diagram.',
      act: async () => askVault('revoke-all'),
    },
    {
      say: 'You allow nine questions, in your own file, on your own website.',
      look: '#graph',
      detail: 'Each is a question they may ask. Not a document they may keep.',
      act: async () => askVault('grant-typical'),
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
      look: '#demo-stage',
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
  try {
    for (let i = 0; i < script.length; i += 1) {
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
        try {
          output = String((await step.act()) ?? '');
        } catch (err) {
          output = 'Error: ' + (err instanceof Error ? err.message : String(err));
        }
        onUpdate({
          caption: step.say,
          detail: step.detail ?? '',
          output,
          index: i + 1,
          total: script.length,
        });
      }

      await new Promise((r) => setTimeout(r, step.wait ?? BEAT_MS));
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
