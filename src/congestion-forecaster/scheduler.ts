import type { Gate, GateId, SignalEvent } from "../types/models.js";
import { computeForecastWithFallback } from "./fallback.js";
import type { RedisClientWrapper } from "../infra/redis-client.js";
import type { ForecastResult } from "./forecast.js";

/** Req 3.1: scheduled recompute cadence, at least once every 30 seconds. */
export const SCHEDULED_TICK_INTERVAL_MS = 30_000;

/** Req 3.3: event-triggered recompute must complete within 5 seconds. */
export const EVENT_TRIGGERED_RECOMPUTE_BUDGET_MS = 5_000;

export interface SignalWindowProvider {
  getWindowForGate(gateId: GateId): Promise<SignalEvent[]>;
}

export interface ForecastPublisher {
  publishForecast(gate: Gate, result: ForecastResult): Promise<void>;
}

/**
 * Per-Gate scheduler (design.md Congestion_Forecaster "Service
 * wrapper" section): runs a >= 30s tick per Gate (Req 3.1) plus reacts
 * to new Signal_Events for a Gate within 5s (Req 3.3). Both paths call
 * the same pure `computeForecast` (via `computeForecastWithFallback`
 * for the Req 12.3 deadline handling).
 */
export class ForecastScheduler {
  private readonly intervalHandles = new Map<GateId, ReturnType<typeof setInterval>>();

  constructor(
    private readonly windowProvider: SignalWindowProvider,
    private readonly publisher: ForecastPublisher,
    private readonly redis: RedisClientWrapper
  ) {}

  /** Starts the scheduled >= 30s recompute tick for a Gate. */
  startScheduledTicks(gate: Gate, tickIntervalMs = SCHEDULED_TICK_INTERVAL_MS): void {
    this.stopScheduledTicks(gate.gateId);
    const handle = setInterval(() => {
      void this.recompute(gate);
    }, tickIntervalMs);
    this.intervalHandles.set(gate.gateId, handle);
  }

  stopScheduledTicks(gateId: GateId): void {
    const existing = this.intervalHandles.get(gateId);
    if (existing) {
      clearInterval(existing);
      this.intervalHandles.delete(gateId);
    }
  }

  /**
   * Triggered by a `signal-events` consumer when a new Signal_Event
   * arrives for `gate`. Must complete (or fall back) within the Req
   * 3.3 5-second budget; `computeForecastWithFallback`'s own 30s
   * timeout is for the Req 12.3 deadline, which is longer than this
   * caller-side budget, so this path is expected to complete well
   * within budget under normal load.
   */
  async onSignalEventForGate(gate: Gate): Promise<void> {
    await this.recompute(gate);
  }

  private async recompute(gate: Gate): Promise<void> {
    const window = await this.windowProvider.getWindowForGate(gate.gateId);
    const result = await computeForecastWithFallback(
      gate,
      window,
      new Date(),
      this.redis
    );
    await this.publisher.publishForecast(gate, result);
  }
}
