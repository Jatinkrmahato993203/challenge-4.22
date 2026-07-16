import type {
  Alert,
  FanNudge,
  Gate,
  GateId,
  RecommendedAction,
  RiskLevel,
  ScoreAuditRecord,
  ShuttleRoute,
  SignalEvent,
} from "./types/models.js";
import type { CongestionScorePoint } from "./types/models.js";
import type { ForecastResult } from "./congestion-forecaster/forecast.js";
import { ForecastScheduler, type ForecastPublisher } from "./congestion-forecaster/scheduler.js";
import {
  RecommendationEngineService,
  type ActiveActionsStore,
  type RecommendationPublisher,
} from "./recommendation-engine/service.js";
import { generateRedirections, type RejectionRecord } from "./shuttle-redirection-advisor/redirections.js";
import type { RedirectionStore } from "./shuttle-redirection-advisor/api.js";
import { FanNotificationService, type QueuedNudgeStore } from "./fan-notification-system/service.js";
import {
  FanNudgeDeliveryWorker,
  type QueuedNudgeSource,
  type NudgeAuditSink,
} from "./fan-notification-system/delivery-worker.js";
import type { FanContext } from "./fan-notification-system/nudges.js";
import { raiseRiskLevelAlertIfTransitioned, type AlertPublisher } from "./ops-dashboard/alerts.js";
import { raiseDataQualityAlertIfAllDegraded } from "./ops-dashboard/data-quality-alerts.js";
import { DashboardWebSocketHub } from "./ops-dashboard/websocket.js";
import { AuditLogConsumer, type AuditRepository } from "./audit-log-service/consumer.js";
import { SourceStatusService } from "./signal-ingestion/status.js";
import type { RedisClientWrapper } from "./infra/redis-client.js";
import { InMemoryEventBus } from "./infra/event-bus.js";

/**
 * Pipeline orchestrator (this file). None of the other subsystem files
 * changed -- this module only wires already-existing, independently
 * testable classes/functions together via the in-memory event bus so
 * the system runs end-to-end automatically instead of only in response
 * to direct API calls.
 */

export interface ForecastStoreWithSetter {
  getLatestForecast(gateId: GateId): Promise<CongestionScorePoint[] | null>;
  setForecast(gateId: GateId, scores: CongestionScorePoint[]): void;
}

export interface GateScoreSourceWithSetter {
  getCurrentScore(gateId: GateId): Promise<CongestionScorePoint | null>;
  setScore(gateId: GateId, point: CongestionScorePoint): void;
}

export interface ActiveActionsSourceWithSetter {
  getActiveActions(gateId: GateId): Promise<RecommendedAction[]>;
  setActions(gateId: GateId, actions: RecommendedAction[]): void;
}

export interface DataQualitySourceWithSetter {
  hasDegradedSource(gateId: GateId): Promise<boolean>;
  setDegraded(gateId: GateId, degraded: boolean): void;
}

export interface AlertStoreWithAdd {
  getAlert(alertId: string): Promise<Alert | null>;
  updateAlert(alert: Alert): Promise<void>;
  addAlert(alert: Alert): void;
}

export interface QueuedNudgeStoreAndSource extends QueuedNudgeStore, QueuedNudgeSource {}

export interface PipelineDependencies {
  bus: InMemoryEventBus;
  gates: Gate[];
  routes: ShuttleRoute[];
  redis: RedisClientWrapper;
  forecastStore: ForecastStoreWithSetter;
  gateScoreSource: GateScoreSourceWithSetter;
  activeActionsStore: ActiveActionsStore;
  activeActionsSource: ActiveActionsSourceWithSetter;
  redirectionStore: RedirectionStore;
  queuedNudgeStore: QueuedNudgeStoreAndSource;
  nudgeAuditSink: NudgeAuditSink;
  alertStore: AlertStoreWithAdd;
  dataQualitySource: DataQualitySourceWithSetter;
  auditRepository: AuditRepository;
  sourceStatusService: SourceStatusService;
  dashboardHub: DashboardWebSocketHub;
  /** Returns rejection records still within the 5-minute suppression window (Req 7.4). */
  getRecentRejections: () => RejectionRecord[];
  fanNudgeWorkerIntervalMs?: number;
  dataQualityCheckIntervalMs?: number;
}

export interface PipelineHandle {
  stop(): void;
}

/** Mirrors forecast.ts's own RECENT_WINDOW_MS contract for the signal window this pipeline maintains. */
const SIGNAL_WINDOW_RETENTION_MS = 10 * 60 * 1000;

