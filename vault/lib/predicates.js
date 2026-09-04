/**
 * @file The predicate catalogue: the questions a letting agent is allowed to ask.
 *
 * Responsible for: defining every question the vault can answer, the JSON Schema
 * for its arguments, how much it discloses, and how it is computed from facts.
 *
 * NOT responsible for: storage (`facts.js`) or authorisation (`grants.js`).
 *
 * The design claim of this project lives in this file. A letting agent does not
 * need your payslips, it needs one bit: is income at least 3x rent, yes or no.
 * Each entry below therefore returns the narrowest answer that still settles the
 * question, and declares in `disclosureBits` how much of you it gives away.
 */

import { CREDIT_BANDS, isIsoDate } from './facts.js';

/**
 * Shannon cost, in bits, of a single yes/no answer.
 *
 * One binary answer distinguishes at most two states of the world, so log2(2)=1.
 * Used as the unit for the disclosure meter in the UI.
 */
const BITS_PER_BOOLEAN = 1;

/**
 * Upper bound on characters a predicate may return.
 *
 * Chrome's WebMCP guidance puts a 1.5K ceiling on a single tool's output before
 * it starts costing the agent real context. Predicates answer in a word or two,
 * so this only ever trips on a malformed fact record.
 */
const MAX_ANSWER_CHARS = 1500;

/**
 * Ceiling on the rent multiple an agent may test.
 *
 * Real affordability checks sit between 2x and 3.5x annual rent. Anything above
 * this is an agent probing for the exact salary one comparison at a time, which
 * is precisely the attack a predicate vault exists to stop, so it is refused.
 */
export const MAX_RENT_MULTIPLE = 6;

/** Ceiling on a monthly rent figure, in GBP, accepted for affordability tests. */
const MAX_MONTHLY_RENT_GBP = 100000;

/**
 * @typedef {object} Predicate
 * @property {string}  name           wire name, snake_case, at most 30 characters
 * @property {string}  title          human label for the consent UI
 * @property {string}  category       grouping for the UI
 * @property {string}  description    what an agent reads, at most 500 characters
 * @property {object}  inputSchema    JSON Schema for the arguments
 * @property {number}  disclosureBits how much of the renter this reveals, in bits
 * @property {string}  reveals        plain sentence naming exactly what leaks
 * @property {boolean} readOnly       true when the call cannot change state
 * @property {(facts: Record<string, unknown>, args: Record<string, unknown>) =>
 *            {ok: true, answer: string} | {ok: false, error: string}} evaluate
 */

/**
 * Bits needed to pin a value to one of `n` equally likely buckets.
 *
 * Used to price the raw-disclosure tools honestly against the predicates. An
 * exact salary anywhere in a plausible 10k-100k range at 100-pound resolution
 * is one of ~900 buckets, so about 9.8 bits, against 1 bit for "meets 3x".
 *
 * @param {number} n number of distinguishable outcomes, must be at least 1
 * @returns {number} bits, rounded to one decimal place
 */
export function bitsForBuckets(n) {
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.round(Math.log2(n) * 10) / 10;
}

/**
 * Read a required finite number out of agent-supplied arguments.
 *
 * Chrome does not enforce JSON Schema before calling `execute`, so every
 * predicate re-checks its own inputs here. Schema constrains loosely, code
 * validates strictly, which is what Chrome's own best-practices page asks for.
 *
 * @param {Record<string, unknown>} args
 * @param {string} key
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {{ok: true, value: number} | {ok: false, error: string}}
 */
export function requireNumber(args, key, bounds = {}) {
  const raw = args?.[key];
  const parsed = typeof raw === 'string' ? Number(raw.trim()) : raw;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return { ok: false, error: 'argument "' + key + '" must be a number' };
  }
  if (bounds.min !== undefined && parsed < bounds.min) {
    return { ok: false, error: '"' + key + '" must be at least ' + bounds.min };
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    return { ok: false, error: '"' + key + '" must be at most ' + bounds.max };
  }
  return { ok: true, value: parsed };
}

/**
 * Format a boolean predicate result the way an agent reads most reliably.
 *
 * A bare "yes" or "no" plus a short clause explaining which threshold was
 * tested. The clause never restates the underlying value, only the question.
 *
 * @param {boolean} verdict
 * @param {string} because short clause, no trailing full stop
 * @returns {{ok: true, answer: string}}
 */
export function verdict(verdict_, because) {
  const answer = (verdict_ ? 'yes' : 'no') + ' (' + because + ')';
  return { ok: true, answer: answer.slice(0, MAX_ANSWER_CHARS) };
}

