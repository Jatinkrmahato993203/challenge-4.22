import type {
  ActionAuditRecord,
  FanNudge,
  NudgeAuditRecord,
  RecommendedAction,
  ScoreAuditRecord,
  ShuttleRedirectionRecommendation,
  SignalEvent,
  ValidationErrorRecord,
} from "../types/models.js";

/**
 * Durable-write sink abstraction (implemented by a TimescaleDB-backed
 * repository in production). Kept as an interface here so the consumer
 * logic below can be exercised without a live database connection.
 */
export interface AuditRepository {
  writeSignalEvent(event: SignalEvent): Promise<void>;
  writeValidationError(error: ValidationErrorRecord): Promise<void>;
  writeScoreAudit(record: ScoreAuditRecord): Promise<void>;
  writeActionAudit(record: ActionAuditRecord): Promise<void>;
  writeShuttleRecommendation(record: ShuttleRedirectionRecommendation): Promise<void>;
  writeNudgeAudit(record: NudgeAuditRecord): Promise<void>;
}

/**
 * Kafka message envelope as delivered to the Audit_Log_Service's
 * multi-topic consumer group (design.md Audit_Log_Service section).
 */
export type AuditableMessage =
  | { topic: "signal-events"; value: SignalEvent }
  | { topic: "signal-events.dlq"; value: ValidationErrorRecord }
  | { topic: "congestion-scores"; value: ScoreAuditRecord }
  | { topic: "recommended-actions"; value: RecommendedAction }
  | { topic: "shuttle-recommendations"; value: ShuttleRedirectionRecommendation }
  | { topic: "fan-nudges"; value: FanNudge };

/**
 * Audit_Log_Service consumer (design.md Audit_Log_Service section,
 * Req 13.1, 13.2, 13.3, 13.5): a Kafka consumer group that writes every
 * message from `signal-events` (incl. DLQ), `congestion-scores`,
 * `recommended-actions`, `shuttle-recommendations`, and `fan-nudges`
 * into the corresponding TimescaleDB hypertables.
 *
 * Every Signal_Event -- stale or not, degraded-source-originated or
 * not -- is written through unmodified, which is what preserves Req
 * 13.5's "independent of whether ... marked stale or excluded from
 * active Congestion_Score computation" guarantee: this consumer has no
 * filtering logic based on isStale/exclusion at all.
 */
export class AuditLogConsumer {
  constructor(private readonly repository: AuditRepository) {}

  async handleMessage(message: AuditableMessage): Promise<void> {
    switch (message.topic) {
      case "signal-events":
        await this.repository.writeSignalEvent(message.value);
        return;
      case "signal-events.dlq":
        await this.repository.writeValidationError(message.value);
        return;
      case "congestion-scores":
        await this.repository.writeScoreAudit(message.value);
        return;
      case "recommended-actions":
        await this.repository.writeActionAudit(message.value);
        return;
      case "shuttle-recommendations":
        await this.repository.writeShuttleRecommendation(message.value);
        return;
      case "fan-nudges":
        await this.repository.writeNudgeAudit(message.value);
        return;
    }
  }
}
