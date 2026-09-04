/**
 * @file Origin map. The single source of truth for who talks to whom.
 *
 * Copied verbatim into `vault/config.js` and `host/config.js` by
 * `tools/sync-config.sh`. It is duplicated rather than fetched because each
 * application is deployed as its own origin with its own document root, and
 * one origin fetching a script from the other would undercut the claim that the
 * vault talks to nobody.
 *
 * Cross-origin WebMCP is symmetric and both halves must agree: the vault names
 * the host in `exposedTo`, the host names the vault in `fromOrigins`. A
 * mismatch yields an empty tool list and no error at all, which is the single
 * most confusing failure mode in this API. Deriving both from this file is what
 * stops that happening.
 */

/**
 * Are we running from a local development server?
 *
 * `localhost` is a secure context, which is what lets the whole cross-origin
 * flow be exercised on two ports before anything is deployed.
 *
 * @returns {boolean}
 */
export function isLocal() {
  const host = globalThis.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1';
}

/** Production origin of the vault. */
export const VAULT_ORIGIN_PROD = 'https://bureau-vault.vercel.app';

/** Production origin of the letting agent. */
export const HOST_ORIGIN_PROD = 'https://bureau-lettings.vercel.app';

/** Local development origin of the vault. */
export const VAULT_ORIGIN_DEV = 'http://localhost:4001';

/** Local development origin of the letting agent. */
export const HOST_ORIGIN_DEV = 'http://localhost:4002';

/**
 * Is this a localhost origin, and therefore safe to accept from a query string?
 *
 * The override below exists so the test harness can run both applications on
 * ports of its choosing. Accepting an arbitrary origin from the URL would be a
 * hole: anyone could send a link that pointed the vault at a site they control
 * and harvest the grant. So the override is refused unless it is localhost, and
 * refused entirely off localhost.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isLocalOrigin(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

/**
 * A localhost-only origin override, read from `?vault=` or `?host=`.
 *
 * @param {'vault' | 'host'} which
 * @returns {string | null}
 */
function override(which) {
  if (!isLocal()) return null;
  const raw = new URLSearchParams(globalThis.location?.search ?? '').get(which);
  if (raw === null) return null;
  const value = raw.replace(/\/$/, '') + '/';
  return isLocalOrigin(value) ? value.replace(/\/$/, '') : null;
}

/** @returns {string} the vault origin for the current environment */
export function vaultOrigin() {
  return override('vault') ?? (isLocal() ? VAULT_ORIGIN_DEV : VAULT_ORIGIN_PROD);
}

/** @returns {string} the letting agent origin for the current environment */
export function hostOrigin() {
  return override('host') ?? (isLocal() ? HOST_ORIGIN_DEV : HOST_ORIGIN_PROD);
}

/**
 * Origins the vault will consider granting to, with the labels a person needs
 * to recognise them. An allowlist and not an open field: `exposedTo` accepts
 * any secure origin, so without this a page could talk a user into granting to
 * an origin they never chose.
 *
 * @returns {ReadonlyArray<{origin: string, label: string, kind: string}>}
 */
export function knownOrigins() {
  return Object.freeze([
    { origin: hostOrigin(), label: 'Marlow & Reed Lettings', kind: 'letting agent' },
  ]);
}
