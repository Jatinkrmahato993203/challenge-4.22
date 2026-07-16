import type { RiskLevel, SignalEvent } from "../types/models.js";

const RISK_PRIORITY: Record<RiskLevel, number> = {
  CRITICAL: 3,
  HIGH: 2,
  MODERATE: 1,
  LOW: 0,
};

export interface QueuedSignalEvent {
  event: SignalEvent;
  gateRiskLevel: RiskLevel;
  enqueuedAt: Date;
}

/**
 * Bounded, Risk_Level-priority intake queue (design.md
 * Signal_Ingestion_Service section, Req 12.4): "the intake priority
 * queue sheds/delays lowest-Risk_Level-Gate traffic first rather than
 * failing indiscriminately."
 *
 * Events are keyed by the TARGET GATE'S CURRENT Risk_Level (supplied by
 * the caller, typically read from the Redis score cache) rather than
 * any property of the event itself, so Signal_Events for higher-risk
 * Gates are always dequeued/processed ahead of lower-risk ones
 * regardless of arrival order.
 */
export class PriorityIntakeQueue {
  private readonly buffers: Map<RiskLevel, QueuedSignalEvent[]> = new Map([
    ["CRITICAL", []],
    ["HIGH", []],
    ["MODERATE", []],
    ["LOW", []],
  ]);

  private size = 0;

  constructor(private readonly capacity: number) {}

  get currentSize(): number {
    return this.size;
  }

  get isFull(): boolean {
    return this.size >= this.capacity;
  }

  /**
   * Enqueues an event. If the queue is at capacity, sheds the
   * lowest-Risk_Level event currently queued (if any exists with lower
   * priority than the incoming one) to make room; otherwise the
   * incoming (also low-priority) event itself is dropped.
   * Returns the event that was shed, if any.
   */
  enqueue(item: QueuedSignalEvent): QueuedSignalEvent | undefined {
    if (this.isFull) {
      const shed = this.shedLowestPriority(item.gateRiskLevel);
      if (!shed) {
        // Nothing lower-priority to shed; the incoming event is dropped.
        return item;
      }
    }
    this.buffers.get(item.gateRiskLevel)!.push(item);
    this.size += 1;
    return undefined;
  }

  /**
   * Removes and returns the highest-priority (highest current
   * Risk_Level) queued event, in FIFO order within the same
   * Risk_Level band.
   */
  dequeue(): QueuedSignalEvent | undefined {
    for (const riskLevel of ["CRITICAL", "HIGH", "MODERATE", "LOW"] as RiskLevel[]) {
      const bucket = this.buffers.get(riskLevel)!;
      if (bucket.length > 0) {
        this.size -= 1;
        return bucket.shift();
      }
    }
    return undefined;
  }

  /**
   * Drains and returns ALL queued events, strictly ordered by
   * descending Risk_Level priority (then FIFO within a level). This is
   * the ordering the property test (Property 40) verifies: events for
   * higher-current-Risk_Level Gates come out before lower ones.
   */
  drainInPriorityOrder(): QueuedSignalEvent[] {
    const result: QueuedSignalEvent[] = [];
    let next = this.dequeue();
    while (next) {
      result.push(next);
      next = this.dequeue();
    }
    return result;
  }

  private shedLowestPriority(incomingRiskLevel: RiskLevel): QueuedSignalEvent | undefined {
    const incomingPriority = RISK_PRIORITY[incomingRiskLevel];
    for (const riskLevel of ["LOW", "MODERATE", "HIGH", "CRITICAL"] as RiskLevel[]) {
      if (RISK_PRIORITY[riskLevel] >= incomingPriority) {
        break;
      }
      const bucket = this.buffers.get(riskLevel)!;
      if (bucket.length > 0) {
        this.size -= 1;
        return bucket.shift();
      }
    }
    return undefined;
  }
}
