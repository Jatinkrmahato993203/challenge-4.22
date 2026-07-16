import fc from "fast-check";
import type { SignalEventPayload } from "./schema.js";

/**
 * Shared fast-check arbitraries for the signal-ingestion parser property
 * tests. Kept in a non-`.test.ts` module so importing it does not cause
 * another file's `describe`/`it` blocks to be re-executed as a side effect.
 */

const isoDateArb = () =>
  fc
    .date({ min: new Date(0), max: new Date(2100, 0, 1) })
    .map((d) => d.toISOString());

const nonEmptyStringArb = (maxLength = 20) =>
  fc.string({ minLength: 1, maxLength });

const gateCounterPayloadArb = (): fc.Arbitrary<SignalEventPayload> =>
  fc.record({
    signalId: nonEmptyStringArb(),
    gateId: nonEmptyStringArb(),
    timestamp: isoDateArb(),
    receivedAt: isoDateArb(),
    isStale: fc.boolean(),
    lateArrivalFlag: fc.boolean(),
    source: fc.constant("GATE_COUNTER" as const),
    payload: fc.record({
      count: fc.integer({ min: 0, max: 100_000 }),
      intervalSeconds: fc.integer({ min: 1, max: 100_000 }),
    }),
  }) as fc.Arbitrary<SignalEventPayload>;

const ticketScannerPayloadArb = (): fc.Arbitrary<SignalEventPayload> =>
  fc.record({
    signalId: nonEmptyStringArb(),
    gateId: nonEmptyStringArb(),
    timestamp: isoDateArb(),
    receivedAt: isoDateArb(),
    isStale: fc.boolean(),
    lateArrivalFlag: fc.boolean(),
    source: fc.constant("TICKET_SCANNER" as const),
    payload: fc.record({
      fanId: nonEmptyStringArb(),
    }),
  }) as fc.Arbitrary<SignalEventPayload>;

const transitFeedPayloadArb = (): fc.Arbitrary<SignalEventPayload> =>
  fc.record({
    signalId: nonEmptyStringArb(),
    routeId: nonEmptyStringArb(),
    timestamp: isoDateArb(),
    receivedAt: isoDateArb(),
    isStale: fc.boolean(),
    lateArrivalFlag: fc.boolean(),
    source: fc.constant("TRANSIT_FEED" as const),
    payload: fc.record({
      estimatedPassengerCount: fc.integer({ min: 0, max: 100_000 }),
      destinationGateId: fc.option(nonEmptyStringArb(), { nil: undefined }),
      destinationRouteId: fc.option(nonEmptyStringArb(), { nil: undefined }),
      fanIds: fc.option(fc.array(nonEmptyStringArb(), { maxLength: 5 }), {
        nil: undefined,
      }),
    }),
  }) as fc.Arbitrary<SignalEventPayload>;

export const validSignalEventPayloadArb = (): fc.Arbitrary<SignalEventPayload> =>
  fc.oneof(
    gateCounterPayloadArb(),
    ticketScannerPayloadArb(),
    transitFeedPayloadArb()
  );
