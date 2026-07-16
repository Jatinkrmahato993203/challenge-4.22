import { describe, it } from "vitest";
import fc from "fast-check";
import { generateRecommendations } from "./recommendations.js";
import { gateArb, riskLevelAndScoreArb, signalEventWindowArb } from "./recommendations.testHelpers.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

describe("Feature: stadium-congestion-forecasting, Property 19: Recommended_Actions are sorted by descending impact", () => {
  it("returns actions already ordered by ascending actionRank (rank 1 first), consistent with descending impact", () => {
    fc.assert(
      fc.property(
        gateArb,
        riskLevelAndScoreArb("MODERATE", "HIGH", "CRITICAL"),
        signalEventWindowArb(),
        fc.boolean(),
        (gate, { riskLevel, score }, window, lowConfidence) => {
          const forecast: ForecastResult = {
            scores: [
              {
                gateId: gate.gateId,
                forecastTime: new Date(2024, 0, 1).toISOString(),
                offsetMinutes: 0,
                score,
                riskLevel,
                lowConfidence,
                outdated: false,
              },
            ],
            lowConfidence,
          };

          const actions = generateRecommendations(gate, forecast, window);

          // Only meaningful to check ordering when there are >= 2 actions.
          fc.pre(actions.length >= 2);

          for (let i = 0; i < actions.length - 1; i++) {
            if (!(actions[i]!.actionRank < actions[i + 1]!.actionRank)) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
