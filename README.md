# Stadium Congestion Forecasting System

A real-time, event-driven system that turns scattered gate signals (counter readings, ticket scans, transit arrivals) into a ranked, explained set of operational actions. It forecasts gate congestion over a rolling 15-minute horizon, raises risk alerts, ranks recommended actions for venue ops and gate staff, advises transit dispatchers on shuttle redirections away from congested gates, and simulates fan-facing nudges suggesting less congested alternatives -- all pushed live to an ops dashboard.

## Architecture

The system is built as seven subsystems, each mapping to an independently testable service:

- **Signal_Ingestion_Service** (`src/signal-ingestion`) -- validates and parses incoming gate/ticket/transit signals, computes staleness and late-arrival flags, tracks per-source health.
- **Congestion_Forecaster** (`src/congestion-forecaster`) -- computes per-gate Congestion_Score/Risk_Level forecasts over the 15-minute horizon, on a scheduled + event-triggered cadence.
- **Recommendation_Engine** (`src/recommendation-engine`) -- turns forecasts into a ranked, explained list of recommended actions per gate.
- **Shuttle_Redirection_Advisor** (`src/shuttle-redirection-advisor`) -- recommends redirecting shuttle routes away from high/critical-risk gates toward lower-risk alternatives.
- **Fan_Notification_System** (`src/fan-notification-system`) -- generates and simulates delivery of fan nudges suggesting alternative gates/arrival times.
- **Ops_Dashboard** (`src/ops-dashboard`) -- aggregates live gate state, actions, and alerts, and pushes updates to connected clients over WebSocket.
- **Audit_Log_Service** (`src/audit-log-service`) -- records an immutable audit trail of scores, actions, and nudges for compliance/review.

This demo build wires all seven subsystems together in a single process using an in-memory event bus (`src/infra/event-bus.ts`) as a stand-in for the Kafka topics described in the design document. It mirrors the topic names/shapes exactly, so a production deployment would swap this class out for real Kafka producers (publish side) and consumer groups (subscribe side) against the topics already defined in `src/infra/kafka-topics.ts`, without changing any subscriber's logic.

## Prerequisites

