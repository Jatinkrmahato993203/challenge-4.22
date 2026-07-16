import type { Gate, ShuttleRoute } from "../types/models.js";

/**
 * Static demo Gate/Shuttle_Route topology, standing in for a real
 * venue configuration store (e.g. a TimescaleDB/Postgres table seeded
 * at deployment time). Used to give the demo server something
 * concrete to forecast/recommend/redirect against out of the box.
 */
export const DEMO_ROUTES: ShuttleRoute[] = [
  { routeId: "route-1", servedGateIds: ["gate-a", "gate-b"] },
  { routeId: "route-2", servedGateIds: ["gate-c"] },
];

export const DEMO_GATES: Gate[] = [
  { gateId: "gate-a", name: "Gate A - North", capacityThreshold: 500, assignedRouteIds: ["route-1"] },
  { gateId: "gate-b", name: "Gate B - East", capacityThreshold: 400, assignedRouteIds: ["route-1"] },
  { gateId: "gate-c", name: "Gate C - South", capacityThreshold: 600, assignedRouteIds: ["route-2"] },
];
