/**
 * @file Running a listing's requirements against whatever the vault has granted.
 *
 * Responsible for: turning a listing's requirement list into a sequence of
 * federated calls, and holding the verdicts for the length of a page view.
 *
 * NOT responsible for: persisting anything. This origin deliberately writes no
 * applicant data to storage of any kind. Reload the page and the assessment is
 * gone, which is the correct behaviour for a party that was never given the
 * data in the first place.
 */

import { callFederated, PROXY_PREFIX } from './federation.js';
import { findListing } from './listings.js';
import { errText } from './util.js';

/**
 * @typedef {object} CheckResult
 * @property {string} predicate
 * @property {string} label
 * @property {boolean} mandatory
 * @property {'pass'|'fail'|'blocked'|'error'} status
 * @property {string} detail   the vault's own words, or why the check could not run
 */

/**
 * In-memory verdicts, keyed by listing id. Never serialised.
 * @type {Map<string, CheckResult[]>}
 */
const results = new Map();

/**
 * Read a listing's current verdicts.
 *
 * @param {string} listingId
 * @returns {CheckResult[]}
 */
export function resultsFor(listingId) {
  return results.get(listingId) ?? [];
}

/** Discard every verdict. Called when a grant changes, since answers may differ. */
export function clearResults() {
  results.clear();
}

/**
 * Does the answer text read as a yes?
 *
 * Predicates answer with a leading "yes" or "no" followed by the threshold that
 * was tested. Parsing only the leading token keeps this from being fooled by a
 * threshold clause that happens to contain the other word.
 *
 * @param {string} answer
 * @returns {boolean | null} null when the text is not a verdict at all
 */
export function readVerdict(answer) {
  const head = String(answer).trim().toLowerCase();
  if (head.startsWith('yes')) return true;
  if (head.startsWith('no')) return false;
  return null;
}

/**
 * Run every requirement for one listing.
 *
 * Checks run in sequence rather than in parallel. Each one is a separate
 * question put to the renter's vault, and a burst of simultaneous cross-origin
 * calls would make the ledger unreadable at exactly the moment a person is
 * trying to watch what is being asked about them.
 *
 * @param {string} listingId
 * @param {Array<object>} federatedTools handles from `discover`
 * @returns {Promise<CheckResult[]>}
 */
export async function assess(listingId, federatedTools) {
  const listing = findListing(listingId);
  if (!listing) return [];

  const byName = new Map(federatedTools.map((t) => [String(t.name), t]));
  /** @type {CheckResult[]} */
  const out = [];

  for (const requirement of listing.requirements) {
    const handle = byName.get(requirement.predicate);

    if (!handle) {
      out.push({
        predicate: requirement.predicate,
        label: requirement.label,
        mandatory: requirement.mandatory,
        status: 'blocked',
        detail: 'The applicant has not granted this permission.',
      });
      continue;
    }

    let answer;
    try {
      answer = await callFederated(handle, requirement.args);
    } catch (err) {
      out.push({
        predicate: requirement.predicate,
        label: requirement.label,
        mandatory: requirement.mandatory,
        status: 'error',
        detail: errText(err),
      });
      continue;
    }

    const verdict = readVerdict(answer);
    out.push({
      predicate: requirement.predicate,
      label: requirement.label,
      mandatory: requirement.mandatory,
      status: verdict === null ? 'error' : verdict ? 'pass' : 'fail',
      detail: answer,
    });
  }

  results.set(listingId, out);
  return out;
}

/**
 * Summarise an assessment into the decision a letting agent would actually make.
 *
 * @param {CheckResult[]} checks
 * @returns {{decision: 'eligible'|'not_eligible'|'incomplete', passed: number,
 *            failed: number, blocked: number, total: number, reason: string}}
 */
export function summarise(checks) {
  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const blocked = checks.filter((c) => c.status === 'blocked' || c.status === 'error').length;

  const mandatoryFailed = checks.filter((c) => c.mandatory && c.status === 'fail');
  const mandatoryBlocked = checks.filter(
    (c) => c.mandatory && (c.status === 'blocked' || c.status === 'error')
  );

  if (mandatoryFailed.length > 0) {
    return {
      decision: 'not_eligible',
      passed,
      failed,
      blocked,
      total: checks.length,
      reason: 'A required check came back no: ' + mandatoryFailed.map((c) => c.predicate).join(', '),
    };
  }
  if (mandatoryBlocked.length > 0) {
    return {
      decision: 'incomplete',
      passed,
      failed,
      blocked,
      total: checks.length,
      reason:
        'Waiting on permission for: ' + mandatoryBlocked.map((c) => c.predicate).join(', '),
    };
  }
  if (checks.length === 0) {
    return { decision: 'incomplete', passed, failed, blocked, total: 0, reason: 'No checks have run.' };
  }
  return {
    decision: 'eligible',
    passed,
    failed,
    blocked,
    total: checks.length,
    reason: 'Every required check was answered yes by the applicant’s vault.',
  };
}

/**
 * Which permissions this listing needs that the vault has not granted.
 *
 * @param {string} listingId
 * @param {Array<object>} federatedTools
 * @returns {string[]}
 */
export function missingPermissions(listingId, federatedTools) {
  const listing = findListing(listingId);
  if (!listing) return [];
  const have = new Set(federatedTools.map((t) => String(t.name)));
  return listing.requirements.filter((r) => !have.has(r.predicate)).map((r) => r.predicate);
}

/** Proxy tool name for a predicate, for display next to a check. */
export function proxyNameFor(predicate) {
  return PROXY_PREFIX + predicate;
}
