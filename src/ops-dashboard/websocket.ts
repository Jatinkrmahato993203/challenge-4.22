import type {
  Alert,
  CongestionScorePoint,
  RecommendedAction,
  ShuttleRedirectionRecommendation,
} from "../types/models.js";

export type DashboardStreamEvent =
  | { type: "ScoreUpdate"; payload: CongestionScorePoint }
  | { type: "ActionListUpdate"; payload: { gateId: string; actions: RecommendedAction[] } }
  | { type: "RedirectionUpdate"; payload: ShuttleRedirectionRecommendation }
  | { type: "Alert"; payload: Alert };

export interface DashboardSocketConnection {
  send(event: DashboardStreamEvent): void;
}

/** Req 10.3: refresh at least every 30 seconds without a manual reload. */
export const DASHBOARD_REFRESH_INTERVAL_MS = 30_000;

/**
 * Implements `WS /v1/dashboard/stream` (design.md Ops_Dashboard API
 * surface): a push channel broadcasting ScoreUpdate/ActionListUpdate/
 * RedirectionUpdate/Alert events to connected clients as they occur,
 * plus a periodic heartbeat/refresh tick to satisfy Req 10.3's "at
 * least every 30 seconds" guarantee even when no new event has
 * occurred.
 */
export class DashboardWebSocketHub {
  private readonly connections = new Set<DashboardSocketConnection>();
  private heartbeatHandle: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly getLatestSnapshotEvents: () => DashboardStreamEvent[]) {}

  register(connection: DashboardSocketConnection): void {
    this.connections.add(connection);
  }

  unregister(connection: DashboardSocketConnection): void {
    this.connections.delete(connection);
  }

  broadcast(event: DashboardStreamEvent): void {
    for (const connection of this.connections) {
      connection.send(event);
    }
  }

  startHeartbeat(intervalMs = DASHBOARD_REFRESH_INTERVAL_MS): void {
    this.stopHeartbeat();
    this.heartbeatHandle = setInterval(() => {
      for (const event of this.getLatestSnapshotEvents()) {
        this.broadcast(event);
      }
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
    }
  }
}
