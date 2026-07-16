import express, { Request, Response, NextFunction } from "express";
import { createServer, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type {
  GateId,
  SignalSource,
  FanId,
  CongestionScorePoint,
  RecommendedAction,
  ShuttleRedirectionRecommendation,
  FanNudge,
  Alert,
  ScoreAuditRecord,
  SignalEvent,
  ValidationErrorRecord,
} from "./types/models.js";

// Service APIs
import { SignalIngestionService, type EventPublisher } from "./signal-ingestion/service.js";
import type { ValidationError } from "./signal-ingestion/parser.js";
import { SourceStatusService } from "./signal-ingestion/status.js";
import { ForecastApi, type ForecastStore } from "./congestion-forecaster/api.js";
import { RecommendationEngineApi } from "./recommendation-engine/api.js";
import type { ActiveActionsStore } from "./recommendation-engine/service.js";
import { ShuttleRedirectionApi, type RedirectionStore } from "./shuttle-redirection-advisor/api.js";
import { FanNotificationApi, type NudgeAuditQuery } from "./fan-notification-system/api.js";
import { OpsDashboardApi, type AlertStore } from "./ops-dashboard/api.js";
import { DashboardSnapshotService, type GateScoreSource, type ActiveActionsSource, type DataQualitySource } from "./ops-dashboard/snapshot.js";
import { DashboardWebSocketHub, type DashboardSocketConnection, type DashboardStreamEvent } from "./ops-dashboard/websocket.js";
import { AuditLogApi, type AuditQueryRepository, type AuditQueryRange } from "./audit-log-service/api.js";
import { RedisClientWrapper } from "./infra/redis-client.js";
import { RedirectionSuppressionStore } from "./shuttle-redirection-advisor/suppression.js";
import { requireRole, verifyApiKey } from "./infra/auth.js";
import { InMemoryEventBus } from "./infra/event-bus.js";
import { DEMO_GATES, DEMO_ROUTES } from "./infra/topology.js";
import { wirePipeline } from "./pipeline.js";
import { REJECTION_SUPPRESSION_MS, type RejectionRecord } from "./shuttle-redirection-advisor/redirections.js";
import type { QueuedNudgeStore } from "./fan-notification-system/service.js";
import type { QueuedNudgeSource, NudgeAuditSink } from "./fan-notification-system/delivery-worker.js";
import type { DeliveryRecord } from "./fan-notification-system/delivery.js";
import type { AuditRepository } from "./audit-log-service/consumer.js";

// ================== In-Memory Mocks ==================

// In-memory EventPublisher (mock): publishes onto the in-memory event
// bus so the pipeline actually receives signal-events / DLQ messages.
class InMemoryEventPublisher implements EventPublisher {
  constructor(private readonly bus: InMemoryEventBus) {}

  async publishSignalEvent(event: SignalEvent): Promise<void> {
    this.bus.publish("signal-events", event);
  }

  async publishValidationError(error: ValidationError): Promise<void> {
    // EventPublisher (signal-ingestion/service.ts) hands us a
    // ValidationError (parser.ts shape), but the bus's
    // "signal-events.dlq" topic payload type is ValidationErrorRecord
    // (types/models.ts shape) -- synthesize the missing fields.
    const record: ValidationErrorRecord = {
      ...error,
      errorId: randomUUID(),
      recordedAt: new Date().toISOString(),
    };
    this.bus.publish("signal-events.dlq", record);
  }
}

// In-memory Redis client wrapper (mock)
interface ExpiringEntry<T> {
  value: T;
  expiresAt: number;
}

class MockRedisClientWrapper extends RedisClientWrapper {
  private cooldownStore: Map<string, ExpiringEntry<string>> = new Map();
  private degradedSourceStore: Map<string, ExpiringEntry<string>> = new Map();
  private lastKnownScoreStore: Map<string, string> = new Map();
  private rejectionStore: Map<string, ExpiringEntry<string>> = new Map();

  constructor() {
    super({ client: {} as any });
  }

  private getIfNotExpired(
    store: Map<string, ExpiringEntry<string>>,
    key: string
  ): string | undefined {
    const entry = store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  // Cooldown tracking
  async getLastNudgeAt(fanId: string, gateId: GateId): Promise<Date | null> {
    const value = this.getIfNotExpired(this.cooldownStore, `${fanId}:${gateId}`);
    return value ? new Date(value) : null;
  }

  async setLastNudgeAt(
    fanId: string,
    gateId: GateId,
    generatedAt: Date,
    cooldownPeriodMs: number
  ): Promise<void> {
    this.cooldownStore.set(`${fanId}:${gateId}`, {
      value: generatedAt.toISOString(),
      expiresAt: Date.now() + cooldownPeriodMs,
    });
  }

  // Degraded-source tracking
  async touchSource(sourceType: string, gateOrRouteId: string, timeoutMs: number): Promise<void> {
    this.degradedSourceStore.set(`${sourceType}:${gateOrRouteId}`, {
      value: "1",
      expiresAt: Date.now() + timeoutMs,
    });
  }

  async isSourceDegraded(sourceType: string, gateOrRouteId: string): Promise<boolean> {
    return this.getIfNotExpired(this.degradedSourceStore, `${sourceType}:${gateOrRouteId}`) === undefined;
  }

  // Last-known score cache
  async getLastKnownScore(gateId: GateId): Promise<CongestionScorePoint | null> {
    const value = this.lastKnownScoreStore.get(gateId);
    return value ? JSON.parse(value) : null;
  }

  async setLastKnownScore(gateId: GateId, point: CongestionScorePoint): Promise<void> {
    this.lastKnownScoreStore.set(gateId, JSON.stringify(point));
  }

  // Rejection suppression
  async recordRejection(routeId: string, alternativeGateId: GateId, suppressionMs: number): Promise<void> {
    this.rejectionStore.set(`${routeId}:${alternativeGateId}`, {
      value: "1",
      expiresAt: Date.now() + suppressionMs,
    });
  }

  async isRejectionSuppressed(routeId: string, alternativeGateId: GateId): Promise<boolean> {
    return this.getIfNotExpired(this.rejectionStore, `${routeId}:${alternativeGateId}`) !== undefined;
  }
}

// In-memory ForecastStore
class MockForecastStore implements ForecastStore {
  private readonly store: Map<GateId, CongestionScorePoint[]> = new Map();

  async getLatestForecast(gateId: GateId): Promise<CongestionScorePoint[] | null> {
    return this.store.get(gateId) ?? null;
  }

  setForecast(gateId: GateId, scores: CongestionScorePoint[]): void {
    this.store.set(gateId, scores);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory ActiveActionsStore
class MockActiveActionsStore implements ActiveActionsStore {
  private readonly store: Map<GateId, RecommendedAction[]> = new Map();

  async getActiveActions(gateId: GateId): Promise<RecommendedAction[]> {
    return this.store.get(gateId) ?? [];
  }

  async setActiveActions(gateId: GateId, actions: RecommendedAction[]): Promise<void> {
    this.store.set(gateId, actions);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory RedirectionStore
class MockRedirectionStore implements RedirectionStore {
  private readonly store: Map<string, ShuttleRedirectionRecommendation[]> = new Map();

  async getActiveRecommendations(routeId: string): Promise<ShuttleRedirectionRecommendation[]> {
    return this.store.get(routeId) ?? [];
  }

  async updateRecommendation(recommendation: ShuttleRedirectionRecommendation): Promise<void> {
    const routeId = recommendation.routeId;
    const existing = this.store.get(routeId) ?? [];
    const index = existing.findIndex((r) => r.recommendationId === recommendation.recommendationId);
    if (index !== -1) {
      existing[index] = recommendation;
    } else {
      existing.push(recommendation);
    }
    this.store.set(routeId, existing);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory NudgeAuditQuery
class MockNudgeAuditQuery implements NudgeAuditQuery {
  private readonly nudges: FanNudge[] = [];

  async queryNudges(filter: { gateId?: GateId; fanId?: FanId }): Promise<FanNudge[]> {
    let result = this.nudges;
    if (filter.gateId) {
      result = result.filter((n) => n.originGateId === filter.gateId);
    }
    if (filter.fanId) {
      result = result.filter((n) => n.fanId === filter.fanId);
    }
    return result;
  }

  addNudge(nudge: FanNudge): void {
    this.nudges.push(nudge);
  }

  clear(): void {
    this.nudges.length = 0;
  }
}

// In-memory AlertStore
class MockAlertStore implements AlertStore {
  private readonly store: Map<string, Alert> = new Map();

  async getAlert(alertId: string): Promise<Alert | null> {
    return this.store.get(alertId) ?? null;
  }

  async updateAlert(alert: Alert): Promise<void> {
    this.store.set(alert.alertId, alert);
  }

  addAlert(alert: Alert): void {
    this.store.set(alert.alertId, alert);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory GateScoreSource
class MockGateScoreSource implements GateScoreSource {
  private readonly store: Map<GateId, CongestionScorePoint> = new Map();

  async getCurrentScore(gateId: GateId): Promise<CongestionScorePoint | null> {
    return this.store.get(gateId) ?? null;
  }

  setScore(gateId: GateId, point: CongestionScorePoint): void {
    this.store.set(gateId, point);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory ActiveActionsSource
class MockActiveActionsSource implements ActiveActionsSource {
  private readonly store: Map<GateId, RecommendedAction[]> = new Map();

  async getActiveActions(gateId: GateId): Promise<RecommendedAction[]> {
    return this.store.get(gateId) ?? [];
  }

  setActions(gateId: GateId, actions: RecommendedAction[]): void {
    this.store.set(gateId, actions);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory DataQualitySource
class MockDataQualitySource implements DataQualitySource {
  private readonly degradedSources: Set<string> = new Set();

  async hasDegradedSource(gateId: GateId): Promise<boolean> {
    return this.degradedSources.has(gateId);
  }

  setDegraded(gateId: GateId, degraded: boolean): void {
    if (degraded) {
      this.degradedSources.add(gateId);
    } else {
      this.degradedSources.delete(gateId);
    }
  }

  clear(): void {
    this.degradedSources.clear();
  }
}

// In-memory QueuedNudgeStore + QueuedNudgeSource (queue of nudges awaiting simulated delivery)
class MockQueuedNudgeStore implements QueuedNudgeStore, QueuedNudgeSource {
  private readonly store: Map<string, FanNudge> = new Map();

  async enqueue(nudge: FanNudge): Promise<void> {
    this.store.set(nudge.nudgeId, nudge);
  }

  async getQueuedNudges(): Promise<FanNudge[]> {
    return Array.from(this.store.values());
  }

  async updateNudge(nudge: FanNudge): Promise<void> {
    this.store.set(nudge.nudgeId, nudge);
  }

  clear(): void {
    this.store.clear();
  }
}

// In-memory AuditQueryRepository + AuditRepository (audit read/write store)
class MockAuditQueryRepository implements AuditQueryRepository, AuditRepository {
  private readonly scores: ScoreAuditRecord[] = [];
  private readonly actions: Map<string, RecommendedAction> = new Map();
  private readonly nudges: Map<string, FanNudge> = new Map();
  private readonly signalEvents: SignalEvent[] = [];
  private readonly validationErrors: ValidationErrorRecord[] = [];
  private readonly shuttleRecommendations: ShuttleRedirectionRecommendation[] = [];

  async queryScores(range: AuditQueryRange): Promise<ScoreAuditRecord[]> {
    return this.scores.filter((s) => {
      if (range.gateId && s.gateId !== range.gateId) return false;
      if (range.from && s.timestamp < range.from) return false;
      if (range.to && s.timestamp > range.to) return false;
      return true;
    });
  }

  async queryActions(range: AuditQueryRange): Promise<RecommendedAction[]> {
    return Array.from(this.actions.values()).filter((a) => {
      if (range.gateId && a.gateId !== range.gateId) return false;
      if (range.from && a.generatedAt < range.from) return false;
      if (range.to && a.generatedAt > range.to) return false;
      return true;
    });
  }

  async queryNudges(range: AuditQueryRange): Promise<FanNudge[]> {
    return Array.from(this.nudges.values()).filter((n) => {
      if (range.gateId && n.originGateId !== range.gateId) return false;
      if (range.fanId && n.fanId !== range.fanId) return false;
      if (range.from && n.generatedAt < range.from) return false;
      if (range.to && n.generatedAt > range.to) return false;
      return true;
    });
  }

  async writeSignalEvent(event: SignalEvent): Promise<void> {
    this.signalEvents.push(event);
  }

  async writeValidationError(error: ValidationErrorRecord): Promise<void> {
    this.validationErrors.push(error);
  }

  async writeScoreAudit(record: ScoreAuditRecord): Promise<void> {
    this.scores.push(record);
  }

  async writeActionAudit(record: RecommendedAction): Promise<void> {
    this.actions.set(record.actionId, record);
  }

  async writeShuttleRecommendation(record: ShuttleRedirectionRecommendation): Promise<void> {
    this.shuttleRecommendations.push(record);
  }

  async writeNudgeAudit(record: FanNudge): Promise<void> {
    this.nudges.set(record.nudgeId, record);
  }

  clear(): void {
    this.scores.length = 0;
    this.actions.clear();
    this.nudges.clear();
    this.signalEvents.length = 0;
    this.validationErrors.length = 0;
    this.shuttleRecommendations.length = 0;
  }
}

// In-memory NudgeAuditSink: records final delivery/cancellation outcomes into
// both the operator-facing nudge query store and the audit repository.
class MockNudgeAuditSink implements NudgeAuditSink {
  constructor(
    private readonly nudgeAuditQuery: MockNudgeAuditQuery,
    private readonly auditRepository: MockAuditQueryRepository
  ) {}

  async recordDelivery(nudge: FanNudge, _deliveryRecord: DeliveryRecord): Promise<void> {
    this.nudgeAuditQuery.addNudge(nudge);
    await this.auditRepository.writeNudgeAudit(nudge);
  }

  async recordCancellation(nudge: FanNudge): Promise<void> {
    this.nudgeAuditQuery.addNudge(nudge);
    await this.auditRepository.writeNudgeAudit(nudge);
  }
}

// ================== Service Instances with Mock Dependencies ==================

// Event bus
const eventBus = new InMemoryEventBus();

// Event publisher
const eventPublisher = new InMemoryEventPublisher(eventBus);

// Redis client
const redisClient = new MockRedisClientWrapper();

// SignalIngestionService
const signalIngestionService = new SignalIngestionService(eventPublisher, redisClient);

// SourceStatusService
const sourceStatusService = new SourceStatusService(redisClient);

// ForecastApi
const forecastStore = new MockForecastStore();
const forecastApi = new ForecastApi(forecastStore);

// ActiveActionsStore and RecommendationEngineApi
const activeActionsStore = new MockActiveActionsStore();
const recommendationEngineApi = new RecommendationEngineApi(activeActionsStore);

// RedirectionSuppressionStore and ShuttleRedirectionApi
const redirectionSuppressionStore = new RedirectionSuppressionStore(redisClient);
const redirectionStore = new MockRedirectionStore();
const shuttleRedirectionApi = new ShuttleRedirectionApi(redirectionStore, redirectionSuppressionStore);

// FanNotificationApi
const nudgeAuditQuery = new MockNudgeAuditQuery();
const fanNotificationApi = new FanNotificationApi(nudgeAuditQuery);

// AlertStore and OpsDashboardApi
const alertStore = new MockAlertStore();
const opsDashboardApi = new OpsDashboardApi(alertStore);

// Mock sources for DashboardSnapshotService
const gateScoreSource = new MockGateScoreSource();
const activeActionsSource = new MockActiveActionsSource();
const dataQualitySource = new MockDataQualitySource();

const dashboardSnapshotService = new DashboardSnapshotService(gateScoreSource, activeActionsSource, dataQualitySource);

// DashboardWebSocketHub
const dashboardWebSocketHub = new DashboardWebSocketHub(() => []);

// AuditQueryRepository and AuditLogApi
const auditQueryRepository = new MockAuditQueryRepository();
const auditLogApi = new AuditLogApi(auditQueryRepository);

// ================== Pipeline Wiring ==================
// Wires the already-independently-testable subsystems above into an
// automatic, end-to-end flow: ingested signals -> forecast -> risk
// alerts -> recommendations -> shuttle redirections -> fan nudges ->
// audit log, using the demo Gate/Route topology and an in-memory event
// bus as a single-process stand-in for the real Kafka topics.
const queuedNudgeStore = new MockQueuedNudgeStore();
const nudgeAuditSink = new MockNudgeAuditSink(nudgeAuditQuery, auditQueryRepository);

const recentRejections: RejectionRecord[] = [];
function getRecentRejections(): RejectionRecord[] {
  const cutoff = Date.now() - REJECTION_SUPPRESSION_MS;
  return recentRejections.filter((r) => new Date(r.rejectedAt).getTime() >= cutoff);
}

const pipelineHandle = wirePipeline({
  bus: eventBus,
  gates: DEMO_GATES,
  routes: DEMO_ROUTES,
  redis: redisClient,
  forecastStore,
  gateScoreSource,
  activeActionsStore,
  activeActionsSource,
  redirectionStore,
  queuedNudgeStore,
  nudgeAuditSink,
  alertStore,
  dataQualitySource,
  auditRepository: auditQueryRepository,
  sourceStatusService,
  dashboardHub: dashboardWebSocketHub,
  getRecentRejections,
});

// ================== Express App Setup ==================

// Allow-list of origins permitted to make cross-origin requests, read
// from ALLOWED_ORIGINS (comma-separated). If unset, no origins are
// allowed (the CORS header is simply omitted) rather than defaulting
// to a wildcard "*".
const allowedOrigins: Set<string> = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
);

const app = express();
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.header("Origin");
  if (origin && allowedOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

// Minimal structured request logging. Logs one JSON line per request
// to stdout once the response has finished. Uses req.path (not
// req.url) so query strings -- which may carry the WebSocket-style
// `apiKey` param used elsewhere -- are never logged, and intentionally
// omits the Authorization/X-API-Key headers and request body since
// those may contain secrets or PII. req.actorRole is read inside the
// "finish" listener, which fires after the whole request/response
// cycle (including the auth middleware) completes, so it reflects the
// value set by requireRole() if the request was authenticated.
app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        actorRole: req.actorRole ?? null,
      })
    );
  });
  next();
});

// ================== Route Handlers ==================

// Liveness check: GET /healthz (no dependency checks)
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Signal_Ingestion: POST /v1/signals
app.post("/v1/signals", requireRole("INGESTION_SOURCE"), async (req: Request, res: Response) => {
  try {
    const result = await signalIngestionService.handleSignal(req.body);
    if (result.status === 202) {
      res.status(202).json({ signalId: result.signalId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) {
    console.error("Error handling signal:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Signal_Ingestion: GET /v1/sources/{gate_or_route_id}/status
app.get(
  "/v1/sources/:gateOrRouteId/status",
  requireRole("VENUE_OPS_MANAGER", "GATE_STAFF", "TRANSIT_DISPATCHER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const gateOrRouteId = req.params.gateOrRouteId as string;
    const statuses = await sourceStatusService.getStatus(gateOrRouteId);
    res.status(200).json(statuses);
  } catch (err) {
    console.error("Error getting source status:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Congestion_Forecaster: GET /v1/gates/{gate_id}/forecast
app.get(
  "/v1/gates/:gateId/forecast",
  requireRole("VENUE_OPS_MANAGER", "GATE_STAFF", "TRANSIT_DISPATCHER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const gateId = req.params.gateId as string;
    const forecast = await forecastApi.getForecast(gateId as GateId);
    if (forecast) {
      res.status(200).json(forecast);
    } else {
      res.status(404).json({ error: "Forecast not found" });
    }
  } catch (err) {
    console.error("Error getting forecast:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Recommendation_Engine: GET /v1/gates/{gate_id}/actions
app.get(
  "/v1/gates/:gateId/actions",
  requireRole("VENUE_OPS_MANAGER", "GATE_STAFF", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const gateId = req.params.gateId as string;
    const actions = await recommendationEngineApi.getActions(gateId as GateId);
    res.status(200).json(actions);
  } catch (err) {
    console.error("Error getting actions:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Recommendation_Engine: POST /v1/gates/{gate_id}/actions/{action_id}/execute
app.post(
  "/v1/gates/:gateId/actions/:actionId/execute",
  requireRole("VENUE_OPS_MANAGER", "GATE_STAFF"),
  async (req: Request, res: Response) => {
  try {
    const gateId = req.params.gateId as string;
    const actionId = req.params.actionId as string;
    const result = await recommendationEngineApi.executeAction(gateId as GateId, actionId, req.body as { userId: string });
    if (result) {
      res.status(200).json(result);
    } else {
      res.status(404).json({ error: "Action not found" });
    }
  } catch (err) {
    console.error("Error executing action:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Shuttle_Redirection_Advisor: GET /v1/routes/{route_id}/redirections
app.get(
  "/v1/routes/:routeId/redirections",
  requireRole("TRANSIT_DISPATCHER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const routeId = req.params.routeId as string;
    const redirections = await shuttleRedirectionApi.getRedirections(routeId);
    res.status(200).json(redirections);
  } catch (err) {
    console.error("Error getting redirections:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Shuttle_Redirection_Advisor: POST /v1/routes/{route_id}/redirections/{rec_id}/accept
app.post(
  "/v1/routes/:routeId/redirections/:recId/accept",
  requireRole("TRANSIT_DISPATCHER"),
  async (req: Request, res: Response) => {
  try {
    const routeId = req.params.routeId as string;
    const recId = req.params.recId as string;
    const result = await shuttleRedirectionApi.acceptRedirection(routeId, recId, req.body as { dispatcherId: string });
    if (result) {
      res.status(200).json(result);
    } else {
      res.status(404).json({ error: "Redirection not found" });
    }
  } catch (err) {
    console.error("Error accepting redirection:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Shuttle_Redirection_Advisor: POST /v1/routes/{route_id}/redirections/{rec_id}/reject
app.post(
  "/v1/routes/:routeId/redirections/:recId/reject",
  requireRole("TRANSIT_DISPATCHER"),
  async (req: Request, res: Response) => {
  try {
    const routeId = req.params.routeId as string;
    const recId = req.params.recId as string;
    const result = await shuttleRedirectionApi.rejectRedirection(routeId, recId, req.body as { dispatcherId: string });
    if (result) {
      recentRejections.push({
        routeId: result.routeId,
        alternativeGateId: result.alternativeGateId,
        rejectedAt: result.rejectedAt ?? new Date().toISOString(),
      });
      res.status(200).json(result);
    } else {
      res.status(404).json({ error: "Redirection not found" });
    }
  } catch (err) {
    console.error("Error rejecting redirection:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Fan_Notification_System: GET /v1/nudges
app.get(
  "/v1/nudges",
  requireRole("VENUE_OPS_MANAGER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const filter: { gateId?: GateId; fanId?: FanId } = {};
    if (req.query.gateId) filter.gateId = req.query.gateId as GateId;
    if (req.query.fanId) filter.fanId = req.query.fanId as FanId;

    const nudges = await fanNotificationApi.getNudges(filter);
    res.status(200).json(nudges);
  } catch (err) {
    console.error("Error getting nudges:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Ops_Dashboard: GET /v1/dashboard/gates
app.get(
  "/v1/dashboard/gates",
  requireRole("VENUE_OPS_MANAGER", "GATE_STAFF", "TRANSIT_DISPATCHER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const gates = await dashboardSnapshotService.getSnapshot(DEMO_GATES.map((g) => g.gateId));
    res.status(200).json(gates);
  } catch (err) {
    console.error("Error getting dashboard gates:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Ops_Dashboard: POST /v1/alerts/{alert_id}/acknowledge
app.post(
  "/v1/alerts/:alertId/acknowledge",
  requireRole("VENUE_OPS_MANAGER", "TRANSIT_DISPATCHER"),
  async (req: Request, res: Response) => {
  try {
    const alertId = req.params.alertId as string;
    const result = await opsDashboardApi.acknowledgeAlert(alertId, req.body as { userId: string });
    if (result) {
      res.status(200).json(result);
    } else {
      res.status(404).json({ error: "Alert not found" });
    }
  } catch (err) {
    console.error("Error acknowledging alert:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Audit_Log_Service: GET /v1/audit/scores
app.get(
  "/v1/audit/scores",
  requireRole("VENUE_OPS_MANAGER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const range: { gateId?: GateId; from?: string; to?: string } = {};
    if (req.query.gateId) range.gateId = req.query.gateId as GateId;
    if (req.query.from) range.from = req.query.from as string;
    if (req.query.to) range.to = req.query.to as string;

    const scores = await auditLogApi.getScores(range);
    res.status(200).json(scores);
  } catch (err) {
    console.error("Error getting audit scores:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Audit_Log_Service: GET /v1/audit/actions
app.get(
  "/v1/audit/actions",
  requireRole("VENUE_OPS_MANAGER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const range: { gateId?: GateId; from?: string; to?: string } = {};
    if (req.query.gateId) range.gateId = req.query.gateId as GateId;
    if (req.query.from) range.from = req.query.from as string;
    if (req.query.to) range.to = req.query.to as string;

    const actions = await auditLogApi.getActions(range);
    res.status(200).json(actions);
  } catch (err) {
    console.error("Error getting audit actions:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// Audit_Log_Service: GET /v1/audit/nudges
app.get(
  "/v1/audit/nudges",
  requireRole("VENUE_OPS_MANAGER", "AUDITOR"),
  async (req: Request, res: Response) => {
  try {
    const range: { fanId?: FanId; gateId?: GateId; from?: string; to?: string } = {};
    if (req.query.fanId) range.fanId = req.query.fanId as FanId;
    if (req.query.gateId) range.gateId = req.query.gateId as GateId;
    if (req.query.from) range.from = req.query.from as string;
    if (req.query.to) range.to = req.query.to as string;

    const nudges = await auditLogApi.getNudges(range);
    res.status(200).json(nudges);
  } catch (err) {
    console.error("Error getting audit nudges:", err);
    res.status(503).json({ error: "Service unavailable" });
  }
});

// ================== WebSocket Endpoint ==================
const httpServer = createServer(app);

const DASHBOARD_STREAM_ROLES = ["VENUE_OPS_MANAGER", "GATE_STAFF", "TRANSIT_DISPATCHER", "AUDITOR"] as const;

const wss = new WebSocketServer({ noServer: true });

// Verify the API key (passed as ?apiKey=<key>) before completing the
// WebSocket handshake, rejecting unauthorized upgrade requests
// outright rather than accepting the connection and closing it after.
httpServer.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", "http://localhost");
  if (url.pathname !== "/v1/dashboard/stream") {
    socket.destroy();
    return;
  }

  const apiKey = url.searchParams.get("apiKey") ?? undefined;
  const roles = verifyApiKey(apiKey);
  const isAuthorized = roles !== null && roles.some((role) => DASHBOARD_STREAM_ROLES.includes(role as (typeof DASHBOARD_STREAM_ROLES)[number]));

  if (!isAuthorized) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws) => {
  const connection: DashboardSocketConnection = {
    send: (event: unknown) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(event));
      }
    },
  };

  dashboardWebSocketHub.register(connection);

  ws.on("close", () => {
    dashboardWebSocketHub.unregister(connection);
  });

  ws.on("error", () => {
    dashboardWebSocketHub.unregister(connection);
  });
});

// Start heartbeat for WebSocket clients
dashboardWebSocketHub.startHeartbeat(30000);

// ================== Server Lifecycle ==================

const PORT = process.env.PORT || 3000;

let server: Server | null = null;

async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = httpServer.listen(PORT, () => {
      console.log(`[server] Stadium Congestion Forecasting System listening on port ${PORT}`);
      resolve();
    });

    server.on("error", (err) => {
      console.error("[server] Failed to start:", err);
      reject(err);
    });
  });
}

async function shutdownServer(): Promise<void> {
  console.log("[server] Shutting down...");

  // Stop the pipeline (scheduled ticks + bus subscriptions)
  pipelineHandle.stop();

  // Stop WebSocket heartbeat
  dashboardWebSocketHub.stopHeartbeat();

  // Close WebSocket server
  wss.close(() => {
    console.log("[server] WebSocket server closed");
  });

  // Close HTTP server
  if (server) {
    server.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });

    // Force close after 5 seconds
    setTimeout(() => {
      console.log("[server] Force closing connections");
      process.exit(0);
    }, 5000);
  }
}

// Handle graceful shutdown
process.on("SIGINT", shutdownServer);
process.on("SIGTERM", shutdownServer);

// Handle otherwise-fatal errors: log with a clear prefix (including
// the stack trace), attempt a graceful shutdown via shutdownServer(),
// and if that doesn't get us to process.exit() within a few seconds
// (e.g. shutdownServer() itself throws, or the process is stuck),
// fall back to a hard exit so the process doesn't hang in a broken
// state. This is intentionally minimal -- just safe logging plus
// graceful-shutdown-then-exit, no crash-reporting integration.
process.on("uncaughtException", (err: Error) => {
  console.error("[server] uncaughtException:", err.stack ?? err);
  setTimeout(() => process.exit(1), 5000);
  void shutdownServer();
});

process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason.stack ?? reason.message : reason;
  console.error("[server] unhandledRejection:", err);
  setTimeout(() => process.exit(1), 5000);
  void shutdownServer();
});

// Export the default async function to start the server
export default async function startStadiumServer(): Promise<void> {
  await startServer();
}
