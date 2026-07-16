import type {
  ActionType,
  Gate,
  RecommendedAction,
  SignalEvent,
} from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import { deriveRiskLevel } from "../congestion-forecaster/risk-level.js";

/** All candidate action types considered for every Gate at/above Moderate risk (Req 5.4). */
const CANDIDATE_ACTION_TYPES: ActionType[] = [
  "OPEN_GATE_LANE",
  "REDIRECT_SHUTTLE_ROUTE",
  "HOLD_TRANSIT_ARRIVAL",
  "FAN_NUDGE_CAMPAIGN",
];

/**
 * Deterministic, input-driven "predicted risk-reduction impact" per
 * candidate action type. Each action type responds to a different slice
 * of the current signal window, so the ranking is a genuine function of
 * the inputs (not an arbitrary fixed order) while still being fully
 * deterministic (Req 6.3) given the same window + forecast.
 */
function impactForActionType(
  actionType: ActionType,
  currentScore: number,
  window: SignalEvent[]
): number {
  const gateCounterEvents = window.filter((e) => e.source === "GATE_COUNTER");
  const ticketScanEvents = window.filter((e) => e.source === "TICKET_SCANNER");
  const transitEvents = window.filter((e) => e.source === "TRANSIT_FEED");

  switch (actionType) {
    case "OPEN_GATE_LANE":
      // Directly reduces gate-side throughput pressure; scales with
      // current score and the volume of gate-counter/ticket-scan activity.
      return currentScore * 1.0 + gateCounterEvents.length * 2 + ticketScanEvents.length * 0.5;
    case "REDIRECT_SHUTTLE_ROUTE":
      // Effective when transit arrivals are a significant contributor.
      return currentScore * 0.9 + transitEvents.length * 3;
    case "HOLD_TRANSIT_ARRIVAL":
      // A more conservative transit-side lever than redirection.
      return currentScore * 0.7 + transitEvents.length * 2;
    case "FAN_NUDGE_CAMPAIGN":
      // Slower-acting (relies on fans changing behavior), lowest base impact.
      return currentScore * 0.5 + ticketScanEvents.length * 0.3;
    default:
      return 0;
  }
}

function buildExplanation(
  actionType: ActionType,
  window: SignalEvent[],
  forecast: ForecastResult
): string {
  const contributingIds = window.slice(0, 5).map((e) => e.signalId);
  const idsPart =
    contributingIds.length > 0
      ? `contributing signals: ${contributingIds.join(", ")}`
      : "no contributing signals in the current window";

  const base = `Recommended ${actionType} based on ${idsPart} and current Congestion_Score of ${forecast.scores[0]?.score ?? 0}.`;

  return forecast.lowConfidence ? `${base} Low_Confidence: forecast based on limited recent signal data.` : base;
}

/**
 * Pure core: generates a ranked, explained Recommended_Action list for
 * a single Gate (design.md Recommendation_Engine section).
 *
 * - Only produces actions when currentRiskLevel is Moderate or higher (Req 5.1).
 * - Scores every candidate action type by predicted risk-reduction impact,
 *   sorts descending, assigns sequential Action_Ranks starting at 1 (Req 5.2, 6.1, 6.2).
 * - Attaches an Explanation referencing contributing Signal_Events / score
 *   factors, including a Low_Confidence token when applicable (Req 5.3, 11.3).
 * - Is a deterministic function of (gate, forecast, window) only -- no
 *   randomness, no I/O, no hidden state (Req 6.3).
 */
export function generateRecommendations(
  gate: Gate,
  forecast: ForecastResult,
  window: SignalEvent[]
): RecommendedAction[] {
  const currentPoint = forecast.scores[0];
  const currentScore = currentPoint?.score ?? 0;
  const currentRiskLevel = currentPoint?.riskLevel ?? deriveRiskLevel(currentScore);

  if (currentRiskLevel === "LOW") {
    return [];
  }

  const generatedAt = currentPoint?.forecastTime ?? new Date().toISOString();

  const scored = CANDIDATE_ACTION_TYPES.map((actionType) => ({
    actionType,
    impact: impactForActionType(actionType, currentScore, window),
  }));

  // Sort descending by impact; break ties by action type name for
  // determinism (stable, total order over the fixed candidate set).
  scored.sort((a, b) => {
    if (b.impact !== a.impact) {
      return b.impact - a.impact;
    }
    return a.actionType.localeCompare(b.actionType);
  });

  return scored.map((entry, index) => ({
    actionId: `${gate.gateId}-${generatedAt}-${entry.actionType}`,
    gateId: gate.gateId,
    actionType: entry.actionType,
    actionRank: index + 1,
    explanation: buildExplanation(entry.actionType, window, forecast),
    generatedAt,
  }));
}
