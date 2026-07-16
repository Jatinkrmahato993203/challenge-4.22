import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateFanNudge } from "./nudges.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { GateId, RiskLevel } from "../types/models.js";
import {
  FIXED_NOW,
  RISK_LEVELS,
  RISK_ORDER,
  makeForecastResult,
  makeGate,
} from "./nudges.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 33: Fan_Nudge alternative Gate is always lower risk than the origin
 *
 * For any generated FanNudge with a defined alternativeGateId, that
 * gate's riskLevel in forecastsByGate SHALL be strictly lower
 * (RISK_ORDER) than the origin Gate's riskLevel at generation time.
 * Builds forecastsByGate with a pool of candidate alternative gates at
 * varying risk levels (some lower, some equal/higher than origin) to
 * exercise the filtering logic, mirroring
 * redirections.property27.test.ts for shuttle redirections.
 *
 * Validates: Requirements 9.4
 */
describe("Feature: stadium-congestion-forecasting, Property 33: Fan_Nudge alternative Gate is always lower risk than the origin", () => {
  it("only assigns alternative gates with strictly lower risk than the origin gate", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).map((s) => `fan-${s}`),
        fc.constantFrom<RiskLevel>("HIGH", "CRITICAL"),
        // A pool of candidate gates, each with an independently chosen
        // risk level (may or may not be strictly lower than the origin).
        fc.array(
          fc.record({
            riskLevel: fc.constantFrom(...RISK_LEVELS),
          }),
          { minLength: 0, maxLength: 6 }
        ),
        (fanIdSuffix, originRiskLevel, candidateGateSpecs) => {
          const originGateId: GateId = "origin-gate";
          const originGate = makeGate(originGateId);
          const fan = { fanId: fanIdSuffix };

          const originScore = originRiskLevel === "HIGH" ? 75 : 95;
          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
          ]);

          candidateGateSpecs.forEach((spec, i) => {
            const candidateGateId = `candidate-gate-${i}`;
            const [min] = ((): [number, number] => {
              switch (spec.riskLevel) {
                case "LOW":
                  return [0, 39];
                case "MODERATE":
                  return [40, 69];
                case "HIGH":
                  return [70, 89];
                case "CRITICAL":
                  return [90, 100];
              }
            })();
            forecastsByGate.set(
              candidateGateId,
              makeForecastResult(candidateGateId, spec.riskLevel, min)
            );
          });

          const nudge = generateFanNudge(
            fan,
            originGate,
            forecastsByGate,
            null,
            FIXED_NOW
          );

          expect(nudge).not.toBeNull();

          if (nudge!.alternativeGateId !== undefined) {
            const altForecast = forecastsByGate.get(nudge!.alternativeGateId);
            expect(altForecast).toBeDefined();
            const altRiskLevel = altForecast!.scores[0]!.riskLevel;
            expect(RISK_ORDER[altRiskLevel]).toBeLessThan(RISK_ORDER[originRiskLevel]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
