import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseSignalEvent, serializeSignalEvent } from "./parser.js";
import type { SignalEvent } from "../types/models.js";

/**
 * Feature: stadium-congestion-forecasting
 * Property 7: Serialize-then-parse round trip, including Late_Arrival_Flag
 *
 * For any structured Signal_Event object (including ones with
 * Late_Arrival_Flag set to true), serializing it and then parsing the
 * result SHALL produce a Signal_Event object equivalent to the original,
 * with the Late_Arrival_Flag preserved.
 */

const isoDateArb = () =>
  fc
    .date({ min: new Date(0), max: new Date(2100, 0, 1) })
    .map((d) => d.toISOString());

const nonEmptyStringArb = (maxLength = 20) =>
  fc.string({ minLength: 1, maxLength });

const gateCounterEventArb = (): fc.Arbitrary<SignalEvent> =>
  fc.record({
    signalId: nonEmptyStringArb(),
    source: fc.constant("GATE_COUNTER" as const),
    gateId: nonEmptyStringArb(),
    routeId: fc.constant(undefined),
    timestamp: isoDateArb(),
    receivedAt: isoDateArb(),
    isStale: fc.boolean(),
    lateArrivalFlag: fc.boolean(),
    payload: fc.record({
      count: fc.integer({ min: 0, max: 100_000 }),
      intervalSeconds: fc.integer({ min: 1, max: 100_000 }),
    }),
  }) as fc.Arbitrary<SignalEvent>;

const ticketScannerEventArb = (): fc.Arbitrary<SignalEvent> =>
  fc.record({
    signalId: nonEmptyStringArb(),
    source: fc.constant("TICKET_SCANNER" as const),
    gateId: nonEmptyStringArb(),
    routeId: fc.constant(undefined),
    timestamp: isoDateArb(),
    receivedAt: isoDateArb(),
    isStale: fc.boolean(),
    lateArrivalFlag: fc.boolean(),
    payload: fc.record({
      fanId: nonEmptyStringArb(),
    }),
  }) as fc.Arbitrary<SignalEvent>;

const transitFeedEventArb = (): fc.Arbitrary<SignalEvent> =>
  fc.record({
    signalId: nonEmptyStringArb(),
    source: fc.constant("TRANSIT_FEED" as const),
    gateId: fc.constant(undefined),
    routeId: nonEmptyStringArb(),
    timestamp: isoDateArb(),
    receivedAt: isoDateArb(),
    isStale: fc.boolean(),
    lateArrivalFlag: fc.boolean(),
    payload: fc.record({
      estimatedPassengerCount: fc.integer({ min: 0, max: 100_000 }),
      destinationGateId: fc.option(nonEmptyStringArb(), { nil: undefined }),
      destinationRouteId: fc.option(nonEmptyStringArb(), { nil: undefined }),
      fanIds: fc.option(fc.array(nonEmptyStringArb(), { maxLength: 5 }), {
        nil: undefined,
      }),
    }),
  }) as fc.Arbitrary<SignalEvent>;

const validSignalEventArb = (): fc.Arbitrary<SignalEvent> =>
  fc.oneof(
    gateCounterEventArb(),
    ticketScannerEventArb(),
    transitFeedEventArb()
  );

describe("Feature: stadium-congestion-forecasting, Property 7: Serialize-then-parse round trip, including Late_Arrival_Flag", () => {
  it("produces a Signal_Event equivalent to the original after serialize -> parse, with lateArrivalFlag preserved", () => {
    fc.assert(
      fc.property(validSignalEventArb(), (originalEvent) => {
        const serialized = serializeSignalEvent(originalEvent);
        const parsed = parseSignalEvent(serialized);

        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value).toEqual(originalEvent);
          expect(parsed.value.lateArrivalFlag).toBe(originalEvent.lateArrivalFlag);
        }
      }),
      { numRuns: 100 }
    );
  });
});
