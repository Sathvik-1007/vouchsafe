/**
 * @file Unit tests for the pure logic of both origins.
 *
 * Covers the parts that can be exercised without a browser: predicate
 * evaluation, grant validation, disclosure arithmetic, verdict parsing, and the
 * schema normalisation that federation depends on.
 *
 * The browser-dependent half, tool registration and cross-origin discovery, is
 * covered by `tests/federation.e2e.mjs`, which drives a real Chromium.
 *
 * Run with: node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The fact and grant stores read `localStorage`, which node has no notion of.
// A minimal in-memory stand-in is installed before those modules are imported,
// which is also a useful check that they never reach for anything else.
class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.location = { hostname: 'localhost' };

const { readFacts, writeFact, resetFacts, isIsoDate, validateFact } =
  await import('../vault/lib/facts.js');
const { PREDICATES, findPredicate, monthsBetween, bitsForBuckets, requireNumber } =
  await import('../vault/lib/predicates.js');
const { isSecureOrigin, grant, revoke, revokeAll, readGrants, disclosedBits, readLedger } =
  await import('../vault/lib/grants.js');
const { readVerdict, summarise } = await import('../host/lib/assessment.js');
const { normaliseSchema } = await import('../host/lib/federation.js');
const { depositFor, LISTINGS, requirementsFor } = await import('../host/lib/listings.js');

const HOST = 'http://localhost:4002';

/* -------------------------------------------------------------------------- */
/* dates                                                                      */
/* -------------------------------------------------------------------------- */

test('isIsoDate accepts a real calendar date', () => {
  assert.equal(isIsoDate('2026-10-01'), true);
});

test('isIsoDate rejects a date that rolls, which Date.parse silently accepts', () => {
  assert.equal(isIsoDate('2026-02-31'), false);
});

test('isIsoDate rejects wrong shapes and non-strings', () => {
  for (const bad of ['2026-1-1', '01/10/2026', '', 'yesterday', null, undefined, 20261001]) {
    assert.equal(isIsoDate(bad), false, String(bad));
  }
});

test('monthsBetween counts calendar months and floors an incomplete one', () => {
  assert.equal(monthsBetween('2023-02-01', '2024-02-01'), 12);
  assert.equal(monthsBetween('2023-02-01', '2024-01-31'), 11);
  assert.equal(monthsBetween('2023-02-15', '2023-03-14'), 0);
  assert.equal(monthsBetween('2023-02-15', '2023-03-15'), 1);
});

test('monthsBetween returns zero when the end precedes the start', () => {
  assert.equal(monthsBetween('2026-01-01', '2025-01-01'), 0);
});

/* -------------------------------------------------------------------------- */
/* facts                                                                      */
/* -------------------------------------------------------------------------- */

test('readFacts returns the seed record before anything is written', () => {
  resetFacts();
  assert.equal(readFacts().legalName, 'Ama Boateng');
});

test('readFacts survives a corrupted record rather than throwing', () => {
  localStorage.setItem('bureau.facts.v1', '{not json');
  assert.equal(readFacts().annualIncomeGbp, 41400);
  resetFacts();
});

test('writeFact rejects an unknown key', () => {
  assert.equal(writeFact('favouriteColour', 'blue').ok, false);
});

test('writeFact rejects a negative number and an out-of-range household', () => {
  assert.equal(writeFact('annualIncomeGbp', -1).ok, false);
  assert.equal(writeFact('householdSize', 999).ok, false);
});

test('writeFact coerces a numeric string, since form inputs yield strings', () => {
  resetFacts();
  assert.equal(writeFact('annualIncomeGbp', ' 52000 ').ok, true);
  assert.equal(readFacts().annualIncomeGbp, 52000);
  resetFacts();
});

test('validateFact constrains creditBand to the known bands', () => {
  assert.equal(validateFact('creditBand', 'good').ok, true);
  assert.equal(validateFact('creditBand', 'stellar').ok, false);
});

/* -------------------------------------------------------------------------- */
/* predicates                                                                 */
/* -------------------------------------------------------------------------- */

test('every predicate fits the limits Chrome documents', () => {
  for (const p of PREDICATES) {
    assert.ok(p.name.length <= 30, p.name + ' name too long');
    assert.ok(p.description.length <= 500, p.name + ' description too long');
    assert.equal(typeof p.evaluate, 'function', p.name + ' has no evaluate');
    assert.equal(p.inputSchema.type, 'object', p.name + ' schema is not an object');
  }
});

test('income_meets_multiple answers yes at the threshold and no above it', () => {
  const p = findPredicate('income_meets_multiple');
  const facts = { annualIncomeGbp: 41400 };
  // 41400 / 12 / 3 = 1150 exactly, so 1150 passes and a pound more does not.
  assert.match(p.evaluate(facts, { monthly_rent_gbp: 1150, multiple: 3 }).answer, /^yes/);
  assert.match(p.evaluate(facts, { monthly_rent_gbp: 1151, multiple: 3 }).answer, /^no/);
});

