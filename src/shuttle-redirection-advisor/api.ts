import type { ShuttleRedirectionRecommendation } from "../types/models.js";
import type { RedirectionSuppressionStore } from "./suppression.js";

export interface AcceptRedirectionRequest {
  dispatcherId: string;
}

export interface RejectRedirectionRequest {
  dispatcherId: string;
}

export interface RedirectionStore {
  getActiveRecommendations(routeId: string): Promise<ShuttleRedirectionRecommendation[]>;
  updateRecommendation(recommendation: ShuttleRedirectionRecommendation): Promise<void>;
}

/**
 * Implements `GET /v1/routes/{route_id}/redirections`,
 * `POST /v1/routes/{route_id}/redirections/{rec_id}/accept`, and
 * `POST /v1/routes/{route_id}/redirections/{rec_id}/reject`
 * (design.md Shuttle_Redirection_Advisor API surface).
 *
 * Acceptance records the acceptance time, dispatcher, and resulting
 * assignment (Req 7.3). Rejection records the rejection and starts the
 * 5-minute suppression window (Req 7.4) via RedirectionSuppressionStore.
 */
export class ShuttleRedirectionApi {
  constructor(
    private readonly store: RedirectionStore,
    private readonly suppressionStore: RedirectionSuppressionStore
  ) {}

  async getRedirections(routeId: string): Promise<ShuttleRedirectionRecommendation[]> {
    return this.store.getActiveRecommendations(routeId);
  }

  async acceptRedirection(
    routeId: string,
    recommendationId: string,
    request: AcceptRedirectionRequest,
    now: Date = new Date()
  ): Promise<ShuttleRedirectionRecommendation | null> {
    const recommendation = await this.findRecommendation(routeId, recommendationId);
    if (!recommendation) {
      return null;
    }

    const updated: ShuttleRedirectionRecommendation = {
      ...recommendation,
      status: "ACCEPTED",
      acceptedAt: now.toISOString(),
      acceptedByDispatcherId: request.dispatcherId,
    };

    await this.store.updateRecommendation(updated);
    return updated;
  }

  async rejectRedirection(
    routeId: string,
    recommendationId: string,
    request: RejectRedirectionRequest,
    now: Date = new Date()
  ): Promise<ShuttleRedirectionRecommendation | null> {
    const recommendation = await this.findRecommendation(routeId, recommendationId);
    if (!recommendation) {
      return null;
    }

    const updated: ShuttleRedirectionRecommendation = {
      ...recommendation,
      status: "REJECTED",
      rejectedAt: now.toISOString(),
      rejectedByDispatcherId: request.dispatcherId,
    };

    await this.store.updateRecommendation(updated);
    await this.suppressionStore.recordRejection(
      recommendation.routeId,
      recommendation.alternativeGateId
    );

    return updated;
  }

  private async findRecommendation(
    routeId: string,
    recommendationId: string
  ): Promise<ShuttleRedirectionRecommendation | undefined> {
    const active = await this.store.getActiveRecommendations(routeId);
    return active.find((r) => r.recommendationId === recommendationId);
  }
}
