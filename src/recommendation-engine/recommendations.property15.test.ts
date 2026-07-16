import { describe, it } from "vitest";
import fc from "fast-check";
import { generateRecommendations } from "./recommendations.js";
import { gateArb, riskLevelAndScoreArb, signalEventWindowArb } from "./recommendations.testHelpers.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

describe("Feature: stadium-congestion-forecasting, Property 15: Moderate-or-higher risk always yields at least one action", () => {
  it("returns a non-empty action list whenever the current risk level is Moderate, High, or Critical", () => {
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
          return actions.length > 0;
        }
      ),
      { numRuns: 100 }
    );
  });
});
