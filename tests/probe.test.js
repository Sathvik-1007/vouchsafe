/**
 * @file Tests for probe detection.
 *
 * The attack these cover is the honest weakness of the whole design: a caller
 * that legitimately holds a threshold permission can ask it repeatedly with
 * different thresholds and reconstruct the number behind it. These tests pin
 * both halves of the response, that an honest check is never obstructed, and
 * that a search is stopped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  checkProbe,
  recordProbe,
  bracketFor,
  activeProbes,
  clearProbes,
  MAX_DISTINCT_PROBES,
  MAX_EXTRACTED_BITS,
  PROBE_WINDOW_MS,
} = await import('../vault/lib/probe.js');

const AGENT = 'https://agent.example.com';

/** Ask `income_meets_multiple` at a given annual-income threshold. */
function probeIncome(threshold, actualIncome, now) {
  const args = { monthly_rent_gbp: threshold / 36, multiple: 3 };
  const verdict = checkProbe(AGENT, 'income_meets_multiple', args, now);
  if (!verdict.allow) return verdict;
  recordProbe(AGENT, 'income_meets_multiple', args, actualIncome >= threshold, now);
  return { allow: true };
}

test('a single honest check is never obstructed', () => {
  clearProbes();
  assert.equal(probeIncome(41400, 41400).allow, true);
  assert.deepEqual(activeProbes(), []);
});

test('asking the same threshold again is a retry, not a probe', () => {
  clearProbes();
  for (let i = 0; i < 20; i += 1) {
    assert.equal(probeIncome(41400, 41400).allow, true, 'retry ' + i + ' was blocked');
  }
  assert.deepEqual(activeProbes(), [], 'identical retries must not register as probing');
});

test('a predicate with no caller-chosen threshold cannot be probed', () => {
  clearProbes();
  for (let i = 0; i < 50; i += 1) {
    assert.equal(checkProbe(AGENT, 'has_no_eviction_record', {}).allow, true);
  }
});

test('a binary search is refused before it pins the value', () => {
  clearProbes();
  const income = 41400;
  const attempts = [72000, 54000, 46800, 43200, 42300, 41850, 41625];
  const blocked = attempts.findIndex((t) => probeIncome(t, income).allow === false);
  assert.notEqual(blocked, -1, 'the search was never stopped');
  assert.ok(
    blocked <= MAX_DISTINCT_PROBES,
    'took ' + blocked + ' probes to stop, budget is ' + MAX_DISTINCT_PROBES
  );
});

test('the refusal explains itself so an agent can correct course', () => {
  clearProbes();
  let refusal = null;
  for (const t of [72000, 54000, 46800, 43200, 42300, 41850, 41625, 41500]) {
    const out = probeIncome(t, 41400);
    if (!out.allow) { refusal = out; break; }
  }
  assert.ok(refusal, 'expected a refusal');
  assert.match(refusal.reason, /Refused/);
  assert.match(refusal.reason, /threshold/i);
});

test('the bracket tightens as yes and no answers arrive', () => {
  clearProbes();
  probeIncome(30000, 41400); // yes, at least 30000
  probeIncome(60000, 41400); // no, under 60000
  const b = bracketFor(AGENT, 'income_meets_multiple');
  assert.equal(b.lower, 30000);
  assert.equal(b.upper, 60000);
  assert.equal(b.bracket, 30000);
  assert.ok(b.bits > 0, 'a two-sided bracket reveals something');
});

test('probing is reported per origin and predicate', () => {
  clearProbes();
  probeIncome(30000, 41400);
  probeIncome(60000, 41400);
  const probes = activeProbes();
  assert.equal(probes.length, 1);
  assert.equal(probes[0].origin, AGENT);
  assert.equal(probes[0].predicate, 'income_meets_multiple');
});

test('an origin containing a space is still parsed back correctly', () => {
  // `activeProbes` splits a composite key. A malformed split would attribute a
  // probe to the wrong origin, which is worse than not reporting it at all.
  clearProbes();
  const odd = 'https://a b.example.com';
  const args = { amount_gbp: 1000 };
  checkProbe(odd, 'deposit_available', args);
  recordProbe(odd, 'deposit_available', args, true);
  const args2 = { amount_gbp: 2000 };
  checkProbe(odd, 'deposit_available', args2);
  recordProbe(odd, 'deposit_available', args2, false);
  const probes = activeProbes();
  assert.equal(probes[0].origin, odd);
  assert.equal(probes[0].predicate, 'deposit_available');
});

test('probes age out of the window, so an honest caller returning later is clean', () => {
  clearProbes();
  const t0 = 1_000_000;
  for (const t of [72000, 54000, 46800, 43200, 42300]) probeIncome(t, 41400, t0);
  assert.equal(probeIncome(41625, 41400, t0).allow, false, 'should be blocked inside the window');

  const later = t0 + PROBE_WINDOW_MS + 1;
  assert.equal(probeIncome(41625, 41400, later).allow, true, 'should be clean after the window');
});

test('one origin probing does not obstruct another', () => {
  clearProbes();
  const t0 = 2_000_000;
  for (const t of [72000, 54000, 46800, 43200, 42300]) probeIncome(t, 41400, t0);

  const other = 'https://honest.example.com';
  const args = { monthly_rent_gbp: 1150, multiple: 3 };
  assert.equal(checkProbe(other, 'income_meets_multiple', args, t0).allow, true);
});

test('the extraction ceiling is a real bound, not a decorative constant', () => {
  assert.ok(MAX_EXTRACTED_BITS > 0 && MAX_EXTRACTED_BITS < 20);
  assert.ok(MAX_DISTINCT_PROBES >= 2, 'must allow at least one honest retry with a new threshold');
});
