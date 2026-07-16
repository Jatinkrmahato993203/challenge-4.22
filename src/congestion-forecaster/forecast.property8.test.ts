import fc from "fast-check";
import { describe, it } from "vitest";
import { computeForecast } from "./forecast.js";
import { gateArb, signalEventArb } from "./test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting, Property 8: Congestion_Score
 * is always bounded (Req 3.4 range invariant: score in [0, 100]).
 *
 * For any Gate and any set of Signal_Events (including empty), every
 * score in computeForecast's returned scores array SHALL be between
 * 0 and 100 inclusive.
 */
describe("Feature: stadium-congestion-forecasting, Property 8: Congestion_Score is always bounded", () => {
  it("keeps every returned score within [0, 100] for any Gate and Signal_Event set", () => {
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
          .array(signalEventArb(now.getTime()), { maxLength: 15 })
          .map((events) => ({ gate, now, events }))
      );

    fc.assert(
      fc.property(caseArb, ({ gate, now, events }) => {
        const result = computeForecast(gate, events, now);
        return result.scores.every(
          (point) => point.score >= 0 && point.score <= 100
        );
      }),
      { numRuns: 100 }
    );
  });

  it("keeps every returned score within [0, 100] for an empty Signal_Event set", () => {
    fc.assert(
      fc.property(
        gateArb,
        fc.date({
          min: new Date("2000-01-01T00:00:00.000Z"),
          max: new Date("2100-01-01T00:00:00.000Z"),
          noInvalidDate: true,
        }),
        (gate, now) => {
          const result = computeForecast(gate, [], now);
          return result.scores.every(
            (point) => point.score >= 0 && point.score <= 100
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
