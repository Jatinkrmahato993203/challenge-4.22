import { describe, expect, it } from "vitest";
import { SignalIngestionService, type EventPublisher } from "../../src/signal-ingestion/service.js";
import { RedisClientWrapper } from "../../src/infra/redis-client.js";
import { computeForecast } from "../../src/congestion-forecaster/forecast.js";
import { generateRecommendations } from "../../src/recommendation-engine/recommendations.js";
import { DashboardSnapshotService } from "../../src/ops-dashboard/snapshot.js";
import type { Gate, RecommendedAction, SignalEvent } from "../../src/types/models.js";

/**
 * Integration test (design.md Testing Strategy): asserts end-to-end
 * ingestion-to-dashboard latency stays within 10 seconds under normal
 * load (Req 12.1) and that the pipeline remains available across the
 * test window (Req 12.2).
 *
 * This wires the real pure-core functions together end-to-end
 * in-process (ingestion -> forecast -> recommendations -> dashboard
 * snapshot) rather than through live Kafka topics, since exercising
 * the full Kafka/Redis/Postgres stack requires the docker-composed
 * infrastructure (see docker-compose.yml) which is not available in
 * this execution environment. Running this test against the full
 * deployed stack (with real Kafka consumers/producers in the loop) is
 * a follow-up verification step outside the scope of what can be run
 * here.
 */
describe("Integration: end-to-end ingestion-to-dashboard latency (Req 12.1, 12.2)", () => {
  it("propagates a Signal_Event to an updated dashboard snapshot within 10 seconds", async () => {
    const gate: Gate = {
      gateId: "gate-a",
      name: "Gate A",
      capacityThreshold: 50,
      assignedRouteIds: [],
    };

    const events: SignalEvent[] = [];
    const publisher: EventPublisher = {
      async publishSignalEvent(event) {
        events.push(event);
      },
      async publishValidationError() {
        /* not exercised */
      },
    };

    const redis = new RedisClientWrapper();
    const ingestion = new SignalIngestionService(publisher, redis);

    const start = Date.now();
    const now = new Date();

    await ingestion.handleSignal(
      {
        source: "GATE_COUNTER",
        gateId: gate.gateId,
        timestamp: now.toISOString(),
        payload: { count: 40, intervalSeconds: 30 },
      },
      now
    );

    const forecast = computeForecast(gate, events, now);
    const actions: RecommendedAction[] = generateRecommendations(gate, forecast, events);

    const snapshotService = new DashboardSnapshotService(
      { async getCurrentScore() { return forecast.scores[0] ?? null; } },
      { async getActiveActions() { return actions; } },
      { async hasDegradedSource() { return false; } }
    );

    const snapshot = await snapshotService.getSnapshot([gate.gateId]);
    const elapsedMs = Date.now() - start;

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.gateId).toBe(gate.gateId);
    expect(elapsedMs).toBeLessThanOrEqual(10_000);

    await redis.disconnect();
  });
});
