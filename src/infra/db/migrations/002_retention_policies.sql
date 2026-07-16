-- Migration: 002_retention_policies
-- Adds a 90-day retention policy to every audit hypertable created in
-- 001_init_timescale_schema.sql (Req 13.4: "retain audit records for
-- at least 90 days from the event date").
--
-- TimescaleDB's add_retention_policy schedules a background job that
-- drops chunks entirely older than the given interval, keyed off each
-- hypertable's designated time column (recorded_at, per 001's
-- create_hypertable calls).

SELECT add_retention_policy('signal_events', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('validation_errors', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('congestion_scores', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('recommended_actions', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('shuttle_recommendations', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('fan_nudges', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('alerts', INTERVAL '90 days', if_not_exists => TRUE);
