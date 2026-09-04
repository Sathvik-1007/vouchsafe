/**
 * @file Authorisation and the audit ledger for the vault origin.
 *
 * Responsible for: which origin may call which predicate, and an append-only
 * record of every call that was actually made.
 *
 * NOT responsible for: what the predicates compute (`predicates.js`) or where
 * the underlying facts live (`facts.js`).
 *
 * A grant is the unit of consent. It names one origin and one predicate, and it
 * is the only thing standing between a letting agent's agent and an answer.
 * Nothing here is transmitted; the ledger is the user's own copy, held in their
 * own browser, which is the point of keeping the boundary in the client.
 */

import { errText } from './facts.js';
import { findPredicate } from './predicates.js';
import { knownOrigins } from '../config.js';

/** Storage key for the grant set. */
const GRANTS_KEY = 'bureau.grants.v1';

/** Storage key for the audit ledger. */
const LEDGER_KEY = 'bureau.ledger.v1';

/**
 * Entries retained in the audit ledger.
 *
 * The ledger is a debugging and trust surface, not an archive. Holding the most
 * recent 500 calls keeps it inside localStorage's quota with room to spare while
 * still covering far more than a single application session.
 */
export const MAX_LEDGER_ENTRIES = 500;

/**
 * Origins the vault will ever consider granting to.
 *
 * An allowlist rather than an open field. `exposedTo` accepts any secure origin,
 * so without this a page could talk the user into granting to an origin they
 * cannot see. Populated at build time with the origins of this project only.
 *
 * @type {ReadonlyArray<{origin: string, label: string, kind: string}>}
 */
export const KNOWN_ORIGINS = knownOrigins();

/**
 * Is this string a usable, secure origin for `exposedTo`?
 *
 * The WebMCP `exposedTo` array accepts secure origins only. `http://localhost`
 * counts as a secure context, which is what makes local development possible,
 * so it is admitted alongside https.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isSecureOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // An origin carries no path, query or fragment.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/**
 * Read the grant set as a map of origin to the predicate names it may call.
 *
 * @returns {Record<string, string[]>} never null; unknown origins are dropped
 */
