import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast.js";
import { gateArb, signalEventArb } from "./test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting, Property 13: Forecast output
 * covers the full horizon in bounded steps (Req 3.2).
 *
 * For any Gate and any Signal_Event set, the returned scores array
 * SHALL cover offsetMinutes from 0 to 15 with no gap between
 * consecutive (sorted) offsets larger than 5 minutes. forecast.ts's
 * actual FORECAST_OFFSETS_MINUTES constant is [0, 5, 10, 15], so the
 * first sorted offset must be 0, the last must be 15, and every
 * consecutive gap must be <= 5.
 */
describe("Feature: stadium-congestion-forecasting, Property 13: Forecast output covers the full horizon in bounded steps", () => {
  it("covers offsets 0..15 with no consecutive gap larger than 5 minutes", () => {
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
        const offsets = result.scores
          .map((point) => point.offsetMinutes)
          .sort((a, b) => a - b);

        expect(offsets.length).toBeGreaterThan(0);
        expect(offsets[0]).toBe(0);
        expect(offsets[offsets.length - 1]).toBeGreaterThanOrEqual(15);

        for (let i = 1; i < offsets.length; i++) {
          expect(offsets[i]! - offsets[i - 1]!).toBeLessThanOrEqual(5);
        }
      }),
      { numRuns: 100 }
    );
  });
});
