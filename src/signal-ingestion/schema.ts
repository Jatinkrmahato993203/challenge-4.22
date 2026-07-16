import { z } from "zod";

/**
 * Signal_Event schema (design.md Data Models / Component API surface).
 * Defines the wire payload shape (SignalEventPayload) which is what
 * parseSignalEvent/serializeSignalEvent operate on.
 */

export const SignalSourceSchema = z.enum([
  "GATE_COUNTER",
  "TICKET_SCANNER",
  "TRANSIT_FEED",
]);

export const GateCounterPayloadSchema = z
  .object({
    count: z.number().nonnegative(),
    intervalSeconds: z.number().positive(),
  })
  .strict();

export const TicketScanPayloadSchema = z
  .object({
    fanId: z.string().min(1),
  })
  .strict();

export const TransitArrivalPayloadSchema = z
  .object({
    estimatedPassengerCount: z.number().nonnegative(),
    destinationGateId: z.string().min(1).optional(),
    destinationRouteId: z.string().min(1).optional(),
    fanIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const SignalEventPayloadBodySchema = z.union([
  GateCounterPayloadSchema,
  TicketScanPayloadSchema,
  TransitArrivalPayloadSchema,
]);

/**
 * Base fields shared by every Signal_Event variant, common to all three
 * discriminated-union members below.
 */
const baseSignalEventFields = {
  signalId: z.string().min(1),
  gateId: z.string().min(1).optional(),
  routeId: z.string().min(1).optional(),
  timestamp: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }),
  isStale: z.boolean(),
  lateArrivalFlag: z.boolean(),
};

const GateCounterEventSchema = z
  .object({
    ...baseSignalEventFields,
    source: z.literal("GATE_COUNTER"),
    payload: GateCounterPayloadSchema,
  })
  .strict();

const TicketScannerEventSchema = z
  .object({
    ...baseSignalEventFields,
    source: z.literal("TICKET_SCANNER"),
    payload: TicketScanPayloadSchema,
  })
  .strict();

const TransitFeedEventSchema = z
  .object({
    ...baseSignalEventFields,
    source: z.literal("TRANSIT_FEED"),
    payload: TransitArrivalPayloadSchema,
  })
  .strict();

/**
 * The wire-format payload as received/sent over HTTP/Kafka.
 * This is the schema `parseSignalEvent` validates against and
 * `serializeSignalEvent` produces.
 *
 * Modeled as a discriminated union on `source` (rather than a plain
 * `z.union` over the payload sub-schema) so that field-level validation
 * errors surface the actual offending field within the matched variant
 * instead of a generic "no union member matched" failure.
 */
export const SignalEventPayloadSchema = z.discriminatedUnion("source", [
  GateCounterEventSchema,
  TicketScannerEventSchema,
  TransitFeedEventSchema,
]);

export type SignalEventPayload = z.infer<typeof SignalEventPayloadSchema>;
export type GateCounterPayload = z.infer<typeof GateCounterPayloadSchema>;
export type TicketScanPayload = z.infer<typeof TicketScanPayloadSchema>;
export type TransitArrivalPayload = z.infer<typeof TransitArrivalPayloadSchema>;
