-- Migration: 001_init_timescale_schema
-- Initial TimescaleDB schema for the Stadium Congestion Forecasting System
-- (design.md "Durable store (time-series + audit)" section).
--
-- Every table below is timestamped and queried by time range + gate_id,
-- so each is converted to a TimescaleDB hypertable partitioned on its
-- primary timestamp column. Retention policies are added separately in
-- migration 002 (Req 13.4: >= 90 days retention).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Signal_Events (Req 1.1, 2.1-2.7, 13.5)
CREATE TABLE IF NOT EXISTS signal_events (
    signal_id            TEXT PRIMARY KEY,
    source                TEXT NOT NULL CHECK (source IN ('GATE_COUNTER', 'TICKET_SCANNER', 'TRANSIT_FEED')),
    gate_id               TEXT,
    route_id              TEXT,
    event_timestamp       TIMESTAMPTZ NOT NULL,
    received_at           TIMESTAMPTZ NOT NULL,
    payload               JSONB NOT NULL,
    is_stale              BOOLEAN NOT NULL DEFAULT FALSE,
    late_arrival_flag     BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('signal_events', 'recorded_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_signal_events_gate_time ON signal_events (gate_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_events_route_time ON signal_events (route_id, recorded_at DESC);

-- Validation_Error records (Req 1.3, 2.5)
CREATE TABLE IF NOT EXISTS validation_errors (
    error_id              TEXT PRIMARY KEY,
    source                TEXT NOT NULL,
    reason                TEXT NOT NULL,
    offending_field       TEXT,
    raw_payload           JSONB NOT NULL,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('validation_errors', 'recorded_at', if_not_exists => TRUE);

-- Congestion_Score audit records (Req 13.1)
CREATE TABLE IF NOT EXISTS congestion_scores (
    gate_id                                TEXT NOT NULL,
    score_timestamp                        TIMESTAMPTZ NOT NULL,
    score                                   NUMERIC NOT NULL CHECK (score >= 0 AND score <= 100),
    risk_level                              TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
    low_confidence                          BOOLEAN NOT NULL DEFAULT FALSE,
    outdated                                BOOLEAN NOT NULL DEFAULT FALSE,
    contributing_signal_ids                 TEXT[] NOT NULL DEFAULT '{}',
    contributing_signal_late_arrival_flags  JSONB NOT NULL DEFAULT '{}',
    recorded_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (gate_id, score_timestamp)
);
SELECT create_hypertable('congestion_scores', 'recorded_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_congestion_scores_gate_time ON congestion_scores (gate_id, recorded_at DESC);

-- Recommended_Action audit records (Req 13.2)
CREATE TABLE IF NOT EXISTS recommended_actions (
    action_id             TEXT PRIMARY KEY,
    gate_id               TEXT NOT NULL,
    action_type           TEXT NOT NULL CHECK (action_type IN ('OPEN_GATE_LANE', 'REDIRECT_SHUTTLE_ROUTE', 'HOLD_TRANSIT_ARRIVAL', 'FAN_NUDGE_CAMPAIGN')),
    action_rank           INTEGER NOT NULL,
    explanation           TEXT NOT NULL,
    target_gate_id        TEXT,
    target_route_id       TEXT,
    generated_at          TIMESTAMPTZ NOT NULL,
    executed_at           TIMESTAMPTZ,
    executed_by_user_id   TEXT,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('recommended_actions', 'recorded_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_recommended_actions_gate_time ON recommended_actions (gate_id, recorded_at DESC);

-- Shuttle_Route redirection recommendation audit records (Req 7.3, 7.4)
CREATE TABLE IF NOT EXISTS shuttle_recommendations (
    recommendation_id         TEXT PRIMARY KEY,
    route_id                  TEXT NOT NULL,
    origin_gate_id            TEXT NOT NULL,
    alternative_gate_id       TEXT NOT NULL,
    explanation                TEXT NOT NULL,
    generated_at               TIMESTAMPTZ NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    accepted_at                 TIMESTAMPTZ,
    accepted_by_dispatcher_id   TEXT,
    rejected_at                 TIMESTAMPTZ,
    rejected_by_dispatcher_id   TEXT,
    recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('shuttle_recommendations', 'recorded_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_shuttle_recommendations_route_time ON shuttle_recommendations (route_id, recorded_at DESC);

-- Fan_Nudge audit records (Req 13.3)
CREATE TABLE IF NOT EXISTS fan_nudges (
    nudge_id                       TEXT PRIMARY KEY,
    fan_id                          TEXT NOT NULL,
    origin_gate_id                  TEXT NOT NULL,
    alternative_gate_id             TEXT,
    alternative_arrival_time        TIMESTAMPTZ,
    alternative_route_id            TEXT,
    message                          TEXT NOT NULL,
    generated_at                      TIMESTAMPTZ NOT NULL,
    simulated_delivery_timestamp     TIMESTAMPTZ,
    status                            TEXT NOT NULL CHECK (status IN ('QUEUED', 'SIMULATED_DELIVERED', 'CANCELLED')),
    recorded_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('fan_nudges', 'recorded_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_fan_nudges_fan_gate_time ON fan_nudges (fan_id, origin_gate_id, recorded_at DESC);

-- Alerts (Req 10.2, 10.4, 11.4)
CREATE TABLE IF NOT EXISTS alerts (
    alert_id                 TEXT PRIMARY KEY,
    gate_id                   TEXT NOT NULL,
    alert_type                 TEXT NOT NULL CHECK (alert_type IN ('RISK_LEVEL', 'DATA_QUALITY')),
    raised_at                   TIMESTAMPTZ NOT NULL,
    risk_level                   TEXT,
    affected_sources             TEXT[],
    acknowledged_at               TIMESTAMPTZ,
    acknowledged_by_user_id       TEXT,
    recorded_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT create_hypertable('alerts', 'recorded_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_alerts_gate_time ON alerts (gate_id, recorded_at DESC);
