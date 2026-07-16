import fc from "fast-check";
import { describe, it } from "vitest";
import { deriveRiskLevel } from "./risk-level.js";

/**
 * Feature: stadium-congestion-forecasting, Property 10: Risk_Level is
 * consistent with fixed score ranges (Req 3.4 / 4.3).
 *
 * For any computed Congestion_Score (integer 0-100), deriveRiskLevel
 * SHALL equal Low for scores 0-39, Moderate for 40-69, High for 70-89,
 * and Critical for 90-100.
 */
describe("Feature: stadium-congestion-forecasting, Property 10: Risk_Level is consistent with fixed score ranges", () => {
  it("maps every score in 0-100 to the correct fixed Risk_Level range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (score) => {
        const riskLevel = deriveRiskLevel(score);

        if (score >= 0 && score <= 39) {
          return riskLevel === "LOW";
        }
        if (score >= 40 && score <= 69) {
          return riskLevel === "MODERATE";
        }
        if (score >= 70 && score <= 89) {
          return riskLevel === "HIGH";
        }
        // 90-100
        return riskLevel === "CRITICAL";
      }),
      { numRuns: 100 }
    );
  });
});
