import type { CongestionScorePoint, Gate, GateId, SignalEvent } from "../types/models.js";
import { computeForecast, type ForecastResult } from "./forecast.js";
import type { RedisClientWrapper } from "../infra/redis-client.js";

/**
 * Wraps a single per-Gate forecast computation with the Req 12.3
 * 30-second computation-deadline fallback: on timeout, publishes the
 * last-known score read from Redis with `outdated: true` instead of
 * skipping the update or blocking indefinitely.
 */
export async function computeForecastWithFallback(
  gate: Gate,
  window: SignalEvent[],
  now: Date,
  redis: RedisClientWrapper,
  computationTimeoutMs = 30_000
): Promise<ForecastResult> {
  const timeoutPromise = new Promise<"TIMEOUT">((resolve) =>
    setTimeout(() => resolve("TIMEOUT"), computationTimeoutMs)
  );

  const computePromise: Promise<ForecastResult> = Promise.resolve().then(() =>
    computeForecast(gate, window, now)
  );

  const outcome = await Promise.race([computePromise, timeoutPromise]);

  if (outcome === "TIMEOUT") {
    const lastKnown = await redis.getLastKnownScore(gate.gateId);
    if (lastKnown) {
      const outdatedPoint: CongestionScorePoint = { ...lastKnown, outdated: true };
      return { scores: [outdatedPoint], lowConfidence: outdatedPoint.lowConfidence };
    }
    // No prior score exists at all; fall back to the Req 4.5 default
    // rather than displaying nothing.
    const defaultResult = computeForecast(gate, [], now);
    return {
      scores: defaultResult.scores.map((point) => ({ ...point, outdated: true })),
      lowConfidence: true,
    };
  }

  const result = outcome as ForecastResult;
  const currentPoint = result.scores[0];
  if (currentPoint) {
    await redis.setLastKnownScore(gate.gateId, currentPoint);
  }
  return result;
}

export type { GateId };
