import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { simulateDelivery } from "./delivery.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { FanNudge, GateId } from "../types/models.js";
import { FIXED_NOW, highOrCriticalRiskLevelArb, makeForecastResult } from "./nudges.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 29: Simulated delivery records complete data with no external transmission
 *
 * For any FanNudge where the target gate's current riskLevel is HIGH or
 * CRITICAL, calling simulateDelivery SHALL return a non-null
 * deliveryRecord whose fanId/message/targetGate/simulatedDeliveryTimestamp
 * match the nudge, and the returned nudge.status SHALL be
 * "SIMULATED_DELIVERED".
 *
 * Note: "no external transmission" is a structural property of
 * delivery.ts having zero network/HTTP imports -- confirmed by reading
 * src/fan-notification-system/delivery.ts, whose only imports are type
 * imports from ../types/models.js and ../congestion-forecaster/forecast.js
 * (no fetch/http/axios/ws/etc). That structural fact is not itself
 * assertable at runtime in a unit test. As a lightweight
 * defense-in-depth check, we additionally spy on globalThis.fetch (when
 * available in this Node version) and assert it is never called while
 * simulateDelivery runs across the whole property run.
 *
 * Validates: Requirements 8.3, 8.5
 */
describe("Feature: stadium-congestion-forecasting, Property 29: Simulated delivery records complete data with no external transmission", () => {
  it("returns a complete deliveryRecord and SIMULATED_DELIVERED status when the target gate is High/Critical, with no fetch calls", () => {
    // globalThis.fetch exists in Node >= 18 (this project's engines.node
    // requirement); if it's absent in the current runtime, skip this
    // specific spy-based assertion rather than failing the whole test.
    const fetchIsSpyable = typeof globalThis.fetch === "function";
    const fetchSpy = fetchIsSpyable
      ? vi.spyOn(globalThis, "fetch")
      : undefined;

    try {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
          highOrCriticalRiskLevelArb(),
          fc.integer({ min: 70, max: 100 }),
          fc.string({ minLength: 1, maxLength: 40 }),
          (fanIdSuffix, targetRiskLevel, targetScore, message) => {
            const targetGateId: GateId = "target-gate";

            const nudge: FanNudge = {
              nudgeId: `${fanIdSuffix}-${targetGateId}-nudge`,
              fanId: fanIdSuffix,
              originGateId: targetGateId,
              message,
              generatedAt: FIXED_NOW.toISOString(),
              status: "QUEUED",
            };

            const forecastsByGate = new Map<GateId, ForecastResult>([
              [targetGateId, makeForecastResult(targetGateId, targetRiskLevel, targetScore)],
            ]);

            const result = simulateDelivery(nudge, forecastsByGate, FIXED_NOW);

            expect(result.deliveryRecord).not.toBeNull();
            expect(result.deliveryRecord!.fanId).toBe(nudge.fanId);
            expect(result.deliveryRecord!.message).toBe(nudge.message);
            expect(result.deliveryRecord!.targetGate).toBe(nudge.originGateId);
            expect(result.deliveryRecord!.simulatedDeliveryTimestamp).toBeDefined();
            expect(result.nudge.status).toBe("SIMULATED_DELIVERED");
          }
        ),
        { numRuns: 100 }
      );
    } finally {
      if (fetchSpy) {
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
      }
    }
  });
});
