import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast.js";
import { gateArb, excludedSignalEventArb } from "./test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting, Property 14: Signal gaps
 * produce Low_Confidence without discarding history (Req 3.5).
 *
 * For any Gate whose Signal_Events are all either stale (isStale=true)
 * or timestamped more than 10 minutes before `now` (i.e. the effective
 * non-stale-recent window is empty), computeForecast SHALL flag
 * lowConfidence=true.
 */
describe("Feature: stadium-congestion-forecasting, Property 14: Signal gaps produce Low_Confidence without discarding history", () => {
  it("flags lowConfidence=true when every Signal_Event is stale or older than the 10-minute recent window", () => {
    const caseArb = fc
      .record({
        gate: gateArb,
        now: fc.date({
          min: new Date("2000-01-01T00:00:00.000Z"),
          max: new Date("2100-01-01T00:00:00.000Z"),
          noInvalidDate: true,
        }),
      })
      .chain(({ gate, now }) =>
        fc
          .array(excludedSignalEventArb(now.getTime()), { maxLength: 15 })
          .map((events) => ({ gate, now, events }))
      );

    fc.assert(
      fc.property(caseArb, ({ gate, now, events }) => {
        const result = computeForecast(gate, events, now);
        expect(result.lowConfidence).toBe(true);
        for (const point of result.scores) {
          expect(point.lowConfidence).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
