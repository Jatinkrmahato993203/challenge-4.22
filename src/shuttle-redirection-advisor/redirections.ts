import type {
  Gate,
  GateId,
  ShuttleRedirectionRecommendation,
  ShuttleRoute,
} from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import { currentRiskLevel, currentScore, pickAlternativeGate } from "../congestion-forecaster/risk-comparison.js";

const HIGH_OR_CRITICAL = new Set(["HIGH", "CRITICAL"]);

/** Req 7.4: rejected recommendations are suppressed for 5 minutes. */
export const REJECTION_SUPPRESSION_MS = 5 * 60 * 1000;

export interface RejectionRecord {
  routeId: string;
  alternativeGateId: GateId;
  rejectedAt: string; // ISO 8601
}

function isSuppressed(
  routeId: string,
  alternativeGateId: GateId,
  recentRejections: RejectionRecord[],
  now: Date
): boolean {
  return recentRejections.some((rejection) => {
    if (rejection.routeId !== routeId) {
      return false;
    }
    if (rejection.alternativeGateId !== alternativeGateId) {
      return false;
    }
    const rejectedAtMs = new Date(rejection.rejectedAt).getTime();
    return now.getTime() - rejectedAtMs < REJECTION_SUPPRESSION_MS;
  });
}

/**
 * Pure core: generates Shuttle_Route redirection recommendations for an
 * origin Gate predicted to reach High/Critical risk within the
 * Forecast_Horizon (design.md Shuttle_Redirection_Advisor section).
 *
 * - Only triggers when the origin Gate's current predicted Risk_Level is
 *   High or Critical (Req 7.1).
 * - Produces one recommendation per Shuttle_Route currently assigned to
 *   the origin Gate (Req 7.1).
 * - Filters alternative Gates to those with a strictly lower predicted
 *   Risk_Level than the origin (Req 7.5).
 * - Excludes any recommendation identical to one rejected for the same
 *   route within the last 5 minutes (Req 7.4).
 * - Attaches an Explanation referencing the Congestion_Score and
 *   Transit_Arrival-derived data that produced it (Req 7.2).
 */
export function generateRedirections(
  originGate: Gate,
  forecastsByGate: Map<GateId, ForecastResult>,
  assignedRoutes: ShuttleRoute[],
  recentRejections: RejectionRecord[],
  now: Date = new Date()
): ShuttleRedirectionRecommendation[] {
  const originForecast = forecastsByGate.get(originGate.gateId);
  const originRiskLevel = currentRiskLevel(originForecast);
  const originScore = currentScore(originForecast);

  if (!HIGH_OR_CRITICAL.has(originRiskLevel)) {
    return [];
  }

  const routesForOrigin = assignedRoutes.filter((route) =>
    originGate.assignedRouteIds.includes(route.routeId)
  );

  const generatedAt = now.toISOString();
  const recommendations: ShuttleRedirectionRecommendation[] = [];

  for (const route of routesForOrigin) {
    const alternativeGateId = pickAlternativeGate(
      originGate.gateId,
      originRiskLevel,
      forecastsByGate
    );

    if (!alternativeGateId) {
      // No strictly-lower-risk alternative currently available; skip
      // this route rather than violate the Req 7.5 invariant.
      continue;
    }

    if (isSuppressed(route.routeId, alternativeGateId, recentRejections, now)) {
      continue;
    }

    recommendations.push({
      recommendationId: `${route.routeId}-${originGate.gateId}-${generatedAt}`,
      routeId: route.routeId,
      originGateId: originGate.gateId,
      alternativeGateId,
      explanation: `Route ${route.routeId} redirected from ${originGate.gateId} (Congestion_Score ${originScore}, Risk_Level ${originRiskLevel}, driven by Transit_Arrival volume) to lower-risk Gate ${alternativeGateId}.`,
      generatedAt,
      status: "PENDING",
    });
  }

  return recommendations;
}
