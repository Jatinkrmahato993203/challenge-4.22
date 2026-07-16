import { describe, it } from "vitest";
import fc from "fast-check";
import { generateRecommendations } from "./recommendations.js";
import { gateArb, riskLevelAndScoreArb, signalEventWindowArb } from "./recommendations.testHelpers.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

describe("Feature: stadium-congestion-forecasting, Property 20: Action_Ranks form a contiguous permutation", () => {
  it("produces actionRank values that are exactly {1, ..., N} with no duplicates or gaps", () => {
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
          const n = actions.length;

          const ranks = actions.map((a) => a.actionRank).sort((a, b) => a - b);
          const expected = Array.from({ length: n }, (_, i) => i + 1);

          if (ranks.length !== expected.length) {
            return false;
          }
          return ranks.every((rank, i) => rank === expected[i]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
