import Redis from "ioredis";
import type { CongestionScorePoint, GateId, RouteId } from "../types/models.js";

/**
 * Redis client wrapper (design.md "Low-latency shared state" section).
 *
 * Exposes the three stateful concerns that need sub-millisecond
 * read/write with TTL semantics per the design's rationale:
 *   - Cooldown tracking for Fan_Nudges (Req 8.4, 9.1)
 *   - Degraded-source timers (Req 1.5)
 *   - Last-known Congestion_Score cache for the outdated-fallback path (Req 12.3)
 */

const COOLDOWN_KEY_PREFIX = "cooldown";
const DEGRADED_SOURCE_KEY_PREFIX = "degraded-source";
const LAST_KNOWN_SCORE_KEY_PREFIX = "last-known-score";

export interface RedisClientOptions {
  host?: string;
  port?: number;
  /** Allows tests/integration harnesses to inject an existing ioredis instance. */
  client?: Redis;
}

export class RedisClientWrapper {
  private readonly client: Redis;

  constructor(options: RedisClientOptions = {}) {
    this.client =
      options.client ??
      new Redis({
        host: options.host ?? "localhost",
        port: options.port ?? 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
  }

  // ---- Cooldown tracking (Req 8.4, 9.1) ----

  private cooldownKey(fanId: string, gateId: GateId): string {
    return `${COOLDOWN_KEY_PREFIX}:${gateId}:${fanId}`;
  }

  /** Returns the ISO timestamp of the last nudge generated for this fan+gate, or null. */
  async getLastNudgeAt(fanId: string, gateId: GateId): Promise<Date | null> {
    const value = await this.client.get(this.cooldownKey(fanId, gateId));
    return value ? new Date(value) : null;
  }

  /**
   * Records the cooldown clock at GENERATION time (not delivery time),
   * per design.md's note that cancellation must not reset the cooldown
   * clock incorrectly.
   */
  async setLastNudgeAt(
    fanId: string,
    gateId: GateId,
    generatedAt: Date,
    cooldownPeriodMs: number
  ): Promise<void> {
    await this.client.set(
      this.cooldownKey(fanId, gateId),
      generatedAt.toISOString(),
      "PX",
      cooldownPeriodMs
    );
  }

  // ---- Degraded-source timers (Req 1.5) ----

  private degradedSourceKey(sourceType: string, gateOrRouteId: string): string {
    return `${DEGRADED_SOURCE_KEY_PREFIX}:${sourceType}:${gateOrRouteId}`;
  }

  /**
   * Resets the "still alive" timer for a source. Called on every
   * received Signal_Event; the key expiring (TTL hit) is what marks
   * the source degraded (checked via isSourceDegraded).
   */
  async touchSource(
    sourceType: string,
    gateOrRouteId: string,
    timeoutMs: number
  ): Promise<void> {
    await this.client.set(
      this.degradedSourceKey(sourceType, gateOrRouteId),
      "1",
      "PX",
      timeoutMs
    );
  }

  /** True if no Signal_Event has been seen from this source within its timeout window. */
  async isSourceDegraded(sourceType: string, gateOrRouteId: string): Promise<boolean> {
    const value = await this.client.get(
      this.degradedSourceKey(sourceType, gateOrRouteId)
    );
    return value === null;
  }

  // ---- Last-known Congestion_Score cache (Req 12.3) ----

  private lastKnownScoreKey(gateId: GateId): string {
    return `${LAST_KNOWN_SCORE_KEY_PREFIX}:${gateId}`;
  }

  async getLastKnownScore(gateId: GateId): Promise<CongestionScorePoint | null> {
    const value = await this.client.get(this.lastKnownScoreKey(gateId));
    return value ? (JSON.parse(value) as CongestionScorePoint) : null;
  }

  async setLastKnownScore(gateId: GateId, point: CongestionScorePoint): Promise<void> {
    await this.client.set(this.lastKnownScoreKey(gateId), JSON.stringify(point));
  }

  // ---- Rejection suppression (Req 7.4), keyed by route ----

  private rejectionKey(routeId: RouteId, alternativeGateId: GateId): string {
    return `redirection-rejection:${routeId}:${alternativeGateId}`;
  }

  async recordRejection(
    routeId: RouteId,
    alternativeGateId: GateId,
    suppressionMs: number
  ): Promise<void> {
    await this.client.set(
      this.rejectionKey(routeId, alternativeGateId),
      "1",
      "PX",
      suppressionMs
    );
  }

  async isRejectionSuppressed(
    routeId: RouteId,
    alternativeGateId: GateId
  ): Promise<boolean> {
    const value = await this.client.get(this.rejectionKey(routeId, alternativeGateId));
    return value !== null;
  }

  async disconnect(): Promise<void> {
    this.client.disconnect();
  }
}
