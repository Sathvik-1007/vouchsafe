# Deploying

Two origins, because the whole demonstration is about a boundary between them.
Subdomains of one domain would work equally well; separate Vercel projects are
simply the fastest way to get two HTTPS origins with no DNS work.

```sh
./tools/sync-config.sh          # copy the origin map into both app roots
npm test                        # 115 tests

vercel deploy vault --prod --yes --name bureau-vault
vercel deploy host  --prod --yes --name bureau-lettings
```

Then set the two production URLs in `shared-config.js` and re-run
`./tools/sync-config.sh`, because each origin must name the other:
the vault lists the letting agent in `exposedTo`, and the letting agent lists
the vault in `fromOrigins`. **A mismatch produces an empty tool list and no
error at all**, which is the most confusing failure mode in this API.

Note on `Origin-Agent-Cluster: ?1`
----------------------------------
WebMCP is available only in origin-isolated documents. Sending
`Origin-Agent-Cluster: ?0`, or enabling `document.domain`, disables the API
outright. Vercel does not send `?0`, so this header is belt and braces: it
states the requirement rather than relying on a default staying put.
