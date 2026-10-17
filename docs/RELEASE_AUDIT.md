# Open-source release audit

Audit date: October 16–17, 2026. This review prepares the single-owner Media Tracker for public source distribution and portfolio review.

## Scope and method

The baseline was the current private hosted checkpoint. Its 101 tracked files and all 14 reachable commits were inspected, including every historical text blob. The production build, TypeScript check, lint, and original 38 tests passed. Source and history were checked for names, emails, account/project identifiers, credentials, private keys, signed tokens, credentialed URLs, private seeds, generated files, and workstation paths. The review also traced authentication, API writes, provider fetches, exports, database setup, client rendering, logging, and deployment configuration.

Remediation in this document applies to the separate open-source release copy. The original hosted deployment, its audience, and its production database were not changed during release preparation. No production library rows, raw operational logs, or real backups were copied into the release. Runtime secret metadata was inspected; the service redacts secret values. This is not a claim to have verified a redacted credential's value.

The dedicated Codex Security scanning server was not available in this environment. This audit used direct source/history review, redacted pattern scans, current dependency advisories, cryptographic/behavioral tests, real SQLite execution, and compiled-Worker checks. It was not an independent penetration test, and no review can establish the absence of every possible defect or secret.

## Release decision

Personal data and deployment-specific source must not be published with the original repository history. The release therefore starts from a fresh repository containing a sanitized, empty-library application, with a generic contributors/noreply commit identity.

Current production dependency audit: **zero known advisories** after remediation. A build-tool-only dependency advisory remains and is documented below. Production deployment still requires an operator-owned authentication gateway and database configuration. The public repository does not provide access to the original owner's tracker.

## Privacy findings and disposition

| Finding | Risk before release | Disposition |
|---|---|---|
| Personal watch-history seed records | Disclosed watched titles, completion states, progress, notes, and interests | Removed the seed module and all automatic media insertion from the release initializer |
| Personal tier assignments | Disclosed ranked preferences and unfinished favorites | Removed assignments and seed-specific tests |
| One-time watchlist import | Disclosed queued interests, shorthand aliases, and progress | Removed the complete import and its trigger/state logic |
| Personal records embedded in initial SQL migration | Reintroduced a private starter watchlist even after removing the TypeScript seed | Removed those INSERT records; verified the complete migration chain starts empty |
| Tests repeating private preferences | Leaked data through test assertions even if the app started empty | Removed seed-only tests and used fictional provider/database fixtures |
| Private Site identifier | Connected the distributed source to a registered private deployment | Removed it; retained only generic binding names and a new-instance configuration template |
| Private repository history | Allowed recovery of removed private fixtures | Did not copy or publish the private Git directory or commits |
| Git author/committer metadata | Could disclose an email when creating the public history | Prepared the new commit with a generic contributors name and GitHub noreply email; publication must recheck remote commit metadata |
| Generated font CSS/cache | Contained absolute environment paths and bundled font files without their release notice | Omitted generated caches and used system fonts |
| TypeScript incremental cache | Contained machine-specific paths and unnecessary generated metadata | Removed; ignored future `*.tsbuildinfo` |
| Starter/example endpoints and assets | Added unrelated surfaces and attribution noise | Removed unused examples and unused starter artwork |
| README and setup text | Referenced a private managed environment instead of a usable installation | Replaced with project-specific local/deployment instructions |
| Environment/config files | Could accidentally include credentials or binding/account details | Only blank key templates and placeholder local hosting config are included; real files are ignored |
| Real screenshots, logs, exports, databases, archives | Could disclose notes, user identity, access credentials, or library contents | No real user artifact is included; release archive is generated from the reviewed commit only |
| Profile information in server HTML | Could serialize an authenticated name/email into a page or capture | Public edition renders a generic profile; built-shell test checks profile values are absent |
| Raw exception logging | Could expose queries, request URLs, database values, or signed SDK details | Relevant API failure logs report safe error names; provider failures use bounded provider/code/status fields |
| Backup/export privacy | Exports intentionally contain private user data | Documented; exports remain owner protected, downloadable, and private/no-store |
| Hashes in audit/configuration | Unsalted email hashes are guessable pseudonyms | Kept in runtime configuration/database, excluded from exports/repository, and described accurately in privacy docs |

