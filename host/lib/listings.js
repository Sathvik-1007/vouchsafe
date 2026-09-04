/**
 * @file The letting agent's own data: properties, and the checks each one runs.
 *
 * Responsible for: the listings a renter can apply to, and the requirement set
 * each listing imposes.
 *
 * NOT responsible for: anything about the applicant. The host origin holds no
 * applicant data at all, which is the property the demonstration is built to
 * show. Everything it learns arrives as a yes or a no from another origin and
 * is never written down here.
 *
 * A requirement names the vault predicate that settles it and the arguments to
 * settle it with. The host therefore states what it needs to know without ever
 * naming what it wants to hold.
 */

/**
 * @typedef {object} Requirement
 * @property {string} predicate wire name of the vault predicate that answers this
 * @property {Record<string, unknown>} args arguments to call it with
 * @property {string} label human sentence for the UI
 * @property {boolean} mandatory whether a "no" ends the application
 */

/**
 * @typedef {object} Listing
 * @property {string} id
 * @property {string} title
 * @property {string} area
 * @property {number} monthlyRentGbp
 * @property {number} bedrooms
 * @property {boolean} allowsPets
 * @property {number} maxOccupants
 * @property {string} availableFromIso
 * @property {string} tenancyEndsIso
 * @property {Requirement[]} requirements
 */

/** Deposit convention in England: five weeks' rent for annual rent under £50,000. */
export const DEPOSIT_WEEKS = 5;

/** Weeks in a year, used to convert monthly rent to the statutory deposit cap. */
const WEEKS_PER_YEAR = 52;

/**
 * Statutory deposit for a monthly rent, rounded to whole pounds.
 *
 * @param {number} monthlyRentGbp
 * @returns {number}
 */
export function depositFor(monthlyRentGbp) {
  return Math.round((monthlyRentGbp * 12 * DEPOSIT_WEEKS) / WEEKS_PER_YEAR);
}

/**
 * Build the requirement set for a listing.
 *
 * Derived from the listing rather than written out per property, so a new
 * listing cannot silently ship with a stale threshold.
 *
 * @param {Omit<Listing, 'requirements'>} listing
 * @returns {Requirement[]}
 */
export function requirementsFor(listing) {
  const required = [
    {
      predicate: 'income_meets_multiple',
      args: { monthly_rent_gbp: listing.monthlyRentGbp, multiple: listing.rentMultiple ?? 3 },
      label: 'Income of at least ' + (listing.rentMultiple ?? 3) + 'x the annual rent',
      mandatory: true,
    },
    {
      predicate: 'deposit_available',
      args: { amount_gbp: depositFor(listing.monthlyRentGbp) },
      label: 'A deposit of ' + gbpish(depositFor(listing.monthlyRentGbp)) + ' available',
      mandatory: true,
    },
    {
      predicate: 'has_no_eviction_record',
      args: {},
      label: 'No eviction or rent-arrears judgment on record',
      mandatory: true,
    },
    {
      predicate: 'right_to_rent_valid',
      args: { tenancy_ends: listing.tenancyEndsIso },
      label: 'Right to rent valid to ' + listing.tenancyEndsIso,
      mandatory: true,
    },
    {
      predicate: 'references_at_least',
      args: { count: listing.minReferences ?? 2 },
      label:
        (listing.minReferences ?? 2) === 1
          ? 'One contactable reference'
          : (listing.minReferences ?? 2) + ' contactable references',
      mandatory: true,
    },
    {
      predicate: 'employment_months_min',
      args: { months: listing.minEmploymentMonths ?? 6 },
      label: (listing.minEmploymentMonths ?? 6) + ' months of continuous employment',
      mandatory: true,
    },
    // A landlord who advertises a date, an occupancy limit or a pet policy means
    // it. Treating these as advisory let a no-pets flat accept a cat owner and
    // reported it as a pass, which is not how any letting works.
    {
      predicate: 'can_move_in_by',
      args: { date: listing.availableFromIso },
      label: 'Able to move in by ' + listing.availableFromIso,
      mandatory: true,
    },
    {
      predicate: 'household_size_at_most',
      args: { max_occupants: listing.maxOccupants },
      label: 'A household of at most ' + listing.maxOccupants,
      mandatory: true,
    },
    {
      predicate: 'pets_compatible',
      args: { allows_pets: listing.allowsPets },
      label: listing.allowsPets ? 'Pets welcome here' : 'No pets in this property',
      mandatory: true,
    },
  ];

  // Some landlords ask for more. Kept per-listing rather than global, so the
  // vault's catalogue is exercised by the properties rather than decorating it.
  if (listing.minCreditBand) {
    required.push({
      predicate: 'credit_band_at_least',
      args: { band: listing.minCreditBand },
      label: 'Credit standing of at least ' + listing.minCreditBand.replace('_', ' '),
      mandatory: true,
    });
  }
  if (listing.nonSmokingOnly) {
    required.push({
      predicate: 'is_non_smoker',
      args: {},
      label: 'A non-smoking household',
      mandatory: true,
    });
  }

  return required;
}

