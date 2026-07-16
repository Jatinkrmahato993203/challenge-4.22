import { describe, expect, it } from "vitest";
import {
  RecommendationEngineService,
  RECOMMENDATION_REGENERATION_BUDGET_MS,
  type ActiveActionsStore,
  type RecommendationPublisher,
  type SignalWindowProvider,
} from "../../src/recommendation-engine/service.js";
import type { Gate, RecommendedAction, SignalEvent } from "../../src/types/models.js";
import type { ForecastResult } from "../../src/congestion-forecaster/forecast.js";

/**
 * Integration test (design.md Testing Strategy): asserts the
 * Recommended_Action list regenerates within 5 seconds of a
 * Congestion_Score update (Req 5.6).
 */
describe("Integration: Recommendation_Engine regeneration cadence (Req 5.6)", () => {
  it("regenerates the active action list within 5 seconds of a score update", async () => {
    const gate: Gate = {
      gateId: "gate-a",
      name: "Gate A",
      capacityThreshold: 100,
      assignedRouteIds: [],
    };

    const windowProvider: SignalWindowProvider = {
      async getWindowForGate(): Promise<SignalEvent[]> {
        return [
          {
            signalId: "s1",
            source: "GATE_COUNTER",
            gateId: gate.gateId,
            timestamp: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            payload: { count: 80, intervalSeconds: 30 },
            isStale: false,
            lateArrivalFlag: false,
          },
        ];
      },
    };

    let stored: RecommendedAction[] = [];
    const store: ActiveActionsStore = {
      async getActiveActions() {
        return stored;
      },
      async setActiveActions(_gateId, actions) {
        stored = actions;
      },
    };

    let published: RecommendedAction[] = [];
    const publisher: RecommendationPublisher = {
      async publishActions(_gateId, actions) {
        published = actions;
      },
    };

    const service = new RecommendationEngineService(windowProvider, store, publisher);

    const forecast: ForecastResult = {
      scores: [
        {
          gateId: gate.gateId,
          forecastTime: new Date().toISOString(),
          offsetMinutes: 0,
          score: 80,
          riskLevel: "HIGH",
          lowConfidence: false,
          outdated: false,
        },
      ],
      lowConfidence: false,
    };

    const start = Date.now();
    const actions = await service.onScoreUpdate(gate, forecast);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThanOrEqual(RECOMMENDATION_REGENERATION_BUDGET_MS);
    expect(actions.length).toBeGreaterThan(0);
    expect(published).toEqual(actions);
  });
});
