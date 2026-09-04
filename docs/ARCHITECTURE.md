# Architecture

Two origins. The browser is the trust boundary.

    ┌─────────────────────────────┐        ┌──────────────────────────────┐
    │  VAULT ORIGIN               │        │  HOST ORIGIN (a letting site)│
    │  vouchsafe-vault.vercel.app    │        │  vouchsafe-lettings.vercel.app       │
    │                             │        │                              │
    │  facts live here, in        │        │  knows nothing about you     │
    │  localStorage, never sent      │        │  until you grant a predicate │
    │  anywhere                   │        │                              │
    │                             │        │                              │
    │  registerTool(pred, {       │        │  getTools({fromOrigins:[     │
    │    exposedTo:[HOST]         │───────▶│    VAULT ]})                 │
    │  })                         │        │       │                      │
    │                             │        │       ▼                      │
    │  execute() runs HERE        │◀───────│  executeTool(tool, json)     │
    │  returns a BIT, not a file  │        │       │                      │
    └─────────────────────────────┘        │       ▼                      │
                                           │  registerTool(proxy)  ──────▶ external agent
                                           │  (this is what ChatGPT sees) │
                                           └──────────────────────────────┘

## Why the proxy layer exists

Measured, not assumed (see docs/CHROME-FINDINGS.md): a host document's own
`getTools()` does NOT include tools registered by a cross-origin iframe, even one
carrying `allow="tools"`. Cross-origin tools surface only via
`getTools({fromOrigins:[...]})`, which an external agent does not call on our behalf.

So the host re-registers a proxy for each granted predicate. That is the whole
consent story made mechanical: the agent's tool list is exactly the set of
capabilities the human granted, and nothing else.

## Revocation

    human clicks REVOKE
      -> vault aborts that tool's AbortController
      -> tool disappears from the vault's registry
      -> `toolchange` fires on the host
      -> host re-runs discovery, finds the tool gone
      -> host aborts its proxy registration
      -> the agent's tool list shrinks, mid-conversation

No server is involved at any step.
