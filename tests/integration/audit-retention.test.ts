import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Integration test (design.md Testing Strategy): asserts the 90-day
 * retention policy is correctly configured on every audit hypertable
 * (Req 13.4).
 *
 * This validates the retention migration's SQL statements statically
 * (every hypertable created in 001_init_timescale_schema.sql has a
 * corresponding add_retention_policy('<table>', INTERVAL '90 days', ...)
 * call in 002_retention_policies.sql). Running `add_retention_policy`
 * against a live TimescaleDB instance and inspecting
 * `timescaledb_information.jobs` for the scheduled policy is the full
 * verification step; that requires the docker-composed Postgres/
 * TimescaleDB stack (see docker-compose.yml), which is not available
 * in this execution environment.
 */
describe("Integration: audit retention policy configuration (Req 13.4)", () => {
  it("configures a 90-day retention policy for every hypertable", () => {
    const migrationsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../src/infra/db/migrations"
    );

    const initSchema = readFileSync(
      path.join(migrationsDir, "001_init_timescale_schema.sql"),
      "utf-8"
    );
    const retentionPolicies = readFileSync(
      path.join(migrationsDir, "002_retention_policies.sql"),
      "utf-8"
    );

    const hypertableNames = Array.from(
      initSchema.matchAll(/create_hypertable\('(\w+)'/g)
    ).map((match) => match[1]);

    expect(hypertableNames.length).toBeGreaterThan(0);

    for (const tableName of hypertableNames) {
      const pattern = new RegExp(
        `add_retention_policy\\('${tableName}',\\s*INTERVAL '90 days'`
      );
      expect(retentionPolicies).toMatch(pattern);
    }
  });
});
