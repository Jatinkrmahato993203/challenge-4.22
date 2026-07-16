import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateRedirections } from "./redirections.js";
import type { RejectionRecord } from "./redirections.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { GateId } from "../types/models.js";
import {
  FIXED_NOW,
  highOrCriticalRiskLevelArb,
  makeForecastResult,
  makeGate,
  makeRoute,
} from "./redirections.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 24: Redirection explanation cites its inputs
 *
 * For any generated recommendation, its explanation SHALL be a non-empty
 * string containing the origin gate's riskLevel and the origin's numeric
 * score. redirections.ts currently embeds the literal tokens
 * `Congestion_Score ${originScore}` and `Risk_Level ${originRiskLevel}`
 * in the explanation template, so those exact substrings are asserted.
 *
 * Validates: Requirements 7.2
 */
describe("Feature: stadium-congestion-forecasting, Property 24: Redirection explanation cites its inputs", () => {
  it("includes the origin's Congestion_Score and Risk_Level in every recommendation's explanation", () => {
    fc.assert(
      fc.property(
        highOrCriticalRiskLevelArb(),
        fc.integer({ min: 70, max: 100 }),
        fc.integer({ min: 1, max: 5 }),
        (originRiskLevel, rawOriginScore, assignedRouteCount) => {
          // Clamp the score into the range consistent with the chosen
          // risk level so the forecast stub is internally coherent.
          const originScore =
            originRiskLevel === "HIGH"
              ? Math.min(rawOriginScore, 89)
              : Math.max(rawOriginScore, 90);

          const originGateId: GateId = "origin-gate";
          const alternativeGateId: GateId = "alt-gate-low";

          const assignedRouteIds = Array.from(
            { length: assignedRouteCount },
            (_, i) => `assigned-route-${i}`
          );
          const originGate = makeGate(originGateId, assignedRouteIds);
          const assignedRoutes = assignedRouteIds.map((id) =>
            makeRoute(id, [originGateId])
          );

          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, makeForecastResult(originGateId, originRiskLevel, originScore)],
            [alternativeGateId, makeForecastResult(alternativeGateId, "LOW", 10)],
          ]);

          const recentRejections: RejectionRecord[] = [];

          const recommendations = generateRedirections(
            originGate,
            forecastsByGate,
            assignedRoutes,
            recentRejections,
            FIXED_NOW
          );

          expect(recommendations.length).toBeGreaterThan(0);

          for (const rec of recommendations) {
            expect(typeof rec.explanation).toBe("string");
            expect(rec.explanation.length).toBeGreaterThan(0);
            expect(rec.explanation).toContain(`Congestion_Score ${originScore}`);
            expect(rec.explanation).toContain(`Risk_Level ${originRiskLevel}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
