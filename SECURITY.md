# Security policy

## Supported release

Security fixes target the latest release on the default branch. Recheck dependencies before deployment; audit results are point-in-time and may change.

## Reporting a vulnerability

Use this repository's **Security → Advisories → Report a vulnerability** when private reporting is available. If it is unavailable, open a minimal issue requesting a private reporting channel; do not include secrets, exploit payloads, personal records, or sensitive deployment details in that issue.

Include the affected version, impact, required attacker access, and a reproduction using fictional data. Avoid testing third-party instances or provider services without their permission.

## Deployment requirements

This is a single-owner application. Production must use either verified Cloudflare Access assertions or the trusted managed Sites dispatcher, plus an owner hash. Sites identity headers are not portable proof of identity on a generic server. Keep default workers.dev and preview hosts disabled on standalone deployments and protect the complete custom hostname with Access.

Do not expose the development server or use a development bypass in production. Keep databases, exports, runtime secrets, and local configuration private. HTTPS is required for production. Revoke credentials if they appear in commits, logs, issues, or screenshots; deleting a file is insufficient recovery for an exposed secret.

## Release checks

The release process checks code paths, credentials/PII patterns, staged content, reachable Git history, compiled output, dependency advisories, authentication boundaries, request limits, exports, and database setup. These controls reduce risk; they do not constitute a security guarantee or third-party penetration test.
