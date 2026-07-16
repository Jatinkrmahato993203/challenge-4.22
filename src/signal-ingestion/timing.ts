import type { SignalEvent } from "../types/models.js";

/**
 * Configuration for staleness and late-arrival classification
 * (design.md Signal_Ingestion_Service section).
 */
export interface TimingConfig {
  /** Req 1.4: events whose age (now - timestamp) meets/exceeds this are stale. */
  staleThresholdMs: number; // default 60_000
  /** Req 1.6: events whose delay (receivedAt - timestamp) meets/exceeds this are late-arrival. */
  lateArrivalThresholdMs: number;
}

export const DEFAULT_TIMING_CONFIG: TimingConfig = {
  staleThresholdMs: 60_000,
  lateArrivalThresholdMs: 30_000,
};

export interface TimingClassification {
  isStale: boolean; // Req 1.4
  lateArrivalFlag: boolean; // Req 1.6-1.8
}

/**
 * Classifies a Signal_Event's timing along two INDEPENDENT axes:
 *  - isStale: is `now - timestamp` >= staleThresholdMs? (Req 1.4)
 *  - lateArrivalFlag: is `receivedAt - timestamp` >= lateArrivalThresholdMs? (Req 1.6)
 *
 * These are computed from two separate threshold comparisons over the
 * event's timestamp/receivedAt and the caller-supplied `now`, with no
 * branch making one depend on the other's outcome. This is what makes
 * Req 1.7's independence property (lateArrivalFlag=true reachable with
 * isStale=false) true by construction.
 */
export function classifyTiming(
  event: Pick<SignalEvent, "timestamp" | "receivedAt">,
  now: Date,
  config: TimingConfig = DEFAULT_TIMING_CONFIG
): TimingClassification {
  const timestampMs = new Date(event.timestamp).getTime();
  const receivedAtMs = new Date(event.receivedAt).getTime();
  const nowMs = now.getTime();

  const ageMs = nowMs - timestampMs;
  const delayMs = receivedAtMs - timestampMs;

  return {
    isStale: ageMs >= config.staleThresholdMs,
    lateArrivalFlag: delayMs >= config.lateArrivalThresholdMs,
  };
}
