# Architecture

Media Tracker is a single-owner application with an API-backed React interface and SQLite storage on Cloudflare D1.

## Request and trust boundaries

The production Worker authenticates dynamic requests before delegating to Vinext. Cloudflare Access mode verifies a signed JWT using a configured team issuer and audience, then compares the normalized email hash with the configured owner hash. The signing-key URL is derived from trusted operator configuration, never token-supplied URLs. Missing configuration or credentials fail closed. Sites mode is an explicit alternative for deployments behind its managed identity dispatcher.

Every API route also calls its server-side guard before database initialization. Write routes enforce JSON where appropriate, bounded streamed bodies, same-origin browser requests, and rate windows. A caller cannot expand permitted origins by supplying forwarding headers. Responses use private/no-store caching for dynamic paths, security headers, and no-referrer policy. The app uses ordinary image elements, so the unused server-side image optimization proxy is disabled.

Local development bypass is available only outside production, with no auth mode configured, for loopback request hosts. The default development server binds to loopback. It is not a remote hosting configuration.

## Domain modules

| Module | Role |
|---|---|
| `media.ts` | Shared media types, parsing, labels, and utilities |
| `continuation.ts` | Derive further-content notices from explicit completion scope and catalog installments |
| `myanimelist.ts`, `kitsu.ts`, `imdb.ts` | Provider-specific search and metadata adapters |
| `metadata-provider.ts` | Endpoint allowlist, bounded retries/timeouts, typed failures, circuit state |
| `provider-health.ts` | Durable provider health and cooldown information |
| `media-metadata.ts` | Combine catalog data and fail-soft enrichment; coalesce identical in-flight syncs |
| `api-security.ts`, `request-validation.ts` | Authorization, rate windows, origin and input validation |
| `collections.ts`, `data-export.ts` | Ordered collections and portable exports |

## Catalog resilience

Anime/manga use official MAL when configured, then Jikan, with Kitsu available for emergency catalog coverage and installment lineage. AniList can enrich schedules independently. Television uses TVmaze show/episode/season records. Movies/games use Wikipedia and Wikidata. IMDb enrichment is optional and requires a licensed subscription.

Sync batches accept up to eight titles and process two concurrently. Jikan has its own serialized request limiter. The shared HTTP client applies timeouts, bounded retries, and local/persisted circuit breakers. A 429 opens the cooldown immediately rather than retrying before Retry-After. Failures retain prior saved metadata. The provider-health surface reports recent observations, not a continuous availability guarantee.

Identical in-flight sync work is shared within an isolate; this is not a distributed global lock. Optimistic timestamp conditions prevent a slow sync response from rolling back an edit made while that response was pending. No queues, Redis service, or unbounded concurrency are used.

## Database and migrations

Drizzle schema describes media items, ordered collections, membership joins, audit/security records, provider health, rate windows, and application metadata. Foreign keys cascade membership deletion. Relevant library and maintenance columns are indexed.

The runtime initializer creates missing tables and adds historical metadata columns. It inserts only the built-in collection definitions, preserves saved media, and caches readiness within an isolate. A version marker provides the one-query cold-start fast path for an up-to-date database. Retention maintenance is gated by a daily marker.

The SQL migration chain and runtime initializer are both tested against real SQLite. They are alternative bootstrap paths for an empty database; historical ALTER migrations should not be rerun against an already initialized schema. There is no destructive rollback or automatic database export in repository source.

## Interface

The client loads the owner's library and collections, memoizes filtering/sorting, debounces and aborts discovery, and refreshes stale eligible series in bounded batches. Personal status remains explicit. Continue Watching currently also includes manually in-progress titles alongside finished titles with further content; the distinct In Progress collection remains available. Queue hide/pin/snooze controls are roadmap work.

The main tracker component remains large. Supporting exports, reminders, dialog focus, and domain/provider logic are separate, but a fuller UI split is planned. This release preserves the interaction model instead of combining a public-release audit with a redesign.

## Verification boundaries

Unit/behavior tests use provider mocks; cryptographic tests generate temporary real key pairs. SQLite tests execute actual bootstrap/migration SQL and check preservation and cascades. Rendered-artifact tests exercise the built Worker boundary and shell. Dependency audits are point-in-time advisory checks.

The release does not claim a penetration test, continuous provider uptime, complete WCAG conformance, or validation of an operator's real Cloudflare account and Access policies. Browser pixel/keyboard QA and operator-hosted end-to-end authentication checks should accompany deployment.
