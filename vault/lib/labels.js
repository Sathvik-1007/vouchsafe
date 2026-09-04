/**
 * @file Human words for machine names.
 *
 * Responsible for: how every fact and permission is described to a person.
 *
 * NOT responsible for: anything the agent reads. Tool names and descriptions
 * stay machine-shaped in `predicates.js`, because an agent picks tools by
 * matching text and a friendly rename would make it worse at that.
 *
 * A person renting a flat should never be shown `annualIncomeGbp`. They should
 * be shown "Income before tax", the units they think in, and a sentence saying
 * what happens if they change it.
 */

/**
 * @typedef {object} FieldLabel
 * @property {string} label  what the field is called
 * @property {string} [hint] a short clarification, only where genuinely unclear
 * @property {string} [unit] shown beside the input
 * @property {string} [group] which fieldset it belongs to
 */

/** @type {ReadonlyMap<string, FieldLabel>} */
export const FIELD_LABELS = new Map([
  ['legalName', { label: 'Full legal name', group: 'You', hint: 'As it appears on your ID.' }],
  ['annualIncomeGbp', { label: 'Income before tax', group: 'Money', unit: '£ a year' }],
  ['savingsGbp', { label: 'Savings you could put to a deposit', group: 'Money', unit: '£' }],
  ['creditBand', { label: 'Credit standing', group: 'Money' }],
  ['employerName', { label: 'Employer', group: 'Work' }],
  ['employmentStartIso', { label: 'Started this job', group: 'Work', hint: 'Used only to work out how long you have been there.' }],
  ['employmentType', { label: 'Kind of contract', group: 'Work' }],
  ['evictionCount', { label: 'Evictions on record', group: 'Renting history' }],
  ['ccjCount', { label: 'Court judgments for rent arrears', group: 'Renting history' }],
  ['referenceCount', { label: 'Referees you could name', group: 'Renting history' }],
  ['householdSize', { label: 'People moving in, including you', group: 'The move' }],
  ['hasPets', { label: 'Any pets', group: 'The move' }],
  ['petDescription', { label: 'What kind', group: 'The move' }],
  ['smoker', { label: 'Anyone smokes indoors', group: 'The move' }],
  ['rightToRentValidUntilIso', { label: 'Right to rent valid until', group: 'The move' }],
  ['earliestMoveInIso', { label: 'Earliest you could move in', group: 'The move' }],
]);

/** Order the fieldsets appear in. Money first, because that is what gets asked about. */
export const FIELD_GROUPS = Object.freeze(['Money', 'Work', 'Renting history', 'The move', 'You']);

/**
 * The human label for a fact key.
 *
 * Falls back to the key rather than inventing a name, so a field added without
 * a label is visibly unfinished instead of quietly mislabelled.
 *
 * @param {string} key
 * @returns {FieldLabel}
 */
export function fieldLabel(key) {
  return FIELD_LABELS.get(key) ?? { label: key, group: 'You' };
}

/**
 * The question a permission answers, written as a person would ask it.
 *
 * The predicate's own `description` is written for an agent and mentions schema
 * and return shape. This is the same question asked in the second person.
 *
 * @type {ReadonlyMap<string, string>}
 */
export const PERMISSION_QUESTIONS = new Map([
  ['income_meets_multiple', 'Does your income cover the rent?'],
  ['deposit_available', 'Can you cover the deposit?'],
  ['credit_band_at_least', 'Is your credit good enough?'],
  ['has_no_eviction_record', 'Have you ever been evicted?'],
  ['references_at_least', 'Can you give enough references?'],
  ['employment_months_min', 'Have you been in your job long enough?'],
  ['right_to_rent_valid', 'Can you legally rent for the whole tenancy?'],
  ['can_move_in_by', 'Can you move in on time?'],
  ['household_size_at_most', 'Does your household fit?'],
  ['pets_compatible', 'Do your pets suit the property?'],
  ['is_non_smoker', 'Does anyone smoke indoors?'],
  ['disclose_exact_income', 'What exactly do you earn?'],
  ['disclose_identity', 'Who are you and where do you work?'],
]);

/**
 * @param {string} predicateName
 * @returns {string} the question in plain second person
 */
export function permissionQuestion(predicateName) {
  return PERMISSION_QUESTIONS.get(predicateName) ?? predicateName;
}

/**
 * The value a letting agent would see if this were a normal application, and
 * the fragment that gets blacked out in the interface.
 *
 * Used only for the redaction display. It is rendered from facts already in
 * this browser and is never sent anywhere, which is the entire point of showing
 * it: the person can see exactly what they are not handing over.
 *
 * @param {string} predicateName
 * @param {Record<string, unknown>} facts
 * @returns {string} the plaintext that gets covered
 */
export function redactedValue(predicateName, facts) {
  switch (predicateName) {
    case 'income_meets_multiple':
    case 'disclose_exact_income':
      return '£' + Number(facts.annualIncomeGbp ?? 0).toLocaleString('en-GB') + ' a year';
    case 'deposit_available':
      return '£' + Number(facts.savingsGbp ?? 0).toLocaleString('en-GB') + ' in savings';
    case 'credit_band_at_least':
      return String(facts.creditBand ?? '').replace('_', ' ') + ' credit';
    case 'has_no_eviction_record':
      return String(facts.evictionCount ?? 0) + ' evictions, ' + String(facts.ccjCount ?? 0) + ' judgments';
    case 'references_at_least':
      return String(facts.referenceCount ?? 0) + ' referees, with names and numbers';
    case 'employment_months_min':
      return 'at ' + String(facts.employerName ?? '') + ' since ' + String(facts.employmentStartIso ?? '');
    case 'right_to_rent_valid':
      return 'passport, valid to ' + String(facts.rightToRentValidUntilIso ?? '');
    case 'can_move_in_by':
      return 'free from ' + String(facts.earliestMoveInIso ?? '');
    case 'household_size_at_most':
      return String(facts.householdSize ?? 0) + ' people, named';
    case 'pets_compatible':
      return facts.hasPets ? String(facts.petDescription ?? 'a pet') : 'no pets';
    case 'is_non_smoker':
      return facts.smoker ? 'smoker' : 'non-smoker';
    case 'disclose_identity':
      return String(facts.legalName ?? '') + ', ' + String(facts.employerName ?? '');
    default:
      return 'your file';
  }
}
