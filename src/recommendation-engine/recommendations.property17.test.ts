import { describe, it } from "vitest";
import fc from "fast-check";
import { generateRecommendations } from "./recommendations.js";
import { gateArb, riskLevelAndScoreArb, signalEventWindowArb } from "./recommendations.testHelpers.js";
import type { ActionType } from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

const VALID_ACTION_TYPES: ActionType[] = [
  "OPEN_GATE_LANE",
  "REDIRECT_SHUTTLE_ROUTE",
  "HOLD_TRANSIT_ARRIVAL",
  "FAN_NUDGE_CAMPAIGN",
];

describe("Feature: stadium-congestion-forecasting, Property 17: Action type is always one of the defined types", () => {
  it("only ever produces actionType values from the fixed ActionType set", () => {
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
          return actions.every((action) => VALID_ACTION_TYPES.includes(action.actionType));
        }
      ),
      { numRuns: 100 }
    );
  });
});
