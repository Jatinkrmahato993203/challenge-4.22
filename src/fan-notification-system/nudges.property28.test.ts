import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateFanNudge } from "./nudges.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { GateId } from "../types/models.js";
import {
  FIXED_NOW,
  highOrCriticalRiskLevelArb,
  makeForecastResult,
  makeGate,
} from "./nudges.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 28: Fan_Nudge always carries at least one usable alternative
 *
 * For any generated (non-null) FanNudge from generateFanNudge, at least
 * one of alternativeGateId, alternativeArrivalTime, or alternativeRouteId
 * SHALL be defined. Covers both: (a) an alternative gate exists at
 * strictly lower risk, and (b) no alternative gate exists at all, to
 * exercise the fallback-to-arrival-time branch.
 *
 * Validates: Requirements 8.2
 */
describe("Feature: stadium-congestion-forecasting, Property 28: Fan_Nudge always carries at least one usable alternative", () => {
  it("always carries at least one usable alternative, whether or not a lower-risk gate exists", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
        highOrCriticalRiskLevelArb(),
        fc.integer({ min: 70, max: 100 }),
        fc.boolean(), // whether an alternative gate at strictly lower risk exists
        (fanIdSuffix, originRiskLevel, originScore, hasAlternativeGate) => {
          const originGateId: GateId = "origin-gate";
          const originGate = makeGate(originGateId);
          const fan = { fanId: fanIdSuffix };

          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
          ]);

          if (hasAlternativeGate) {
            // (a) an alternative gate exists at strictly lower risk (LOW).
            forecastsByGate.set(
              "alt-gate",
              makeForecastResult("alt-gate", "LOW", 10)
            );
          }
          // (b) else: forecastsByGate only contains the origin gate, so no
          // alternative gate is available and the fallback arrival-time
          // branch must be exercised.

          const nudge = generateFanNudge(
            fan,
            originGate,
            forecastsByGate,
            null,
            FIXED_NOW
          );

          expect(nudge).not.toBeNull();
          const hasUsableAlternative =
            nudge!.alternativeGateId !== undefined ||
            nudge!.alternativeArrivalTime !== undefined ||
            nudge!.alternativeRouteId !== undefined;
          expect(hasUsableAlternative).toBe(true);

          if (hasAlternativeGate) {
            expect(nudge!.alternativeGateId).toBe("alt-gate");
          } else {
            expect(nudge!.alternativeGateId).toBeUndefined();
            expect(nudge!.alternativeArrivalTime).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
