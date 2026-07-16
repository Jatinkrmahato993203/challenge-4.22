import { describe, it } from "vitest";
import fc from "fast-check";
import { generateRecommendations } from "./recommendations.js";
import { gateArb, riskLevelAndScoreArb, signalEventWindowArb } from "./recommendations.testHelpers.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

describe("Feature: stadium-congestion-forecasting, Property 21: Recommendation generation is deterministic", () => {
  it("produces identical output for identical (gate, forecast, window) inputs on repeated calls", () => {
    fc.assert(
      fc.property(
        gateArb,
        riskLevelAndScoreArb("LOW", "MODERATE", "HIGH", "CRITICAL"),
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

          // generatedAt (and thus actionId, which is derived from gateId +
          // generatedAt + actionType) is sourced from forecast.scores[0].forecastTime
          // here, which is fixed across both calls -- so the full output,
          // including actionId/generatedAt, is expected to be deep-equal.
          const first = generateRecommendations(gate, forecast, window);
          const second = generateRecommendations(gate, forecast, window);

          return JSON.stringify(first) === JSON.stringify(second);
        }
      ),
      { numRuns: 100 }
    );
  });
});
