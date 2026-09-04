/**
 * @file Generate TOOLS.md from the code that registers the tools.
 *
 * A tool contract written by hand goes stale on the first rename and then
 * quietly misleads whoever trusts it. This reads the catalogue and the listing
 * requirements and emits the table, so the document is wrong only if the code
 * is.
 *
 * Run: node tools/gen-tools-doc.mjs > TOOLS.md
 */

import { PREDICATES } from '../vault/lib/predicates.js';
import { PERMISSION_QUESTIONS } from '../vault/lib/labels.js';
import { LISTINGS } from '../host/lib/listings.js';

const asked = new Set();
for (const l of LISTINGS) for (const r of l.requirements) asked.add(r.predicate);

const rows = PREDICATES.map((p) => {
  const question = PERMISSION_QUESTIONS.get(p.name) ?? '';
  const when = asked.has(p.name) ? 'Asked by at least one property' : 'Never asked by a property';
  return `| \`${p.name}\` | ${question} | ${p.disclosureBits} | ${p.readOnly ? 'yes' : 'no'} | ${when} |`;
});

const managementTools = [
  ['vault_list_predicates', 'List every question this file can answer, with its cost in bits.'],
  ['vault_list_grants', 'Which agencies hold which permissions, and how much each has been told.'],
  ['vault_grant', 'Allow one agency to ask one question.'],
  ['vault_revoke', 'Withdraw one permission. Takes effect immediately.'],
  ['vault_revoke_all', 'Withdraw everything from one agency at once.'],
  ['vault_disclosure_report', 'How much has been given away, per agency, and which grant costs most.'],
  ['vault_compare_disclosure', 'What the permissions revealed against the documents they replaced.'],
  ['vault_explain_permission', 'What one permission does and does not reveal, in plain words.'],
  ['vault_probe_report', 'Whether anyone is asking the same threshold repeatedly to work out the figure behind it.'],
  ['vault_read_ledger', 'The most recent questions asked, who asked, and what they were told.'],
  ['vault_update_fact', 'Correct one detail. Never leaves this browser.'],
  ['vault_known_origins', 'Which origins this file will consider granting to.'],
];

const hostTools = [
  ['list_listings', 'Every property currently available.', 'yes'],
  ['get_listing', 'One property in full, including every check its landlord runs.', 'yes'],
  ['check_eligibility', 'Run every check for one property against the applicant.', 'no'],
  ['missing_permissions', 'Which permissions this property needs that have not been allowed.', 'yes'],
  ['submit_application', 'Submit, but only once every required check has been answered yes.', 'no'],
  ['what_this_site_knows', 'State exactly what this agency holds about the applicant.', 'yes'],
];

process.stdout.write(`# The tool contract

Generated from the code by \`node tools/gen-tools-doc.mjs\`. A contract written by
hand goes stale on the first rename and then quietly misleads whoever trusts it.

Three sets of tools exist, and which of them a given agent can see depends
entirely on what the person has allowed.

## The applicant's file, exposed across the origin boundary

Registered on \`bureau-vault.vercel.app\` with an \`exposedTo\` naming the letting
agent, and only while the permission is allowed. Withdraw one and it is not a
guarded tool that refuses, it is absent.

Cost is Shannon bits: how much of the applicant the answer gives up.

| Tool | The question, as a person would ask it | Bits | Read only | Used by a property |
| --- | --- | ---: | --- | --- |
${rows.join('\n')}

The letting agent republishes each allowed tool under its own name with an
\`applicant_\` prefix, because an agent reads the top-level document's tool list
and does not call \`getTools({fromOrigins})\` on anyone's behalf. That republished
set is exactly what was allowed, and nothing else.

## The applicant's file, for the applicant only

Registered with no \`exposedTo\`, so they are same-origin and no letting agent can
reach them however many permissions it holds. This is what lets someone say
"withdraw everything from Marlow and Reed" to their own assistant.

| Tool | What it does |
| --- | --- |
${managementTools.map(([n, d]) => `| \`${n}\` | ${d} |`).join('\n')}

## The letting agent's own tools

Registered on \`bureau-lettings.vercel.app\`. These describe the property. None of
them describe the applicant, because this origin holds nothing about them.

| Tool | What it does | Read only |
| --- | --- | --- |
${hostTools.map(([n, d, r]) => `| \`${n}\` | ${d} | ${r} |`).join('\n')}

## Annotations

Every tool carries \`readOnlyHint\`. Every tool whose answer originates outside the
origin that publishes it also carries \`untrustedContentHint\`, which is exactly
the case that hint exists to mark: the borrowed \`applicant_*\` tools return
whatever another origin chose to say.

\`destructiveHint\` is discarded by Chrome at registration, measured, so it is not
used. See [docs/CHROME-FINDINGS.md](docs/CHROME-FINDINGS.md).
`);
