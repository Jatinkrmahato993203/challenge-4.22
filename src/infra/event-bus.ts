import { EventEmitter } from "node:events";
import type {
  FanNudge,
  Gate,
  GateId,
  RecommendedAction,
  ShuttleRedirectionRecommendation,
  SignalEvent,
  ValidationErrorRecord,
} from "../types/models.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";

/**
 * In-memory pub/sub stand-in for the Kafka topics described in
 * design.md (see src/infra/kafka-topics.ts for the real topic
 * configuration this mirrors). Scoped to a single process: every
 * publish/subscribe call here happens synchronously in-memory via
 * Node's EventEmitter, with no partitioning, durability, or
 * cross-instance delivery.
 *
 * A multi-instance production deployment would replace this class
 * with real Kafka producers (on the publish side) and consumer groups
 * (on the subscribe side) against the topics already defined in
 * kafka-topics.ts, without needing to change any subscriber's logic --
 * every subscriber here only depends on the BusTopics payload shapes,
 * not on this transport.
 */
export interface CongestionScoreMessage {
  gate: Gate;
  result: ForecastResult;
}

export interface RecommendedActionsMessage {
  gateId: GateId;
  actions: RecommendedAction[];
}

export interface BusTopics {
  "signal-events": SignalEvent;
  "signal-events.dlq": ValidationErrorRecord;
  "congestion-scores": CongestionScoreMessage;
  "recommended-actions": RecommendedActionsMessage;
  "shuttle-recommendations": ShuttleRedirectionRecommendation;
  "fan-nudges": FanNudge;
}

export class InMemoryEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Topic payloads fan out to listeners across several subsystems
    // (ingestion, forecaster, recommendations, audit, dashboard);
    // raise the default limit rather than silently dropping the
    // MaxListenersExceededWarning.
    this.emitter.setMaxListeners(50);
  }

  publish<T extends keyof BusTopics>(topic: T, payload: BusTopics[T]): void {
    this.emitter.emit(topic, payload);
  }

  subscribe<T extends keyof BusTopics>(
    topic: T,
    handler: (payload: BusTopics[T]) => void | Promise<void>
  ): () => void {
    const wrapped = (payload: BusTopics[T]) => {
      try {
        const result = handler(payload);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            console.error(`[event-bus] subscriber error on topic "${topic}":`, err);
          });
        }
      } catch (err) {
        console.error(`[event-bus] subscriber error on topic "${topic}":`, err);
      }
    };

    this.emitter.on(topic, wrapped);
    return () => {
      this.emitter.off(topic, wrapped);
    };
  }
}