test('income_meets_multiple refuses a multiple outside the probe bound', () => {
  const p = findPredicate('income_meets_multiple');
  const out = p.evaluate({ annualIncomeGbp: 41400 }, { monthly_rent_gbp: 1000, multiple: 99 });
  assert.equal(out.ok, false);
});

test('a predicate returns an error rather than throwing on rubbish arguments', () => {
  const p = findPredicate('income_meets_multiple');
  const out = p.evaluate({ annualIncomeGbp: 41400 }, { monthly_rent_gbp: 'lots', multiple: 3 });
  assert.equal(out.ok, false);
  assert.match(out.error, /must be a number/);
});

test('a predicate reports a missing fact instead of inventing an answer', () => {
  const p = findPredicate('income_meets_multiple');
  const out = p.evaluate({}, { monthly_rent_gbp: 1000, multiple: 3 });
  assert.equal(out.ok, false);
});

test('credit_band_at_least compares by rank, not alphabetically', () => {
  const p = findPredicate('credit_band_at_least');
  assert.match(p.evaluate({ creditBand: 'good' }, { band: 'fair' }).answer, /^yes/);
  assert.match(p.evaluate({ creditBand: 'good' }, { band: 'excellent' }).answer, /^no/);
});

test('right_to_rent_valid fails when cover ends before the tenancy does', () => {
  const p = findPredicate('right_to_rent_valid');
  const facts = { rightToRentValidUntilIso: '2027-01-01' };
  assert.match(p.evaluate(facts, { tenancy_ends: '2026-12-31' }).answer, /^yes/);
  assert.match(p.evaluate(facts, { tenancy_ends: '2027-06-01' }).answer, /^no/);
});

test('pets_compatible passes a pet-free applicant at a pet-free property', () => {
  const p = findPredicate('pets_compatible');
  assert.match(p.evaluate({ hasPets: false }, { allows_pets: false }).answer, /^yes/);
  assert.match(p.evaluate({ hasPets: true }, { allows_pets: false }).answer, /^no/);
});

test('every threshold predicate costs exactly one bit', () => {
  const thresholds = PREDICATES.filter((p) => p.category !== 'raw disclosure');
  for (const p of thresholds) assert.equal(p.disclosureBits, 1, p.name);
});

test('a raw disclosure costs far more than the predicate answering the same question', () => {
  const raw = findPredicate('disclose_exact_income');
  const predicate = findPredicate('income_meets_multiple');
  assert.ok(raw.disclosureBits > predicate.disclosureBits * 9, 'raw disclosure is underpriced');
});

test('bitsForBuckets is log2 and degrades safely', () => {
  assert.equal(bitsForBuckets(2), 1);
  assert.equal(bitsForBuckets(1024), 10);
  assert.equal(bitsForBuckets(0), 0);
  assert.equal(bitsForBuckets(NaN), 0);
});

test('requireNumber enforces its bounds', () => {
  assert.equal(requireNumber({ n: 5 }, 'n', { min: 1, max: 10 }).ok, true);
  assert.equal(requireNumber({ n: 0 }, 'n', { min: 1 }).ok, false);
  assert.equal(requireNumber({ n: Infinity }, 'n').ok, false);
  assert.equal(requireNumber({}, 'n').ok, false);
});

/* -------------------------------------------------------------------------- */
/* grants                                                                     */
/* -------------------------------------------------------------------------- */

test('isSecureOrigin admits https and localhost, refuses everything else', () => {
  assert.equal(isSecureOrigin('https://example.com'), true);
  assert.equal(isSecureOrigin('http://localhost:4002'), true);
  assert.equal(isSecureOrigin('http://127.0.0.1:4002'), true);
  assert.equal(isSecureOrigin('http://example.com'), false);
  assert.equal(isSecureOrigin('https://example.com/path'), false);
  assert.equal(isSecureOrigin('javascript:alert(1)'), false);
  assert.equal(isSecureOrigin(''), false);
  assert.equal(isSecureOrigin(null), false);
});

test('grant refuses an origin that is not on the allowlist', () => {
  localStorage.clear();
  assert.equal(grant('https://evil.example.com', 'income_meets_multiple').ok, false);
});

test('grant refuses a predicate that does not exist', () => {
  localStorage.clear();
  assert.equal(grant(HOST, 'read_my_diary').ok, false);
});

test('grant is idempotent', () => {
  localStorage.clear();
  assert.equal(grant(HOST, 'income_meets_multiple').changed, true);
  assert.equal(grant(HOST, 'income_meets_multiple').changed, false);
  assert.equal(readGrants()[HOST].length, 1);
});

test('revoke removes the origin entirely once its last grant goes', () => {
  localStorage.clear();
  grant(HOST, 'income_meets_multiple');
  revoke(HOST, 'income_meets_multiple');
  assert.equal(readGrants()[HOST], undefined);
});

