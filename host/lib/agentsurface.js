/**
 * @file The letting agent's own WebMCP tools.
 *
 * Responsible for: the tools this origin registers under its own name, which is
 * what an external agent such as ChatGPT sees when it opens the site.
 *
 * NOT responsible for: the borrowed `applicant_*` tools. Those are published by
 * `federation.js` and exist only while the renter's grant does.
 *
 * The split is the point. These tools describe the property. The borrowed ones
 * describe the applicant, they are owned by a different origin, and this origin
 * can lose them at any moment without warning.
 */

import { LISTINGS, findListing, depositFor } from './listings.js';
import { assess, summarise, resultsFor, missingPermissions } from './assessment.js';
import { errText, gbp } from './util.js';

/** Live registrations, so the surface can be torn down cleanly. @type {Map<string, AbortController>} */
const registered = new Map();

/**
 * Where the current federated tool handles come from.
 *
 * A getter rather than a value, because handles are replaced wholesale on every
 * rediscovery and a captured array would go stale the first time a grant changed.
 * @type {() => Array<object>}
 */
let handleSource = () => [];

/** Called after a tool changes application state, so the page can redraw. @type {() => void} */
let onStateChange = () => {};

/**
 * Applications submitted this page view. Never persisted, never transmitted.
 * @type {Map<string, {at: string, decision: string}>}
 */
const submitted = new Map();

/**
 * Register the host's own tools.
 *
 * @param {{handles: () => Array<object>, onChange: () => void}} wiring
 * @returns {Promise<string[]>} names that registered successfully
 */
