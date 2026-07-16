import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classifyTiming, DEFAULT_TIMING_CONFIG } from "./timing.js";

/**
 * Feature: stadium-congestion-forecasting
 * Property 5: Late-arrival recording is complete and independent of staleness
 *
 * classifyTiming(event, now, config) computes:
 *  - isStale from (now - timestamp) >= config.staleThresholdMs
 *  - lateArrivalFlag from (receivedAt - timestamp) >= config.lateArrivalThresholdMs
 * These two computations are independent (no branch of one depends on the
 * other's outcome), classifyTiming always returns a result synchronously
 * (never throws/returns null/undefined), and it does not mutate the input
 * event object. This property asserts lateArrivalFlag correctness, the
 * "always returns a result" guarantee, non-mutation of the input, and
 * independence from isStale -- including a targeted reachability check
 * that lateArrivalFlag=true is achievable together with isStale=false
 * given DEFAULT_TIMING_CONFIG's actual thresholds
 * (staleThresholdMs=60_000, lateArrivalThresholdMs=30_000).
 */

const baseTimestampArb = () =>
  fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1) })
    .map((d) => d.getTime());

describe("Feature: stadium-congestion-forecasting, Property 5: Late-arrival recording is complete and independent of staleness", () => {
  it("computes lateArrivalFlag from receivedAt-timestamp delay, always returns a result, and never mutates the input event", () => {
    fc.assert(
      fc.property(
        baseTimestampArb(),
        fc.integer({ min: 0, max: 120_000 }), // delayMs: receivedAt - timestamp
        fc.integer({ min: 0, max: 120_000 }), // ageMs: now - timestamp
        (timestampMs, delayMs, ageMs) => {
          const timestamp = new Date(timestampMs).toISOString();
          const receivedAt = new Date(timestampMs + delayMs).toISOString();
          const now = new Date(timestampMs + ageMs);
          const event = { timestamp, receivedAt };
          const eventSnapshotBefore = { ...event };

          let result;
          expect(() => {
            result = classifyTiming(event, now);
          }).not.toThrow();

          expect(result).toBeDefined();
          expect(result).not.toBeNull();

          expect(result!.lateArrivalFlag).toBe(
            delayMs >= DEFAULT_TIMING_CONFIG.lateArrivalThresholdMs
          );
          expect(result!.isStale).toBe(
            ageMs >= DEFAULT_TIMING_CONFIG.staleThresholdMs
          );

          // classifyTiming must not mutate the event it was given.
          expect(event).toEqual(eventSnapshotBefore);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("guarantees lateArrivalFlag=true is reachable together with isStale=false (targeted reachability, DEFAULT_TIMING_CONFIG)", () => {
    // Targeted generator: delayMs is fixed just above lateArrivalThresholdMs
    // (30_000ms) while ageMs (== ambient "now" position) stays strictly
    // below staleThresholdMs (60_000ms), and receivedAt == now so the
    // late-arrival delay and the staleness age can coincide.
    fc.assert(
      fc.property(
        baseTimestampArb(),
        fc.integer({
          min: DEFAULT_TIMING_CONFIG.lateArrivalThresholdMs,
          max: DEFAULT_TIMING_CONFIG.staleThresholdMs - 1,
        }),
        (timestampMs, delayMs) => {
          const timestamp = new Date(timestampMs).toISOString();
          const receivedAt = new Date(timestampMs + delayMs).toISOString();
          // now coincides with receivedAt: age == delay, which is < staleThresholdMs
          // but >= lateArrivalThresholdMs by construction of the generator range.
          const now = new Date(timestampMs + delayMs);

          const result = classifyTiming({ timestamp, receivedAt }, now);

          expect(result.lateArrivalFlag).toBe(true);
          expect(result.isStale).toBe(false);
        }
      ),
      { numRuns: 100 }
    );

    // Explicit witness example (not just random hope): a single concrete
    // case guaranteed to land in the lateArrivalFlag=true, isStale=false region.
    const timestamp = new Date(2024, 0, 1, 0, 0, 0).toISOString();
    const receivedAt = new Date(
      new Date(timestamp).getTime() + 35_000
    ).toISOString(); // delay = 35_000ms >= 30_000ms lateArrivalThresholdMs
    const now = new Date(new Date(timestamp).getTime() + 35_000); // age = 35_000ms < 60_000ms staleThresholdMs

    const witnessResult = classifyTiming({ timestamp, receivedAt }, now);
    expect(witnessResult.lateArrivalFlag).toBe(true);
    expect(witnessResult.isStale).toBe(false);
  });
});
