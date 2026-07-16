import type { FanNudge, Gate, GateId } from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import { currentRiskLevel, currentScore, pickAlternativeGate } from "../congestion-forecaster/risk-comparison.js";

const HIGH_OR_CRITICAL = new Set(["HIGH", "CRITICAL"]);

/** Req 8.4/9.1: minimum interval between nudges to the same fan+gate. */
export const COOLDOWN_PERIOD_MS = 5 * 60 * 1000;

export interface FanContext {
  fanId: string;
}

/**
 * Pure core: generates (or suppresses) a Fan_Nudge for a fan predicted
 * to be heading toward `originGate` (design.md Fan_Notification_System
 * section).
 *
 * Returns null when:
 *  - the Cooldown_Period since `lastNudgeAt` has not yet elapsed (Req 8.4, 9.1), or
 *  - the origin Gate's current predicted Risk_Level is not High/Critical (Req 8.1, 9.2, 9.3).
 *
 * Otherwise returns a FanNudge populated with a strictly-lower-risk
 * alternative Gate when one is available (Req 9.4), always carrying at
 * least one usable alternative -- an alternative Gate when available,
 * else an alternative arrival time (Req 8.2).
 */
export function generateFanNudge(
  fan: FanContext,
  originGate: Gate,
  forecastsByGate: Map<GateId, ForecastResult>,
  lastNudgeAt: Date | null,
  now: Date
): FanNudge | null {
  if (lastNudgeAt) {
    const elapsedMs = now.getTime() - lastNudgeAt.getTime();
    if (elapsedMs < COOLDOWN_PERIOD_MS) {
      return null;
    }
  }

  const originForecast = forecastsByGate.get(originGate.gateId);
  const originRiskLevel = currentRiskLevel(originForecast);

  if (!HIGH_OR_CRITICAL.has(originRiskLevel)) {
    return null;
  }

  const alternativeGateId = pickAlternativeGate(
    originGate.gateId,
    originRiskLevel,
    forecastsByGate
  );

  const generatedAt = now.toISOString();
  // Guaranteed fallback alternative so every nudge carries at least one
  // usable alternative (Req 8.2) even when no lower-risk Gate exists.
  const alternativeArrivalTime = alternativeGateId
    ? undefined
    : new Date(now.getTime() + 20 * 60 * 1000).toISOString();

  const message = alternativeGateId
    ? `${originGate.name} is experiencing ${originRiskLevel} congestion. Consider using Gate ${alternativeGateId} instead.`
    : `${originGate.name} is experiencing ${originRiskLevel} congestion. Consider arriving later, around ${alternativeArrivalTime}.`;

  return {
    nudgeId: `${fan.fanId}-${originGate.gateId}-${generatedAt}`,
    fanId: fan.fanId,
    originGateId: originGate.gateId,
    alternativeGateId,
    alternativeArrivalTime,
    message,
    generatedAt,
    status: "QUEUED",
  };
}
