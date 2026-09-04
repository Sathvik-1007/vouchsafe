/**
 * @file Probe detection: catching a caller that binary-searches a threshold.
 *
 * Responsible for: noticing when an origin is using a yes-or-no predicate to
 * extract the number behind it, quantifying how much it has learned, and
 * refusing once it has learned too much.
 *
 * NOT responsible for: authorisation. A probe is a *granted* caller abusing a
 * permission it legitimately holds, which is exactly why the grant system on
 * its own cannot stop it.
 *
 * ## The attack
 *
 * `income_meets_multiple` returns one bit. Call it once and the caller learns
 * one bit. But the caller chooses the threshold, so it can call again with a
 * different one:
 *
 *     rent 1150, multiple 3  yields yes   so income is at least 41,400
 *     rent 2000, multiple 3  yields no    so income is under   72,000
 *     rent 1500, multiple 3  yields no    so income is under   54,000
 *     rent 1300, multiple 3  yields no    so income is under   46,800
 *     rent 1200, multiple 3  yields yes   so income is at least 43,200
 *
 * Five calls have bracketed the salary to a 3,600 pound window. Twenty pin it
 * exactly. Every individual answer was one bit and entirely legitimate. The
 * sequence is a salary disclosure wearing a predicate's clothes.
 *
 * This is the real limit of a predicate vault, and the honest thing is to bound
 * it in code rather than leave it in a caveat. So the vault tracks the bracket
 * each origin has established per predicate, prices what it has learned, and
 * stops answering once the remaining uncertainty falls below a floor.
 *
 * ## What this does not claim
 *
 * It does not make threshold predicates leak-proof. A patient caller spreading
 * probes across sessions, or several colluding origins pooling their answers,
 * defeats a per-origin window. Adding noise to the answers would bound the leak
 * properly and would also make a legitimate affordability check occasionally
 * wrong, which is not a trade a letting decision can absorb. What is here is
 * the cheap, honest version: it stops the obvious attack, and it says plainly
 * that it does not stop every one.
 */

/**
 * How many distinct thresholds an origin may test against one predicate before
 * the vault refuses.
 *
 * A genuine letting check calls each predicate once, occasionally twice if the
 * agent retries after correcting an argument. Five different thresholds against
 * one predicate is not a check, it is a search.
 */
export const MAX_DISTINCT_PROBES = 5;

/**
 * Bits an origin may extract about one underlying value before the vault stops.
 *
 * Each probe at worst halves the plausible range, so this caps how many times
 * the search may usefully split. Four bits leaves the value pinned no more
 * precisely than one part in sixteen of the range it started from.
 */
export const MAX_EXTRACTED_BITS = 4;

/**
 * Window over which probes are counted, in milliseconds.
 *
 * Fifteen minutes comfortably contains any honest application flow, and is
 * short enough that a legitimate caller returning the next day starts clean.
 */
export const PROBE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Read the numeric threshold out of a predicate's arguments.
 *
 * Only predicates that take a caller-chosen number are probeable.
 * `has_no_eviction_record` takes no argument at all, so calling it a hundred
 * times reveals nothing that one call did not.
 *
 * @type {ReadonlyMap<string, (args: Record<string, unknown>) => number | null>}
 */
const THRESHOLD_READERS = new Map([
  [
    'income_meets_multiple',
    // The bracket is on annual income, so both arguments fold into one number.
    (a) => finite(Number(a?.monthly_rent_gbp) * 12 * Number(a?.multiple)),
  ],
  ['deposit_available', (a) => finite(Number(a?.amount_gbp))],
  ['references_at_least', (a) => finite(Number(a?.count))],
  ['employment_months_min', (a) => finite(Number(a?.months))],
  ['household_size_at_most', (a) => finite(Number(a?.max_occupants))],
]);

/**
 * @param {number} n
 * @returns {number | null} the number, or null when it is not finite
 */
