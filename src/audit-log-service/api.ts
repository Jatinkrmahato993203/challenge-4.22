import type {
  FanId,
  FanNudge,
  GateId,
  RecommendedAction,
  ScoreAuditRecord,
} from "../types/models.js";

export interface AuditQueryRange {
  gateId?: GateId;
  fanId?: FanId;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
}

export interface AuditQueryRepository {
  queryScores(range: AuditQueryRange): Promise<ScoreAuditRecord[]>;
  queryActions(range: AuditQueryRange): Promise<RecommendedAction[]>;
  queryNudges(range: AuditQueryRange): Promise<FanNudge[]>;
}

/**
 * Implements `GET /v1/audit/scores`, `GET /v1/audit/actions`, and
 * `GET /v1/audit/nudges` (design.md Audit_Log_Service API surface,
 * Req 13.1, 13.2, 13.3).
 */
export class AuditLogApi {
  constructor(private readonly repository: AuditQueryRepository) {}

  async getScores(range: AuditQueryRange): Promise<ScoreAuditRecord[]> {
    return this.repository.queryScores(range);
  }

  async getActions(range: AuditQueryRange): Promise<RecommendedAction[]> {
    return this.repository.queryActions(range);
  }

  async getNudges(range: AuditQueryRange): Promise<FanNudge[]> {
    return this.repository.queryNudges(range);
  }
}