- Node.js >= 18 (see `package.json` `engines`)
- npm

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env` and fill in:

- `API_KEYS` -- comma-separated `key:role` pairs (roles can be combined with `+`) used to authenticate requests.
- `ALLOWED_ORIGINS` -- comma-separated list of browser origins allowed to make cross-origin requests.
- `PORT` -- port the HTTP/WebSocket server listens on (defaults to `3000`).

See `.env.example` for the exact format and example (non-secret) placeholder values.

## Running

Development (via `tsx`, no build step):

```bash
npm run dev
```

Production-style (compiled):

```bash
npm run build
npm start
```

The demo topology -- 3 gates (`gate-a`, `gate-b`, `gate-c`) served by 2 shuttle routes -- is defined in `src/infra/topology.ts`. It's seeded in-memory at startup so the pipeline has something concrete to forecast/recommend/redirect against out of the box.

## Testing

Run the full test suite:

```bash
npm test
```

This runs Vitest across the whole repo. Two things to know:

- **Integration tests** (`tests/integration/*.test.ts`) exercise the system against real Kafka, Redis, and TimescaleDB. Start that infrastructure first with `docker compose up -d`, otherwise these tests fail with `ECONNREFUSED`.
- **Property-based tests** (`*.property*.test.ts`, 43 of them per the design document's Correctness Properties section) and unit tests are self-contained -- they test the pure scoring/ranking/parsing logic directly and run standalone with no infrastructure required.

## Authentication

Every route except `/healthz` requires a valid API key, enforced by `src/infra/auth.ts`. Keys are configured via the `API_KEYS` environment variable as comma-separated `key:role` pairs, where a key can hold multiple roles joined with `+` (e.g. `abc123:GATE_STAFF+AUDITOR`).

Recognized roles:

| Role | Represents |
|---|---|
| `INGESTION_SOURCE` | Automated devices posting signals (Gate_Counter / Ticket_Scanner / Transit_Feed) |
| `VENUE_OPS_MANAGER` | Venue operations manager |
| `GATE_STAFF` | Gate staff |
| `TRANSIT_DISPATCHER` | Transit dispatcher |
| `AUDITOR` | Read-only audit access |

Pass your key one of these ways:

- `Authorization: Bearer <key>` header
- `X-API-Key: <key>` header
- `?apiKey=<key>` query parameter (WebSocket endpoint only, since browsers can't set custom headers on WS handshakes)

Requests with no recognized key get `401 Unauthorized`; requests with a valid key but insufficient role get `403 Forbidden`. `GET /healthz` is unauthenticated (liveness check only).

## API overview

Base path for all REST routes is `/v1`. See [`openapi.yaml`](./openapi.yaml) for full request/response schemas.

| Method | Path | Required role(s) |
|---|---|---|
| GET | `/healthz` | none (unauthenticated) |
| POST | `/v1/signals` | `INGESTION_SOURCE` |
| GET | `/v1/sources/{gateOrRouteId}/status` | `VENUE_OPS_MANAGER`, `GATE_STAFF`, `TRANSIT_DISPATCHER`, `AUDITOR` |
| GET | `/v1/gates/{gateId}/forecast` | `VENUE_OPS_MANAGER`, `GATE_STAFF`, `TRANSIT_DISPATCHER`, `AUDITOR` |
| GET | `/v1/gates/{gateId}/actions` | `VENUE_OPS_MANAGER`, `GATE_STAFF`, `AUDITOR` |
| POST | `/v1/gates/{gateId}/actions/{actionId}/execute` | `VENUE_OPS_MANAGER`, `GATE_STAFF` |
| GET | `/v1/routes/{routeId}/redirections` | `TRANSIT_DISPATCHER`, `AUDITOR` |
| POST | `/v1/routes/{routeId}/redirections/{recId}/accept` | `TRANSIT_DISPATCHER` |
| POST | `/v1/routes/{routeId}/redirections/{recId}/reject` | `TRANSIT_DISPATCHER` |
| GET | `/v1/nudges` | `VENUE_OPS_MANAGER`, `AUDITOR` |
| GET | `/v1/dashboard/gates` | `VENUE_OPS_MANAGER`, `GATE_STAFF`, `TRANSIT_DISPATCHER`, `AUDITOR` |
| POST | `/v1/alerts/{alertId}/acknowledge` | `VENUE_OPS_MANAGER`, `TRANSIT_DISPATCHER` |
| GET | `/v1/audit/scores` | `VENUE_OPS_MANAGER`, `AUDITOR` |
| GET | `/v1/audit/actions` | `VENUE_OPS_MANAGER`, `AUDITOR` |
| GET | `/v1/audit/nudges` | `VENUE_OPS_MANAGER`, `AUDITOR` |
| WS | `/v1/dashboard/stream` | `VENUE_OPS_MANAGER`, `GATE_STAFF`, `TRANSIT_DISPATCHER`, `AUDITOR` (via `?apiKey=`) |

## Docker

A `Dockerfile` is provided at the repo root:

```bash
docker build -t stadium-congestion-forecasting .
docker run -p 3000:3000 --env-file .env stadium-congestion-forecasting
```

Note: this container only runs the app process itself. It doesn't include Kafka/Redis/TimescaleDB -- use `docker-compose.yml` for that infrastructure if needed.

## Project structure

```
src/
  audit-log-service/          Immutable audit trail (scores, actions, nudges)
  congestion-forecaster/      Per-gate Congestion_Score / Risk_Level forecasting
  fan-notification-system/    Fan nudge generation + simulated delivery
  infra/                      Event bus, Kafka topic config, Redis client, auth, demo topology, DB migrations
  ops-dashboard/              Live snapshot aggregation, alerts, WebSocket push hub
  recommendation-engine/      Ranked, explained recommended actions per gate
  shuttle-redirection-advisor/  Shuttle route redirection recommendations
  signal-ingestion/           Signal parsing/validation, staleness/lateness, source health
  types/                      Shared domain types (models.ts)
  pipeline.ts                 Wires all subsystems together via the event bus
  server.ts                   Express app, routes, auth middleware, WebSocket upgrade, mock stores
```

## Known limitations

- The event bus (`src/infra/event-bus.ts`) and demo topology (`src/infra/topology.ts`) are single-process demo stand-ins, not production Kafka wiring. There is no partitioning, durability, or cross-instance delivery.
- All persistence is in-memory (the Redis client and durable/audit stores in `server.ts` are mock implementations). Nothing survives a process restart.
- There's no automatic TLS termination -- the server is expected to run behind a reverse proxy or load balancer that handles TLS in production.
