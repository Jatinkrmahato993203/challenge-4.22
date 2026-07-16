import { DegradedSourceTracker } from "./degraded-source.js";
import type { RedisClientWrapper } from "../infra/redis-client.js";
import type { SignalSource } from "../types/models.js";

export interface SourceStatus {
  sourceType: SignalSource;
  status: "active" | "degraded";
}

const ALL_SOURCE_TYPES: SignalSource[] = [
  "GATE_COUNTER",
  "TICKET_SCANNER",
  "TRANSIT_FEED",
];

/**
 * Implements `GET /v1/sources/{gate_or_route_id}/status` (design.md
 * Signal_Ingestion_Service API surface, Req 11.1): reports per-source
 * active/degraded status for a Gate or Route, backing the dashboard's
 * data-quality indicator.
 */
export class SourceStatusService {
  private readonly degradedSourceTracker: DegradedSourceTracker;

  constructor(redis: RedisClientWrapper) {
    this.degradedSourceTracker = new DegradedSourceTracker(redis);
  }

  async getStatus(gateOrRouteId: string): Promise<SourceStatus[]> {
    const statuses = await Promise.all(
      ALL_SOURCE_TYPES.map(async (sourceType) => {
        const degraded = await this.degradedSourceTracker.isDegraded(
          sourceType,
          gateOrRouteId
        );
        return {
          sourceType,
          status: degraded ? ("degraded" as const) : ("active" as const),
        };
      })
    );
    return statuses;
  }

  /** True if every source for this Gate/Route is currently degraded (Req 11.4). */
  async allSourcesDegraded(gateOrRouteId: string): Promise<boolean> {
    const statuses = await this.getStatus(gateOrRouteId);
    return statuses.every((s) => s.status === "degraded");
  }
}
