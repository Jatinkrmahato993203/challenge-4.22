import { randomUUID } from "node:crypto";
import type { Alert, GateId, RiskLevel } from "../types/models.js";

const HIGH_OR_CRITICAL = new Set<RiskLevel>(["HIGH", "CRITICAL"]);

export interface AlertPublisher {
  publishAlert(alert: Alert): Promise<void>;
}

export type Visibility = "VENUE_OPS_MANAGER" | "GATE_STAFF" | "TRANSIT_DISPATCHER";

export interface VisibleAlert {
  alert: Alert;
  visibleTo: Visibility[];
}

/**
 * Risk_Level-transition Alert generation (design.md Ops_Dashboard
 * section, Req 10.2): raises a RISK_LEVEL Alert whenever a Gate's
 * Risk_Level transitions FROM Low/Moderate TO High/Critical, visible
 * to the Venue_Ops_Manager, the Gate_Staff assigned to that Gate, and
 * the Transit_Dispatcher.
 *
 * This function takes the previous and new Risk_Level explicitly
 * rather than tracking state itself, so it stays a pure, easily
 * property-tested transition check; the caller (score-update consumer)
 * is responsible for supplying the previous Risk_Level (e.g. from the
 * last-known-score cache).
 */
export function checkRiskLevelTransition(
  gateId: GateId,
  previousRiskLevel: RiskLevel,
  newRiskLevel: RiskLevel,
  now: Date = new Date()
): VisibleAlert | null {
  const wasLowOrModerate = !HIGH_OR_CRITICAL.has(previousRiskLevel);
  const isNowHighOrCritical = HIGH_OR_CRITICAL.has(newRiskLevel);

  if (!(wasLowOrModerate && isNowHighOrCritical)) {
    return null;
  }

  const alert: Alert = {
    alertId: randomUUID(),
    gateId,
    alertType: "RISK_LEVEL",
    raisedAt: now.toISOString(),
    riskLevel: newRiskLevel,
  };

  return {
    alert,
    visibleTo: ["VENUE_OPS_MANAGER", "GATE_STAFF", "TRANSIT_DISPATCHER"],
  };
}

/**
 * Detects a transition and, if one occurred, publishes the resulting
 * Alert (Req 10.2's <= 5s visibility is satisfied by the caller
 * invoking this synchronously from the score-update consumer/pipeline
 * rather than on a delayed schedule).
 */
export async function raiseRiskLevelAlertIfTransitioned(
  gateId: GateId,
  previousRiskLevel: RiskLevel,
  newRiskLevel: RiskLevel,
  publisher: AlertPublisher,
  now: Date = new Date()
): Promise<VisibleAlert | null> {
  const transition = checkRiskLevelTransition(gateId, previousRiskLevel, newRiskLevel, now);
  if (transition) {
    await publisher.publishAlert(transition.alert);
  }
  return transition;
}