test('revokeAll clears every grant and reports the count', () => {
  localStorage.clear();
  grant(HOST, 'income_meets_multiple');
  grant(HOST, 'deposit_available');
  assert.equal(revokeAll(HOST).revoked, 2);
  assert.equal(disclosedBits(HOST), 0);
});

test('a stale grant naming a predicate that no longer exists is dropped on read', () => {
  localStorage.clear();
  localStorage.setItem('bureau.grants.v1', JSON.stringify({ [HOST]: ['predicate_from_2025'] }));
  assert.equal(readGrants()[HOST], undefined);
});

test('a grant to an insecure origin is dropped on read even if it was persisted', () => {
  localStorage.clear();
  localStorage.setItem(
    'bureau.grants.v1',
    JSON.stringify({ 'http://evil.example.com': ['income_meets_multiple'] })
  );
  assert.deepEqual(readGrants(), {});
});

test('disclosure is the sum of the granted predicates, in bits', () => {
  localStorage.clear();
  grant(HOST, 'income_meets_multiple');
  grant(HOST, 'deposit_available');
  assert.equal(disclosedBits(HOST), 2);
  grant(HOST, 'disclose_exact_income');
  assert.equal(disclosedBits(HOST), 11.8);
});

test('the ledger records grants and revocations', () => {
  localStorage.clear();
  grant(HOST, 'income_meets_multiple');
  revoke(HOST, 'income_meets_multiple');
  const kinds = readLedger().map((e) => e.kind);
  assert.deepEqual(kinds, ['revoke', 'grant']);
});

/* -------------------------------------------------------------------------- */
/* host: assessment and federation plumbing                                   */
/* -------------------------------------------------------------------------- */

test('readVerdict reads the leading token, not any word in the clause', () => {
  assert.equal(readVerdict('yes (no evictions on record)'), true);
  assert.equal(readVerdict('no (tested against £2000)'), false);
  assert.equal(readVerdict('Error: income is not recorded'), null);
  assert.equal(readVerdict(''), null);
});

test('a failed mandatory check makes the applicant not eligible', () => {
  const checks = [
    { predicate: 'a', label: '', mandatory: true, status: 'pass', detail: '' },
    { predicate: 'b', label: '', mandatory: true, status: 'fail', detail: '' },
  ];
  assert.equal(summarise(checks).decision, 'not_eligible');
});

test('a failed optional check does not block eligibility', () => {
  const checks = [
    { predicate: 'a', label: '', mandatory: true, status: 'pass', detail: '' },
    { predicate: 'b', label: '', mandatory: false, status: 'fail', detail: '' },
  ];
  assert.equal(summarise(checks).decision, 'eligible');
});

test('a mandatory check with no permission is incomplete, not a rejection', () => {
  const checks = [{ predicate: 'a', label: '', mandatory: true, status: 'blocked', detail: '' }];
  assert.equal(summarise(checks).decision, 'incomplete');
});

test('normaliseSchema parses the JSON string Chrome returns from getTools', () => {
  const schema = normaliseSchema('{"type":"object","properties":{"n":{"type":"number"}}}');
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.n.type, 'number');
});

test('normaliseSchema passes an object through untouched', () => {
  const original = { type: 'object', properties: {} };
  assert.equal(normaliseSchema(original), original);
});

test('normaliseSchema degrades to an empty schema rather than losing the registration', () => {
  for (const bad of ['{not json', null, undefined, 42, '"a string"']) {
    const schema = normaliseSchema(bad);
    assert.equal(schema.type, 'object', String(bad));
    assert.deepEqual(schema.properties, {}, String(bad));
  }
});

/* -------------------------------------------------------------------------- */
/* listings                                                                   */
/* -------------------------------------------------------------------------- */

test('the deposit is five weeks of rent, per the Tenant Fees Act cap', () => {
  // 1150/month is 13800/year; five weeks of that is 13800 * 5 / 52.
  assert.equal(depositFor(1150), Math.round((1150 * 12 * 5) / 52));
});

test('every listing requirement names a predicate that actually exists', () => {
  for (const listing of LISTINGS) {
    for (const requirement of listing.requirements) {
      assert.ok(
        findPredicate(requirement.predicate),
        listing.id + ' asks for unknown predicate ' + requirement.predicate
      );
    }
  }
});

test('requirements are derived from the listing, so thresholds cannot go stale', () => {
  const listing = { monthlyRentGbp: 2000, maxOccupants: 5, allowsPets: false,
    availableFromIso: '2026-12-01', tenancyEndsIso: '2027-11-30' };
  const income = requirementsFor(listing).find((r) => r.predicate === 'income_meets_multiple');
  assert.equal(income.args.monthly_rent_gbp, 2000);
});

test('no listing asks for a raw disclosure', () => {
  for (const listing of LISTINGS) {
    for (const requirement of listing.requirements) {
      assert.notEqual(
        findPredicate(requirement.predicate).category,
        'raw disclosure',
        listing.id + ' asks for raw data'
      );
    }
  }
});
