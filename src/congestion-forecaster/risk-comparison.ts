import type { GateId } from "../types/models.js";
import type { ForecastResult } from "./forecast.js";

/**
 * Shared risk-comparison helpers used by both the Shuttle_Redirection_Advisor
 * and Fan_Notification_System to pick a strictly-lower-risk alternative Gate
 * (design.md Shuttle_Redirection_Advisor / Fan_Notification_System sections).
 */

export const RISK_ORDER: Record<string, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export function riskOrderOf(riskLevel: string): number {
  return RISK_ORDER[riskLevel] ?? 0;
}

export function currentRiskLevel(forecast: ForecastResult | undefined): string {
  return forecast?.scores[0]?.riskLevel ?? "LOW";
}

export function currentScore(forecast: ForecastResult | undefined): number {
  return forecast?.scores[0]?.score ?? 0;
}

/**
 * Picks the best alternative Gate: the candidate with the strictly lowest
 * predicted Risk_Level (ties broken by lowest score, then by gateId for
 * determinism). Returns undefined if no gate has a strictly lower risk
 * than the origin.
 */
export function pickAlternativeGate(
  originGateId: GateId,
  originRiskLevel: string,
  forecastsByGate: Map<GateId, ForecastResult>
): GateId | undefined {
  const candidates: { gateId: GateId; riskOrder: number; score: number }[] = [];

  for (const [gateId, forecast] of forecastsByGate.entries()) {
    if (gateId === originGateId) {
      continue;
    }
    const riskLevel = currentRiskLevel(forecast);
    if (riskOrderOf(riskLevel) < riskOrderOf(originRiskLevel)) {
      candidates.push({
        gateId,
        riskOrder: riskOrderOf(riskLevel),
        score: currentScore(forecast),
      });
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => {
    if (a.riskOrder !== b.riskOrder) {
      return a.riskOrder - b.riskOrder;
    }
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return a.gateId.localeCompare(b.gateId);
  });

  return candidates[0]!.gateId;
}
