# Devpost submission

Copy each block into the matching field.

---

## Project name

Vouchsafe

## Elevator pitch (200 characters max)

> The letting agent gets an answer, not your life. Your facts stay in your
> browser; a site borrows the capability to ask and gets one word back.

(139 characters.)

## What to type first

> "What have you got, and would I qualify for the Wilbraham Road flat?"

Then allow the nine questions, ask again, and finally withdraw one and ask a
third time. The tool is gone from the agent's list, not refused.

---

## About the project

### Inspiration

To rent a flat in Britain you upload your payslips, your bank statements and
your passport to six letting agents, who keep them forever. None of them wanted
your salary. They wanted one bit: is annual income at least three times annual
rent, yes or no.

Every other way of building this ends the same way, with a copy of your life on
someone else's server. WebMCP is the first browser primitive that offers a way
out, because a tool runs **in the page that owns the data** and returns only
what it chooses to return.

### Check it without taking our word for anything

`/proof.html` reads `document.modelContext` back out of the browser on both
origins and redraws only when the browser fires `toolchange`. It registers
nothing itself, which is what makes it a witness rather than a participant.
Press one button and it tries to call a question:

```
allowed    -> executeTool(...) -> yes (tested against 3x a rent of £1150/month)
withdrawn  -> 8 tools from that origin
              income_meets_multiple is not among them
              There is no handle to pass to executeTool.
```

No agent, no extension, no console.

### What it does

Two separate origins, and the browser is the only thing between them.

Your vault holds your facts in your own browser and registers a tool per
question you allow, using `exposedTo` to name exactly who may call it. A letting
agent's site discovers those tools with `getTools({fromOrigins})`, runs them with
`executeTool`, and republishes each one under its own name so your agent can call
them. It receives a word. It never receives a document, and it stores nothing.

Three things follow that a single origin cannot do:

**Data that answers without being sent.** The vault holds an income. The agent
can learn whether it clears a threshold and can never learn what it is.

**Authority is tool existence, not a permission check.** Before a question is
allowed there is no tool, so there is nothing for a prompt injection to talk
into running. A server-side permission flag cannot give you that; `exposedTo`
can.

**Consent you can withdraw and watch die.** Revoking aborts the vault's
`AbortController`. That fires `toolchange` in the agent's document, its
rediscovery finds the tool gone, and it drops the proxy. The agent's tool list is
one shorter, mid-sentence. Nothing was asked to cooperate.

**A disclosure budget you can count.** Every permission is priced in bits.
`income_meets_multiple` costs 1. `disclose_exact_income` costs 9.8. The standard
letting check is nine permissions and nine bits, against roughly 122 bits and 37
unasked-for facts in the documents it replaces. The meter is computed from log2
of the outcome space, not decorated on afterwards.

### The attack we did not wave away

A yes-or-no permission leaks one bit, but the caller picks the threshold, so it
can ask again. Five calls bracket a salary; twenty pin it. Every individual
answer is legitimate and the grant system cannot see it, because each call is
authorised.

So the vault tracks the bracket each origin has established per predicate, prices
what it has worked out in bits, refuses once the search has gone far enough, and
tells you who is doing it. Identical thresholds are retries and are never
penalised, probes age out after fifteen minutes, and one origin probing does not
obstruct another.

It does not make threshold predicates leak-proof. A patient caller spread across
sessions, or colluding origins pooling answers, defeats a per-origin window.
Noise on the answers would bound the leak properly and would also make a
legitimate affordability check occasionally wrong, which a letting decision
cannot absorb. This is the cheap honest version, and it says so.

### Why not the other ways of doing this

Two other entries reach across origins and each does half of the lifecycle.
One brokers `executeTool` calls straight across without re-registering, so the
remote capability never appears in the local tool list an agent actually reads.
Another scopes a single tool's lifetime to a review panel. A third approach
injects the WebMCP API into a remote browser before the site's own scripts
load, which is impressive and is not the standard.

Vouchsafe does the complete round trip on the standard: `exposedTo` on one side,
`getTools({fromOrigins})` on the other, local re-registration as `applicant_*`
proxies so an agent can actually see them, and `toolchange` teardown when the
permission is withdrawn. As far as we can find, nobody else republishes
discovered remote tools locally, and nobody else tears them down live.

### How we built it

Vanilla ES modules, no framework, no build step, no runtime dependency at all.
Both origins are static and deploy to Vercel. Neither makes a third-party
request, including for the two typefaces, and a test fails the build if one is
ever added.

117 tests. 58 are unit tests; 50 drive a real Chromium with WebMCP enabled and
assert on three surfaces that can disagree, which is where the bugs in this
project actually live: the DOM, the browser's own tool registry, and what the
other origin can see across the boundary. `evals.json` is written in the format
Chrome's own `webmcp-evals` harness consumes, and the same contract is asserted
in our suite because that harness resolves a browser through a hardcoded path
under `/opt` that we cannot point at the Chrome we have.

### Challenges

Cross-origin federation is barely used, so the divergences between the draft and
Chrome are undocumented. Three we hit, all measured in Brave 152 and written up
in `docs/CHROME-FINDINGS.md`:

- **`getTools()` returns `inputSchema` as a string; `registerTool()` demands an
  object.** A borrowed tool cannot be round-tripped without a `JSON.parse`
  between them. We have not found this recorded anywhere, because reproducing it
  needs two origins trading tools.
- **`fromOrigins` widens rather than filters.** With 6 local tools and 9 exposed
  it returned 15. Filtering on each handle's `origin` is the only way to tell a
  borrowed capability from your own.
- **Federation is scoped to the frame tree.** A vault in a separate tab is
  invisible, which is why it is embedded rather than linked.

`provideContext` is in the explainer and not in the browser.

The worst bug was ours. The host told the vault to trust a configured origin
rather than `location.origin`. Those differ the moment it is served anywhere
unexpected, and naming the wrong origin exposes nothing at all with no error on
either side. Our end-to-end suite caught it; no unit test could have.

### Try all three outcomes

Three sample applicants, each qualifying for exactly one of five properties, so
a yes, a no and a not-yet are all reachable without editing a field. Ama gets
the Chorlton flat. Dele, on a first job with one reference, gets only the Old
Trafford studio. Priya earns most of all and is refused by the strictest
landlord for seven months of self-employment. The Ducie Street conversion suits
nobody.

### Accomplishments

Federation works, end to end, in production, across two real origins. The
revocation is genuinely live. And the honest weakness of the whole design, the
threshold search, is bounded in code rather than left in a caveat.

### What we learned

The proxy layer looked like a workaround and turned out to be the product: the
agent's tool list is exactly the set of capabilities you granted, so revocation
is visible in it.

### What's next

Two-sided grants so a vault can lend to several agencies with different
permissions each, a signed receipt for every answer, and noise on the answers
where the domain can absorb being occasionally wrong.

---

## Built with

`javascript` `webmcp` `web-components` `vercel` `html` `css` `chrome` `model-context-protocol`

## Try it out

- https://bureau-lettings.vercel.app
- https://bureau-lettings.vercel.app/proof.html
- https://bureau-vault.vercel.app
- https://github.com/Sathvik-1007/bureau-webmcp
