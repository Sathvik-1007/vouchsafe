# What Chrome actually does

Measured in **Brave 152.1.94.117 (Chromium 152.0.7977.64)** on 2026-09-03, with
`--enable-features=WebMCP`, driven over the DevTools protocol. Every claim below
was produced by running the code in `spike/` or the app itself and reading the
result, not by reading the explainer.

The published divergences between the WebMCP draft and Chrome's implementation
are catalogued by [`jagreehal/webmcpable`](https://github.com/jagreehal/webmcpable),
and this project depends on several of them. The findings in the **federation**
section below are ones we did not find recorded anywhere, because reproducing
them requires two origins exchanging tools, which almost nothing does yet.

## The API surface that exists

```js
Object.getOwnPropertyNames(Object.getPrototypeOf(document.modelContext))
// ["ontoolchange", "executeTool", "getTools", "registerTool", "constructor"]
```

`provideContext` appears in the explainer and **is not implemented**. Anything
built on it today is building on a proposal, not an API.

`window.originAgentCluster === true` in a document where WebMCP works, which is
the origin-isolation requirement the documentation describes.

## Federation

### 1. `getTools()` returns `inputSchema` as a string; `registerTool()` demands an object

This is the finding that shaped this project's architecture.

```js
const [tool] = await document.modelContext.getTools({ fromOrigins: [VAULT] });
typeof tool.inputSchema        // "string"
tool.inputSchema.slice(0, 24)  // '{"type":"object","proper'
```

Handing that value straight back to `registerTool` fails:

```
Failed to execute 'registerTool' on 'ModelContext':
Failed to read the 'inputSchema' property from 'ModelContextTool':
Failed to convert value to 'object'.
```

So a borrowed tool cannot be re-published without a `JSON.parse` in between.
`normaliseSchema()` in `host/lib/federation.js` is that parse, and it falls back
to an empty object schema rather than dropping the registration.

### 2. `getTools({fromOrigins})` returns same-origin tools as well

Passing `fromOrigins` does not narrow the result to those origins, it widens the
result to include them. With 6 local tools and 9 exposed by the vault, the call
returned 15. Every handle carries an `origin`, so filtering on it is the only
way to tell a borrowed capability from one of your own.

### 3. A cross-origin iframe's tools are invisible to the host's own `getTools()`

An iframe carrying `allow="tools"` registers successfully, and the host's plain
`getTools()` still returns `[]`. The tools appear only through
`getTools({fromOrigins: [...]})`.

The consequence is architectural. An external agent reads the top-level
document's tool list, and does not call `getTools({fromOrigins})` on the page's
behalf. For a borrowed capability to be reachable by that agent, the host must
register a proxy tool of its own that forwards to it.

### 4. Federation is scoped to the frame tree

`exposedTo` plus `fromOrigins` resolves tools registered by documents in the
calling document's frame tree. A vault open in a **separate tab** is not
discoverable. This is why the vault is embedded as an iframe rather than linked.

### 5. `toolchange` fires once per registration

Granting nine permissions emits nine events within a few milliseconds. Without
debouncing, each one triggers a full rediscovery, and the intermediate passes
see half-built tool sets and try to register names that are already taken.
`REDISCOVER_DEBOUNCE_MS` coalesces them.

### 6. Revocation propagates across the origin boundary with no channel

Aborting the `AbortController` passed to `registerTool` in the vault removes the
tool, fires `toolchange` in the host document, and the host's rediscovery finds
it gone. Measured: 15 published tools before, 14 after, and
`applicant_income_meets_multiple` absent from the host's own `getTools()`. No
`postMessage`, no server, no polling.

## Result and error handling, confirmed here

These match `webmcpable`'s published measurements and this project relies on all
of them:

| What you write | What the agent receives |
| --- | --- |
| `return { content: [{ type: 'text', text: 'x' }] }` | the wrapper as raw unparsed JSON |
| `return undefined` | the literal string `"undefined"` |
| `throw new Error('out of stock')` | `UnknownError`, message discarded |
| `annotations: { destructiveHint: true }` | discarded at registration |
| `executeTool(tool, { q: 'x' })` | fails; the second argument must be a JSON **string** |

Every `execute` in this repository therefore returns a plain string, and every
failure is a returned `"Error: ..."` string rather than a throw, so the agent can
read what went wrong and correct its arguments.

## How to reproduce

```sh
./tools/serve.sh                 # two origins on :4001 and :4002
brave --enable-features=WebMCP --remote-debugging-port=9222 http://localhost:4002/
```

Then drive it over CDP, or open `chrome://flags/#enable-webmcp-testing` and use
DevTools → Application → WebMCP to call the tools by hand.
