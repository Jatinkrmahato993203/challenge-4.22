import type { RiskLevel } from "../types/models.js";

/**
 * Derives a Gate's Risk_Level from its Congestion_Score using the fixed,
 * non-overlapping score ranges defined in Req 3.4 / 4.3:
 *   Low (0-39), Moderate (40-69), High (70-89), Critical (90-100).
 */
export function deriveRiskLevel(score: number): RiskLevel {
  if (score < 0 || score > 100) {
    throw new RangeError(`Congestion_Score out of bounds: ${score}`);
  }
  if (score <= 39) {
    return "LOW";
  }
  if (score <= 69) {
    return "MODERATE";
  }
  if (score <= 89) {
    return "HIGH";
  }
  return "CRITICAL";
}
