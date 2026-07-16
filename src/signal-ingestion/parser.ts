import { ZodError } from "zod";
import { SignalEventPayloadSchema, type SignalEventPayload } from "./schema.js";
import type { SignalEvent, SignalSource } from "../types/models.js";

/**
 * Result type used by parseSignalEvent so that expected validation
 * failures are returned rather than thrown (design.md Error Handling table).
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface ValidationError {
  source: SignalSource | "UNKNOWN";
  reason: string;
  offendingField?: string;
  rawPayload: unknown;
}

/**
 * Attempts to extract a `source` value from an arbitrary/unknown payload
 * so ValidationErrors can still report a source even when the payload
 * as a whole failed validation (Req 1.3 / 2.5).
 */
function extractSource(payload: unknown): SignalSource | "UNKNOWN" {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "source" in payload
  ) {
    const candidate = (payload as { source: unknown }).source;
    if (
      candidate === "GATE_COUNTER" ||
      candidate === "TICKET_SCANNER" ||
      candidate === "TRANSIT_FEED"
    ) {
      return candidate;
    }
  }
  return "UNKNOWN";
}

function formatOffendingField(issue: ZodError["issues"][number]): string | undefined {
  if (issue.path.length === 0) {
    return undefined;
  }
  return issue.path.join(".");
}

/**
 * Parses an incoming, untrusted Signal_Event payload against the
 * Signal_Event schema (Req 2.1). Never throws: returns a typed
 * Result so the service layer can respond 400 with a diagnosable
 * ValidationError (Req 1.3, 2.5) rather than crashing.
 */
export function parseSignalEvent(
  payload: unknown
): Result<SignalEvent, ValidationError> {
  const parsed = SignalEventPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        source: extractSource(payload),
        reason: firstIssue
          ? `${firstIssue.path.join(".") || "(root)"}: ${firstIssue.message}`
          : "Signal_Event payload failed schema validation",
        offendingField: firstIssue ? formatOffendingField(firstIssue) : undefined,
        rawPayload: payload,
      },
    };
  }

  const value = parsed.data;
  return {
    ok: true,
    value: {
      signalId: value.signalId,
      source: value.source,
      gateId: value.gateId,
      routeId: value.routeId,
      timestamp: value.timestamp,
      receivedAt: value.receivedAt,
      payload: value.payload,
      isStale: value.isStale,
      lateArrivalFlag: value.lateArrivalFlag,
    },
  };
}

/**
 * Serializes a structured Signal_Event object back into a wire payload
 * conforming to the Signal_Event schema (Req 2.2). Since the structured
 * object and the wire schema share the same field set (per design.md's
 * Data Models section), this is a direct, lossless field mapping which
 * is what makes the round-trip properties (Req 2.3, 2.4) hold.
 */
export function serializeSignalEvent(event: SignalEvent): SignalEventPayload {
  // `SignalEvent.source`/`payload` are typed as the general SignalSource /
  // SignalEventPayloadBody unions (models.ts), so TS can't narrow this
  // object literal to the matching SignalEventPayloadSchema discriminated
  // union member on its own. The invariant that `payload`'s shape always
  // matches `source` is guaranteed by construction (via parseSignalEvent
  // or callers building a valid SignalEvent), so the cast is safe.
  return {
    signalId: event.signalId,
    source: event.source,
    gateId: event.gateId,
    routeId: event.routeId,
    timestamp: event.timestamp,
    receivedAt: event.receivedAt,
    payload: event.payload,
    isStale: event.isStale,
    lateArrivalFlag: event.lateArrivalFlag,
  } as SignalEventPayload;
}
