import type { FanNudge, GateId } from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

export interface DeliveryRecord {
  fanId: string;
  message: string;
  targetGate: GateId;
  simulatedDeliveryTimestamp: string;
}

const LOW_OR_MODERATE = new Set(["LOW", "MODERATE"]);

/**
 * Simulates delivery of a queued Fan_Nudge (design.md
 * Fan_Notification_System section, Req 8.3/8.5).
 *
 * This function NEVER calls any external messaging provider -- it only
 * returns a plain record describing what would have been sent, plus the
 * nudge's updated status. It is intentionally free of any network/HTTP
 * client dependency so a mock-based test can assert zero invocations of
 * an outbound messaging client (Req 8.3).
 *
 * Re-checks the target Gate's current Risk_Level immediately before
 * "delivering": if the Gate has returned to Low/Moderate, the nudge is
 * cancelled instead of delivered (Req 8.5).
 */
export function simulateDelivery(
  nudge: FanNudge,
  forecastsByGate: Map<GateId, ForecastResult>,
  now: Date = new Date()
): { nudge: FanNudge; deliveryRecord: DeliveryRecord | null } {
  const currentRiskLevel =
    forecastsByGate.get(nudge.originGateId)?.scores[0]?.riskLevel ?? "LOW";

  if (LOW_OR_MODERATE.has(currentRiskLevel)) {
    return {
      nudge: { ...nudge, status: "CANCELLED" },
      deliveryRecord: null,
    };
  }

  const simulatedDeliveryTimestamp = now.toISOString();
  const deliveryRecord: DeliveryRecord = {
    fanId: nudge.fanId,
    message: nudge.message,
    targetGate: nudge.originGateId,
    simulatedDeliveryTimestamp,
  };

  return {
    nudge: {
      ...nudge,
      status: "SIMULATED_DELIVERED",
      simulatedDeliveryTimestamp,
    },
    deliveryRecord,
  };
}
