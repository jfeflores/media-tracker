# Privacy and data boundaries

## Repository contents

A fresh installation starts empty. The public release excludes the original user's watch history, rankings, notes, watchlist imports, database contents, owner identifiers, deployment identifiers, credentials, access policies, production logs, screenshots of real collections, generated caches, and private Git history.

Example email addresses in tests use reserved example domains. Test tokens are created at runtime with temporary signing keys. Commit identities for the prepared release use a generic contributors name and GitHub noreply address. A repository owner's public GitHub username and ordinary platform account metadata remain visible on GitHub.

`.gitignore` excludes environment files, local Worker configuration, D1 emulator databases, exports/backups, credentials/key files, logs, build output, font caches, and TypeScript caches. The privacy script checks tracked/staged content; ignored files can still contain sensitive local data and should never be force-added.

## Application data

Your own instance stores title information, progress, status, personal ratings, reviews, notes, reminder dates, collection membership, created/modified dates, catalog matches, and provider health in its D1 database.

Audit records contain the action, item/collection identifier, a SHA-256 owner-email hash, and a timestamp. These hashes are pseudonymous identifiers, not anonymized data: an email candidate can be guessed and hashed for comparison. Rate-limit keys use the verified owner's hash and a normalized route/window. Application records do not store raw owner emails or IP addresses.

Security events retain event types, normalized API paths, and timestamps. Maintenance removes expired rate windows, security events older than 90 days, and audit events older than 180 days. Maintenance is opportunistic during schema readiness checks, not a guaranteed exact-time deletion scheduler. Hosting providers and Access may independently retain operational request/authentication logs under their own policies.

The UI stores its sort preference in localStorage. It does not put the full library, tokens, credentials, email addresses, or notes there. No analytics/tracking SDK or advertising integration is included.

## External requests

| Operation | Recipient/data |
|---|---|
| Search | Applicable catalog provider receives the search term and media type |
| Metadata sync | Applicable catalog providers receive titles or provider IDs; optional enrichment can contact other providers |
| Artwork display | Your browser contacts the image host, which can observe your IP and ordinary request metadata |
| External source link | Your browser navigates to the chosen provider |
| Cloudflare Access sign-in | Cloudflare and the configured identity provider process authentication |
| Managed Sites sign-in | The managed hosting identity gateway processes authentication |

Notes, reviews, private tags, collections, owner hashes, and credentials are not included in catalog search payloads. The library is not automatically published, syndicated, or sent to an AI service. Artwork is loaded directly; there is no server-side image proxy. Referrers are disabled by Worker response policy.

Provider endpoints are HTTPS and restricted to known hosts. Redirect following is disabled in the shared catalog client to avoid carrying request details or API headers onto an unexpected origin. This host restriction also prevents following arbitrary provider-supplied links into internal networks.

## Exports and disclosure

JSON/CSV exports intentionally contain personal library data. Store them privately and inspect them before sharing. CSV is a readable subset; JSON retains the full media records and collection structure. There is no restore UI or historical watch diary yet.

Do not attach your real database, backups, `.dev.vars`, local Wrangler configuration, raw headers, signed requests, Access assertions, or populated environment files to public issues. Use fictional reproductions. Never send a maintainer an actual API key to diagnose a bug; revoke a credential if it has been disclosed.
