import type { GateId, RouteId } from "../types/models.js";
import type { RedisClientWrapper } from "../infra/redis-client.js";
import { REJECTION_SUPPRESSION_MS } from "./redirections.js";

/**
 * 5-minute rejection-suppression store (design.md
 * Shuttle_Redirection_Advisor / Error Handling sections, Req 7.4):
 * keyed by (routeId, recommendation content hash) in Redis. Here the
 * "content hash" is represented by the alternativeGateId, since a
 * redirection recommendation's identity for suppression purposes is
 * the (route, alternative gate) pair.
 */
export class RedirectionSuppressionStore {
  constructor(private readonly redis: RedisClientWrapper) {}

  async recordRejection(routeId: RouteId, alternativeGateId: GateId): Promise<void> {
    await this.redis.recordRejection(routeId, alternativeGateId, REJECTION_SUPPRESSION_MS);
  }

  async isSuppressed(routeId: RouteId, alternativeGateId: GateId): Promise<boolean> {
    return this.redis.isRejectionSuppressed(routeId, alternativeGateId);
  }
}
