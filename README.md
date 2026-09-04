# Bureau

**The letting agent gets an answer, not your life.**

To rent a flat in Britain you upload your payslips, your bank statements and your
passport to six letting agents, who keep them forever. None of them wanted your
salary. They wanted one bit: *is annual income at least three times annual rent,
yes or no.*

Bureau is that bit. Your facts live on your own origin and never leave your
browser. A letting agent's site borrows the *capability to ask*, gets back a
word, and holds nothing. Withdraw the permission and the tool disappears from
the agent's hands mid-conversation.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

- **Live:** LIVE_HOST_URL — open in ChatGPT's browser, or Chrome 149+
- **Your vault:** LIVE_VAULT_URL
- **Video:** VIDEO_URL
- **Licence:** MIT

---

## What is actually new here

Almost every WebMCP project is one site publishing tools about itself. Bureau is
two origins exchanging them. The renter's vault registers tools with `exposedTo`,
the letting agent discovers them with `getTools({fromOrigins})` and runs them with
`executeTool`, and the browser is the only thing in between. There is no server
on either side of the boundary and no API key anywhere.

That makes three things possible that a single origin cannot do:

**Data that answers without being sent.** The vault holds an income. The letting
agent can learn whether it clears a threshold and can never learn what it is.

**Consent you can withdraw and watch die.** Revoking aborts the vault's
`AbortController`. That fires `toolchange` in the letting agent's document, its
rediscovery finds the tool gone, and it drops the proxy. The agent's tool list is
one shorter, in the middle of a sentence. Nothing was asked to cooperate.

**A disclosure budget you can count.** Every permission is priced in bits.
`income_meets_multiple` costs 1. `disclose_exact_income` costs 9.8. The whole
standard letting check is nine permissions and nine bits. The meter is computed
from `log2` of the outcome space, not decorated on afterwards.

---

## Try it in three minutes

**In ChatGPT's browser** (how the judges will see it): open the built-in browser
(⌘⇧B), go to the live URL, and turn on *Settings → Browser → Permissions → Enable
site tools*. Then ask:

- *"What's available and what would I need to prove for the Wilbraham Road flat?"*
- *"Check whether I'm eligible for it."*
- *"What does this site actually know about me?"*
- Now press **revoke** on `income_meets_multiple` in the vault panel, and ask it
  to check again. Watch the tool go missing.

**In Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing`, open the live
URL, and use *DevTools → Application → WebMCP* to call every tool by hand. The
[Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) works too.

**Locally:**

```sh
git clone https://github.com/Sathvik-1007/bureau-webmcp
cd bureau-webmcp
npm test          # 44 unit tests
./tools/serve.sh  # two origins, :4001 and :4002
```

Then open `http://localhost:4002` in a WebMCP-capable browser. Both ports are
secure contexts, so the full cross-origin flow works locally.

---

## The tool surface

**28 tools across two origins**, and which ones exist depends on what you granted.

### The vault, `vault/lib/predicates.js` — 13 questions it will answer

Each is exposed only to the origins you name, each returns a word, each is priced.

| Tool | Costs | What the asker learns |
| --- | ---: | --- |
| `income_meets_multiple` | 1 bit | whether income clears *this* multiple of *this* rent |
| `deposit_available` | 1 bit | whether savings clear this figure |
| `credit_band_at_least` | 1 bit | whether the band clears this floor |
| `has_no_eviction_record` | 1 bit | clean record or not, no case detail |
| `references_at_least` | 1 bit | enough references, no names |
| `employment_months_min` | 1 bit | tenure clears the bar, not the employer |
| `right_to_rent_valid` | 1 bit | covered for this tenancy, not the status or nationality |
| `can_move_in_by` | 1 bit | available by then, not the current tenancy end |
| `household_size_at_most` | 1 bit | fits, not who they are |
| `pets_compatible` | 1 bit | compatible, animal unnamed |
| `is_non_smoker` | 1 bit | one bit |
| `disclose_exact_income` | **9.8 bits** | the salary, permanently, copyably |
| `disclose_identity` | **19.9 bits** | enough to identify you by name and workplace |

The last two exist so the meter has something to measure against. No listing asks
for them, and a test asserts that.

### The vault, `vault/lib/registry.js` — 9 tools only *you* can reach

Registered with no `exposedTo`, so they are same-origin and a letting agent cannot
touch them however many predicates it holds. This is what lets you say *"revoke
everything from Marlow and Reed"* to your own agent:
`vault_list_predicates`, `vault_list_grants`, `vault_grant`, `vault_revoke`,
`vault_revoke_all`, `vault_disclosure_report`, `vault_read_ledger`,
`vault_update_fact`, `vault_known_origins`.

### The letting agent — 6 of its own, plus one proxy per permission

