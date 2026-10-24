# Media Tracker

A private, single-owner library for anime, television, manga, films, and games.

Media Tracker combines progress tracking, custom collections, personal rankings, and catalog metadata in one self-hosted application. It can also flag further installments for a finished series while keeping your own completion status under your control.

A fresh installation starts with an empty media library. Built-in collection definitions are created automatically.

## Features

| Area | What you can do |
| --- | --- |
| Library | Track titles as watchlist, in progress, finished, on hold, or dropped; record progress, priorities, ratings, reviews, notes, and tags. |
| Collections | Create custom collections, assign a title to multiple collections, and reorder navigation using drag or touch-friendly controls. |
| Rankings | Organize tier rankings and sort/filter the library by its saved fields. |
| Continuations | Review further-content notices based on released or confirmed installments and your recorded completion scope. |
| Discovery | Search supported catalogs, choose a match, and refresh metadata without replacing personal status. |
| Reminders | Set dates and review them in the in-app reminder center. |
| Exports | Download versioned JSON or spreadsheet-safe CSV from Security Center. |
| Interface | Use responsive dark layouts, saved sorting preferences, and keyboard-aware dialogs. |
| Diagnostics | Inspect metadata-provider observations and application security metrics. |

This application organizes a media library; it does not stream, host, or download the media itself.

## Technology

| Layer | Implementation |
| --- | --- |
| Interface | React 19, TypeScript, CSS/Tailwind tooling, Lucide icons |
| Application runtime | Vinext, Vite, and App Router-style routes |
| Hosting and storage | Cloudflare Workers, D1/SQLite, Drizzle ORM |
| Hosted access | Cloudflare Access JWT verification or a managed Sites identity gateway |
| Verification tools | TypeScript, ESLint, Node.js tests, SQLite/Worker integration checks, privacy checks |

## Run locally

### Requirements

- Git
- Node.js 24 or newer
- npm

Ordinary loopback development does not require a hosting account or provider credentials.

```sh
git clone https://github.com/jfeflores/media-tracker.git
cd media-tracker
npm ci
npm run dev
```

