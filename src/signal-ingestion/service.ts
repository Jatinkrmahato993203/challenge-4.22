import { randomUUID } from "node:crypto";
import { parseSignalEvent, serializeSignalEvent, type ValidationError } from "./parser.js";
import { classifyTiming, DEFAULT_TIMING_CONFIG, type TimingConfig } from "./timing.js";
import { DegradedSourceTracker } from "./degraded-source.js";
import type { RedisClientWrapper } from "../infra/redis-client.js";
import type { SignalEvent } from "../types/models.js";

/**
 * Minimal publisher abstraction so the service logic can be unit-tested
 * without a real Kafka broker. A production wiring supplies a Kafka
 * producer-backed implementation.
 */
export interface EventPublisher {
  publishSignalEvent(event: SignalEvent): Promise<void>;
  publishValidationError(error: ValidationError): Promise<void>;
}

export type SignalIngestionResult =
  | { status: 202; signalId: string }
  | { status: 400; error: ValidationError };

/**
 * Signal_Ingestion_Service wrapper (design.md Signal_Ingestion_Service
 * section): validates/parses incoming payloads, classifies timing,
 * publishes to Kafka (or the DLQ on validation failure), and refreshes
 * degraded-source timers.
 *
 * Implements `POST /v1/signals` (Req 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8,
 * 2.1, 2.2): returns 202 with the assigned signalId on success, or 400
 * with a diagnosable ValidationError on failure (Req 1.3/2.5).
 */
export class SignalIngestionService {
  private readonly degradedSourceTracker: DegradedSourceTracker;

  constructor(
    private readonly publisher: EventPublisher,
    redis: RedisClientWrapper,
    private readonly timingConfig: TimingConfig = DEFAULT_TIMING_CONFIG
  ) {
    this.degradedSourceTracker = new DegradedSourceTracker(redis);
  }

  /**
   * Handles a raw Signal_Event payload as received over HTTP. `now`
   * defaults to the current time but is injectable for deterministic
   * testing.
   */
  async handleSignal(
    rawPayload: unknown,
    now: Date = new Date()
  ): Promise<SignalIngestionResult> {
    // Ensure every incoming payload carries a signalId, receivedAt, and
    // the timing fields before schema validation -- callers (HTTP
    // clients) are only expected to supply source/gateId/routeId/
    // timestamp/payload; the service assigns the rest.
    const withDefaults = this.applyIntakeDefaults(rawPayload, now);

    const parsed = parseSignalEvent(withDefaults);
    if (!parsed.ok) {
      await this.publisher.publishValidationError(parsed.error);
      return { status: 400, error: parsed.error };
    }

    const { isStale, lateArrivalFlag } = classifyTiming(
      parsed.value,
      now,
      this.timingConfig
    );

    const event: SignalEvent = {
      ...parsed.value,
      isStale,
      lateArrivalFlag,
    };

    await this.publisher.publishSignalEvent(event);

    const targetId = event.gateId ?? event.routeId;
    if (targetId) {
      await this.degradedSourceTracker.markActive(event.source, targetId);
    }

    return { status: 202, signalId: event.signalId };
  }

  /**
   * Fills in fields the intake layer is responsible for assigning
   * (signalId, receivedAt, isStale/lateArrivalFlag placeholders) so
   * that clients only need to supply the "business" fields.
   */
  private applyIntakeDefaults(rawPayload: unknown, now: Date): unknown {
    if (typeof rawPayload !== "object" || rawPayload === null) {
      return rawPayload;
    }
    const input = rawPayload as Record<string, unknown>;
    return {
      signalId: input.signalId ?? randomUUID(),
      receivedAt: input.receivedAt ?? now.toISOString(),
      isStale: input.isStale ?? false,
      lateArrivalFlag: input.lateArrivalFlag ?? false,
      ...input,
    };
  }
}

export { serializeSignalEvent };