No recognizable real credential tokens, private key blocks, or signed JWTs were found in the reviewed tracked source/history. This statement is bounded to the inspected material; it does not cover unrelated accounts, local files outside the project, or redacted runtime secret values. Revocation was not necessary based on the source findings, and no credentials were rotated.

The new privacy check scans working and staged tracked bytes and can inspect all reachable Git objects and commit emails. It rejects common credential/token patterns, private deployment IDs, private media-seed identifiers, workstation paths, non-example emails, populated environment templates, populated library exports, and binary/database content. Findings print categories/file paths without matched values. `.gitignore` additionally covers local credentials, D1 state, backups, logs, build output, and common export names. Manual review remains necessary for formats and secrets a pattern scanner cannot understand.

The owner's public GitHub username and normal GitHub account/repository metadata will remain visible by design. Public source distribution cannot make the repository owner's platform identity anonymous.

## Security and correctness changes

| Area | Verified issue or release concern | Correction |
|---|---|---|
| Standalone identity | Managed sign-in headers alone could be forged on a generic host | Added explicit authentication modes; standalone mode verifies Cloudflare Access JWT signatures/issuer/audience/expiry/algorithm/claims; unconfigured production fails closed |
| Page protection | A signed-in shell did not independently establish owner authorization | Worker checks owner authorization before every dynamic page/API request; route guards provide a second boundary |
| Development bypass | A broadly reachable development deployment could accept anonymous requests | Default server binds to loopback and development bypass checks the loopback request host; production cannot select a local bypass |
| Initialization ordering | Unauthorized API requests could trigger schema work before denial | Authorization now precedes schema initialization |
| Request body size | Checking after `request.text()` allowed the whole body into memory | Streamed byte counting cancels over-limit bodies before buffering the remainder |
| Origin checks | Forwarded host headers enlarged the accepted write origins | Write origin is checked against the actual request URL; forged forwarding headers add no trusted origins |
| Rate buckets | Arbitrary record IDs created separate per-item budgets | Normalize item routes and use the verified owner identity rather than caller-selected email/IP input |
| CSV formulas | Leading whitespace could precede a dangerous formula prefix | Neutralize formula prefixes after whitespace/control characters while preserving JSON values |
| Discovery requests | TV/Wikipedia discovery bypassed the common timeout/retry client | Routed discovery through the bounded provider client; corrected fallback provider labels/keys |
| Provider redirects/URLs | Generic fetches could follow an unexpected host or redirect | Restrict HTTPS provider hosts, reject URL credentials/ports, and disable redirect following |
| Rate-limited providers | Retrying within a short backoff could disregard a long Retry-After | Open the circuit immediately on 429; do not retry before cooldown |
| Unused image proxy | An unused server endpoint expanded remote-fetch/parser exposure | Disabled it; the interface uses ordinary images |
| Slow sync writes | An old sync result/failure could overwrite state/timestamps after an intervening edit | Apply optimistic updated-time conditions and report a conflict while preserving newer edits |
| Installer hosting config | The starter build used a generic local binding even when an installer supplied real config | Load the installer’s ignored Wrangler config when present and declare the ASSETS binding explicitly |
| Schema initialization race | Awaiting a binding before assigning the readiness promise allowed overlapping initializers | Assign the initialization promise before awaiting the binding |
| Exception responses | Unhandled handler errors might expose inconsistent framework behavior | Add a safe Worker error response and safe-name logging |
| Headers/caching | Privacy depends on dynamic pages staying out of shared caches | Apply private/no-store dynamic responses, no-referrer, CSP, MIME/frame/permissions protections |

Parameterized SQL and explicit API field whitelists were preserved. No user-supplied SQL is executed. React text rendering is preserved; provider markup is stripped and there is no application `dangerouslySetInnerHTML` path. Collection changes stay atomic and foreign keys cascade membership removal. User statuses, personal notes, and progress remain user controlled; catalog outages retain prior saved data.

## Dependencies and licensing