Open the loopback URL printed by Vite, normally [http://127.0.0.1:5173](http://127.0.0.1:5173).

The local Cloudflare emulator stores D1 state in the ignored `.wrangler/` directory. Schema initialization runs automatically and creates the built-in collections without adding media. Deleting that directory resets the local database.

The development server binds to loopback. Its development access bypass applies only outside production, with no authentication mode configured, for loopback request hosts. Remote access requires an authenticated hosting setup.

### First use

1. Add a title manually or search a catalog and choose a result.
2. Set its status, progress, and any rating, notes, or completion scope.
3. Create a collection or assign the title to an existing one.
4. Refresh metadata when needed and review any continuation notice.
5. Export JSON from Security Center before bulk edits or upgrades.

## Configuration and deployment

Optional runtime values belong in an ignored `.dev.vars` file or hosting secrets. [`.env.example`](.env.example) documents the supported variable names; leave authentication variables absent for ordinary loopback development.

| Variable | Purpose |
| --- | --- |
| `MEDIA_TRACKER_AUTH_MODE` | Hosted mode: `cloudflare-access` or `sites` |
| `MEDIA_TRACKER_OWNER_HASH` | SHA-256 of the configured owner's trimmed, lowercased email; generate with `npm run owner:hash` |
| `CF_ACCESS_TEAM_DOMAIN` | Trusted Cloudflare Access team issuer for standalone hosting |
| `CF_ACCESS_AUD` | Access application's expected audience |
| `MYANIMELIST_CLIENT_ID` | Optional official MyAnimeList catalog access |
| `IMDB_*` | Optional licensed AWS Data Exchange integration; see the template and deployment guide |

Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the complete setup. It covers your own D1 database, domain, Access application, owner identity, secrets, build configuration, and deployment checks.

For standalone hosting, copy [`wrangler.example.jsonc`](wrangler.example.jsonc) to your ignored local `wrangler.jsonc` and configure your own resources. Build before deploying, and use the generated `dist/server/wrangler.json` configuration as described in the guide.

Each deployment is designed for one owner and one library. Production requests require the configured authentication mode and owner. Managed `sites` mode relies on trusted platform identity headers and is intended for that hosting gateway.

The runtime database initializer and the historical SQL chain are alternative bootstrap paths. Do not apply the entire migration chain to a database that the runtime has already initialized; historical ALTER statements are not idempotent.

## Catalog providers

| Media or enrichment | Sources | Credentials |
| --- | --- | --- |
| Anime and manga | Official MyAnimeList when configured, Jikan fallback, Kitsu fallback and installment lineage | MAL client ID is optional |
| Anime scheduling | Optional AniList enrichment | No key configured by this app |
| Television | TVmaze search, episodes, seasons, and schedules | No key required |
| Movies and games | Wikipedia descriptions/images and Wikidata identifiers | No key required |
| IMDb enrichment | Optional AWS Data Exchange adapter | Separate licensed subscription and complete server-side configuration required |

Discovery and refresh requests send search terms, titles, or catalog IDs to the relevant providers. Artwork loads from external hosts. Availability and matching quality depend on those services, and movie/game results may need manual correction.

Metadata sync processes up to eight title IDs per request with two concurrent workers. Provider timeouts, bounded retries, cooldowns, and circuit breakers limit repeated failures. Failed syncs retain saved metadata, and timestamp checks protect edits made while a refresh is pending.

Continuation notices are best-effort. Split seasons, remakes, specials, and related films can require manual completion-scope adjustments. Provider-health indicators reflect recent observations rather than continuous monitoring.

## Data and privacy

Library records, progress, reviews, notes, reminders, collection membership, and catalog metadata are stored in the deployment's D1 database. Browser local storage is used for sorting preferences rather than a second copy of the full library.

JSON exports contain media records and collection structure. CSV exports provide a readable subset and escape cells that could be interpreted as spreadsheet formulas. An import/restore interface is not implemented.

The source does not automatically publish your library or send it to an AI service. Hosting authentication, catalog requests, external artwork, and operational logs have separate data flows. See [`docs/PRIVACY.md`](docs/PRIVACY.md) for details.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the loopback development server |
| `npm run build` | Build the Worker application |
| `npm run start` | Start the built application with Vinext |
| `npm run typecheck` | Check TypeScript |
| `npm run lint` | Run ESLint |
| `npm test` | Build, then run the Node.js test suite |
| `npm run test:unit` | Run the tests using the existing build |
| `npm run check:privacy` | Check tracked/staged content for the privacy script's patterns |
| `npm run check` | Run privacy, type, lint, and build-backed test checks |
| `npm run owner:hash` | Generate the hosted owner's identity hash |
| `npm run db:generate` | Generate a Drizzle migration after schema changes |

Before publishing changes:

```sh
npm run check
node scripts/check-privacy.mjs --history
npm audit
```

CI installs with `npm ci`, checks reachable history for the privacy script's patterns, runs types/lint/tests, and audits production dependencies.

The tests cover provider fallbacks, continuation rules, signed-token authentication, request validation, exports, collections, real SQLite initialization/migrations, and the built Worker boundary. Provider tests use controlled fixtures; they do not verify live catalog accuracy or an operator's deployed Access policy.

## Repository layout

```text
app/
  components/             Library interface, reminders, and exports
  api/                    Media, collections, discovery, sync, and diagnostics
  lib/                    Domain logic, providers, authentication, request guards
  hooks/                  Shared dialog focus handling
db/                       D1 access, schema, and additive runtime initialization
drizzle/                  Historical SQL migration chain
worker/                   Hosted authentication boundary and response headers
scripts/                  Build, privacy, and owner-configuration helpers
tests/                    Behavioral, SQLite, and Worker checks
docs/                     Deployment, architecture, privacy, and roadmap
```

## Current limits

- Reminders appear in the app; push notifications and always-on background jobs are not implemented.
- Metadata matching and franchise continuation detection can need manual correction.
- Export is available; restore/import, recoverable deletion, and a dated watch-history diary remain future work.
- The full library is loaded client-side. Server-side pagination is not implemented.
- Hosted authentication and mobile/keyboard behavior should be verified for your own deployment. Existing tests do not establish complete accessibility coverage.

Read [the architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and [historical release audit](docs/RELEASE_AUDIT.md) for implementation choices and verification boundaries.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Keep changes focused on private library management and preserve saved data and explicit user statuses. Report security concerns through [`SECURITY.md`](SECURITY.md).

This project is AI-assisted.

## License and attribution

Copyright (c) 2026 Media Tracker contributors.

Project code is licensed under the [Apache License, Version 2.0](LICENSE). The upstream Sites build helper retains its [MIT notice](build/sites-vite-plugin.LICENSE). Third-party packages and provider content retain their own terms; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
