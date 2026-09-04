/**
 * @file Small helpers shared across the host origin.
 *
 * Responsible for: formatting and error rendering used by more than one module.
 * Deliberately tiny; anything that grows a second responsibility moves out.
 */

/**
 * Render any thrown value as a string, including non-Error throws.
 *
 * `catch` binds whatever was thrown, and a thrown string or object would
 * otherwise reach the UI as "[object Object]".
 *
 * @param {unknown} err
 * @returns {string}
 */
export function errText(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Format a GBP amount the way a letting listing writes it.
 *
 * @param {number} amount
 * @returns {string}
 */
export function gbp(amount) {
  if (!Number.isFinite(amount)) return '—';
  return '£' + Math.round(amount).toLocaleString('en-GB');
}

/**
 * Escape text for interpolation into HTML.
 *
 * Every string that reaches the DOM in this project passes through here or is
 * set via `textContent`. Listing copy is static, but a federated answer is not:
 * it crosses an origin boundary, and treating it as markup would hand the vault
 * a scripting foothold on this page.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
