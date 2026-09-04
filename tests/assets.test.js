/**
 * @file Every file a page asks for must exist.
 *
 * This exists because of a real outage. `vault/ui/app.js` gained two imports,
 * `toast.js` and `confirm.js`, which were written locally and not deployed. The
 * browser fetched them, got 404, and refused the whole module graph. Both live
 * pages rendered completely blank, and 108 passing tests had nothing to say
 * about it, because every one of them ran against a local server where the
 * files were present.
 *
 * A missing module is not a subtle failure. It is the worst one available: the
 * product disappears. So it is checked statically, here, in milliseconds,
 * against the directory that actually gets deployed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The two directories that are deployed, each as its own origin. */
const ORIGINS = ['vault', 'host'];

/**
 * Every file under a directory, recursively.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/**
 * Resolve a reference the way a browser would, relative to the file holding it.
 *
 * @param {string} fromFile absolute path of the file containing the reference
 * @param {string} ref      the reference as written
 * @returns {string | null} absolute path, or null when it is not ours to check
 */
function resolveRef(fromFile, ref) {
  if (/^(https?:)?\/\//.test(ref)) return null;   // another origin's problem
  if (ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('mailto:')) return null;
  const clean = ref.split('?')[0].split('#')[0];
  if (clean === '') return null;
  return resolve(dirname(fromFile), clean);
}

for (const origin of ORIGINS) {
  const originRoot = join(ROOT, origin);

  test(`${origin}: every module imported by its scripts exists`, () => {
    const missing = [];
    for (const file of filesUnder(originRoot)) {
      if (extname(file) !== '.js') continue;
      const source = readFileSync(file, 'utf8');
      // Static imports and re-exports. Dynamic import() is not used here, and a
      // pattern that tried to cover it would match strings in prose.
      for (const match of source.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm)) {
        const target = resolveRef(file, match[1]);
        if (target !== null && !existsSync(target)) {
          missing.push(file.slice(ROOT.length) + ' imports ' + match[1]);
        }
      }
      for (const match of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) {
        const target = resolveRef(file, match[1]);
        if (target !== null && !existsSync(target)) {
          missing.push(file.slice(ROOT.length) + ' imports ' + match[1]);
        }
      }
    }
    assert.deepEqual(missing, [], 'the browser would 404 and render nothing:\n  ' + missing.join('\n  '));
  });

  test(`${origin}: every file its pages link to exists`, () => {
    const missing = [];
    for (const file of filesUnder(originRoot)) {
      if (extname(file) !== '.html') continue;
      const html = readFileSync(file, 'utf8');
      for (const match of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
        const target = resolveRef(file, match[1]);
        if (target !== null && !existsSync(target)) {
          missing.push(file.slice(ROOT.length) + ' references ' + match[1]);
        }
      }
    }
    assert.deepEqual(missing, [], 'the browser would 404:\n  ' + missing.join('\n  '));
  });

  test(`${origin}: every url() in its stylesheet exists`, () => {
    const css = join(originRoot, 'ui', 'base.css');
    const missing = [];
    for (const match of readFileSync(css, 'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      const target = resolveRef(css, match[1]);
      if (target !== null && !existsSync(target)) missing.push('base.css references ' + match[1]);
    }
    assert.deepEqual(missing, [], missing.join('\n  '));
  });
}

test('the two origins carry identical copies of every shared module', () => {
  // They cannot import from each other, so the files are duplicated by
  // tools/sync-config.sh. A copy that drifts is a bug that only shows on one
  // origin, which is the hardest kind to see.
  const drifted = [];
  for (const shared of ['ui/base.css', 'ui/toast.js', 'ui/confirm.js', 'config.js']) {
    const a = readFileSync(join(ROOT, 'vault', shared), 'utf8');
    const b = readFileSync(join(ROOT, 'host', shared), 'utf8');
    if (a !== b) drifted.push(shared);
  }
  assert.deepEqual(drifted, [], 'run tools/sync-config.sh; these have drifted: ' + drifted.join(', '));
});

test('the hidden attribute is honoured in both stylesheets', () => {
  // `.announcer` is `display: grid`, which beats the user agent's `display:
  // none` for `[hidden]`. Without an author rule saying otherwise, every page
  // load opened with an empty bordered banner and a close button over the
  // masthead. Six elements in the markup rely on the attribute, so this is
  // asserted on the stylesheet rather than on any one of them.
  for (const sheet of ['vault/ui/base.css', 'host/ui/base.css']) {
    const css = readFileSync(join(ROOT, sheet), 'utf8');
    assert.match(
      css,
      /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
      sheet + ' does not force hidden elements to stay hidden'
    );
  }
});
