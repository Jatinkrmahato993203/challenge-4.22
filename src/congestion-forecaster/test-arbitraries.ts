import fc from "fast-check";
import type { Gate, SignalEvent, SignalSource } from "../types/models.js";

/**
 * Shared fast-check arbitraries for the congestion-forecaster pure-core
 * property tests (Feature: stadium-congestion-forecasting).
 *
 * Kept in one place so every property test builds Gate / SignalEvent
 * fixtures against the exact shapes in src/types/models.ts.
 */

/** Gate arbitrary, including edge-case capacityThresholds (0, negative). */
export const gateArb: fc.Arbitrary<Gate> = fc.record({
  gateId: fc.string({ minLength: 1, maxLength: 10 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  capacityThreshold: fc.integer({ min: -50, max: 1000 }),
  assignedRouteIds: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
    maxLength: 3,
  }),
});

/** Gate arbitrary restricted to a "normal" positive capacityThreshold. */
export const positiveCapacityGateArb: fc.Arbitrary<Gate> = fc.record({
  gateId: fc.string({ minLength: 1, maxLength: 10 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  capacityThreshold: fc.integer({ min: 1, max: 1000 }),
  assignedRouteIds: fc.array(fc.string({ minLength: 1, maxLength: 8 }), {
    maxLength: 3,
  }),
});

const sourcePayloadArb = fc.oneof(
  fc.record({
    source: fc.constant<SignalSource>("GATE_COUNTER"),
    payload: fc.record({
      count: fc.integer({ min: -50, max: 500 }),
      intervalSeconds: fc.integer({ min: 1, max: 60 }),
    }),
  }),
  fc.record({
    source: fc.constant<SignalSource>("TICKET_SCANNER"),
    payload: fc.record({
      fanId: fc.string({ minLength: 1, maxLength: 10 }),
    }),
  }),
  fc.record({
    source: fc.constant<SignalSource>("TRANSIT_FEED"),
    payload: fc.record({
      estimatedPassengerCount: fc.integer({ min: -50, max: 500 }),
    }),
  })
);

/**
 * SignalEvent arbitrary. `timestamp` and `receivedAt` are generated as
 * ISO 8601 strings offset from `nowMs`, spanning both "recent" (within
 * the last 10 minutes, per Congestion_Forecaster's RECENT_WINDOW_MS)
 * and "stale/old" (further in the past) ranges so tests can exercise
 * both the counted and excluded branches of computeForecast.
 */
export function signalEventArb(nowMs: number): fc.Arbitrary<SignalEvent> {
  return sourcePayloadArb.chain((sourcePayload) =>
    fc
      .record({
        signalId: fc.uuid(),
        gateId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
          nil: undefined,
        }),
        routeId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), {
          nil: undefined,
        }),
        // -20 minutes .. now
        timestampOffsetMs: fc.integer({ min: -20 * 60 * 1000, max: 0 }),
        // small ingestion delay, may be slightly after "now" too
        receivedAtOffsetMs: fc.integer({
          min: -20 * 60 * 1000,
          max: 5000,
        }),
        isStale: fc.boolean(),
        lateArrivalFlag: fc.boolean(),
      })
      .map((rest) => ({
        signalId: rest.signalId,
        source: sourcePayload.source,
        gateId: rest.gateId,
        routeId: rest.routeId,
        timestamp: new Date(nowMs + rest.timestampOffsetMs).toISOString(),
        receivedAt: new Date(nowMs + rest.receivedAtOffsetMs).toISOString(),
        payload: sourcePayload.payload,
        isStale: rest.isStale,
        lateArrivalFlag: rest.lateArrivalFlag,
      }))
  );
}

/**
 * SignalEvent arbitrary restricted to the "recent and non-stale" branch
 * that computeForecast actually counts (timestamp within RECENT_WINDOW_MS
 * of nowMs, isStale = false).
 */
export function recentNonStaleGateCounterArb(
  nowMs: number,
  count: fc.Arbitrary<number> = fc.integer({ min: 0, max: 500 })
): fc.Arbitrary<SignalEvent> {
  return fc
    .record({
      signalId: fc.uuid(),
      timestampOffsetMs: fc.integer({ min: -10 * 60 * 1000, max: 0 }),
      count,
      intervalSeconds: fc.integer({ min: 1, max: 60 }),
      lateArrivalFlag: fc.boolean(),
    })
    .map((rest) => ({
      signalId: rest.signalId,
      source: "GATE_COUNTER" as SignalSource,
      gateId: "gate-under-test",
      timestamp: new Date(nowMs + rest.timestampOffsetMs).toISOString(),
      receivedAt: new Date(nowMs + rest.timestampOffsetMs).toISOString(),
      payload: { count: rest.count, intervalSeconds: rest.intervalSeconds },
      isStale: false,
      lateArrivalFlag: rest.lateArrivalFlag,
    }));
}

/**
 * SignalEvent arbitrary restricted to events that computeForecast will
 * EXCLUDE from its "non-stale recent" window: either explicitly stale,
 * or timestamped more than 10 minutes before nowMs.
 */
export function excludedSignalEventArb(nowMs: number): fc.Arbitrary<SignalEvent> {
  return sourcePayloadArb.chain((sourcePayload) =>
    fc
      .record({
        signalId: fc.uuid(),
        isStale: fc.boolean(),
        // strictly older than the 10-minute recent window
        timestampOffsetMs: fc.integer({
          min: -60 * 60 * 1000,
          max: -10 * 60 * 1000 - 1,
        }),
        lateArrivalFlag: fc.boolean(),
      })
      .chain((rest) =>
        // Ensure at least one of the two exclusion reasons holds: either
        // isStale is true, or the timestamp is outside the recent window
        // (guaranteed by the offset range above already). We still allow
        // isStale to vary freely since an old-and-stale event is also
        // a valid exclusion example.
        fc.constant({
          signalId: rest.signalId,
          source: sourcePayload.source,
          gateId: "gate-under-test",
          timestamp: new Date(nowMs + rest.timestampOffsetMs).toISOString(),
          receivedAt: new Date(nowMs + rest.timestampOffsetMs).toISOString(),
          payload: sourcePayload.payload,
          isStale: rest.isStale,
          lateArrivalFlag: rest.lateArrivalFlag,
        })
      )
  );
}
