import type { Gate, GateId, RecommendedAction, SignalEvent } from "../types/models.js";
import { generateRecommendations } from "./recommendations.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

/** Req 5.6: regenerate the Recommended_Action list within 5s of a score update. */
export const RECOMMENDATION_REGENERATION_BUDGET_MS = 5_000;

export interface ActiveActionsStore {
  getActiveActions(gateId: GateId): Promise<RecommendedAction[]>;
  setActiveActions(gateId: GateId, actions: RecommendedAction[]): Promise<void>;
}

export interface RecommendationPublisher {
  publishActions(gateId: GateId, actions: RecommendedAction[]): Promise<void>;
}

export interface SignalWindowProvider {
  getWindowForGate(gateId: GateId): Promise<SignalEvent[]>;
}

/**
 * Recommendation_Engine service wrapper (design.md
 * Recommendation_Engine section): consumes `congestion-scores` updates
 * and regenerates a Gate's Recommended_Action list via the pure
 * `generateRecommendations` (Req 5.6). When the new list is empty
 * (Gate dropped below Moderate), this REPLACES the active list with an
 * empty one, satisfying Req 6.4's removal requirement -- there is no
 * partial-merge logic that could leave stale actions behind.
 */
export class RecommendationEngineService {
  constructor(
    private readonly windowProvider: SignalWindowProvider,
    private readonly store: ActiveActionsStore,
    private readonly publisher: RecommendationPublisher
  ) {}

  async onScoreUpdate(gate: Gate, forecast: ForecastResult): Promise<RecommendedAction[]> {
    const window = await this.windowProvider.getWindowForGate(gate.gateId);
    const actions = generateRecommendations(gate, forecast, window);

    // Replacing (not merging) the active list is what guarantees
    // previously generated actions are removed once the Gate's score
    // drops below Moderate and generateRecommendations returns [] (Req 6.4).
    await this.store.setActiveActions(gate.gateId, actions);
    await this.publisher.publishActions(gate.gateId, actions);
    return actions;
  }
}