export function wirePipeline(deps: PipelineDependencies): PipelineHandle {
  const {
    bus,
    gates,
    routes,
    redis,
    forecastStore,
    gateScoreSource,
    activeActionsStore,
    activeActionsSource,
    redirectionStore,
    queuedNudgeStore,
    nudgeAuditSink,
    alertStore,
    dataQualitySource,
    auditRepository,
    sourceStatusService,
    dashboardHub,
    getRecentRejections,
    fanNudgeWorkerIntervalMs = 15_000,
    dataQualityCheckIntervalMs = 15_000,
  } = deps;

  const gatesById = new Map(gates.map((g) => [g.gateId, g]));

  // -- per-gate signal window (bounded to the last 10 minutes) -----------
  const signalWindowByGate = new Map<GateId, SignalEvent[]>();

  function appendToWindow(gateId: GateId, event: SignalEvent, now: Date): void {
    const existing = signalWindowByGate.get(gateId) ?? [];
    const cutoff = now.getTime() - SIGNAL_WINDOW_RETENTION_MS;
    const pruned = existing.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
    pruned.push(event);
    signalWindowByGate.set(gateId, pruned);
  }

  const windowProvider = {
    async getWindowForGate(gateId: GateId): Promise<SignalEvent[]> {
      return signalWindowByGate.get(gateId) ?? [];
    },
  };

  // -- per-gate fan tracking, derived from Ticket_Scan/Transit_Arrival ----
  const fansByGate = new Map<GateId, Map<string, FanContext>>();

  function trackFansForEvent(event: SignalEvent): void {
    if (event.source === "TICKET_SCANNER" && event.gateId) {
      const payload = event.payload as { fanId: string };
      const fanMap = fansByGate.get(event.gateId) ?? new Map<string, FanContext>();
      fanMap.set(payload.fanId, { fanId: payload.fanId });
      fansByGate.set(event.gateId, fanMap);
    }
    if (event.source === "TRANSIT_FEED") {
      const payload = event.payload as { destinationGateId?: GateId; fanIds?: string[] };
      if (payload.destinationGateId && payload.fanIds) {
        const fanMap = fansByGate.get(payload.destinationGateId) ?? new Map<string, FanContext>();
        for (const fanId of payload.fanIds) {
          fanMap.set(fanId, { fanId });
        }
        fansByGate.set(payload.destinationGateId, fanMap);
      }
    }
  }

  // -- latest forecast + previous risk level per gate ---------------------
  const forecastsByGate = new Map<GateId, ForecastResult>();
  const previousRiskLevelByGate = new Map<GateId, RiskLevel>();

  const alertPublisher: AlertPublisher = {
    async publishAlert(alert: Alert): Promise<void> {
      alertStore.addAlert(alert);
      dashboardHub.broadcast({ type: "Alert", payload: alert });
    },
  };

  const forecastPublisher: ForecastPublisher = {
    async publishForecast(gate: Gate, result: ForecastResult): Promise<void> {
      forecastStore.setForecast(gate.gateId, result.scores);
      const currentPoint = result.scores[0];
      if (currentPoint) {
        gateScoreSource.setScore(gate.gateId, currentPoint);
      }
      bus.publish("congestion-scores", { gate, result });
    },
  };

  const forecastScheduler = new ForecastScheduler(windowProvider, forecastPublisher, redis);

  const recommendationPublisher: RecommendationPublisher = {
    async publishActions(gateId: GateId, actions: RecommendedAction[]): Promise<void> {
      activeActionsSource.setActions(gateId, actions);
      bus.publish("recommended-actions", { gateId, actions });
    },
  };

  const recommendationEngineService = new RecommendationEngineService(
    windowProvider,
    activeActionsStore,
    recommendationPublisher
  );

  const fanNotificationService = new FanNotificationService(redis, queuedNudgeStore);
  const fanNudgeDeliveryWorker = new FanNudgeDeliveryWorker(queuedNudgeStore, nudgeAuditSink);
  const auditLogConsumer = new AuditLogConsumer(auditRepository);

  // -- start the >= 30s scheduled recompute tick for every gate (Req 3.1) --
  for (const gate of gates) {
    forecastScheduler.startScheduledTicks(gate);
  }

  const unsubscribes: Array<() => void> = [];

  // -- signal-events: update window/fan-tracking, trigger recompute (Req 3.3) --
  unsubscribes.push(
    bus.subscribe("signal-events", async (event) => {
      const now = new Date();
      trackFansForEvent(event);

      const gateId = event.gateId;
      if (!gateId) {
        return;
      }
      appendToWindow(gateId, event, now);

      const gate = gatesById.get(gateId);
      if (gate) {
        await forecastScheduler.onSignalEventForGate(gate);
      }
    })
  );

  // -- audit: signal-events / DLQ (decoupled from the business-logic path) --
  unsubscribes.push(
    bus.subscribe("signal-events", (event) =>
      auditLogConsumer.handleMessage({ topic: "signal-events", value: event })
    )
  );
  unsubscribes.push(
    bus.subscribe("signal-events.dlq", (error) =>
      auditLogConsumer.handleMessage({ topic: "signal-events.dlq", value: error })
    )
  );

  // -- congestion-scores: alerts, recommendations, redirections, nudges ----
  unsubscribes.push(
    bus.subscribe("congestion-scores", async ({ gate, result }) => {
      const now = new Date();
      const currentPoint = result.scores[0];
      const newRiskLevel: RiskLevel = currentPoint?.riskLevel ?? "LOW";
      const previousRiskLevel = previousRiskLevelByGate.get(gate.gateId) ?? "LOW";

      forecastsByGate.set(gate.gateId, result);

      await raiseRiskLevelAlertIfTransitioned(gate.gateId, previousRiskLevel, newRiskLevel, alertPublisher, now);
      previousRiskLevelByGate.set(gate.gateId, newRiskLevel);

      if (currentPoint) {
        dashboardHub.broadcast({ type: "ScoreUpdate", payload: currentPoint });
      }

      const actions = await recommendationEngineService.onScoreUpdate(gate, result);
      dashboardHub.broadcast({ type: "ActionListUpdate", payload: { gateId: gate.gateId, actions } });

      const redirections = generateRedirections(gate, forecastsByGate, routes, getRecentRejections(), now);
      for (const redirection of redirections) {
        await redirectionStore.updateRecommendation(redirection);
        bus.publish("shuttle-recommendations", redirection);
        dashboardHub.broadcast({ type: "RedirectionUpdate", payload: redirection });
      }

      const fanMap = fansByGate.get(gate.gateId);
      const fans = fanMap ? Array.from(fanMap.values()) : [];
      const nudges = await fanNotificationService.onScoreUpdate(fans, gate, forecastsByGate, now);
      for (const nudge of nudges) {
        bus.publish("fan-nudges", nudge);
      }
    })
  );

  // -- audit: score computations, recommended actions, redirections, nudges --
  unsubscribes.push(
    bus.subscribe("congestion-scores", ({ gate, result }) => {
      const currentPoint = result.scores[0];
      if (!currentPoint) return;
      const window = signalWindowByGate.get(gate.gateId) ?? [];
      const scoreAudit: ScoreAuditRecord = {
        gateId: gate.gateId,
        timestamp: currentPoint.forecastTime,
        score: currentPoint.score,
        riskLevel: currentPoint.riskLevel,
        contributingSignalIds: window.map((e) => e.signalId),
        contributingSignalLateArrivalFlags: Object.fromEntries(
          window.map((e) => [e.signalId, e.lateArrivalFlag])
        ),
      };
      void auditLogConsumer.handleMessage({ topic: "congestion-scores", value: scoreAudit });
    })
  );
  unsubscribes.push(
    bus.subscribe("recommended-actions", ({ actions }) => {
      for (const action of actions) {
        void auditLogConsumer.handleMessage({ topic: "recommended-actions", value: action });
      }
    })
  );
  unsubscribes.push(
    bus.subscribe("shuttle-recommendations", (recommendation) =>
      auditLogConsumer.handleMessage({ topic: "shuttle-recommendations", value: recommendation })
    )
  );
  unsubscribes.push(
    bus.subscribe("fan-nudges", (nudge) =>
      auditLogConsumer.handleMessage({ topic: "fan-nudges", value: nudge })
    )
  );

  // -- periodic fan-nudge delivery worker + data-quality alert checks -----
  const nudgeWorkerHandle = setInterval(() => {
    void fanNudgeDeliveryWorker.processQueue(forecastsByGate);
  }, fanNudgeWorkerIntervalMs);

  const dataQualityHandle = setInterval(() => {
    void Promise.all(
      gates.map(async (gate) => {
        const statuses = await sourceStatusService.getStatus(gate.gateId);
        const allDegraded = await sourceStatusService.allSourcesDegraded(gate.gateId);
        dataQualitySource.setDegraded(gate.gateId, allDegraded);
        await raiseDataQualityAlertIfAllDegraded(gate.gateId, statuses, alertPublisher);
      })
    );
  }, dataQualityCheckIntervalMs);

  return {
    stop(): void {
      clearInterval(nudgeWorkerHandle);
      clearInterval(dataQualityHandle);
      for (const gate of gates) {
        forecastScheduler.stopScheduledTicks(gate.gateId);
      }
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    },
  };
}
