# Section 83 — Package-only integration lab

This laboratory is **not** the all-in-one (AIO) hosting/management application. It certifies individual packages, local integration fixtures and declared real-service interoperability only. The `--all` command is deliberately red until every selected fixture passes; a missing live service is a skip/blocker, never a green test. Every live suite uses test-only keys and isolated data.

## Commands

From `apps/proworkspace`:

```sh
node --test scripts/integration-lab-core.test.mjs
npm run lab:offline
node scripts/integration-lab.mjs --offline --build --report=integration-lab/reports/offline.json
npm run lab:live
node scripts/integration-lab.mjs --only=pg,redis-queue --require=pg,redis-queue --build --report=integration-lab/reports/selected.json
npm run lab:all
```

`--offline` selects source-contracts, Auth/Security, real SQLite, a host-authenticated Analytics→Tags→Reports→Email suppression pipeline, and local content workflows. `--live` selects PostgreSQL, MySQL, MongoDB, Redis, BullMQ, Redis Cluster, S3, SMTP, IMAP, POP3 and Chromium. `--only` overrides the selection, while `--require` forces specified suites to pass (the suite must also be in `--only` when specified). `--build` runs the existing dependency-order package builder on the selected workspace scopes; it cannot replace `npm ci`. `--dry-run` only enumerates suites and is **not** verification. `--report` writes an evidence JSON file without service credentials, mail addresses, secrets or payloads. Non-passing selected matrices exit nonzero.

On a **clean** checkout, first complete `npm ci --no-audit --no-fund`. If this fails, report it as a release blocker. The Section 82 baseline still has 14 unresolved external entries and cannot be treated as a reproducibly installable product. A local workaround using temporary symlinks or global types is **not** a clean-install certificate.

## Disposable services

`integration-lab/compose.yml` defines PostgreSQL 16, MySQL 8.4, MongoDB 7.0, Redis 7.4, a version-configurable MinIO S3 server, and GreenMail. Ports are published **only on 127.0.0.1**. Test credentials in `.env.lab.example` are deliberately insecure and must never be reused. Docker Compose and its image pulls are required; images/behaviors must be checked in the target CI environment. Use a unique Compose project name for each run.

```sh
docker compose -f integration-lab/compose.yml -p zerux-section83 up -d --wait
docker compose -f integration-lab/compose.yml -p zerux-section83 ps
docker compose -f integration-lab/compose.yml -p zerux-section83 images
# Export only the required values from .env.lab.example into the shell.
node scripts/integration-lab.mjs --live --build --report=integration-lab/reports/live.json
# ALWAYS release all disposable volumes, including on failure:
docker compose -f integration-lab/compose.yml -p zerux-section83 down --volumes --remove-orphans
```

Never point the lab at a production account. Database parity suites use random table names and clean up; queue/cache suites use random prefixes; S3 tests use a random key prefix and delete their objects. Optional `LAB_S3_EPHEMERAL_BUCKET=1` creates and removes a **random test bucket only on a loopback S3 endpoint**. There is **no automatic destructive database reset, server flush or outbound email send**. The SMTP suite verifies a TLS login only; actual sending remains an explicit, separate opt-in test.

GreenMail uses self-signed test TLS by default. Provision a **test-only CA** through `NODE_EXTRA_CA_CERTS` before enabling SMTP/IMAP/POP3. The lab intentionally does not disable certificate verification. IMAP/POP3 test ports can be mapped through `ZERUX_TEST_IMAP_PORT` and `ZERUX_TEST_POP3_PORT`. Open-text connection strings and default credentials are permitted **only** for private disposable fixtures.

## Coverage / certification boundaries

| Gate | Evidence | Default availability |
|---|---|---|
| Source contracts / lock and tooling | isolated source preflight, workspace tools | offline |
| Authentication and authorization | Auth/Security local regressions | offline with built outputs |
| SQLite analytics/tags/reports/migrations/campaigns | real Node SQLite integration tests | offline with built outputs |
| Auth → DB → analytics → publish tag → report endpoint → suppression | new real SQLite host-policy fixture; **not** a real queue/email send | offline with built outputs |
| Local media/assets/search/feed/SEO/AI retrieval | end-to-end local storage workflow | offline with built outputs |
| PostgreSQL/MySQL/MongoDB | real connector parity (CRUD / affected count) | opt-in live credentials |
| Redis/BullMQ | namespace isolation, multi-worker/retry/scheduling | opt-in real Redis |
| Redis Cluster | cross-slot/prefix + cron with Cluster nodes | **separate** opt-in cluster fixture (not in one-node Compose) |
| MinIO/S3 | upload, range, metadata, copy and cleanup | opt-in S3 endpoint + SDK |
| SMTP | TLS/password verify only, no send | opt-in SMTP + trusted test CA |
| IMAP/POP3 | TLS auth, read-only folder verification | opt-in mail server + trusted test CA |
| Browser | Chromium accessibility fixture | opt-in Chromium binary; render timeouts are failures |
| Cross-OS / React / Vue / Next / Nuxt / native HTTP/3 | separate certification required | **not certified** |

`status: passed` applies only to selected suites that actually passed. A test suite with zero successes, even if every test was skipped, cannot pass. `status: partial` means selected checks are missing. `status: incomplete` means no suite passed. If a required suite skips, exits nonzero, times out, or is missing compiled artifacts, `status: failed`. Per-suite TAP totals retain `skipped` counts (e.g. the shared DB test includes tests for other engines).

## CI

`.github/workflows/package-integration-lab.yml` runs source and harness checks against Node 22 and 24 without service startup; a manual dispatch with `run_live=true` starts disposable Compose services, requires a clean npm install, runs the selected real SQL/Redis/S3 matrix and always tears down containers/volumes. A failed `npm ci` makes the job fail; it **does not** imply the downstream live checks ran. GreenMail TLS and Redis Cluster are deliberately separate gated jobs until compatible trusted CA and real cluster fixtures are provisioned. The workflow uploads only JSON outcome summaries, not credentials or captured network traffic. Pin and re-verify image digests before production release qualification.