/**
 * Whole months elapsed between two ISO dates, floor.
 *
 * Counts calendar months rather than 30-day blocks, because employment tenure
 * is quoted in calendar months and an agent comparing against "6 months" means
 * calendar months. Returns 0 when `endIso` precedes `startIso`.
 *
 * @param {string} startIso
 * @param {string} endIso
 * @returns {number}
 */
export function monthsBetween(startIso, endIso) {
  if (!isIsoDate(startIso) || !isIsoDate(endIso)) return 0;
  const from = new Date(startIso + 'T00:00:00Z');
  const to = new Date(endIso + 'T00:00:00Z');
  if (to < from) return 0;
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  // Not yet past the day-of-month anniversary, so the final month is incomplete.
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * The catalogue.
 *
 * Ordered by how routinely a letting agent asks the question, so the consent UI
 * puts the ordinary asks at the top and the invasive ones at the bottom where
 * their cost is visible.
 *
 * @type {ReadonlyArray<Predicate>}
 */
export const PREDICATES = Object.freeze([
  {
    name: 'income_meets_multiple',
    title: 'Income covers the rent',
    category: 'affordability',
    description:
      'Answer yes or no: does the applicant’s annual income reach the given multiple of the annual rent? Use multiple 3 for the standard UK affordability check. Returns only yes or no, never the income itself.',
    inputSchema: {
      type: 'object',
      properties: {
        monthly_rent_gbp: {
          type: 'number',
          description: 'Advertised monthly rent in GBP.',
        },
        multiple: {
          type: 'number',
          description: 'Required ratio of annual income to annual rent, typically 3.',
        },
      },
      required: ['monthly_rent_gbp', 'multiple'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: whether income clears this one threshold. Not the salary.',
    readOnly: true,
    evaluate(facts, args) {
      const rent = requireNumber(args, 'monthly_rent_gbp', { min: 1, max: MAX_MONTHLY_RENT_GBP });
      if (!rent.ok) return rent;
      const mult = requireNumber(args, 'multiple', { min: 1, max: MAX_RENT_MULTIPLE });
      if (!mult.ok) return mult;

      const income = Number(facts.annualIncomeGbp);
      if (!Number.isFinite(income)) return { ok: false, error: 'income is not recorded in the vault' };

      const required = rent.value * 12 * mult.value;
      return verdict(
        income >= required,
        'tested against ' + mult.value + 'x a rent of £' + rent.value + '/month'
      );
    },
  },

  {
    name: 'deposit_available',
    title: 'Deposit is available',
    category: 'affordability',
    description:
      'Answer yes or no: can the applicant cover a deposit of the given amount from savings right now? Returns only yes or no, never the savings balance.',
    inputSchema: {
      type: 'object',
      properties: {
        amount_gbp: { type: 'number', description: 'Deposit required, in GBP.' },
      },
      required: ['amount_gbp'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: whether savings clear this figure. Not the balance.',
    readOnly: true,
    evaluate(facts, args) {
      const amount = requireNumber(args, 'amount_gbp', { min: 0, max: MAX_MONTHLY_RENT_GBP * 12 });
      if (!amount.ok) return amount;
      const savings = Number(facts.savingsGbp);
      if (!Number.isFinite(savings)) return { ok: false, error: 'savings are not recorded in the vault' };
      return verdict(savings >= amount.value, 'tested against £' + amount.value);
    },
  },

  {
    name: 'credit_band_at_least',
    title: 'Credit standing',
    category: 'affordability',
    description:
      'Answer yes or no: is the applicant’s credit band at or above the band given? Bands, weakest first: very_poor, poor, fair, good, excellent. Returns only yes or no, never the score or the band.',
    inputSchema: {
      type: 'object',
      properties: {
        band: {
          type: 'string',
          enum: [...CREDIT_BANDS],
          description: 'Minimum acceptable band.',
        },
      },
      required: ['band'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: whether the band clears this floor. Not the band or score.',
    readOnly: true,
    evaluate(facts, args) {
      const band = typeof args?.band === 'string' ? args.band.trim().toLowerCase() : '';
      const floor = CREDIT_BANDS.indexOf(band);
      if (floor === -1) {
        return { ok: false, error: 'band must be one of ' + CREDIT_BANDS.join(', ') };
      }
      const actual = CREDIT_BANDS.indexOf(String(facts.creditBand));
      if (actual === -1) return { ok: false, error: 'credit band is not recorded in the vault' };
      return verdict(actual >= floor, 'tested against "' + band + '"');
    },
  },

  {
    name: 'has_no_eviction_record',
    title: 'No eviction history',
    category: 'tenancy history',
    description:
      'Answer yes or no: is the applicant free of any recorded eviction and any county court judgment for rent arrears?',
    inputSchema: { type: 'object', properties: {}, required: [] },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: clean record or not. No case details.',
    readOnly: true,
    evaluate(facts) {
      const evictions = Number(facts.evictionCount);
      const ccjs = Number(facts.ccjCount);
      if (!Number.isFinite(evictions) || !Number.isFinite(ccjs)) {
        return { ok: false, error: 'tenancy history is not recorded in the vault' };
      }
      return verdict(evictions === 0 && ccjs === 0, 'evictions and rent-arrears CCJs both zero');
    },
  },

  {
    name: 'references_at_least',
    title: 'Reference count',
    category: 'tenancy history',
    description:
      'Answer yes or no: can the applicant supply at least this many contactable previous-landlord or employer references?',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Minimum number of references required.' },
      },
      required: ['count'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: enough references or not. No names, no contact details.',
    readOnly: true,
    evaluate(facts, args) {
      const want = requireNumber(args, 'count', { min: 0, max: 32 });
      if (!want.ok) return want;
      const have = Number(facts.referenceCount);
      if (!Number.isFinite(have)) return { ok: false, error: 'reference count is not recorded' };
      return verdict(have >= want.value, 'tested against ' + want.value);
    },
  },

  {
    name: 'employment_months_min',
    title: 'Length of employment',
    category: 'employment',
    description:
      'Answer yes or no: has the applicant been continuously employed for at least this many months, as of today?',
    inputSchema: {
      type: 'object',
      properties: {
        months: { type: 'number', description: 'Minimum continuous months required.' },
      },
      required: ['months'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: tenure clears the bar or not. Not the employer, not the start date.',
    readOnly: true,
    evaluate(facts, args) {
      const want = requireNumber(args, 'months', { min: 0, max: 600 });
      if (!want.ok) return want;
      const start = String(facts.employmentStartIso);
      if (!isIsoDate(start)) return { ok: false, error: 'employment start date is not recorded' };
      const served = monthsBetween(start, new Date().toISOString().slice(0, 10));
      return verdict(served >= want.value, 'tested against ' + want.value + ' months');
    },
  },

  {
    name: 'right_to_rent_valid',
    title: 'Right to rent is valid',
    category: 'legal',
    description:
      'Answer yes or no: is the applicant’s right to rent valid for the whole of a tenancy ending on the given date? This is the statutory check a landlord in England must make.',
    inputSchema: {
      type: 'object',
      properties: {
        tenancy_ends: {
          type: 'string',
          description: 'Last day of the proposed tenancy, as YYYY-MM-DD.',
        },
      },
      required: ['tenancy_ends'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: covered for that period or not. No document, no nationality, no status.',
    readOnly: true,
    evaluate(facts, args) {
      const ends = typeof args?.tenancy_ends === 'string' ? args.tenancy_ends.trim() : '';
      if (!isIsoDate(ends)) {
        return { ok: false, error: 'tenancy_ends must be an ISO date such as 2027-09-30' };
      }
      const validUntil = String(facts.rightToRentValidUntilIso);
      if (!isIsoDate(validUntil)) return { ok: false, error: 'right to rent is not recorded' };
      return verdict(validUntil >= ends, 'tested against a tenancy ending ' + ends);
    },
  },

  {
    name: 'can_move_in_by',
    title: 'Move-in date works',
    category: 'logistics',
    description:
      'Answer yes or no: can the applicant take occupancy on or before the given date?',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Target move-in date, as YYYY-MM-DD.' },
      },
      required: ['date'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: available by then or not. Not the current tenancy end date.',
    readOnly: true,
    evaluate(facts, args) {
      const date = typeof args?.date === 'string' ? args.date.trim() : '';
      if (!isIsoDate(date)) return { ok: false, error: 'date must be an ISO date such as 2026-10-01' };
      const earliest = String(facts.earliestMoveInIso);
      if (!isIsoDate(earliest)) return { ok: false, error: 'earliest move-in date is not recorded' };
      return verdict(earliest <= date, 'tested against ' + date);
    },
  },

  {
    name: 'household_size_at_most',
    title: 'Household fits the property',
    category: 'logistics',
    description:
      'Answer yes or no: does the household fit within the stated maximum occupancy for the property?',
    inputSchema: {
      type: 'object',
      properties: {
        max_occupants: { type: 'number', description: 'Maximum occupants the property permits.' },
      },
      required: ['max_occupants'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: fits or not. Not the actual household size, not who they are.',
    readOnly: true,
    evaluate(facts, args) {
      const max = requireNumber(args, 'max_occupants', { min: 1, max: 32 });
      if (!max.ok) return max;
      const size = Number(facts.householdSize);
      if (!Number.isFinite(size)) return { ok: false, error: 'household size is not recorded' };
      return verdict(size <= max.value, 'tested against a limit of ' + max.value);
    },
  },

  {
    name: 'pets_compatible',
    title: 'Pets match the policy',
    category: 'logistics',
    description:
      'Answer yes or no: is the applicant’s pet situation compatible with the property’s pet policy? Pass allows_pets as true for a pet-friendly listing.',
    inputSchema: {
      type: 'object',
      properties: {
        allows_pets: { type: 'boolean', description: 'Whether the listing permits pets.' },
      },
      required: ['allows_pets'],
    },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: compatible or not. What kind of animal stays here.',
    readOnly: true,
    evaluate(facts, args) {
      const allows = args?.allows_pets;
      if (typeof allows !== 'boolean') {
        return { ok: false, error: 'allows_pets must be true or false' };
      }
      const hasPets = Boolean(facts.hasPets);
      return verdict(allows || !hasPets, allows ? 'listing permits pets' : 'listing forbids pets');
    },
  },

  {
    name: 'is_non_smoker',
    title: 'Non-smoking household',
    category: 'logistics',
    description: 'Answer yes or no: is the applicant a non-smoker?',
    inputSchema: { type: 'object', properties: {}, required: [] },
    disclosureBits: BITS_PER_BOOLEAN,
    reveals: 'One bit: whether anyone smokes. Nothing else.',
    readOnly: true,
    evaluate(facts) {
      return verdict(!facts.smoker, 'self-declared');
    },
  },

  // ---------------------------------------------------------------------------
  // Raw disclosures. These exist so the meter has something to measure against.
  // Every one is deliberately expensive, and the consent UI prices them in bits
  // next to the predicate that answers the same question for one bit.
  // ---------------------------------------------------------------------------

  {
    name: 'disclose_exact_income',
    title: 'Exact annual income',
    category: 'raw disclosure',
    description:
      'Return the applicant’s exact annual income in GBP. Prefer income_meets_multiple, which settles affordability without revealing the figure.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    // A salary anywhere in 10k-100k at 100-pound resolution is one of ~900 buckets.
    disclosureBits: bitsForBuckets(900),
    reveals: 'The exact salary. Permanent, copyable, and enough to profile the applicant.',
    readOnly: true,
    evaluate(facts) {
      const income = Number(facts.annualIncomeGbp);
      if (!Number.isFinite(income)) return { ok: false, error: 'income is not recorded in the vault' };
      return { ok: true, answer: '£' + income.toLocaleString('en-GB') + ' per year' };
    },
  },

  {
    name: 'disclose_identity',
    title: 'Full legal name and employer',
    category: 'raw disclosure',
    description:
      'Return the applicant’s full legal name and current employer. Most checks do not need this until a tenancy is actually being drawn up.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    // Name plus employer is effectively re-identifying: treat it as a large,
    // deliberately blunt number rather than pretending it can be priced exactly.
    disclosureBits: bitsForBuckets(1_000_000),
    reveals: 'Enough to identify the applicant by name and workplace.',
    readOnly: true,
    evaluate(facts) {
      const name = String(facts.legalName || '').trim();
      const employer = String(facts.employerName || '').trim();
      if (!name) return { ok: false, error: 'legal name is not recorded in the vault' };
      return { ok: true, answer: name + (employer ? ', employed at ' + employer : '') };
    },
  },
]);

/** @type {ReadonlyMap<string, Predicate>} name to predicate, for O(1) lookup. */
const PREDICATES_BY_NAME = new Map(PREDICATES.map((p) => [p.name, p]));

/**
 * Look one predicate up by wire name.
 *
 * @param {string} name
 * @returns {Predicate | undefined}
 */
export function findPredicate(name) {
  return PREDICATES_BY_NAME.get(name);
}

/**
 * Distinct categories, in the order they first appear in the catalogue.
 *
 * @returns {string[]}
 */
export function predicateCategories() {
  const seen = [];
  for (const p of PREDICATES) if (!seen.includes(p.category)) seen.push(p.category);
  return seen;
}
