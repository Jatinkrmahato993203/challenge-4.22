import type { CongestionScorePoint, GateId } from "../types/models.js";

export interface GateForecastResponse {
  gateId: GateId;
  scores: CongestionScorePoint[];
  riskLevel: CongestionScorePoint["riskLevel"];
  lowConfidence: boolean;
  outdated: boolean;
}

export interface ForecastStore {
  getLatestForecast(gateId: GateId): Promise<CongestionScorePoint[] | null>;
}

/**
 * Implements `GET /v1/gates/{gate_id}/forecast` (design.md
 * Congestion_Forecaster API surface): returns the current
 * Congestion_Score series across the Forecast_Horizon, Risk_Level, and
 * the `lowConfidence`/`outdated` flags (Req 3.2, 3.5, 12.3).
 */
export class ForecastApi {
  constructor(private readonly store: ForecastStore) {}

  async getForecast(gateId: GateId): Promise<GateForecastResponse | null> {
    const scores = await this.store.getLatestForecast(gateId);
    if (!scores || scores.length === 0) {
      return null;
    }

    const current = scores[0]!;
    return {
      gateId,
      scores,
      riskLevel: current.riskLevel,
      lowConfidence: scores.some((s) => s.lowConfidence),
      outdated: scores.some((s) => s.outdated),
    };
  }
}
