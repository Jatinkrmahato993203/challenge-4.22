import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast.js";
import { gateArb } from "./test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting, Property 12: Empty input
 * yields a defined default, not an error (Req 4.5).
 *
 * For any Gate, computeForecast(gate, [], now) SHALL return a result
 * whose scores all have score=0 and riskLevel="LOW", and
 * lowConfidence=true, without throwing.
 */
describe("Feature: stadium-congestion-forecasting, Property 12: Empty input yields a defined default, not an error", () => {
  it("returns score=0, riskLevel=LOW, lowConfidence=true for every Gate without throwing", () => {
    fc.assert(
      fc.property(
        gateArb,
        fc.date({
          min: new Date("2000-01-01T00:00:00.000Z"),
          max: new Date("2100-01-01T00:00:00.000Z"),
          noInvalidDate: true,
        }),
        (gate, now) => {
          let result;
          expect(() => {
            result = computeForecast(gate, [], now);
          }).not.toThrow();

          expect(result!.lowConfidence).toBe(true);
          expect(result!.scores.length).toBeGreaterThan(0);
          for (const point of result!.scores) {
            expect(point.score).toBe(0);
            expect(point.riskLevel).toBe("LOW");
            expect(point.lowConfidence).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
