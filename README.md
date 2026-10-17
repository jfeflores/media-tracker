# Media Tracker

A private, single-user library for anime, TV, manga, films, and games. Track progress, organize collections, rank favorites, and find out when a finished series has more to watch.

Built with React, TypeScript, Vinext, Cloudflare Workers, D1/SQLite, and Drizzle ORM. The open-source edition starts with an **empty library**. It includes no personal watchlist, ratings, credentials, or database exports.

## What it does

- Track watchlist, in-progress, finished, on-hold, and dropped titles.
- Maintain priorities, personal ratings, tier rankings, reviews, notes, and reminders.
- Create custom collections, reorder navigation, and assign titles to multiple collections.
- Remember library sorting; show newly added titles and added/modified timestamps.
- Derive continuation notices for finished anime/TV with further released or confirmed installments. User statuses remain under user control.
- Search catalogs and refresh metadata through bounded concurrency, retries, circuit breakers, and provider-health reporting.
- Export a versioned JSON backup or spreadsheet-safe CSV from Security Center.
- Use a responsive dark interface with keyboard dialog navigation and touch alternatives to collection dragging.

## Run locally

Requires **Node.js 24+**, npm, and Git. No provider credentials or hosting account are needed for local use.

```sh
git clone https://github.com/jfeflores/media-tracker.git
cd media-tracker
npm ci
npm run dev
```

Open the loopback URL printed by Vite (normally `http://127.0.0.1:5173`). The local Cloudflare emulator keeps your database in ignored `.wrangler/` state; schema initialization is automatic. Do not delete that directory unless you intend to reset the local library.

Development access without sign-in is restricted to loopback. Keep the development server on the default loopback interface; use authenticated production hosting for remote access.

Optional runtime credentials belong in an ignored `.dev.vars` file. Copy the key names from [.env.example](.env.example); leave the auth variables absent for ordinary loopback development.

## Deploy your own instance

Use [the deployment guide](docs/DEPLOYMENT.md). Standalone Cloudflare Workers use **Cloudflare Access JWT verification** and an explicitly configured owner hash. Production fails closed when required authentication configuration is missing. A separate `sites` mode supports managed Sites deployments behind their trusted identity gateway.

This is a single-owner application. Do not expose one database as a multi-user service: shared accounts, tenant isolation, and public sign-ups are outside its design.

## Metadata sources

| Media | Sources | Configuration |
|---|---|---|
| Anime and manga | Official MyAnimeList, public Jikan fallback, Kitsu fallback/lineage; optional AniList enrichment | MAL client ID is optional |
| Television | TVmaze catalog, episodes, seasons, and schedules | No key required |
| Movies and games | Wikipedia descriptions/images and Wikidata identifiers | No key required; matches may need manual correction |
| IMDb enrichment | Optional licensed AWS Data Exchange adapter | Separate subscription and server-side credentials required |

Search terms and catalog IDs are sent to these services during discovery and sync. Artwork loads from external hosts. API availability, metadata accuracy, and third-party content rights are governed by each provider. See [privacy](docs/PRIVACY.md) and [attribution](THIRD_PARTY_NOTICES.md).

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run check:privacy
npm audit
```

`npm test` builds the actual Worker and then runs the test suite. `npm run test:unit` reuses an existing build. Tests cover provider failures/fallbacks, continuation rules, authentication and signed tokens, body/origin validation, exports, real SQLite setup/migrations, collections, and the rendered Worker shell. CI runs the same core checks and dependency auditing.

The privacy check inspects tracked/staged files and prints categories without matched values. Run `node scripts/check-privacy.mjs --history` before a public release. It complements manual review; it is not a guarantee that a repository is free of every possible secret.

## Project map

| Path | Responsibility |
|---|---|
| `app/components/` | Library UI, reminders, export controls |
| `app/api/` | Protected media, collection, sync, export, and diagnostic endpoints |
| `app/lib/` | Domain rules, provider adapters, authentication, request safeguards |
| `db/` and `drizzle/` | D1 schema, additive runtime initialization, SQL migrations |
| `worker/` | Production authentication boundary and response security headers |
| `tests/` | Behavioral, database, security, and rendered-artifact checks |
| `docs/` | Architecture, deployment, privacy, release audit, and roadmap |

Read the [architecture](docs/ARCHITECTURE.md), [release audit](docs/RELEASE_AUDIT.md), and [roadmap](docs/ROADMAP.md) for implementation choices and known limits.

## Current limits

- Reminders are in-app; there are no push notifications or always-on background jobs.
- Franchise discovery is best-effort; split seasons, remakes, specials, and films can need manual scope correction.
- Movies and games currently use less structured catalog search than anime and TV.
- JSON export is available; an import/restore interface and recoverable deletion are future work. Keep backups before bulk edits or upgrades.
- The full library is loaded client-side; server-side pagination is deferred until measured library sizes justify it.
- Browser visual/accessibility testing and a real operator-hosted Access deployment remain separate verification tasks.

## Contributing and license

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues through [SECURITY.md](SECURITY.md).

MIT licensed. The build integration retains its upstream MIT notice. Provider content and third-party packages retain their own licenses. This project is AI-assisted.