export function readGrants() {
  let raw = null;
  try {
    raw = localStorage.getItem(GRANTS_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    /** @type {Record<string, string[]>} */
    const clean = {};
    for (const [origin, names] of Object.entries(parsed)) {
      // Drop anything that fails today's rules, so a stale record cannot widen
      // access after the allowlist or the catalogue has changed underneath it.
      if (!isSecureOrigin(origin)) continue;
      if (!Array.isArray(names)) continue;
      const valid = names.filter((n) => typeof n === 'string' && findPredicate(n) !== undefined);
      if (valid.length > 0) clean[origin] = [...new Set(valid)];
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * Is this predicate currently granted to this origin?
 *
 * @param {string} origin
 * @param {string} predicateName
 * @returns {boolean}
 */
export function isGranted(origin, predicateName) {
  const grants = readGrants();
  return Array.isArray(grants[origin]) && grants[origin].includes(predicateName);
}

/**
 * Grant one predicate to one origin.
 *
 * Idempotent: granting twice is a no-op that still reports success, so a UI
 * double-click cannot produce a duplicate entry.
 *
 * @param {string} origin        must be a secure origin and on the allowlist
 * @param {string} predicateName must name a predicate in the catalogue
 * @returns {{ok: true, changed: boolean} | {ok: false, error: string}}
 */
export function grant(origin, predicateName) {
  if (!isSecureOrigin(origin)) return { ok: false, error: 'not a secure origin: ' + origin };
  if (!KNOWN_ORIGINS.some((o) => o.origin === origin)) {
    return { ok: false, error: 'origin is not on the vault allowlist: ' + origin };
  }
  if (findPredicate(predicateName) === undefined) {
    return { ok: false, error: 'no such predicate: ' + predicateName };
  }

  const grants = readGrants();
  const existing = grants[origin] ?? [];
  if (existing.includes(predicateName)) return { ok: true, changed: false };

  grants[origin] = [...existing, predicateName];
  const saved = persistGrants(grants);
  if (!saved.ok) return saved;

  appendLedger({ kind: 'grant', origin, predicate: predicateName });
  return { ok: true, changed: true };
}

/**
 * Withdraw one predicate from one origin.
 *
 * @param {string} origin
 * @param {string} predicateName
 * @returns {{ok: true, changed: boolean} | {ok: false, error: string}}
 */
export function revoke(origin, predicateName) {
  const grants = readGrants();
  const existing = grants[origin] ?? [];
  if (!existing.includes(predicateName)) return { ok: true, changed: false };

  const next = existing.filter((n) => n !== predicateName);
  if (next.length === 0) delete grants[origin];
  else grants[origin] = next;

  const saved = persistGrants(grants);
  if (!saved.ok) return saved;

  appendLedger({ kind: 'revoke', origin, predicate: predicateName });
  return { ok: true, changed: true };
}

/**
 * Withdraw every grant held by one origin.
 *
 * The panic button. One call ends the relationship entirely.
 *
 * @param {string} origin
 * @returns {{ok: true, revoked: number} | {ok: false, error: string}}
 */
export function revokeAll(origin) {
  const grants = readGrants();
  const existing = grants[origin] ?? [];
  if (existing.length === 0) return { ok: true, revoked: 0 };

  delete grants[origin];
  const saved = persistGrants(grants);
  if (!saved.ok) return saved;

  for (const predicate of existing) appendLedger({ kind: 'revoke', origin, predicate });
  return { ok: true, revoked: existing.length };
}

/**
 * Total bits disclosed to one origin, summed over its live grants.
 *
 * This is an upper bound on what the origin can learn by exercising every grant
 * it holds once. Repeated calls with different arguments can extract more from a
 * threshold predicate, which is exactly why `MAX_RENT_MULTIPLE` bounds the range
 * an agent may probe.
 *
 * @param {string} origin
 * @returns {number} bits, rounded to one decimal place
 */
export function disclosedBits(origin) {
  const names = readGrants()[origin] ?? [];
  let total = 0;
  for (const name of names) {
    const predicate = findPredicate(name);
    if (predicate) total += predicate.disclosureBits;
  }
  return Math.round(total * 10) / 10;
}

/**
 * Append one event to the audit ledger.
 *
 * Never throws: an unwritable ledger must not break a tool call that has
 * already been authorised. A failed write is dropped, and the ledger UI states
 * plainly that it holds the most recent entries only.
 *
 * @param {{kind: string, origin: string, predicate: string,
 *          args?: unknown, answer?: string, error?: string}} event
 * @returns {void}
 */
export function appendLedger(event) {
  const entry = {
    at: new Date().toISOString(),
    kind: String(event.kind),
    origin: String(event.origin),
    predicate: String(event.predicate),
    args: event.args === undefined ? null : event.args,
    answer: event.answer === undefined ? null : String(event.answer),
    error: event.error === undefined ? null : String(event.error),
  };

  try {
    const ledger = readLedger();
    ledger.unshift(entry);
    localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(0, MAX_LEDGER_ENTRIES)));
  } catch {
    // Ledger is best-effort. Losing an entry must never fail the call itself.
  }
}

/**
 * Read the audit ledger, newest entry first.
 *
 * @returns {Array<Record<string, unknown>>}
 */
export function readLedger() {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Empty the audit ledger. Grants are untouched.
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function clearLedger() {
  try {
    localStorage.removeItem(LEDGER_KEY);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errText(err) };
  }
}

/**
 * Write the grant set through.
 *
 * @param {Record<string, string[]>} grants
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function persistGrants(grants) {
  try {
    localStorage.setItem(GRANTS_KEY, JSON.stringify(grants));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'could not save grants: ' + errText(err) };
  }
}
