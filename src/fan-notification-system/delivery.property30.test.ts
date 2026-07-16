import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { simulateDelivery } from "./delivery.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { FanNudge, GateId } from "../types/models.js";
import { FIXED_NOW, lowOrModerateRiskLevelArb, makeForecastResult } from "./nudges.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 30: Risk downgrade before delivery cancels the queued nudge
 *
 * For any FanNudge where the target gate's current riskLevel is LOW or
 * MODERATE, calling simulateDelivery SHALL return deliveryRecord===null
 * and the returned nudge.status SHALL be "CANCELLED".
 *
 * Validates: Requirements 8.5
 */
describe("Feature: stadium-congestion-forecasting, Property 30: Risk downgrade before delivery cancels the queued nudge", () => {
  it("returns a null deliveryRecord and CANCELLED status when the target gate has returned to Low/Moderate risk", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
        lowOrModerateRiskLevelArb(),
        fc.integer({ min: 0, max: 69 }),
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

          expect(result.deliveryRecord).toBeNull();
          expect(result.nudge.status).toBe("CANCELLED");
        }
      ),
      { numRuns: 100 }
    );
  });
});