`list_listings`, `get_listing`, `check_eligibility`, `missing_permissions`,
`submit_application`, `what_this_site_knows`.

Plus a dynamic `applicant_*` tool for every capability you granted. Those are the
borrowed ones. They exist only while your grant does.

---

## How it works

```
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  VAULT ORIGIN                │          │  LETTING AGENT ORIGIN        │
│                              │          │                              │
│  facts in localStorage       │          │  stores nothing about you    │
│  ships no fetch() at all     │          │                              │
│                              │          │                              │
│  registerTool(predicate, {   │  ──────▶ │  getTools({fromOrigins:[…]}) │
│    exposedTo: [AGENT]        │          │        │                     │
│  })                          │  ◀────── │  executeTool(tool, jsonStr)  │
│                              │          │        │                     │
│  execute() runs HERE.        │          │        ▼                     │
│  returns "yes", not a file   │          │  registerTool(applicant_*) ──┼──▶ ChatGPT
└──────────────────────────────┘          └──────────────────────────────┘
```

**Why the proxy layer exists**, measured rather than assumed: a document's own
`getTools()` does not include tools registered by a cross-origin iframe, even one
carrying `allow="tools"`. They surface only through `getTools({fromOrigins})`,
which an external agent does not call for you. So the letting agent must
re-register a tool of its own that forwards.

That constraint turned out to be the honest shape of the thing. The agent's tool
list is *exactly* the set of capabilities you granted, and revocation is visible
in it.

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## What Chrome actually does

Everything below was produced by running the code in Brave 152 (Chromium 152) and
reading the result. Full write-up with reproduction steps in
[docs/CHROME-FINDINGS.md](docs/CHROME-FINDINGS.md).

**`getTools()` returns `inputSchema` as a string. `registerTool()` demands an
object.** Passing a borrowed schema straight back fails with *"Failed to convert
value to 'object'"*. A federated tool cannot be round-tripped without a
`JSON.parse` in between. We have not found this recorded anywhere else, because
reproducing it needs two origins trading tools.

**`getTools({fromOrigins})` widens, it does not filter.** With 6 local tools and 9
exposed by the vault it returned 15. Filtering on each handle's `origin` is the
only way to tell a borrowed capability from your own.

**Federation is scoped to the frame tree.** A vault open in a separate tab is not
discoverable, which is why the vault is embedded rather than linked.

**`toolchange` fires once per registration.** Granting nine permissions emits nine
events in milliseconds; without debouncing the intermediate passes try to register
names that are already taken.

**`provideContext` does not exist.** It is in the explainer and not in the
browser. `document.modelContext` exposes exactly `registerTool`, `getTools`,
`executeTool` and `ontoolchange`.

We also depend on the divergences catalogued by
[`jagreehal/webmcpable`](https://github.com/jagreehal/webmcpable) and confirmed
them here: a thrown `Error` reaches the agent as a bare `UnknownError` with the
message discarded, a returned `{content:[…]}` wrapper arrives as raw JSON, and
`executeTool` rejects an object argument. Every `execute` in this repository
returns a plain string, and every failure is a returned `"Error: …"` string so the
agent can read it and retry.

---

## Security posture

- The vault ships **no `fetch` call**. Grep for it.
- `exposedTo` is fed from an **allowlist**, never a free text field, so a page
  cannot talk you into granting to an origin you did not choose. Any grant to a
  non-allowlisted or insecure origin is dropped when the record is read, not just
  when it is written, so a tampered `localStorage` cannot widen access.
- Every predicate carries `readOnlyHint: true` and `untrustedContentHint: true`.
  The answers derive from user-entered facts and cross an origin boundary, which
  is exactly the case the hint exists to mark.
- `MAX_RENT_MULTIPLE` bounds the range an agent may probe, because a threshold
  predicate called repeatedly with different thresholds is a binary search for
  the underlying number. This is the real limit of the approach and it is bounded
  in code rather than waved away.
- Schema constrains loosely, code validates strictly. Chrome does not enforce
  JSON Schema before calling `execute`, so every predicate re-checks its inputs.

## Tests

```sh
npm test    # 44 tests, 0 failures
```

Covering threshold behaviour at the exact boundary, calendar-month arithmetic,
rejection of dates that `Date.parse` silently rolls, allowlist enforcement,
tampered-record recovery, disclosure arithmetic, verdict parsing that is not
fooled by a clause containing the opposite word, and the schema normalisation
that federation depends on.

## Layout

```
vault/    the renter's origin — facts, predicates, grants, ledger, tool registry
host/     the letting agent's origin — listings, federation, assessment, graph
tools/    serve both origins; keep the origin map in sync between them
tests/    unit tests
docs/     architecture, and what Chrome actually does
```

All data in this repository is synthetic. No real person's information appears in
it, and the vault is seeded with an invented renter so the demo has something to
answer about.
