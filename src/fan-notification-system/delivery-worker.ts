import type { FanNudge, GateId } from "../types/models.js";
import { simulateDelivery, type DeliveryRecord } from "./delivery.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

export interface NudgeAuditSink {
  recordDelivery(nudge: FanNudge, deliveryRecord: DeliveryRecord): Promise<void>;
  recordCancellation(nudge: FanNudge): Promise<void>;
}

export interface QueuedNudgeSource {
  getQueuedNudges(): Promise<FanNudge[]>;
  updateNudge(nudge: FanNudge): Promise<void>;
}

/**
 * Queued-delivery worker (design.md Fan_Notification_System section,
 * Req 8.5): re-checks each queued nudge's target Gate's CURRENT
 * Risk_Level immediately before calling `simulateDelivery`, and
 * persists the resulting QUEUED -> SIMULATED_DELIVERED / CANCELLED
 * transition.
 */
export class FanNudgeDeliveryWorker {
  constructor(
    private readonly nudgeSource: QueuedNudgeSource,
    private readonly auditSink: NudgeAuditSink
  ) {}

  async processQueue(
    forecastsByGate: Map<GateId, ForecastResult>,
    now: Date = new Date()
  ): Promise<void> {
    const queued = await this.nudgeSource.getQueuedNudges();

    for (const nudge of queued) {
      if (nudge.status !== "QUEUED") {
        continue;
      }

      const { nudge: updated, deliveryRecord } = simulateDelivery(
        nudge,
        forecastsByGate,
        now
      );

      await this.nudgeSource.updateNudge(updated);

      if (deliveryRecord) {
        await this.auditSink.recordDelivery(updated, deliveryRecord);
      } else {
        await this.auditSink.recordCancellation(updated);
      }
    }
  }
}
