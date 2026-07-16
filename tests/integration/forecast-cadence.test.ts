import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ForecastScheduler,
  SCHEDULED_TICK_INTERVAL_MS,
  EVENT_TRIGGERED_RECOMPUTE_BUDGET_MS,
  type ForecastPublisher,
  type SignalWindowProvider,
} from "../../src/congestion-forecaster/scheduler.js";
import { RedisClientWrapper } from "../../src/infra/redis-client.js";
import type { Gate, SignalEvent } from "../../src/types/models.js";
import type { ForecastResult } from "../../src/congestion-forecaster/forecast.js";

/**
 * Integration test (design.md Testing Strategy): asserts the >= 30s
 * scheduled recompute cadence (Req 3.1) and the <= 5s event-triggered
 * recompute cadence (Req 3.3).
 *
 * Requires the docker-composed Redis stack to be running for the
 * last-known-score fallback path exercised by ForecastScheduler.
 */
describe("Integration: Congestion_Forecaster recompute cadence (Req 3.1, 3.3)", () => {
  const gate: Gate = {
    gateId: "gate-a",
    name: "Gate A",
    capacityThreshold: 100,
    assignedRouteIds: [],
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks the scheduled recompute at the configured >= 30s interval", async () => {
    const windowProvider: SignalWindowProvider = {
      async getWindowForGate(): Promise<SignalEvent[]> {
        return [];
      },
    };
    const publishedTicks: ForecastResult[] = [];
    const publisher: ForecastPublisher = {
      async publishForecast(_g, result) {
        publishedTicks.push(result);
      },
    };
    const redis = new RedisClientWrapper();
    const scheduler = new ForecastScheduler(windowProvider, publisher, redis);

    scheduler.startScheduledTicks(gate, SCHEDULED_TICK_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(SCHEDULED_TICK_INTERVAL_MS);
    expect(publishedTicks.length).toBeGreaterThanOrEqual(1);

    scheduler.stopScheduledTicks(gate.gateId);
    await redis.disconnect();
  });

  it("completes an event-triggered recompute within the 5s budget", async () => {
    const windowProvider: SignalWindowProvider = {
      async getWindowForGate(): Promise<SignalEvent[]> {
        return [];
      },
    };
    const publisher: ForecastPublisher = {
      async publishForecast() {
        /* no-op */
      },
    };
    const redis = new RedisClientWrapper();
    const scheduler = new ForecastScheduler(windowProvider, publisher, redis);

    vi.useRealTimers();
    const start = Date.now();
    await scheduler.onSignalEventForGate(gate);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThanOrEqual(EVENT_TRIGGERED_RECOMPUTE_BUDGET_MS);
    await redis.disconnect();
  });
});
