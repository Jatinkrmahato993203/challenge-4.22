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
  scoreForRiskLevelArb,
} from "./redirections.testkit.js";

/**
 * Feature: stadium-congestion-forecasting, Property 23: High/Critical prediction covers every assigned route
 *
 * For any origin Gate whose current forecast riskLevel is HIGH or CRITICAL,
 * with N routes assigned to it, AND at least one alternative Gate available
 * with a strictly lower risk level than the origin, AND no active
 * rejections suppressing any of them, generateRedirections SHALL return
 * exactly one recommendation per assigned route.
 *
 * Validates: Requirements 7.1, 7.5
 */
describe("Feature: stadium-congestion-forecasting, Property 23: High/Critical prediction covers every assigned route", () => {
  it("returns exactly one recommendation per route assigned to a High/Critical origin gate when an alternative exists", () => {
    fc.assert(
      fc.property(
        highOrCriticalRiskLevelArb(),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 3 }),
        (originRiskLevel, alternativeScore, assignedRouteCount, extraUnassignedRouteCount) => {
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
          const unassignedRoutes = Array.from(
            { length: extraUnassignedRouteCount },
            (_, i) => makeRoute(`unassigned-route-${i}`, [alternativeGateId])
          );
          const allRoutes = [...assignedRoutes, ...unassignedRoutes];

          // Origin score can be any value within the HIGH/CRITICAL range;
          // the alternative gate is fixed at LOW risk (score 0-39) so a
          // strictly-lower-risk alternative is always guaranteed to exist.
          const originForecast: ForecastResult = makeForecastResult(
            originGateId,
            originRiskLevel,
            originRiskLevel === "HIGH" ? 75 : 95
          );
          const alternativeForecast: ForecastResult = makeForecastResult(
            alternativeGateId,
            "LOW",
            Math.min(alternativeScore, 39)
          );

          const forecastsByGate = new Map<GateId, ForecastResult>([
            [originGateId, originForecast],
            [alternativeGateId, alternativeForecast],
          ]);

          const recentRejections: RejectionRecord[] = [];

          const recommendations = generateRedirections(
            originGate,
            forecastsByGate,
            allRoutes,
            recentRejections,
            FIXED_NOW
          );

          const expectedCount = allRoutes.filter((route) =>
            originGate.assignedRouteIds.includes(route.routeId)
          ).length;

          expect(recommendations.length).toBe(expectedCount);

          const recommendedRouteIds = new Set(
            recommendations.map((rec) => rec.routeId)
          );
          for (const routeId of assignedRouteIds) {
            expect(recommendedRouteIds.has(routeId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
