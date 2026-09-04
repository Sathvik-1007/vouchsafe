# Bureau

**The letting agent gets an answer, not your life.**

Try it at <https://bureau-lettings.vercel.app>. If you would rather not take any
of this on trust, <https://bureau-lettings.vercel.app/proof.html> reads the
browser's own tool registry, live, on both origins, and lets you watch a
permission stop existing.

Video: VIDEO_URL. The tool contract is in [TOOLS.md](TOOLS.md). MIT licensed,
115 tests, and no runtime dependencies at all.

To rent a flat in Britain you upload your payslips, your bank statements and
your passport to six letting agents, who keep them forever. None of them wanted
your salary. They wanted one bit: is annual income at least three times annual
rent, yes or no.

Bureau is that bit. Your facts live on your own origin and never leave your
browser. A letting agent borrows the *capability to ask*, gets back a word, and
holds nothing.

## Ask it something

Open the live URL in ChatGPT's browser (⌘⇧B, then Settings, Browser,
Permissions, Enable site tools), or in Chrome 149+ with the
[Model Context Tool Inspector](https://chromewebstore.google.com/detail/gbpdfapgefenggkahomfgkhfehlcenpd).
Then, in this order:

> **"What have you got, and would I qualify for the Wilbraham Road flat?"**

It will tell you it cannot check anything yet, and name what it needs. Allow the
nine questions in the panel on the right, then ask again. Nine cross-origin
calls, nine one-word answers, no documents.

> **"What do you actually know about me?"**

*"Stored about the applicant: nothing."*

Now the part worth watching. Press **Withdraw** on *Does your income cover the
rent?* and ask it to check again:

> **"Check the Wilbraham Road flat again."**

The tool is gone from its list mid-conversation. Not refused. **Gone.** Authority
here is enforced by whether the tool exists, not by a permission check inside
it, so a withheld question cannot be called, guessed at, or talked into
existence by anything written into a page or a prompt.

There are three sample applicants in the file panel. Ama qualifies for the
Chorlton flat, Dele only for the Old Trafford studio, Priya only for the Whalley
Range terrace, and the Ducie Street conversion suits nobody. Switch between them
to see a yes, a no and a not-yet without editing a field.

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

**Authority is tool existence, not a permission check.** Before you allow a
question there is no tool to call, so there is nothing for a prompt injection to
talk into running. This is the property `exposedTo` gives you and a server-side
permission flag cannot.

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

**No agent at all?** Press **Watch how it works** on the live site. It runs the
whole argument in about forty seconds, against both real origins, calling the
same tools an agent would. Nothing is faked or replayed, so if federation were
broken the demo would visibly fail.

One detail worth noticing while it runs: the demo cannot grant itself anything.
The vault ignores every request from the letting agent's page unless you tick
the switch inside the vault panel first. A demonstration of a consent model is
worth nothing if the consent model is suspended while it plays.

**In Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing`, open the live
URL, and use *DevTools → Application → WebMCP* to call every tool by hand. The
[Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) works too.

**Locally:**

```sh
git clone https://github.com/Sathvik-1007/bureau-webmcp
cd bureau-webmcp
npm test          # 115 tests: 65 unit, 50 in a real browser
./tools/serve.sh  # two origins, :4001 and :4002
```

Then open `http://localhost:4002` in a WebMCP-capable browser. Both ports are
secure contexts, so the full cross-origin flow works locally.

---

## The tool surface

**31 tools across two origins**, and which ones exist depends on what you granted.

### The vault: 13 questions it will answer

In `vault/lib/predicates.js`.

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

### The vault: 12 tools only you can reach

In `vault/lib/registry.js`.

Registered with no `exposedTo`, so they are same-origin and a letting agent cannot
touch them however many predicates it holds. This is what lets you say *"revoke
everything from Marlow and Reed"* to your own agent:
`vault_list_predicates`, `vault_list_grants`, `vault_grant`, `vault_revoke`,
`vault_revoke_all`, `vault_disclosure_report`, `vault_compare_disclosure`,
`vault_explain_permission`, `vault_probe_report`, `vault_read_ledger`,
`vault_update_fact`, `vault_known_origins`.

### The letting agent: 6 of its own, plus one proxy per permission

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

**A form with `toolname` becomes a tool, and Chrome writes its schema.** We
supplied no schema for the file editor; Chrome read the fields and produced one,
turning a `<select>` into an enumeration by itself. Leaving off
`toolautosubmit` then parks the agent's call until a person presses Save, which
is a human-in-the-loop gate the imperative API has no way to express.

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

## The attack we did not wave away

A yes-or-no permission leaks one bit. But the caller picks the threshold, so it
can ask again:

```
rent 2000, multiple 3  ->  no    income is under   72,000
rent 1500, multiple 3  ->  no    income is under   54,000
rent 1300, multiple 3  ->  no    income is under   46,800
rent 1200, multiple 3  ->  no    income is under   43,200
rent 1175, multiple 3  ->  no    income is under   42,300
rent 1160, multiple 3  ->  Error: Refused. 5 different thresholds have already
                                  been tested against income_meets_multiple.
```

Every one of those answers was a legitimate single bit from a permission the
renter granted. The **sequence** is a salary disclosure wearing a predicate's
clothes, and the grant system cannot see it, because each call is authorised.

So the vault tracks the bracket each origin has established per predicate,
prices what it has worked out in bits, refuses once the search has gone far
enough, and tells the renter who is doing it. That transcript above is real
output from the running app. An identical threshold asked twice is a retry and
is never penalised; probes age out after fifteen minutes; one origin probing
does not obstruct another. All of it is in `vault/lib/probe.js` with 11 tests.

**What this does not claim.** It does not make threshold predicates leak-proof.
A patient caller spread across sessions, or several colluding origins pooling
answers, defeats a per-origin window. Adding noise to the answers would bound
the leak properly and would also make a legitimate affordability check
occasionally wrong, which a letting decision cannot absorb. This is the cheap
honest version: it stops the obvious attack and says plainly that it does not
stop every one.

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
npm test    # 115 tests, 0 failures
```

**65 unit tests** cover threshold behaviour at the exact boundary, calendar-month
arithmetic, rejection of dates that `Date.parse` silently rolls, allowlist
enforcement, tampered-record recovery, disclosure arithmetic, verdict parsing
that is not fooled by a clause containing the opposite word, and the schema
normalisation federation depends on.

**50 end-to-end tests** drive a real Chromium with WebMCP, serve both origins,
and click every control. They assert on three surfaces that can disagree, and a
bug that matters here is exactly a disagreement between them: the DOM, the
browser's own tool registry, and what the *other* origin can see across the
boundary. They also hold the quality floor: every control keyboard-reachable and
named, focus visible under a real Tab press, no sideways scroll at 390px, body
contrast above 4.5:1, motion dropped under `prefers-reduced-motion`, both
typefaces actually loaded, and zero third-party requests from either origin.

That suite found two real bugs on its first run, both invisible to unit tests:

- the dev origins were hardcoded, so neither app could be served on another port;
- the host told the vault to trust `hostOrigin()` rather than `location.origin`,
  which differ the moment it is served anywhere unexpected. Naming the wrong
  origin exposes nothing at all, with no error on either side. It is the worst
  failure mode in this API and we had shipped an instance of it.

## The design

A letting reference is a document where everything about you is legible to a
stranger. So the interface is that document with everything blacked out but the
answer, and the redaction bar is the signature device rather than another panel
border.

Fraunces carries voice, Public Sans carries instruction, and both are
self-hosted so neither origin makes a third-party request at runtime. The
affirmative stamp is violet rather than green, because red and green as a pair
collapse for red-green colour deficiency and a consent screen is the wrong place
to encode meaning in that pair alone. There is one orchestrated motion, the
redaction wipe and the stamp, played on change and dropped entirely under
`prefers-reduced-motion`.

Embedded in the letting agent's page the vault drops its explanatory sections
rather than shrinking them, because the reader has already been told what it is
by the page around it and needs the controls immediately.

## Layout

```
vault/    the renter's origin: facts, predicates, grants, ledger, tool registry
host/     the letting agent's origin: listings, federation, assessment, graph
tools/    serve both origins; keep the origin map in sync between them
tests/    unit tests
docs/     architecture, and what Chrome actually does
```

All data in this repository is synthetic. No real person's information appears in
it, and the vault is seeded with an invented renter so the demo has something to
answer about.
