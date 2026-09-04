/**
 * @file What the old way would have cost.
 *
 * Responsible for: naming the documents a renter would have uploaded to answer
 * each question the ordinary way, and pricing that disclosure against the
 * predicate that replaces it.
 *
 * NOT responsible for: any part of the live flow. Nothing here is registered as
 * a tool or consulted during a check. It exists to make the comparison legible,
 * because "one bit" means nothing to a person until they see the alternative
 * sitting next to it.
 *
 * The figures are counts of distinct facts a document exposes, not file sizes.
 * A payslip is not expensive because it is a large PDF. It is expensive because
 * it carries your salary, your employer, your tax code, your National Insurance
 * number and your address, all of which the affordability question never asked
 * about and none of which a letting agent can un-see.
 */

import { bitsForBuckets } from './predicates-shim.js';

/**
 * @typedef {object} Counterfactual
 * @property {string} predicate  the predicate that makes this unnecessary
 * @property {string} document   what would have been uploaded instead
 * @property {string[]} alsoReveals facts the document carries that were not asked for
 */

/**
 * The document each question would ordinarily require, and what else it leaks.
 *
 * Drawn from what letting agents in England actually request at referencing:
 * three months of payslips, three months of bank statements, a photo ID, an
 * employer's reference and a previous landlord's reference.
 *
 * @type {ReadonlyArray<Counterfactual>}
 */
export const COUNTERFACTUALS = Object.freeze([
  {
    predicate: 'income_meets_multiple',
    document: 'Three months of payslips',
    alsoReveals: [
      'exact monthly salary',
      'employer name and address',
      'tax code',
      'National Insurance number',
      'pension contributions',
      'student loan status',
    ],
  },
  {
    predicate: 'deposit_available',
    document: 'Three months of bank statements',
    alsoReveals: [
      'every transaction you made',
      'account balance on every day',
      'who you pay and who pays you',
      'gambling, medical and legal spending',
      'other account numbers',
    ],
  },
  {
    predicate: 'credit_band_at_least',
    document: 'Full credit report',
    alsoReveals: [
      'exact score',
      'every credit account you hold',
      'every search made against you',
      'addresses linked to you',
      'financial associates',
    ],
  },
  {
    predicate: 'has_no_eviction_record',
    document: 'Tenancy history disclosure',
    alsoReveals: ['every previous address', 'every previous landlord', 'dates of every tenancy'],
  },
  {
    predicate: 'references_at_least',
    document: 'Named referee contact list',
    alsoReveals: [
      'names of previous landlords',
      'their phone numbers and emails',
      'your relationship to each',
    ],
  },
  {
    predicate: 'employment_months_min',
    document: 'Employment contract and employer letter',
    alsoReveals: ['job title', 'salary', 'probation terms', 'line manager', 'notice period'],
  },
  {
    predicate: 'right_to_rent_valid',
    document: 'Passport or biometric residence permit',
    alsoReveals: [
      'nationality',
      'date and place of birth',
      'document number',
      'immigration status',
      'photograph',
    ],
  },
  {
    predicate: 'can_move_in_by',
    document: 'Current tenancy agreement',
    alsoReveals: ['current address', 'current rent', 'current landlord', 'notice already served'],
  },
  {
    predicate: 'household_size_at_most',
    document: 'Household occupancy declaration',
    alsoReveals: ['names of everyone living with you', 'their ages', 'their relationship to you'],
  },
  {
    predicate: 'pets_compatible',
    document: 'Pet declaration and vet records',
    alsoReveals: ['species and breed', 'veterinary history', 'your vet’s name'],
  },
]);

/** @type {ReadonlyMap<string, Counterfactual>} */
const BY_PREDICATE = new Map(COUNTERFACTUALS.map((c) => [c.predicate, c]));

/**
 * The document a predicate saves you from uploading.
 *
 * @param {string} predicateName
 * @returns {Counterfactual | undefined}
 */
export function counterfactualFor(predicateName) {
  return BY_PREDICATE.get(predicateName);
}

/**
 * Price the old way against the new one for a set of granted predicates.
 *
 * The document figure counts distinct facts exposed and converts to bits the
 * same way the predicates are priced, so the two numbers sit on one scale. It
 * is a floor, not an estimate: a bank statement reveals far more than the five
 * categories listed for it, and the point survives being conservative.
 *
 * @param {string[]} predicateNames granted predicates
 * @returns {{predicateBits: number, documentBits: number, documents: string[],
 *            extraFacts: number, ratio: number}}
 */
export function compareDisclosure(predicateNames) {
  const documents = [];
  let extraFacts = 0;

  for (const name of predicateNames) {
    const counterfactual = BY_PREDICATE.get(name);
    if (!counterfactual) continue;
    if (!documents.includes(counterfactual.document)) documents.push(counterfactual.document);
    extraFacts += counterfactual.alsoReveals.length;
  }

  // One bit per predicate answered, against log2 of the space each unasked-for
  // fact opens up. Ten distinguishable values per fact is deliberately modest;
  // a salary alone has hundreds.
  const predicateBits = predicateNames.filter((n) => BY_PREDICATE.has(n)).length;
  const documentBits = Math.round(extraFacts * bitsForBuckets(10) * 10) / 10;

  return {
    predicateBits,
    documentBits,
    documents,
    extraFacts,
    ratio: predicateBits === 0 ? 0 : Math.round((documentBits / predicateBits) * 10) / 10,
  };
}