The initial full-tree audit reported 26 affected package nodes, including one critical severity package. This did not establish runtime exploitability of every advisory: for example, the Windows-hosted Next.js advisory is not a claim that a Cloudflare Worker uses Windows. It nevertheless made the baseline unsuitable as the dependency set for a new public release.

The release updates affected Next.js/lint and Cloudflare tooling versions, refreshes compatible transitive fixes, and pins patched image-size and the esbuild dependency used by the legacy loader. The runtime audit is clean. Targeted overrides are recorded in package.json/package-lock.json and remain subject to build, migration-generation, and regression checks.

**Residual build-only advisory:** `braces` stack-exhaustion denial of service ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). At audit time it propagates through eight affected dependency nodes in lint/build glob tooling. No patched `braces` release was available in the registry. The audit's forced remedy would downgrade the lint framework; it does not provide a safe blanket fix for the build graph. We did not apply an unrelated downgrade or silently suppress the result.

Application request handlers do not accept arbitrary glob patterns, and this tooling is not used to serve the production library. Running build tools on an untrusted repository remains an execution trust boundary. CI uses read-only permissions and does not persist checkout credentials. Revisit this advisory when upstream tooling publishes a compatible fix; `npm audit` intentionally continues to report it. CI's production gate uses `--omit=dev --audit-level=high` and is not represented as a clean full dependency tree.

MIT licensing, contribution/security policies, and architecture/privacy/deployment documentation are provided. The upstream Sites build-helper MIT notice is retained. No posters, catalog dataset, proprietary provider content, or original generated fonts are bundled. External metadata/artwork remain subject to provider licenses/attribution; optional IMDb enrichment requires a separate licensed subscription.

References checked include the [Next.js advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36), [image-size advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99), [Cloudflare Access validation guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), and [TVmaze API terms](https://www.tvmaze.com/api).

## Verification and remaining boundaries

Local release results:

| Check | Result |
|---|---|
| Production Worker build and artifact validation | Passed |
| Installer-specific Worker package dry run | Passed with isolated placeholder database configuration; nothing deployed |
| TypeScript check and lint | Passed |
| Behavioral, cryptographic, SQLite, rendered-artifact, and Worker/D1 tests | 45/45 passed |
| Locked dependency-install dry run | Passed |
| Drizzle migration generation | No schema drift or extra migration |
| Production dependency audit | Zero known advisories |
| Full dependency audit | One documented upstream build-only advisory across eight dependency nodes |
| Tracked/staged privacy scan | Passed; final reachable-history scan is part of packaging |
| Real hosted Access deployment and visual browser QA | Not performed |

CI is configured for future GitHub runs; no remote CI result is claimed before publication.

Coverage includes:

- Production Worker build and artifact entry/binding validation.
- Strict TypeScript and lint.
- Cryptographic tests with real ephemeral keys for valid tokens, wrong signatures, wrong audiences/issuers, expired/missing claims, and disallowed algorithms.
- Production denial of anonymous, wrong-owner, spoofed-header, and unconfigured requests.
- Streamed JSON limits, origin validation, CSV escaping/formula protection, endpoint allowlists, and provider cooldown behavior.
- Actual SQLite runtime initialization and complete migration-chain execution, empty-library checks, data/order preservation, and membership cascades.
- Rendered Worker HTML without profile/preview metadata and with private cache policy.
- Actual compiled Worker/D1 CRUD, collections, exports, audit records, successful metadata writes, simulated upstream 504 preservation, and an edit arriving while metadata sync is pending.
- Full source/staged/history privacy checks and an independent final artifact inventory review.

Browser pixel-level/mobile/keyboard QA, broad penetration testing, and a real operator-hosted Cloudflare Access deployment are not claimed. Provider behavior tests use controlled fixtures, not a live uptime or catalog-correctness guarantee. JSON restore, soft deletion/undo, dated watch history, more structured movie/game providers, and fuller UI modularization remain roadmap work. Those limits are documented rather than presented as completed features.

The updated Vite/RSC tooling emits upstream source-map generation warnings during a successful build. These are retained in the audit record; debugging map accuracy is not certified. They did not prevent Worker packaging or the integration tests.