function finite(n) {
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-origin, per-predicate probe history.
 *
 * In memory only. This defends against a live caller inside one session.
 * Persisting it would let a stale bracket from last week refuse an honest check
 * today, which trades a real usability cost for very little extra safety.
 *
 * @type {Map<string, Array<{at: number, threshold: number, answer: boolean}>>}
 */
const history = new Map();

/**
 * @param {string} origin
 * @param {string} predicate
 * @returns {string}
 */
function key(origin, predicate) {
  return origin + ' ' + predicate;
}

/**
 * Drop probes that have aged out of the window.
 *
 * @param {Array<{at: number, threshold: number, answer: boolean}>} entries
 * @param {number} now
 * @returns {Array<{at: number, threshold: number, answer: boolean}>}
 */
function fresh(entries, now) {
  return entries.filter((e) => now - e.at < PROBE_WINDOW_MS);
}

/**
 * What an origin has established about the value behind one predicate.
 *
 * Every yes at threshold t means the value is at least t. Every no means it is
 * below t. The tightest such pair is the bracket, and the bits extracted is how
 * far that bracket has narrowed the range.
 *
 * @param {string} origin
 * @param {string} predicate
 * @param {number} [now]
 * @returns {{probes: number, lower: number | null, upper: number | null,
 *            bits: number, bracket: number | null}}
 */
export function bracketFor(origin, predicate, now = Date.now()) {
  const entries = fresh(history.get(key(origin, predicate)) ?? [], now);

  let lower = null;
  let upper = null;
  for (const e of entries) {
    if (e.answer) lower = lower === null ? e.threshold : Math.max(lower, e.threshold);
    else upper = upper === null ? e.threshold : Math.min(upper, e.threshold);
  }

  const distinct = new Set(entries.map((e) => e.threshold)).size;
  let bits = 0;
  let bracket = null;

  if (lower !== null && upper !== null && upper > lower) {
    bracket = upper - lower;
    // A bracket that is one part in 2^k of the plausible starting range carries
    // k bits. The starting range is taken as the upper bound itself, which is
    // conservative: it assumes the caller knew nothing below it to begin with.
    const ratio = upper / bracket;
    bits = ratio > 1 ? Math.round(Math.log2(ratio) * 10) / 10 : 0;
  } else if (distinct > 1) {
    // One-sided so far, but each extra distinct probe still cuts the space.
    bits = Math.round(Math.log2(distinct) * 10) / 10;
  }

  return { probes: entries.length, lower, upper, bits, bracket };
}

/**
 * Decide whether a call should be answered.
 *
 * Runs before every predicate evaluation for a cross-origin caller. Returns a
 * verdict rather than throwing, so the caller can be told why in words an agent
 * can act on and correct.
 *
 * @param {string} origin
 * @param {string} predicate
 * @param {Record<string, unknown>} args
 * @param {number} [now]
 * @returns {{allow: true} | {allow: false, reason: string, bits: number}}
 */
export function checkProbe(origin, predicate, args, now = Date.now()) {
  const reader = THRESHOLD_READERS.get(predicate);
  if (!reader) return { allow: true };

  const threshold = reader(args);
  // Malformed arguments are the predicate's business, not this module's.
  if (threshold === null) return { allow: true };

  const entries = fresh(history.get(key(origin, predicate)) ?? [], now);
  const distinct = new Set(entries.map((e) => e.threshold));

  // Repeating a threshold already asked is not a probe. The answer is unchanged
  // and the caller learns nothing new, so an honest retry is never penalised.
  if (distinct.has(threshold)) return { allow: true };

  if (distinct.size >= MAX_DISTINCT_PROBES) {
    return {
      allow: false,
      bits: bracketFor(origin, predicate, now).bits,
      reason:
        'Refused. ' +
        distinct.size +
        ' different thresholds have already been tested against ' +
        predicate +
        ' from this origin. Repeated threshold questions reconstruct the value this permission exists to withhold. Ask once, with the threshold that actually applies.',
    };
  }

  const extracted = bracketFor(origin, predicate, now).bits;
  if (extracted >= MAX_EXTRACTED_BITS) {
    return {
      allow: false,
      bits: extracted,
      reason:
        'Refused. These questions have already narrowed the underlying value by about ' +
        extracted +
        ' bits, which is past what a yes-or-no permission is meant to give up.',
    };
  }

  return { allow: true };
}

/**
 * Record the answer that was given, so the bracket can be updated.
 *
 * Separate from `checkProbe` because the answer is not known until the predicate
 * has run, and a refused or errored call must not tighten a bracket.
 *
 * @param {string} origin
 * @param {string} predicate
 * @param {Record<string, unknown>} args
 * @param {boolean} answer
 * @param {number} [now]
 * @returns {void}
 */
export function recordProbe(origin, predicate, args, answer, now = Date.now()) {
  const reader = THRESHOLD_READERS.get(predicate);
  if (!reader) return;
  const threshold = reader(args);
  if (threshold === null) return;

  const historyKey = key(origin, predicate);
  const entries = fresh(history.get(historyKey) ?? [], now);
  entries.push({ at: now, threshold, answer });
  history.set(historyKey, entries);
}

/**
 * Every predicate an origin is currently probing, worst first.
 *
 * Drives the warning the user sees. Only brackets that actually reveal
 * something are reported, so an ordinary one-call check raises no alarm.
 *
 * @param {number} [now]
 * @returns {Array<{origin: string, predicate: string, probes: number,
 *                  bits: number, bracket: number | null}>}
 */
export function activeProbes(now = Date.now()) {
  const out = [];
  for (const historyKey of history.keys()) {
    const gap = historyKey.lastIndexOf(' ');
    const origin = historyKey.slice(0, gap);
    const predicate = historyKey.slice(gap + 1);
    const found = bracketFor(origin, predicate, now);
    if (found.probes > 1 && found.bits > 0) {
      out.push({
        origin,
        predicate,
        probes: found.probes,
        bits: found.bits,
        bracket: found.bracket,
      });
    }
  }
  return out.sort((a, b) => b.bits - a.bits);
}

/** Forget all probe history. Used by tests and by the user's reset control. */
export function clearProbes() {
  history.clear();
}
