/**
 * @file Guards the claim the whole product rests on.
 *
 * The vault says it never transmits your facts. That is a claim about source
 * code, so it is checked against source code rather than trusted. If someone
 * later adds a `fetch` to the vault, this fails and the README stops being true
 * in the same commit.
 *
 * Comments and prose are excluded: several files discuss why there is no fetch,
 * and matching on the word rather than the call would make the test useless.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Anything that could put a byte on the network from a page. */
const NETWORK_CALL = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|navigator\s*\.\s*sendBeacon/;

/** Files worth scanning. CSS cannot make these calls. */
const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.html']);

/**
 * Every code file under a directory, recursively.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function codeFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...codeFiles(path));
    else if (CODE_EXTENSIONS.has(extname(entry))) out.push(path);
  }
  return out;
}

/**
 * Strip block comments, line comments and HTML comments.
 *
 * Deliberately crude: it will also blank the inside of a string literal that
 * contains `//`. That errs toward false negatives on string content, which is
 * acceptable, because a network call written inside a string still has to be
 * evaluated by something this test would catch at the call site.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');
}

test('the vault makes no network call of any kind', () => {
  const offenders = [];
  for (const file of codeFiles('vault')) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const match = code.match(NETWORK_CALL);
    if (match) offenders.push(file + ' contains ' + match[0]);
  }
  assert.deepEqual(
    offenders,
    [],
    'The vault must never transmit. Found: ' + offenders.join('; ')
  );
});

test('the letting agent makes no network call either', () => {
  // It has no server to call. Everything it learns arrives over WebMCP, which is
  // the point: there is no back channel that could carry the data the tools
  // deliberately withhold.
  const offenders = [];
  for (const file of codeFiles('host')) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const match = code.match(NETWORK_CALL);
    if (match) offenders.push(file + ' contains ' + match[0]);
  }
  assert.deepEqual(offenders, [], 'Found: ' + offenders.join('; '));
});

test('neither origin embeds a third-party script or stylesheet', () => {
  const offenders = [];
  for (const file of [...codeFiles('vault'), ...codeFiles('host')]) {
    if (extname(file) !== '.html') continue;
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/g)) {
      offenders.push(file + ' loads ' + match[1]);
    }
  }
  assert.deepEqual(offenders, [], 'Found: ' + offenders.join('; '));
});
