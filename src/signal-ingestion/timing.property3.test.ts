import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classifyTiming, DEFAULT_TIMING_CONFIG } from "./timing.js";

/**
 * Feature: stadium-congestion-forecasting
 * Property 3: Staleness threshold is applied consistently
 *
 * For any Signal_Event, the event is marked stale if and only if
 * `now - timestamp >= staleThresholdMs` (DEFAULT_TIMING_CONFIG.staleThresholdMs,
 * default 60_000ms). classifyTiming computes isStale from `now` vs
 * `timestamp` (not `receivedAt` vs `timestamp`); `now` is exercised here as
 * `timestamp + delayMs` to sweep both sides of the threshold.
 */

const baseTimestampArb = () =>
  fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1) })
    .map((d) => d.getTime());

describe("Feature: stadium-congestion-forecasting, Property 3: Staleness threshold is applied consistently", () => {
  it("marks an event stale if and only if now - timestamp >= staleThresholdMs", () => {
    fc.assert(
      fc.property(
        baseTimestampArb(),
        fc.integer({ min: 0, max: 120_000 }),
        (timestampMs, delayMs) => {
          const timestamp = new Date(timestampMs).toISOString();
          const receivedAt = new Date(timestampMs).toISOString();
          const now = new Date(timestampMs + delayMs);

          const result = classifyTiming({ timestamp, receivedAt }, now);

          expect(result.isStale).toBe(
            delayMs >= DEFAULT_TIMING_CONFIG.staleThresholdMs
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
