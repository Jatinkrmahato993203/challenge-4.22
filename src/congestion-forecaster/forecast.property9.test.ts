import fc from "fast-check";
import { describe, it } from "vitest";
import { computeForecast } from "./forecast.js";
import { positiveCapacityGateArb, recentNonStaleGateCounterArb } from "./test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting, Property 9: Congestion_Score
 * is monotonic in incoming count (Req 4.2).
 *
 * For any Gate and any two Signal_Event sets for that gate that differ
 * only in total incoming count (all other factors -- gate, timestamps
 * being non-stale/recent, now -- held equal), the set with the greater
 * or equal total incoming count SHALL receive a Congestion_Score >= the
 * other's, at every corresponding offset.
 *
 * Construction: a fixed base window of recent, non-stale GATE_COUNTER
 * events, and a second window built by adding non-negative "delta"
 * counts to it (same gate, same event count/shape, only the `count`
 * payload field increases per event). This guarantees the total
 * incoming count for windowB >= windowA while holding every other
 * factor (gate identity, capacityThreshold, event timestamps/isStale,
 * `now`) exactly equal.
 */
describe("Feature: stadium-congestion-forecasting, Property 9: Congestion_Score is monotonic in incoming count", () => {
  it("scores computed from a >= total incoming count are never lower at any offset", () => {
    const now = new Date("2024-06-01T12:00:00.000Z");

    const caseArb = fc
      .record({
        gate: positiveCapacityGateArb,
        baseCounts: fc.array(fc.integer({ min: 0, max: 300 }), {
          minLength: 0,
          maxLength: 10,
        }),
        deltas: fc.array(fc.integer({ min: 0, max: 300 }), {
          minLength: 0,
          maxLength: 10,
        }),
        timestampOffsets: fc.array(
          fc.integer({ min: -10 * 60 * 1000, max: 0 }),
          { minLength: 0, maxLength: 10 }
        ),
      })
      .map(({ gate, baseCounts, deltas, timestampOffsets }) => {
        // Align all three arrays to the same (shortest) length so each
        // index represents one event present in BOTH windows, differing
        // only by its count/delta.
        const length = Math.min(
          baseCounts.length,
          deltas.length,
          timestampOffsets.length
        );

        const windowA = Array.from({ length }, (_, i) => ({
          signalId: `evt-${i}`,
          source: "GATE_COUNTER" as const,
          gateId: gate.gateId,
          timestamp: new Date(now.getTime() + timestampOffsets[i]!).toISOString(),
          receivedAt: new Date(
            now.getTime() + timestampOffsets[i]!
          ).toISOString(),
          payload: { count: baseCounts[i]!, intervalSeconds: 10 },
          isStale: false,
          lateArrivalFlag: false,
        }));

        const windowB = Array.from({ length }, (_, i) => ({
          signalId: `evt-${i}`,
          source: "GATE_COUNTER" as const,
          gateId: gate.gateId,
          timestamp: new Date(now.getTime() + timestampOffsets[i]!).toISOString(),
          receivedAt: new Date(
            now.getTime() + timestampOffsets[i]!
          ).toISOString(),
          payload: { count: baseCounts[i]! + deltas[i]!, intervalSeconds: 10 },
          isStale: false,
          lateArrivalFlag: false,
        }));

        return { gate, windowA, windowB };
      });

    fc.assert(
      fc.property(caseArb, ({ gate, windowA, windowB }) => {
        const resultA = computeForecast(gate, windowA, now);
        const resultB = computeForecast(gate, windowB, now);

        return resultA.scores.every((pointA, i) => {
          const pointB = resultB.scores[i]!;
          return (
            pointA.offsetMinutes === pointB.offsetMinutes &&
            pointA.score <= pointB.score
          );
        });
      }),
      { numRuns: 100 }
    );
  });

  it("also holds when comparing arbitrary recent Gate_Counter windows for the same gate by total count", () => {
    const now = new Date("2024-06-01T12:00:00.000Z");

    fc.assert(
      fc.property(
        positiveCapacityGateArb,
        fc.array(recentNonStaleGateCounterArb(now.getTime()), {
          maxLength: 10,
        }),
        fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 10 }),
        (gate, baseWindowTemplate, extraCounts) => {
          const windowA = baseWindowTemplate.map((e, i) => ({
            ...e,
            gateId: gate.gateId,
            signalId: `a-${i}`,
          }));
          // windowB = windowA plus extra positive-count events appended,
          // so its total incoming count is >= windowA's, gate/now fixed.
          const windowB = [
            ...windowA,
            ...extraCounts.map((count, i) => ({
              signalId: `extra-${i}`,
              source: "GATE_COUNTER" as const,
              gateId: gate.gateId,
              timestamp: now.toISOString(),
              receivedAt: now.toISOString(),
              payload: { count, intervalSeconds: 10 },
              isStale: false,
              lateArrivalFlag: false,
            })),
          ];

          const resultA = computeForecast(gate, windowA, now);
          const resultB = computeForecast(gate, windowB, now);

          return resultA.scores.every((pointA, i) => {
            const pointB = resultB.scores[i]!;
            return pointA.score <= pointB.score;
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
