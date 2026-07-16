import { randomUUID } from "node:crypto";
import type { Alert, GateId, SignalSource } from "../types/models.js";
import type { AlertPublisher } from "./alerts.js";

/**
 * DATA_QUALITY Alert generation (design.md Ops_Dashboard section, Req
 * 11.4): raised when ALL Signal_Ingestion_Service sources for a Gate
 * are simultaneously degraded, distinct from a RISK_LEVEL Alert
 * (Req 10.2).
 */
export function buildDataQualityAlert(
  gateId: GateId,
  affectedSources: SignalSource[],
  now: Date = new Date()
): Alert {
  return {
    alertId: randomUUID(),
    gateId,
    alertType: "DATA_QUALITY",
    raisedAt: now.toISOString(),
    affectedSources,
  };
}

export async function raiseDataQualityAlertIfAllDegraded(
  gateId: GateId,
  sourceStatuses: { sourceType: SignalSource; status: "active" | "degraded" }[],
  publisher: AlertPublisher,
  now: Date = new Date()
): Promise<Alert | null> {
  const allDegraded =
    sourceStatuses.length > 0 && sourceStatuses.every((s) => s.status === "degraded");

  if (!allDegraded) {
    return null;
  }

  const alert = buildDataQualityAlert(
    gateId,
    sourceStatuses.map((s) => s.sourceType),
    now
  );
  await publisher.publishAlert(alert);
  return alert;
}
