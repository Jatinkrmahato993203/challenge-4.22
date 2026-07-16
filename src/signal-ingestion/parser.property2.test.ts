import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseSignalEvent } from "./parser.js";
import { validSignalEventPayloadArb } from "./parser.test-arbitraries.js";
import type { SignalEventPayload } from "./schema.js";

/**
 * Feature: stadium-congestion-forecasting
 * Property 2: Non-conforming payloads are rejected with a diagnosable error
 *
 * For any payload that violates the schema (missing required field,
 * wrong-typed field, or extra unexpected structure), parsing SHALL fail
 * and the resulting ValidationError SHALL contain source, a reason, and
 * the raw payload.
 */

type RequiredFieldCorruption = {
  path: string[];
  mode: "delete" | "wrongType";
};

function requiredFieldPathsFor(payload: SignalEventPayload): string[][] {
  const topLevel = ["signalId", "timestamp", "receivedAt", "isStale", "lateArrivalFlag"];
  let payloadFields: string[];
  switch (payload.source) {
    case "GATE_COUNTER":
      payloadFields = ["count", "intervalSeconds"];
      break;
    case "TICKET_SCANNER":
      payloadFields = ["fanId"];
      break;
    case "TRANSIT_FEED":
      payloadFields = ["estimatedPassengerCount"];
      break;
  }
  return [
    ...topLevel.map((f) => [f]),
    ...payloadFields.map((f) => ["payload", f]),
  ];
}

function getWrongTypeReplacement(originalValue: unknown): unknown {
  if (typeof originalValue === "string") return 12345;
  if (typeof originalValue === "number") return "not-a-number";
  if (typeof originalValue === "boolean") return "not-a-boolean";
  return 42;
}

function corrupt(
  payload: SignalEventPayload,
  corruption: RequiredFieldCorruption
): unknown {
  // Deep clone via JSON to avoid mutating the original input.
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  let target: Record<string, unknown> = clone;
  for (let i = 0; i < corruption.path.length - 1; i++) {
    target = target[corruption.path[i]!] as Record<string, unknown>;
  }
  const lastKey = corruption.path[corruption.path.length - 1]!;

  if (corruption.mode === "delete") {
    delete target[lastKey];
  } else {
    target[lastKey] = getWrongTypeReplacement(target[lastKey]);
  }
  return clone;
}

const corruptedPayloadArb = (): fc.Arbitrary<{
  malformed: unknown;
  originalSource: string;
}> =>
  validSignalEventPayloadArb().chain((validPayload) => {
    const candidatePaths = requiredFieldPathsFor(validPayload);
    return fc
      .tuple(
        fc.constantFrom(...candidatePaths),
        fc.constantFrom<"delete" | "wrongType">("delete", "wrongType")
      )
      .map(([path, mode]) => ({
        malformed: corrupt(validPayload, { path, mode }),
        originalSource: validPayload.source,
      }));
  });

describe("Feature: stadium-congestion-forecasting, Property 2: Non-conforming payloads are rejected with a diagnosable error", () => {
  it("rejects payloads missing a required field or containing a wrong-typed field, with a diagnosable ValidationError", () => {
    fc.assert(
      fc.property(corruptedPayloadArb(), ({ malformed }) => {
        const result = parseSignalEvent(malformed);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.source).toBeDefined();
          expect(typeof result.error.reason).toBe("string");
          expect(result.error.reason.length).toBeGreaterThan(0);
          expect("rawPayload" in result.error).toBe(true);
          expect(result.error.rawPayload).toEqual(malformed);
        }
      }),
      { numRuns: 100 }
    );
  });
});
