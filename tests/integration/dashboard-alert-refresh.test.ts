import { describe, expect, it, vi } from "vitest";
import { raiseRiskLevelAlertIfTransitioned } from "../../src/ops-dashboard/alerts.js";
import {
  DashboardWebSocketHub,
  DASHBOARD_REFRESH_INTERVAL_MS,
  type DashboardSocketConnection,
  type DashboardStreamEvent,
} from "../../src/ops-dashboard/websocket.js";
import type { Alert } from "../../src/types/models.js";

/**
 * Integration test (design.md Testing Strategy): asserts Alerts become
 * visible within 5 seconds of a Risk_Level transition (Req 10.2) and
 * the dashboard refreshes at least every 30 seconds (Req 10.3).
 */
describe("Integration: Ops_Dashboard alert visibility and refresh cadence (Req 10.2, 10.3)", () => {
  it("raises a visible Alert within 5 seconds of a High/Critical transition", async () => {
    const published: Alert[] = [];
    const publisher = {
      async publishAlert(alert: Alert) {
        published.push(alert);
      },
    };

    const start = Date.now();
    const result = await raiseRiskLevelAlertIfTransitioned(
      "gate-a",
      "MODERATE",
      "HIGH",
      publisher
    );
    const elapsedMs = Date.now() - start;

    expect(result).not.toBeNull();
    expect(published).toHaveLength(1);
    expect(elapsedMs).toBeLessThanOrEqual(5000);
  });

  it("refreshes connected dashboard clients at least every 30 seconds", async () => {
    vi.useFakeTimers();

    const received: DashboardStreamEvent[] = [];
    const connection: DashboardSocketConnection = {
      send(event) {
        received.push(event);
      },
    };

    const hub = new DashboardWebSocketHub(() => [
      {
        type: "ScoreUpdate",
        payload: {
          gateId: "gate-a",
          forecastTime: new Date().toISOString(),
          offsetMinutes: 0,
          score: 50,
          riskLevel: "MODERATE",
          lowConfidence: false,
          outdated: false,
        },
      },
    ]);

    hub.register(connection);
    hub.startHeartbeat(DASHBOARD_REFRESH_INTERVAL_MS);

    await vi.advanceTimersByTimeAsync(DASHBOARD_REFRESH_INTERVAL_MS);

    expect(received.length).toBeGreaterThanOrEqual(1);

    hub.stopHeartbeat();
    vi.useRealTimers();
  });
});
