# Portfolio notes

## What this project demonstrates

- Full-stack React/TypeScript application work with a Worker runtime and relational SQLite/D1 storage.
- SQL schema design, indexed queries, additive migrations, and atomic collection operations.
- Integration of multiple external catalogs with timeouts, circuit breakers, rate-aware fallback, and controlled concurrency.
- Single-owner authorization, cryptographic JWT verification, input/origin validation, privacy-aware logging, and secure exports.
- Domain modeling that separates personal completion state from discovered future installments.
- Automated behavioral/security/database tests and reproducible release checks.

## Resume wording

Adapt this to reflect the parts you personally designed, implemented, and can explain:

> Built an open-source media tracker using React, TypeScript, Cloudflare Workers, and D1/SQLite, with customizable collections, multi-provider metadata synchronization, single-owner access controls, and automated security/database tests.

Do not add invented user counts, latency improvements, uptime guarantees, or deployment claims. Be prepared to explain the design decisions and walk through one feature end to end.

## Suggested demonstration

Run a fresh local instance and use fictional sample titles. Add a title, update progress, create a collection, reorder navigation, inspect a continuation fixture in tests, and export a small JSON file. Show how a provider outage retains previous data and how invalid identity assertions are rejected. Use the architecture and audit documents to explain tradeoffs.

Use a separate, sanitized demo instance if you want a public interactive demo. The original private library should not be made public for recruiting.
