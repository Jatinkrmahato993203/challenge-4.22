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
 * Feature: stadium-congestion-forecasting, Property 26: Rejection suppresses identical recommendations for 5 minutes
 *
 * For any origin Gate/route/alternative-gate combination that would
 * otherwise generate a recommendation, if a RejectionRecord exists for
 * that exact (routeId, alternativeGateId) pair with rejectedAt within the
 * last REJECTION_SUPPRESSION_MS (5 minutes) of `now`, generateRedirections
 * SHALL NOT include a recommendation for that route.
 *
 * Validates: Requirements 7.4
 */
describe("Feature: stadium-congestion-forecasting, Property 26: Rejection suppresses identical recommendations for 5 minutes", () => {
  it("omits a route's recommendation once a matching rejection exists within the suppression window", () => {
    fc.assert(
      fc.property(
        highOrCriticalRiskLevelArb(),
        fc.integer({ min: 1, max: 4 }),
        // Age of the rejection, strictly within the 5-minute suppression
        // window (0ms up to just under 5 minutes old).
        fc.integer({ min: 0, max: 5 * 60 * 1000 - 1 }),
        (originRiskLevel, assignedRouteCount, rejectionAgeMs) => {
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
            [
              originGateId,
              makeForecastResult(
                originGateId,
                originRiskLevel,
                originRiskLevel === "HIGH" ? 75 : 95
              ),
            ],
            [alternativeGateId, makeForecastResult(alternativeGateId, "LOW", 10)],
          ]);

          // Baseline run: no rejections, so every assigned route should be
          // recommended, targeting the single available alternative gate.
          const baseline = generateRedirections(
            originGate,
            forecastsByGate,
            assignedRoutes,
            [],
            FIXED_NOW
          );

          expect(baseline.length).toBe(assignedRouteCount);

          // Pick one recommendation from the baseline run and capture the
          // exact (routeId, alternativeGateId) pair it targets.
          const target = baseline[0]!;
          expect(target.alternativeGateId).toBe(alternativeGateId);

          const rejectedAt = new Date(
            FIXED_NOW.getTime() - rejectionAgeMs
          ).toISOString();

          const recentRejections: RejectionRecord[] = [
            {
              routeId: target.routeId,
              alternativeGateId: target.alternativeGateId,
              rejectedAt,
            },
          ];

          const suppressedRun = generateRedirections(
            originGate,
            forecastsByGate,
            assignedRoutes,
            recentRejections,
            FIXED_NOW
          );

          const suppressedRouteIds = suppressedRun.map((rec) => rec.routeId);
          expect(suppressedRouteIds).not.toContain(target.routeId);

          // All other assigned routes should still be recommended.
          expect(suppressedRun.length).toBe(assignedRouteCount - 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
