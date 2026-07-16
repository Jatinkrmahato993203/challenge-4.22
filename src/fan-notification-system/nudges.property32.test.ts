import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateFanNudge } from "./nudges.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { GateId } from "../types/models.js";
import {
  FIXED_NOW,
  highOrCriticalRiskLevelArb,
  lowOrModerateRiskLevelArb,
  makeForecastResult,
  makeGate,
} from "./nudges.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 32: A Fan_Nudge exists for a fan/Gate at time T if and only if that Gate is High/Critical at T
 *
 * For any fan/Gate/forecastsByGate combination with lastNudgeAt=null (no
 * active cooldown), generateFanNudge SHALL return non-null if and only
 * if the origin gate's riskLevel is HIGH or CRITICAL.
 *
 * Validates: Requirements 8.1, 9.2, 9.3
 */
describe("Feature: stadium-congestion-forecasting, Property 32: A Fan_Nudge exists for a fan/Gate at time T if and only if that Gate is High/Critical at T", () => {
  it("returns null when the origin gate's risk is LOW or MODERATE", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
        lowOrModerateRiskLevelArb(),
        fc.integer({ min: 0, max: 69 }),
        (fanIdSuffix, originRiskLevel, originScore) => {
          const originGateId: GateId = "origin-gate";
          const originGate = makeGate(originGateId);
          const fan = { fanId: fanIdSuffix };

          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
          ]);

          const nudge = generateFanNudge(
            fan,
            originGate,
            forecastsByGate,
            null,
            FIXED_NOW
          );

          expect(nudge).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns non-null when the origin gate's risk is HIGH or CRITICAL", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
        highOrCriticalRiskLevelArb(),
        fc.integer({ min: 70, max: 100 }),
        (fanIdSuffix, originRiskLevel, originScore) => {
          const originGateId: GateId = "origin-gate";
          const originGate = makeGate(originGateId);
          const fan = { fanId: fanIdSuffix };

          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
          ]);

          const nudge = generateFanNudge(
            fan,
            originGate,
            forecastsByGate,
            null,
            FIXED_NOW
          );

          expect(nudge).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
