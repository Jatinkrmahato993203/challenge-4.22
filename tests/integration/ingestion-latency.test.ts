import { describe, expect, it } from "vitest";
import { SignalIngestionService, type EventPublisher } from "../../src/signal-ingestion/service.js";
import { RedisClientWrapper } from "../../src/infra/redis-client.js";
import type { SignalEvent } from "../../src/types/models.js";
import type { ValidationError } from "../../src/signal-ingestion/parser.js";

/**
 * Integration test (design.md Testing Strategy: "Integration tests"):
 * asserts Signal_Events are recorded within 2 seconds of receipt
 * (Req 1.1).
 *
 * Requires the docker-composed Redis/Kafka stack (see docker-compose.yml
 * at the repo root: `docker compose up -d`) to be running. The publisher
 * below stands in for the real Kafka producer -- swap in a Kafka-backed
 * EventPublisher when running this against a full deployment; what this
 * test measures is the ingestion service's own recording latency, which
 * is independent of the transport used downstream.
 */
describe("Integration: Signal_Event ingestion latency (Req 1.1)", () => {
  it("records a Signal_Event within 2 seconds of receipt", async () => {
    const recorded: SignalEvent[] = [];
    const publisher: EventPublisher = {
      async publishSignalEvent(event) {
        recorded.push(event);
      },
      async publishValidationError(_error: ValidationError) {
        // not exercised in this happy-path test
      },
    };

    const redis = new RedisClientWrapper();
    const service = new SignalIngestionService(publisher, redis);

    const now = new Date();
    const start = Date.now();

    const result = await service.handleSignal(
      {
        source: "GATE_COUNTER",
        gateId: "gate-a",
        timestamp: now.toISOString(),
        payload: { count: 10, intervalSeconds: 30 },
      },
      now
    );

    const elapsedMs = Date.now() - start;

    expect(result.status).toBe(202);
    expect(recorded).toHaveLength(1);
    expect(elapsedMs).toBeLessThanOrEqual(2000);

    await redis.disconnect();
  });
});
