import type { GateId, RecommendedAction } from "../types/models.js";
import type { ActiveActionsStore } from "./service.js";

export interface ExecuteActionRequest {
  userId: string;
}

/**
 * Implements `GET /v1/gates/{gate_id}/actions` and
 * `POST /v1/gates/{gate_id}/actions/{action_id}/execute` (design.md
 * Recommendation_Engine API surface).
 *
 * Executing an action records the execution time and acting user
 * (Req 5.5) on the specific action, leaving all other actions and
 * their ranks untouched.
 */
export class RecommendationEngineApi {
  constructor(private readonly store: ActiveActionsStore) {}

  async getActions(gateId: GateId): Promise<RecommendedAction[]> {
    return this.store.getActiveActions(gateId);
  }

  async executeAction(
    gateId: GateId,
    actionId: string,
    request: ExecuteActionRequest,
    now: Date = new Date()
  ): Promise<RecommendedAction | null> {
    const actions = await this.store.getActiveActions(gateId);
    const index = actions.findIndex((a) => a.actionId === actionId);
    if (index === -1) {
      return null;
    }

    const updated: RecommendedAction = {
      ...actions[index]!,
      executedAt: now.toISOString(),
      executedByUserId: request.userId,
    };

    const newActions = [...actions];
    newActions[index] = updated;
    await this.store.setActiveActions(gateId, newActions);

    return updated;
  }
}
