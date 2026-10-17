# Contributing

Keep the tracker focused on private library management. Prefer small, reviewable changes and preserve saved data and explicit user statuses.

1. Use Node.js 24+, install with `npm ci`, and work on a branch.
   Use a GitHub noreply commit email; the release-history privacy gate rejects other email domains.
2. Reproduce the issue with fictional data. Do not include real exports, names, emails, credentials, or deployment identifiers.
3. Add behavior tests for changes to authorization, provider failures, writes, exports, or migration behavior. Preserve bounded provider concurrency and failure isolation.
4. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:privacy`, and `npm audit`.
5. Explain the resulting behavior, validation, and any limitations in the pull request. Check mobile and keyboard interactions when modifying the UI.

Database changes must be additive or include a concrete migration/recovery plan. Do not add personal records to migrations or automatic seeds. External metadata and artwork need their own attribution/usage review. Keep credentials exclusively in ignored local files or runtime secrets.

Security reports belong in the private reporting channel described in SECURITY.md, not a public issue containing exploit details or personal data.