export async function registerHostTools(wiring) {
  if (typeof document?.modelContext?.registerTool !== 'function') return [];
  handleSource = wiring.handles;
  onStateChange = wiring.onChange;

  const tools = [
    {
      name: 'list_listings',
      description:
        'List every property currently available from this letting agent, with rent, area, bedrooms and pet policy.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () =>
        LISTINGS.map(
          (l) =>
            l.id +
            '  ' +
            l.title +
            ', ' +
            l.area +
            '  ' +
            gbp(l.monthlyRentGbp) +
            '/month, ' +
            l.bedrooms +
            ' bed, ' +
            (l.allowsPets ? 'pets welcome' : 'no pets') +
            ', available ' +
            l.availableFromIso
        ).join('\n'),
    },
    {
      name: 'get_listing',
      description:
        'Full detail for one property, including the deposit and every check its landlord runs before offering a tenancy.',
      inputSchema: {
        type: 'object',
        properties: { listing_id: { type: 'string', description: 'Listing id, such as ml-114.' } },
        required: ['listing_id'],
      },
      readOnly: true,
      run: (args) => {
        const listing = findListing(String(args.listing_id ?? ''));
        if (!listing) return 'Error: no listing with id "' + args.listing_id + '"';
        return [
          listing.title + ', ' + listing.area,
          'Rent ' + gbp(listing.monthlyRentGbp) + ' per month, deposit ' + gbp(depositFor(listing.monthlyRentGbp)),
          listing.bedrooms + ' bedrooms, up to ' + listing.maxOccupants + ' occupants',
          listing.allowsPets ? 'Pets welcome' : 'No pets',
          'Available from ' + listing.availableFromIso + ', tenancy to ' + listing.tenancyEndsIso,
          '',
          'Checks the landlord runs:',
          ...listing.requirements.map(
            (r) => '  ' + (r.mandatory ? '[required] ' : '[optional] ') + r.label
          ),
        ].join('\n');
      },
    },
    {
      name: 'check_eligibility',
      description:
        'Run every check for one property against the applicant’s vault and report the outcome. Each check is a separate yes-or-no question; this site never receives the underlying documents.',
      inputSchema: {
        type: 'object',
        properties: { listing_id: { type: 'string', description: 'Listing id, such as ml-114.' } },
        required: ['listing_id'],
      },
      readOnly: false,
      run: async (args) => {
        const id = String(args.listing_id ?? '');
        const listing = findListing(id);
        if (!listing) return 'Error: no listing with id "' + id + '"';

        const checks = await assess(id, handleSource());
        const summary = summarise(checks);
        onStateChange();

        const lines = checks.map((c) => {
          const mark =
            c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : c.status === 'blocked' ? 'NOT GRANTED' : 'ERROR';
          return '  ' + mark + '  ' + c.predicate + '  ' + c.detail;
        });
        return [
          'Assessment for ' + listing.title,
          ...lines,
          '',
          'Decision: ' + summary.decision.replace('_', ' ') + '. ' + summary.reason,
        ].join('\n');
      },
    },
    {
      name: 'missing_permissions',
      description:
        'List the permissions this property’s checks need that the applicant has not yet granted. Use this to tell the applicant exactly what to allow.',
      inputSchema: {
        type: 'object',
        properties: { listing_id: { type: 'string', description: 'Listing id, such as ml-114.' } },
        required: ['listing_id'],
      },
      readOnly: true,
      run: (args) => {
        const id = String(args.listing_id ?? '');
        if (!findListing(id)) return 'Error: no listing with id "' + id + '"';
        const missing = missingPermissions(id, handleSource());
        return missing.length === 0
          ? 'Nothing is missing. Every check for this property can be answered.'
          : 'Not yet granted: ' + missing.join(', ');
      },
    },
    {
      name: 'submit_application',
      description:
        'Submit an application for one property. Only succeeds when every required check has already been answered yes.',
      inputSchema: {
        type: 'object',
        properties: { listing_id: { type: 'string', description: 'Listing id, such as ml-114.' } },
        required: ['listing_id'],
      },
      readOnly: false,
      run: (args) => {
        const id = String(args.listing_id ?? '');
        const listing = findListing(id);
        if (!listing) return 'Error: no listing with id "' + id + '"';

        const checks = resultsFor(id);
        if (checks.length === 0) {
          return 'Error: run check_eligibility for ' + id + ' before submitting.';
        }
        const summary = summarise(checks);
        if (summary.decision !== 'eligible') {
          return 'Cannot submit: ' + summary.reason;
        }

        const at = new Date().toISOString();
        submitted.set(id, { at, decision: summary.decision });
        onStateChange();
        return (
          'Application submitted for ' +
          listing.title +
          ' at ' +
          at +
          '. The landlord received ' +
          checks.length +
          ' yes-or-no answers and no documents.'
        );
      },
    },
    {
      name: 'what_this_site_knows',
      description:
        'State exactly what this letting agent holds about the applicant. Useful when the applicant asks what they have given away.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      readOnly: true,
      run: () => {
        const borrowed = handleSource().map((t) => String(t.name));
        const lines = [
          'Stored about the applicant: nothing. This origin writes no applicant data to storage.',
          'Permissions currently borrowed from the applicant’s vault: ' +
            (borrowed.length === 0 ? 'none' : borrowed.join(', ')),
          'Each permission returns a yes or a no. The applicant can withdraw any of them at any moment, and the corresponding tool disappears from this site immediately.',
        ];
        if (submitted.size > 0) {
          lines.push('Applications submitted this session: ' + [...submitted.keys()].join(', '));
        }
        return lines.join('\n');
      },
    },
  ];

  const done = [];
  for (const tool of tools) {
    const controller = new AbortController();
    try {
      await document.modelContext.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: false },
          execute: async (args) => {
            try {
              return String(await tool.run(args ?? {}));
            } catch (err) {
              // Returned, not thrown: Chrome replaces a thrown Error with a
              // generic UnknownError and discards the message.
              return 'Error: ' + errText(err);
            }
          },
        },
        { signal: controller.signal }
      );
      registered.set(tool.name, controller);
      done.push(tool.name);
    } catch (err) {
      console.error('[host] could not register ' + tool.name + ':', errText(err));
    }
  }
  return done;
}

/** Names of the host's own tools currently registered. @returns {string[]} */
export function hostToolNames() {
  return [...registered.keys()].sort();
}

/** Applications submitted this page view. @returns {Map<string, {at: string, decision: string}>} */
export function submittedApplications() {
  return submitted;
}
