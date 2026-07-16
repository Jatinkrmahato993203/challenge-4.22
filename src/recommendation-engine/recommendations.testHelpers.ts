import fc from "fast-check";
import type { Gate, RiskLevel, SignalEvent } from "../types/models.js";

/** Fixed score ranges per Req 3.4/4.3, mirrored from risk-level.ts. */
export const SCORE_RANGE_FOR_RISK: Record<RiskLevel, [number, number]> = {
  LOW: [0, 39],
  MODERATE: [40, 69],
  HIGH: [70, 89],
  CRITICAL: [90, 100],
};

export const gateArb: fc.Arbitrary<Gate> = fc.record({
  gateId: fc.string({ minLength: 1, maxLength: 10 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  capacityThreshold: fc.integer({ min: 1, max: 5000 }),
  assignedRouteIds: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
});

const gateCounterEventArb: fc.Arbitrary<SignalEvent> = fc.record({
  signalId: fc.string({ minLength: 1, maxLength: 16 }),
  source: fc.constant("GATE_COUNTER" as const),
  gateId: fc.string({ minLength: 1, maxLength: 8 }),
  timestamp: fc
    .date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) })
    .map((d) => d.toISOString()),
  receivedAt: fc
    .date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) })
    .map((d) => d.toISOString()),
  isStale: fc.boolean(),
  lateArrivalFlag: fc.boolean(),
  payload: fc.record({
    count: fc.integer({ min: 0, max: 500 }),
    intervalSeconds: fc.integer({ min: 1, max: 60 }),
  }),
});

const ticketScanEventArb: fc.Arbitrary<SignalEvent> = fc.record({
  signalId: fc.string({ minLength: 1, maxLength: 16 }),
  source: fc.constant("TICKET_SCANNER" as const),
  gateId: fc.string({ minLength: 1, maxLength: 8 }),
  timestamp: fc
    .date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) })
    .map((d) => d.toISOString()),
  receivedAt: fc
    .date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) })
    .map((d) => d.toISOString()),
  isStale: fc.boolean(),
  lateArrivalFlag: fc.boolean(),
  payload: fc.record({ fanId: fc.string({ minLength: 1, maxLength: 8 }) }),
});

const transitFeedEventArb: fc.Arbitrary<SignalEvent> = fc.record({
  signalId: fc.string({ minLength: 1, maxLength: 16 }),
  source: fc.constant("TRANSIT_FEED" as const),
  routeId: fc.string({ minLength: 1, maxLength: 8 }),
  timestamp: fc
    .date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) })
    .map((d) => d.toISOString()),
  receivedAt: fc
    .date({ min: new Date(2020, 0, 1), max: new Date(2030, 0, 1) })
    .map((d) => d.toISOString()),
  isStale: fc.boolean(),
  lateArrivalFlag: fc.boolean(),
  payload: fc.record({ estimatedPassengerCount: fc.integer({ min: 0, max: 500 }) }),
});

export const signalEventArb: fc.Arbitrary<SignalEvent> = fc.oneof(
  gateCounterEventArb,
  ticketScanEventArb,
  transitFeedEventArb
);

export const signalEventWindowArb = (maxLength = 10): fc.Arbitrary<SignalEvent[]> =>
  fc.array(signalEventArb, { maxLength });

/** Picks a risk level together with an integer score consistent with it. */
export function riskLevelAndScoreArb(
  ...levels: RiskLevel[]
): fc.Arbitrary<{ riskLevel: RiskLevel; score: number }> {
  return fc.constantFrom(...levels).chain((riskLevel) => {
    const [min, max] = SCORE_RANGE_FOR_RISK[riskLevel];
    return fc.integer({ min, max }).map((score) => ({ riskLevel, score }));
  });
}