/**
 * Format pounds for a requirement label.
 *
 * `util.js` has `gbp` for the interface, but requirements are built in this
 * module and importing the view layer into the data layer to borrow a comma
 * would be the wrong direction.
 *
 * @param {number} amount
 * @returns {string}
 */
function gbpish(amount) {
  return '\u00a3' + Math.round(amount).toLocaleString('en-GB');
}

/** @type {ReadonlyArray<Omit<Listing, 'requirements'>>} */
const RAW_LISTINGS = Object.freeze([
  {
    id: 'ml-090',
    title: 'Studio, Talbot Road',
    area: 'Old Trafford, Manchester',
    monthlyRentGbp: 695,
    bedrooms: 1,
    allowsPets: false,
    maxOccupants: 1,
    availableFromIso: '2026-09-25',
    tenancyEndsIso: '2027-09-24',
    minReferences: 1,
    minEmploymentMonths: 3,
  },
  {
    id: 'ml-114',
    title: 'Two-bed garden flat, Wilbraham Road',
    area: 'Chorlton, Manchester',
    monthlyRentGbp: 1150,
    bedrooms: 2,
    allowsPets: true,
    maxOccupants: 3,
    availableFromIso: '2026-10-05',
    tenancyEndsIso: '2027-10-04',
  },
  {
    id: 'ml-207',
    title: 'One-bed conversion, Egerton Road',
    area: 'Fallowfield, Manchester',
    monthlyRentGbp: 875,
    bedrooms: 1,
    allowsPets: false,
    maxOccupants: 2,
    availableFromIso: '2026-09-29',
    tenancyEndsIso: '2027-09-28',
    nonSmokingOnly: true,
  },
  {
    id: 'ml-330',
    title: 'Three-bed terrace, Range Road',
    area: 'Whalley Range, Manchester',
    monthlyRentGbp: 1495,
    bedrooms: 3,
    allowsPets: true,
    maxOccupants: 4,
    availableFromIso: '2026-11-01',
    tenancyEndsIso: '2027-10-31',
    minCreditBand: 'good',
  },
  {
    id: 'ml-410',
    title: 'Warehouse conversion, Ducie Street',
    area: 'Northern Quarter, Manchester',
    monthlyRentGbp: 2250,
    bedrooms: 2,
    allowsPets: false,
    maxOccupants: 2,
    availableFromIso: '2026-10-12',
    tenancyEndsIso: '2027-10-11',
    rentMultiple: 3.5,
    minReferences: 3,
    minEmploymentMonths: 24,
    minCreditBand: 'excellent',
    nonSmokingOnly: true,
  },
]);

/** @type {ReadonlyArray<Listing>} every listing, with its requirements resolved. */
export const LISTINGS = Object.freeze(
  RAW_LISTINGS.map((l) => Object.freeze({ ...l, requirements: requirementsFor(l) }))
);

/**
 * Find one listing by id.
 *
 * @param {string} id
 * @returns {Listing | undefined}
 */
export function findListing(id) {
  return LISTINGS.find((l) => l.id === id);
}

/**
 * Every distinct predicate any listing can ask for.
 *
 * The vault's consent screen uses this to show a renter the full set of
 * questions this agent could ever put, before they grant the first one.
 *
 * @returns {string[]}
 */
export function allRequestedPredicates() {
  const names = new Set();
  for (const listing of LISTINGS) for (const r of listing.requirements) names.add(r.predicate);
  return [...names].sort();
}
