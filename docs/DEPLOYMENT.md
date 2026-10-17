# Deployment

Each deployment owns one library and one D1 database. The repository never connects to its original private instance.

## Standalone Cloudflare Workers

1. Run `npm ci` using Node.js 24+.
2. Authenticate your own Cloudflare account with `npx wrangler login`.
3. Create a database: `npx wrangler d1 create media-tracker`.
4. Copy `wrangler.example.jsonc` to ignored `wrangler.jsonc`, replace its database ID with the returned ID, and select your own Worker name. Configure a custom domain/route you control. Keep `workers_dev` and preview URLs disabled so there is no alternate unauthenticated hostname.
5. Create a self-hosted Cloudflare Access application for that entire hostname (`/*`) and an Allow policy restricted to your own identity. Use an interactive user identity, not a service-token-only policy. Record the application's audience (AUD) and team domain.
6. Run `npm run owner:hash` and enter the email used by that Access identity. It prints SHA-256 of the trimmed, lowercased email. The value is a pseudonymous identifier, not a password or an anonymization guarantee; keep it in runtime configuration.
7. Run `npm run build` to generate the deployment configuration from your ignored source config. Then configure these runtime secrets against that generated configuration:

```sh
npx wrangler secret put MEDIA_TRACKER_OWNER_HASH --config dist/server/wrangler.json
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN --config dist/server/wrangler.json
npx wrangler secret put CF_ACCESS_AUD --config dist/server/wrangler.json
```

Set the team domain to `https://YOUR-TEAM.cloudflareaccess.com`, without a path or query. Set `MEDIA_TRACKER_AUTH_MODE` to `cloudflare-access` (already present in the example config). No email address is committed.

8. Deploy the built Worker:

```sh
npx wrangler deploy --config dist/server/wrangler.json
```

Vite loads your ignored `wrangler.jsonc` when present and emits the production Worker configuration with your database/routes. The commands above explicitly select that generated configuration, whose asset directory and module entry are resolved by the build. Do not pass the source template directly to `wrangler deploy`; its asset binding is completed by the Vite build. Rebuild before deploying subsequent source/config changes. The template references the source Worker entry; keep that entry rather than changing it to the generated output file.

The runtime initializer creates empty tables and the five built-in collections on first authorized API use. It is additive and does not insert any user's media. Do not independently apply the complete migration chain to an already runtime-initialized database: the historical ALTER statements are not idempotent. The SQL chain is for an otherwise empty database; the runtime path handles existing schemas.

9. Verify the hostname while signed out (Access should require sign-in), then sign in as the owner, add a fictional title, edit it, create a collection, export JSON, and remove the test data. A request without a valid Access assertion must not return library data. The Worker independently checks signature, issuer, audience, required claims, expiry, algorithm, and owner membership.

The configuration template is supplied and builds locally. Provisioning a real Cloudflare account/domain/Access application is operator work and is not an automatic part of cloning this repository.

## Managed Sites

The build preserves the `sites()` integration and `.openai/hosting.json` binding declaration. Register a **new** private Site for your own deployment, store its returned project ID only in your deployment copy, and configure `MEDIA_TRACKER_AUTH_MODE=sites` plus your own `MEDIA_TRACKER_OWNER_HASH` as runtime values.

`sites` mode trusts identity headers supplied by the managed Sites dispatcher. It is inappropriate for a generic standalone Worker or reverse proxy, where a caller could forge those headers. Keep the platform's owner-only audience policy in place. The open-source template deliberately contains no registered Site identity or production database binding ID.

## Optional provider credentials

- `MYANIMELIST_CLIENT_ID`: obtain your own API client ID from [MyAnimeList API settings](https://myanimelist.net/apiconfig). Configure it as a server-side runtime value. A client secret is not needed for read-only catalog lookups. Without a client ID, public fallback catalogs remain available.
- The `IMDB_*` keys in `.env.example` are used only when the complete licensed AWS Data Exchange configuration exists. Obtain a subscription separately and grant credentials the least permissions that integration requires. The repository includes no subscription, data license, or credentials.

Never prefix credentials with `NEXT_PUBLIC_` or `VITE_`, place them in `.openai/hosting.json`, embed them in images, or paste them into public issues.

## Backups and upgrades

Export JSON from Security Center before upgrading or changing a database binding. Store exports privately; they include reviews, notes, watch history state, collection membership, and timestamps. Keep local `.wrangler/` state private as well. There is no automatic restore UI yet.

## References

- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Vinext](https://github.com/cloudflare/vinext)
