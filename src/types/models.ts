/**
 * Shared domain types for the Stadium Congestion Forecasting System.
 * Mirrors design.md's "Data Models" section exactly.
 */

export type GateId = string;
export type RouteId = string;
export type FanId = string;

export interface Gate {
  gateId: GateId;
  name: string;
  capacityThreshold: number; // Capacity_Threshold
  assignedRouteIds: RouteId[];
}

export interface ShuttleRoute {
  routeId: RouteId;
  servedGateIds: GateId[];
}

export type SignalSource = "GATE_COUNTER" | "TICKET_SCANNER" | "TRANSIT_FEED";

export interface GateCounterPayload {
  count: number;
  intervalSeconds: number;
}

export interface TicketScanPayload {
  fanId: FanId;
}

export interface TransitArrivalPayload {
  estimatedPassengerCount: number;
  destinationGateId?: GateId;
  destinationRouteId?: RouteId;
  fanIds?: FanId[];
}

export type SignalEventPayloadBody =
  | GateCounterPayload
  | TicketScanPayload
  | TransitArrivalPayload;

export interface SignalEvent {
  signalId: string;
  source: SignalSource;
  gateId?: GateId; // present for Gate_Counter / Ticket_Scan
  routeId?: RouteId; // present for Transit_Arrival
  timestamp: string; // ISO 8601, event-reported time
  receivedAt: string; // ISO 8601, ingestion receipt time
  payload: SignalEventPayloadBody;
  isStale: boolean; // Req 1.4
  lateArrivalFlag: boolean; // Req 1.6-1.8, independent of isStale
}

export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface CongestionScorePoint {
  gateId: GateId;
  forecastTime: string; // absolute time this point predicts
  offsetMinutes: number; // 0..15, step <= 5
  score: number; // 0..100 inclusive
  riskLevel: RiskLevel;
  lowConfidence: boolean; // Req 3.5, 11.2
  outdated: boolean; // Req 12.3
}

export type ActionType =
  | "OPEN_GATE_LANE"
  | "REDIRECT_SHUTTLE_ROUTE"
  | "HOLD_TRANSIT_ARRIVAL"
  | "FAN_NUDGE_CAMPAIGN";

export interface RecommendedAction {
  actionId: string;
  gateId: GateId;
  actionType: ActionType;
  actionRank: number; // 1 = highest priority, unique per (gateId, forecastTime)
  explanation: string; // references contributing signalIds / score factors; includes
  // "Low_Confidence" token when derived from a Low_Confidence score
  targetGateId?: GateId;
  targetRouteId?: RouteId;
  generatedAt: string;
  executedAt?: string;
  executedByUserId?: string;
}

export interface ShuttleRedirectionRecommendation {
  recommendationId: string;
  routeId: RouteId;
  originGateId: GateId;
  alternativeGateId: GateId; // riskLevel strictly lower than originGateId's
  explanation: string; // references Congestion_Score + Transit_Arrival data
  generatedAt: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  acceptedAt?: string;
  acceptedByDispatcherId?: string;
  rejectedAt?: string;
  rejectedByDispatcherId?: string;
}

export interface FanNudge {
  nudgeId: string;
  fanId: FanId;
  originGateId: GateId; // riskLevel HIGH/CRITICAL at generation time
  alternativeGateId?: GateId; // riskLevel strictly lower than originGateId's, if provided
  alternativeArrivalTime?: string;
  alternativeRouteId?: RouteId;
  message: string;
  generatedAt: string;
  simulatedDeliveryTimestamp?: string;
  status: "QUEUED" | "SIMULATED_DELIVERED" | "CANCELLED";
}

export interface Alert {
  alertId: string;
  gateId: GateId;
  alertType: "RISK_LEVEL" | "DATA_QUALITY"; // Req 10.2 vs Req 11.4
  raisedAt: string;
  riskLevel?: RiskLevel; // for RISK_LEVEL alerts
  affectedSources?: SignalSource[]; // for DATA_QUALITY alerts
  acknowledgedAt?: string;
  acknowledgedByUserId?: string;
}

export interface ValidationErrorRecord {
  errorId: string;
  source: SignalSource | "UNKNOWN";
  reason: string;
  offendingField?: string;
  rawPayload: unknown;
  recordedAt: string;
}

// Audit records: one per computation/generation, immutable, retained >= 90 days
export interface ScoreAuditRecord {
  gateId: GateId;
  timestamp: string;
  score: number;
  riskLevel: RiskLevel;
  contributingSignalIds: string[];
  contributingSignalLateArrivalFlags: Record<string, boolean>; // Req 13.5
}

export type ActionAuditRecord = RecommendedAction;
export type NudgeAuditRecord = FanNudge;
