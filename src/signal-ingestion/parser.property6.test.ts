import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseSignalEvent, serializeSignalEvent } from "./parser.js";
import { validSignalEventPayloadArb } from "./parser.test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting
 * Property 6: Parse-then-serialize round trip
 *
 * For any valid Signal_Event payload, parsing it into a structured
 * Signal_Event and then serializing that object SHALL produce a payload
 * equivalent to the original input.
 */

describe("Feature: stadium-congestion-forecasting, Property 6: Parse-then-serialize round trip", () => {
  it("produces a payload equivalent to the original input after parse -> serialize", () => {
    fc.assert(
      fc.property(validSignalEventPayloadArb(), (input) => {
        const parsed = parseSignalEvent(input);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          const serialized = serializeSignalEvent(parsed.value);
          expect(serialized).toEqual(input);
        }
      }),
      { numRuns: 100 }
    );
  });
});
