/**
 * @file Fact store for the vault origin.
 *
 * Responsible for: durable, origin-local storage of the facts a renter would
 * otherwise upload to a letting agent (income, tenancy history, references).
 *
 * NOT responsible for: deciding who may read them. That is `grants.js`.
 * NOT responsible for: answering questions about them. That is `predicates.js`.
 *
 * Every value here stays in this origin's `localStorage`. Nothing in this file
 * performs network I/O, and the vault ships no `fetch` call at all, which is
 * the property the whole product rests on.
 */

/** Storage key for the fact record. Namespaced so a future schema can migrate. */
const FACTS_KEY = 'vouchsafe.facts.v1';

/**
 * Ceiling on a stored string, in UTF-16 code units.
 *
 * localStorage quota is roughly 5MB per origin across all keys. A single
 * free-text fact has no legitimate reason to approach that, so we cap well
 * below it and fail loudly rather than let one oversized note evict the record.
 */
const MAX_FACT_STRING_LENGTH = 4096;

/** Largest household size accepted. Above this the input is a typo, not a household. */
const MAX_HOUSEHOLD_SIZE = 32;

/** Largest reference count accepted. */
const MAX_REFERENCES = 32;

/**
 * The demonstration renter.
 *
 * Synthetic. No real person's data appears in this repository. These values
 * exist so a judge opening the live URL sees a populated vault immediately
 * rather than an empty form, and every one of them is editable in the UI.
 */
export const APPLICANTS = Object.freeze([
  {
    id: 'ama',
    label: 'Ama, staff nurse',
    summary: 'Permanent contract, three years in post, comfortable on most of the market.',
    facts: {
      legalName: 'Ama Boateng',
      annualIncomeGbp: 41400,
      employerName: 'Northgate Radiology',
      employmentStartIso: '2023-02-01',
      employmentType: 'permanent',
      savingsGbp: 6800,
      creditBand: 'good',
      evictionCount: 0,
      ccjCount: 0,
      referenceCount: 3,
      householdSize: 2,
      hasPets: true,
      petDescription: 'one neutered cat, indoor',
      smoker: false,
      rightToRentValidUntilIso: '2031-06-30',
      earliestMoveInIso: '2026-10-01',
    },
  },
  {
    id: 'dele',
    label: 'Dele, first tenancy',
    summary: 'Two years in a first job, no rental history, priced out of the larger places.',
    facts: {
      legalName: 'Dele Okafor',
      annualIncomeGbp: 26800,
      employerName: 'Riverside Logistics',
      employmentStartIso: '2024-09-16',
      employmentType: 'permanent',
      savingsGbp: 2100,
      creditBand: 'fair',
      evictionCount: 0,
      ccjCount: 0,
      referenceCount: 1,
      householdSize: 1,
      hasPets: false,
      petDescription: '',
      smoker: false,
      rightToRentValidUntilIso: '2029-11-30',
      earliestMoveInIso: '2026-09-20',
    },
  },
  {
    id: 'priya',
    label: 'Priya, self-employed',
    summary: 'Earns well, seven months self-employed, which the stricter landlords still treat as no history.',
    facts: {
      legalName: 'Priya Raman',
      annualIncomeGbp: 58000,
      employerName: 'Self-employed, Raman Design',
      employmentStartIso: '2026-02-02',
      employmentType: 'self-employed',
      savingsGbp: 14500,
      creditBand: 'excellent',
      evictionCount: 0,
      ccjCount: 0,
      referenceCount: 2,
      householdSize: 3,
      hasPets: true,
      petDescription: 'two greyhounds',
      smoker: false,
      rightToRentValidUntilIso: '2033-01-31',
      earliestMoveInIso: '2026-10-20',
    },
  },
]);

/**
 * The applicant the vault starts on.
 *
 * Three of them, not one, because a product that only ever shows a pass never
 * shows what it is for. Switching to Dele produces a refusal on rent, and to
 * Priya an incomplete on employment history, without anyone having to hand-edit
 * a field to get there.
 *
 * All invented. No real person's details appear in this repository.
 */
export const SEED_FACTS = Object.freeze(APPLICANTS[0].facts);

/**
 * Credit bands in ascending order of strength.
 *
 * Ordered so `credit_band_at_least` compares by index instead of hardcoding a
 * comparison table. Names follow the bands UK agencies actually quote.
 */
export const CREDIT_BANDS = Object.freeze(['very_poor', 'poor', 'fair', 'good', 'excellent']);

/**
 * Read the whole fact record.
 *
 * Returns a fresh object every call, so a caller mutating the result cannot
 * corrupt the store. On any storage failure (private mode, quota, corrupted
 * JSON) this returns the seed record rather than throwing, because a vault that
 * cannot be read must still render something the user can correct.
 *
 * @returns {Record<string, unknown>} the current facts, never null
 */
