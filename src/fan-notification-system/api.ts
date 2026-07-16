import type { FanId, FanNudge, GateId } from "../types/models.js";

export interface NudgeAuditQuery {
  queryNudges(filter: { gateId?: GateId; fanId?: FanId }): Promise<FanNudge[]>;
}

/**
 * Implements `GET /v1/nudges?gateId=&fanId=` (design.md
 * Fan_Notification_System API surface): an operator-facing audit view
 * of generated/cancelled/simulated-delivered nudges (Req 8.3).
 */
export class FanNotificationApi {
  constructor(private readonly auditQuery: NudgeAuditQuery) {}

  async getNudges(filter: { gateId?: GateId; fanId?: FanId }): Promise<FanNudge[]> {
    return this.auditQuery.queryNudges(filter);
  }
}
