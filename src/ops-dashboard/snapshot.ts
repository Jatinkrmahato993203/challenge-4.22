import type {
  CongestionScorePoint,
  GateId,
  RecommendedAction,
} from "../types/models.js";

export interface GateSnapshot {
  gateId: GateId;
  score: number;
  riskLevel: CongestionScorePoint["riskLevel"];
  lowConfidence: boolean;
  outdated: boolean;
  dataQualityIndicator: boolean; // Req 11.1
  activeActions: RecommendedAction[];
}

export interface GateScoreSource {
  getCurrentScore(gateId: GateId): Promise<CongestionScorePoint | null>;
}

export interface ActiveActionsSource {
  getActiveActions(gateId: GateId): Promise<RecommendedAction[]>;
}

export interface DataQualitySource {
  hasDegradedSource(gateId: GateId): Promise<boolean>;
}

/**
 * Implements `GET /v1/dashboard/gates` (design.md Ops_Dashboard API
 * surface): a per-Gate snapshot of current score, Risk_Level, active
 * Recommended_Actions (rank, explanation, status), and a data-quality
 * indicator (Req 10.1, 10.5, 11.1).
 */
export class DashboardSnapshotService {
  constructor(
    private readonly scoreSource: GateScoreSource,
    private readonly actionsSource: ActiveActionsSource,
    private readonly dataQualitySource: DataQualitySource
  ) {}

  async getSnapshot(gateIds: GateId[]): Promise<GateSnapshot[]> {
    const snapshots = await Promise.all(
      gateIds.map(async (gateId) => {
        const [scorePoint, activeActions, degraded] = await Promise.all([
          this.scoreSource.getCurrentScore(gateId),
          this.actionsSource.getActiveActions(gateId),
          this.dataQualitySource.hasDegradedSource(gateId),
        ]);

        return {
          gateId,
          score: scorePoint?.score ?? 0,
          riskLevel: scorePoint?.riskLevel ?? "LOW",
          lowConfidence: scorePoint?.lowConfidence ?? false,
          outdated: scorePoint?.outdated ?? false,
          dataQualityIndicator: degraded,
          activeActions,
        } satisfies GateSnapshot;
      })
    );
    return snapshots;
  }
}
