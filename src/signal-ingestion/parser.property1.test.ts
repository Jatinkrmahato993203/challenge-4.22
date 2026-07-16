import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseSignalEvent } from "./parser.js";
import { validSignalEventPayloadArb } from "./parser.test-arbitraries.js";

/**
 * Feature: stadium-congestion-forecasting
 * Property 1: Ingestion preserves source, target, timestamp, and payload
 *
 * For any valid Signal_Event payload from a Gate_Counter, Ticket_Scanner,
 * or Transit_Feed, parsing the payload SHALL produce a structured
 * Signal_Event whose source, Gate_Id/Route_Id, timestamp, and payload
 * match the input.
 */

describe("Feature: stadium-congestion-forecasting, Property 1: Ingestion preserves source, target, timestamp, and payload", () => {
  it("parses valid Gate_Counter/Ticket_Scanner/Transit_Feed payloads preserving source, gateId/routeId, timestamp, and payload", () => {
    fc.assert(
      fc.property(validSignalEventPayloadArb(), (input) => {
        const result = parseSignalEvent(input);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.source).toEqual(input.source);
          expect(result.value.gateId).toEqual((input as { gateId?: string }).gateId);
          expect(result.value.routeId).toEqual((input as { routeId?: string }).routeId);
          expect(result.value.timestamp).toEqual(input.timestamp);
          expect(result.value.payload).toEqual(input.payload);
        }
      }),
      { numRuns: 100 }
    );
  });
});
