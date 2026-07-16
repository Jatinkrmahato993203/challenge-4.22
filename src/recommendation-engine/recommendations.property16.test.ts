import { describe, it } from "vitest";
import fc from "fast-check";
import { generateRecommendations } from "./recommendations.js";
import { gateArb, riskLevelAndScoreArb, signalEventWindowArb } from "./recommendations.testHelpers.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

describe("Feature: stadium-congestion-forecasting, Property 16: Every action's explanation names its contributing signals", () => {
  it("references a contributing signal id (or is a defined non-empty string when the window is empty), and flags Low_Confidence when applicable", () => {
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

          return actions.every((action) => {
            const { explanation } = action;

            if (typeof explanation !== "string" || explanation.length === 0) {
              return false;
            }

            if (window.length === 0) {
              // No contributing signals available -- explanation must still
              // be a defined, non-empty string (already checked above).
            } else {
              const contributingIds = window.slice(0, 5).map((e) => e.signalId);
              const referencesASignal = contributingIds.some((id) => explanation.includes(id));
              if (!referencesASignal) {
                return false;
              }
            }

            if (lowConfidence && !explanation.includes("Low_Confidence")) {
              return false;
            }

            return true;
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