export function readFacts() {
  let raw = null;
  try {
    raw = localStorage.getItem(FACTS_KEY);
  } catch {
    // Storage unavailable entirely (private mode, blocked site data).
    return { ...SEED_FACTS };
  }
  if (raw === null) return { ...SEED_FACTS };

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...SEED_FACTS };
    }
    // Seed underneath, so a record written by an older build still resolves
    // every key a predicate expects.
    return { ...SEED_FACTS, ...parsed };
  } catch {
    return { ...SEED_FACTS };
  }
}

/**
 * Replace one fact.
 *
 * @param {string} key    fact name, must already exist in the seed schema
 * @param {unknown} value new value, validated before it lands
 * @returns {{ok: true} | {ok: false, error: string}} outcome, never throws
 */
export function writeFact(key, value) {
  if (!Object.prototype.hasOwnProperty.call(SEED_FACTS, key)) {
    return { ok: false, error: 'unknown fact "' + key + '"' };
  }

  const validation = validateFact(key, value);
  if (!validation.ok) return validation;

  const next = { ...readFacts(), [key]: validation.value };
  try {
    localStorage.setItem(FACTS_KEY, JSON.stringify(next));
  } catch (err) {
    return { ok: false, error: 'could not save: ' + errText(err) };
  }
  return { ok: true };
}

/**
 * Check one fact value against the type and range its predicates assume.
 *
 * Predicates downstream treat their inputs as already-sane, so this is the only
 * place external input is admitted into the record, and it validates strictly.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {{ok: true, value: unknown} | {ok: false, error: string}}
 */
export function validateFact(key, value) {
  const expected = SEED_FACTS[key];

  if (typeof expected === 'number') {
    const parsed = typeof value === 'string' ? Number(value.trim()) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
      return { ok: false, error: key + ' must be a finite number' };
    }
    if (parsed < 0) return { ok: false, error: key + ' cannot be negative' };
    if (key === 'householdSize' && parsed > MAX_HOUSEHOLD_SIZE) {
      return { ok: false, error: 'householdSize cannot exceed ' + MAX_HOUSEHOLD_SIZE };
    }
    if (key === 'referenceCount' && parsed > MAX_REFERENCES) {
      return { ok: false, error: 'referenceCount cannot exceed ' + MAX_REFERENCES };
    }
    return { ok: true, value: parsed };
  }

  if (typeof expected === 'boolean') {
    if (typeof value === 'boolean') return { ok: true, value };
    if (value === 'true') return { ok: true, value: true };
    if (value === 'false') return { ok: true, value: false };
    return { ok: false, error: key + ' must be true or false' };
  }

  if (typeof expected === 'string') {
    if (typeof value !== 'string') return { ok: false, error: key + ' must be text' };
    if (value.length > MAX_FACT_STRING_LENGTH) {
      return { ok: false, error: key + ' exceeds ' + MAX_FACT_STRING_LENGTH + ' characters' };
    }
    if (key === 'creditBand' && !CREDIT_BANDS.includes(value)) {
      return { ok: false, error: 'creditBand must be one of ' + CREDIT_BANDS.join(', ') };
    }
    if (key.endsWith('Iso') && !isIsoDate(value)) {
      return { ok: false, error: key + ' must be an ISO date such as 2026-10-01' };
    }
    return { ok: true, value };
  }

  return { ok: false, error: 'unsupported fact type for "' + key + '"' };
}

/**
 * Restore the seed record, discarding edits.
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function resetFacts() {
  try {
    localStorage.removeItem(FACTS_KEY);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/**
 * Replace the whole record with one of the sample applicants.
 *
 * @param {string} id one of the ids in `APPLICANTS`
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function loadApplicant(id) {
  const applicant = APPLICANTS.find((a) => a.id === id);
  if (!applicant) return { ok: false, error: 'no sample applicant called "' + id + '"' };
  try {
    localStorage.setItem(FACTS_KEY, JSON.stringify(applicant.facts));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'could not switch applicant: ' + errText(err) };
  }
}

/**
 * Which sample applicant the current record matches, if any.
 *
 * Compared on the name rather than deep-equality, because the point is to show
 * which preset is loaded, and an edited preset is still that preset.
 *
 * @returns {string | null}
 */
export function currentApplicantId() {
  const name = readFacts().legalName;
  return APPLICANTS.find((a) => a.facts.legalName === name)?.id ?? null;
}

/**
 * Is this a well-formed calendar date in `YYYY-MM-DD` form?
 *
 * `Date.parse` alone accepts `2026-02-31` and silently rolls it into March, so
 * the parsed value is compared back against the input to reject rolled dates.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * Render any thrown value as a string, including non-Error throws.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function errText(err) {
  return err instanceof Error ? err.message : String(err);
}
