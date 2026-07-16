import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateRedirections } from "./redirections.js";
import type { RejectionRecord } from "./redirections.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { GateId, RiskLevel } from "../types/models.js";
import {
  FIXED_NOW,
  RISK_LEVELS,
  RISK_ORDER,
  makeForecastResult,
  makeGate,
  makeRoute,
  scoreForRiskLevelArb,
} from "./redirections.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 27: Redirection targets are always lower risk than the origin
 *
 * For any generated recommendation, the alternativeGateId's forecast
 * riskLevel (looked up in forecastsByGate) SHALL be strictly lower (in
 * risk order LOW < MODERATE < HIGH < CRITICAL) than the origin Gate's
 * riskLevel.
 *
 * Validates: Requirements 7.5
 */
describe("Feature: stadium-congestion-forecasting, Property 27: Redirection targets are always lower risk than the origin", () => {
  it("only recommends alternative gates with strictly lower risk than the origin gate", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RiskLevel>("HIGH", "CRITICAL"),
        // A pool of candidate gates, each with an independently chosen
        // risk level (may or may not be strictly lower than the origin).
        fc.array(
          fc.record({
            riskLevel: fc.constantFrom(...RISK_LEVELS),
          }),
          { minLength: 0, maxLength: 6 }
        ),
        fc.integer({ min: 1, max: 3 }),
        (originRiskLevel, candidateGateSpecs, assignedRouteCount) => {
          const originGateId: GateId = "origin-gate";

          const assignedRouteIds = Array.from(
            { length: assignedRouteCount },
            (_, i) => `assigned-route-${i}`
          );
          const originGate = makeGate(originGateId, assignedRouteIds);
          const assignedRoutes = assignedRouteIds.map((id) =>
            makeRoute(id, [originGateId])
          );

          const originScore = originRiskLevel === "HIGH" ? 75 : 95;
          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
          ]);

          candidateGateSpecs.forEach((spec, i) => {
            const candidateGateId = `candidate-gate-${i}`;
            const [min, max] = ((): [number, number] => {
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

          const recentRejections: RejectionRecord[] = [];

          const recommendations = generateRedirections(
            originGate,
            forecastsByGate,
            assignedRoutes,
            recentRejections,
            FIXED_NOW
          );

          for (const rec of recommendations) {
            const altForecast = forecastsByGate.get(rec.alternativeGateId);
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
