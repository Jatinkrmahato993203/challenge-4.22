import type { Alert } from "../types/models.js";

export interface AcknowledgeAlertRequest {
  userId: string;
}

export interface AlertStore {
  getAlert(alertId: string): Promise<Alert | null>;
  updateAlert(alert: Alert): Promise<void>;
}

/**
 * Implements `POST /v1/alerts/{alert_id}/acknowledge` (design.md
 * Ops_Dashboard API surface, Req 10.4): records the acknowledgment
 * time and the acknowledging user on the Alert.
 */
export class OpsDashboardApi {
  constructor(private readonly store: AlertStore) {}

  async acknowledgeAlert(
    alertId: string,
    request: AcknowledgeAlertRequest,
    now: Date = new Date()
  ): Promise<Alert | null> {
    const alert = await this.store.getAlert(alertId);
    if (!alert) {
      return null;
    }

    const updated: Alert = {
      ...alert,
      acknowledgedAt: now.toISOString(),
      acknowledgedByUserId: request.userId,
    };

    await this.store.updateAlert(updated);
    return updated;
  }
}
