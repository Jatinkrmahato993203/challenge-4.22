import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateFanNudge, COOLDOWN_PERIOD_MS } from "./nudges.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { GateId } from "../types/models.js";
import { FIXED_NOW, highOrCriticalRiskLevelArb, makeForecastResult, makeGate } from "./nudges.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 31: Cooldown prevents repeat nudges to the same fan and Gate
 *
 * For any fan/Gate pair, if lastNudgeAt is non-null and
 * (now.getTime() - lastNudgeAt.getTime()) < COOLDOWN_PERIOD_MS,
 * generateFanNudge SHALL return null even when originGate is forced to
 * HIGH or CRITICAL risk (which would otherwise generate a nudge).
 *
 * Validates: Requirements 8.4, 9.1
 */
describe("Feature: stadium-congestion-forecasting, Property 31: Cooldown prevents repeat nudges to the same fan and Gate", () => {
  it("returns null when within the cooldown period, regardless of origin risk", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
        highOrCriticalRiskLevelArb(),
        fc.integer({ min: 70, max: 100 }),
        fc.integer({ min: 0, max: COOLDOWN_PERIOD_MS - 1 }),
        (fanIdSuffix, originRiskLevel, originScore, elapsedMs) => {
          const originGateId: GateId = "origin-gate";
          const originGate = makeGate(originGateId);
          const fan = { fanId: fanIdSuffix };

          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
          ]);

          const lastNudgeAt = new Date(FIXED_NOW.getTime() - elapsedMs);

          const nudge = generateFanNudge(
            fan,
            originGate,
            forecastsByGate,
            lastNudgeAt,
            FIXED_NOW
          );

          expect(nudge).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
