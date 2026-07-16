import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast.js";
import { gateArb, signalEventArb } from "./test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting, Property 11: Congestion_Score
 * computation is deterministic (Req 4.4).
 *
 * For any Gate, any fixed set of Signal_Events, and any fixed forecast
 * time (now), repeated computation SHALL produce the same result every
 * time.
 */
describe("Feature: stadium-congestion-forecasting, Property 11: Congestion_Score computation is deterministic", () => {
  it("produces deep-equal results when called twice with identical inputs", () => {
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
        // Deep-clone inputs to also confirm the function doesn't rely on
        // object identity/mutation between calls.
        const gateClone = JSON.parse(JSON.stringify(gate));
        const eventsClone = JSON.parse(JSON.stringify(events));
        const nowClone = new Date(now.getTime());

        const resultA = computeForecast(gate, events, now);
        const resultB = computeForecast(gateClone, eventsClone, nowClone);

        expect(resultB).toEqual(resultA);
      }),
      { numRuns: 100 }
    );
  });
});
