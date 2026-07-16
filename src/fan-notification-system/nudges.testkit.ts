import fc from "fast-check";
import type { Gate, GateId, RiskLevel, RouteId } from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

/**
 * Shared fast-check arbitrary helpers for Fan_Notification_System
 * property tests. Mirrors the score ranges from
 * src/congestion-forecaster/risk-level.ts (Req 3.4 / 4.3) and the risk
 * ordering from src/congestion-forecaster/risk-comparison.ts, following
 * the same pattern as src/shuttle-redirection-advisor/redirections.testkit.ts.
 *
 * This is a non-test module (no describe/it blocks) so importing it from
 * multiple *.test.ts files does not re-trigger any test suite.
 */

export const RISK_LEVELS: RiskLevel[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

export const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/** Fixed, deterministic "now" used across property tests. */
export const FIXED_NOW = new Date("2024-01-01T12:00:00.000Z");

export function scoreRangeFor(riskLevel: RiskLevel): [number, number] {
  switch (riskLevel) {
    case "LOW":
      return [0, 39];
    case "MODERATE":
      return [40, 69];
    case "HIGH":
      return [70, 89];
    case "CRITICAL":
      return [90, 100];
  }
}

export function riskLevelArb(): fc.Arbitrary<RiskLevel> {
  return fc.constantFrom(...RISK_LEVELS);
}

export function highOrCriticalRiskLevelArb(): fc.Arbitrary<RiskLevel> {
  return fc.constantFrom<RiskLevel>("HIGH", "CRITICAL");
}

export function lowOrModerateRiskLevelArb(): fc.Arbitrary<RiskLevel> {
  return fc.constantFrom<RiskLevel>("LOW", "MODERATE");
}

export function scoreForRiskLevelArb(riskLevel: RiskLevel): fc.Arbitrary<number> {
  const [min, max] = scoreRangeFor(riskLevel);
  return fc.integer({ min, max });
}

/**
 * Builds a minimal ForecastResult stub: only scores[0].riskLevel and
 * scores[0].score are exercised by generateFanNudge / simulateDelivery
 * (via risk-comparison.ts), so the rest of the CongestionScorePoint
 * fields are filled with realistic-but-inert defaults.
 */
export function makeForecastResult(
  gateId: GateId,
  riskLevel: RiskLevel,
  score: number,
  now: Date = FIXED_NOW
): ForecastResult {
  return {
    scores: [
      {
        gateId,
        forecastTime: now.toISOString(),
        offsetMinutes: 0,
        score,
        riskLevel,
        lowConfidence: false,
        outdated: false,
      },
    ],
    lowConfidence: false,
  };
}

export function makeGate(gateId: GateId, assignedRouteIds: RouteId[] = []): Gate {
  return {
    gateId,
    name: `Gate ${gateId}`,
    capacityThreshold: 100,
    assignedRouteIds,
  };
}
