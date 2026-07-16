import type { CongestionScorePoint, Gate, SignalEvent } from "../types/models.js";
import { deriveRiskLevel } from "./risk-level.js";

export interface ForecastResult {
  scores: CongestionScorePoint[];
  lowConfidence: boolean;
}

/** Forecast_Horizon: 0..15 minutes, in steps <= 5 minutes (Req 3.2). */
const FORECAST_OFFSETS_MINUTES = [0, 5, 10, 15] as const;

/**
 * Offset growth factors representing an assumed linear buildup over the
 * Forecast_Horizon. These depend ONLY on the offset (not on the input
 * Signal_Events), so scaling the base score up or down (as happens when
 * the incoming count changes) preserves ordering at every offset --
 * this is what makes the monotonicity property (Req 4.2) hold across
 * the whole forecast series, not just at offset 0.
 */
const OFFSET_GROWTH_FACTOR: Record<number, number> = {
  0: 1.0,
  5: 1.05,
  10: 1.1,
  15: 1.15,
};

/** Window lookback used to judge whether a Gate's forecast is Low_Confidence (Req 3.5). */
const RECENT_WINDOW_MS = 10 * 60 * 1000;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * Computes the "incoming count" contribution of a single Signal_Event
 * toward a Gate's congestion. Each source type contributes the number
 * of people it represents heading through/toward the Gate.
 */
function incomingCountFor(event: SignalEvent): number {
  switch (event.source) {
    case "GATE_COUNTER": {
      const payload = event.payload as { count: number };
      return Math.max(0, payload.count);
    }
    case "TICKET_SCANNER": {
      // Each Ticket_Scan represents exactly one fan validated at the gate.
      return 1;
    }
    case "TRANSIT_FEED": {
      const payload = event.payload as { estimatedPassengerCount: number };
      return Math.max(0, payload.estimatedPassengerCount);
    }
    default:
      return 0;
  }
}

/**
 * Pure core forecasting function (design.md Congestion_Forecaster section).
 *
 * computeForecast is a deterministic function of (gate, window, now) only:
 * no I/O, no hidden state, no randomness -- required for Req 4.4's
 * determinism property and for property-based testing without mocking
 * Kafka/Redis/Postgres.
 *
 * Contract reconciliation between Req 4.5 and Req 3.5: `window` is
 * expected to already be filtered to non-stale events within the last
 * 10 minutes for this gate (per the design's documented parameter
 * contract). When `window` is empty -- whether because no Signal_Events
 * exist at all (Req 4.5) or because all recent Signal_Events aged out /
 * were excluded as stale (Req 3.5) -- this function returns a defined
 * score of 0 with Risk_Level Low (never an error, satisfying Req 4.5)
 * and flags the result Low_Confidence (satisfying Req 3.5's "mark ...
 * Low_Confidence" clause). Retaining/continuing to display the actual
 * prior Congestion_Score instead of this 0 fallback ("rather than
 * discarding the prior Congestion_Score") is the responsibility of the
 * stateful service wrapper (last-known-score cache in Redis, see
 * src/congestion-forecaster/fallback.ts), since this pure function has
 * no access to prior computations by design.
 */
export function computeForecast(
  gate: Gate,
  window: SignalEvent[],
  now: Date
): ForecastResult {
  const nonStaleRecent = window.filter((event) => {
    if (event.isStale) {
      return false;
    }
    const ageMs = now.getTime() - new Date(event.timestamp).getTime();
    return ageMs <= RECENT_WINDOW_MS;
  });

  const lowConfidence = nonStaleRecent.length === 0;

  const totalIncomingCount = nonStaleRecent.reduce(
    (sum, event) => sum + incomingCountFor(event),
    0
  );

  const capacityThreshold = Math.max(1, gate.capacityThreshold);
  const baseScore = clampScore((totalIncomingCount / capacityThreshold) * 100);

  const scores: CongestionScorePoint[] = FORECAST_OFFSETS_MINUTES.map(
    (offsetMinutes) => {
      const factor = OFFSET_GROWTH_FACTOR[offsetMinutes] ?? 1.0;
      const score = clampScore(Math.round(baseScore * factor));
      const forecastTime = new Date(
        now.getTime() + offsetMinutes * 60 * 1000
      ).toISOString();

      return {
        gateId: gate.gateId,
        forecastTime,
        offsetMinutes,
        score,
        riskLevel: deriveRiskLevel(score),
        lowConfidence,
        outdated: false,
      };
    }
  );

  return { scores, lowConfidence };
}
