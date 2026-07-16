import type { FanNudge, Gate, GateId } from "../types/models.js";
import { generateFanNudge, COOLDOWN_PERIOD_MS, type FanContext } from "./nudges.js";
import type { ForecastResult } from "../congestion-forecaster/forecast.js";
import type { RedisClientWrapper } from "../infra/redis-client.js";

export interface QueuedNudgeStore {
  enqueue(nudge: FanNudge): Promise<void>;
}

/**
 * Fan_Notification_System service wrapper (design.md
 * Fan_Notification_System section): consumes `congestion-scores`
 * updates, calls `generateFanNudge` per affected fan, and checks/sets
 * the Redis cooldown key AT GENERATION TIME (not delivery time), per
 * the design's note that this is required for correct cancellation
 * semantics (Req 8.1, 8.4, 9.1).
 */
export class FanNotificationService {
  constructor(
    private readonly redis: RedisClientWrapper,
    private readonly queuedNudgeStore: QueuedNudgeStore
  ) {}

  async onScoreUpdate(
    fans: FanContext[],
    originGate: Gate,
    forecastsByGate: Map<GateId, ForecastResult>,
    now: Date = new Date()
  ): Promise<FanNudge[]> {
    const generated: FanNudge[] = [];

    for (const fan of fans) {
      const lastNudgeAt = await this.redis.getLastNudgeAt(fan.fanId, originGate.gateId);
      const nudge = generateFanNudge(fan, originGate, forecastsByGate, lastNudgeAt, now);

      if (!nudge) {
        continue;
      }

      // Set the cooldown clock at generation time so that a later
      // cancellation (Req 8.5) does not incorrectly reset it.
      await this.redis.setLastNudgeAt(fan.fanId, originGate.gateId, now, COOLDOWN_PERIOD_MS);
      await this.queuedNudgeStore.enqueue(nudge);
      generated.push(nudge);
    }

    return generated;
  }
}
