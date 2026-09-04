/**
 * @file The one function the letting agent needs from the vault's pricing model.
 *
 * The counterfactual comparison is shared between the two origins, and it needs
 * `bitsForBuckets`. Importing the whole predicate catalogue here would drag the
 * vault's private evaluation logic across the boundary into a codebase that has
 * no business holding it, so only the arithmetic crosses.
 */

/**
 * Bits needed to pin a value to one of `n` equally likely buckets.
 *
 * @param {number} n number of distinguishable outcomes, at least 1
 * @returns {number} bits, to one decimal place
 */
export function bitsForBuckets(n) {
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.round(Math.log2(n) * 10) / 10;
}
