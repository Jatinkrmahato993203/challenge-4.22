import type { RedisClientWrapper } from "../infra/redis-client.js";
import type { SignalSource } from "../types/models.js";

/**
 * Per-source-type timeout configuration (Req 1.5: "a configured
 * source-specific timeout").
 */
export const SOURCE_TIMEOUT_MS: Record<SignalSource, number> = {
  GATE_COUNTER: 45_000,
  TICKET_SCANNER: 45_000,
  TRANSIT_FEED: 90_000,
};

/**
 * Degraded-source detection (design.md Signal_Ingestion_Service
 * section, Req 1.5): a Redis TTL timer per (sourceType, gateOrRouteId)
 * key. Receiving a Signal_Event refreshes ("touches") the timer;
 * letting the TTL expire is what flips the source to degraded. This
 * module wraps that Redis interaction so the service layer has a
 * simple markActive/isDegraded interface.
 */
export class DegradedSourceTracker {
  constructor(private readonly redis: RedisClientWrapper) {}

  /** Called whenever a Signal_Event is received from this source; resets its timer. */
  async markActive(sourceType: SignalSource, gateOrRouteId: string): Promise<void> {
    const timeoutMs = SOURCE_TIMEOUT_MS[sourceType];
    await this.redis.touchSource(sourceType, gateOrRouteId, timeoutMs);
  }

  /** True if the source's timer has expired (no Signal_Event within its timeout). */
  async isDegraded(sourceType: SignalSource, gateOrRouteId: string): Promise<boolean> {
    return this.redis.isSourceDegraded(sourceType, gateOrRouteId);
  }
}
