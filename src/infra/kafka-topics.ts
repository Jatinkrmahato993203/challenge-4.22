/**
 * Kafka topic configuration for the Congestion_Forecasting_System
 * (design.md Architecture section: "event backbone").
 *
 * All topics are partitioned by gate_id (or route_id for shuttle
 * topics) so that all events for a given Gate/Route are processed in
 * order by a single partition -- required for the Req 4/6/9
 * determinism and monotonicity properties, which depend on a Gate's
 * Congestion_Score and Recommended_Action list being pure functions of
 * the ORDERED Signal_Event history for that Gate.
 */

export type PartitionKeyField = "gate_id" | "route_id";

export interface KafkaTopicConfig {
  name: string;
  partitionKeyField: PartitionKeyField;
  /** Number of partitions; should be >= expected concurrent Gate/Route count. */
  numPartitions: number;
  /** Replication factor for durability. */
  replicationFactor: number;
  /**
   * Retention in ms. The audit trail requirement (Req 13.4, 90 days) is
   * satisfied by the durable TimescaleDB audit store fed by these
   * topics, not by topic retention itself -- topic retention here is
   * sized for operational replay/recovery, not long-term audit.
   */
  retentionMs: number;
}

export const KAFKA_TOPICS: Record<string, KafkaTopicConfig> = {
  SIGNAL_EVENTS: {
    name: "signal-events",
    partitionKeyField: "gate_id",
    numPartitions: 12,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000, // 7 days operational replay window
  },
  SIGNAL_EVENTS_DLQ: {
    name: "signal-events.dlq",
    partitionKeyField: "gate_id",
    numPartitions: 6,
    replicationFactor: 3,
    retentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days for investigation
  },
  CONGESTION_SCORES: {
    name: "congestion-scores",
    partitionKeyField: "gate_id",
    numPartitions: 12,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
  },
  RECOMMENDED_ACTIONS: {
    name: "recommended-actions",
    partitionKeyField: "gate_id",
    numPartitions: 12,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
  },
  SHUTTLE_RECOMMENDATIONS: {
    name: "shuttle-recommendations",
    partitionKeyField: "route_id",
    numPartitions: 6,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
  },
  FAN_NUDGES: {
    name: "fan-nudges",
    partitionKeyField: "gate_id",
    numPartitions: 6,
    replicationFactor: 3,
    retentionMs: 7 * 24 * 60 * 60 * 1000,
  },
};

/**
 * Resolves the Kafka partition key for a message given its target
 * Gate_Id or Route_Id, per the topic's configured partitionKeyField.
 */
export function partitionKeyFor(
  topic: KafkaTopicConfig,
  ids: { gateId?: string; routeId?: string }
): string {
  const key = topic.partitionKeyField === "gate_id" ? ids.gateId : ids.routeId;
  if (!key) {
    throw new Error(
      `Missing ${topic.partitionKeyField} required to partition message for topic ${topic.name}`
    );
  }
  return key;
}
