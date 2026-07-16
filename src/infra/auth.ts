import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// Augment Express's Request type so req.actorRole / req.apiKey are
// recognized by TypeScript wherever this module is imported.
declare global {
  namespace Express {
    interface Request {
      actorRole?: string;
      apiKey?: string;
    }
  }
}

/**
 * Roles recognized by the system. INGESTION_SOURCE covers automated
 * devices (Gate_Counter/Ticket_Scanner/Transit_Feed) posting signals;
 * the remaining roles cover human operators/dispatchers/auditors.
 */
export type Role =
  | "INGESTION_SOURCE"
  | "VENUE_OPS_MANAGER"
  | "GATE_STAFF"
  | "TRANSIT_DISPATCHER"
  | "AUDITOR";

const VALID_ROLES: ReadonlySet<Role> = new Set([
  "INGESTION_SOURCE",
  "VENUE_OPS_MANAGER",
  "GATE_STAFF",
  "TRANSIT_DISPATCHER",
  "AUDITOR",
]);

function isRole(value: string): value is Role {
  return VALID_ROLES.has(value as Role);
}

/**
 * Parses the `API_KEYS` env var, formatted as comma-separated
 * `key:role` (or `key:role1+role2` for multiple roles) pairs, e.g.
 * `API_KEYS="abc123:VENUE_OPS_MANAGER,def456:INGESTION_SOURCE"`.
 * Unknown/malformed entries are skipped with a stderr warning rather
 * than crashing the process.
 */
function parseApiKeys(raw: string | undefined): Map<string, Role[]> {
  const keyMap = new Map<string, Role[]>();

  if (!raw || raw.trim().length === 0) {
    console.error("[auth] WARNING: API_KEYS not configured - all requests will be rejected");
    return keyMap;
  }

  for (const pair of raw.split(",")) {
    const trimmedPair = pair.trim();
    if (trimmedPair.length === 0) continue;

    const separatorIndex = trimmedPair.indexOf(":");
    if (separatorIndex === -1) {
      console.error(`[auth] WARNING: ignoring malformed API_KEYS entry (missing ':'): "${trimmedPair}"`);
      continue;
    }

    const key = trimmedPair.slice(0, separatorIndex).trim();
    const rolesRaw = trimmedPair.slice(separatorIndex + 1).trim();

    if (key.length === 0 || rolesRaw.length === 0) {
      console.error("[auth] WARNING: ignoring malformed API_KEYS entry (empty key or role)");
      continue;
    }

    const roles: Role[] = [];
    for (const roleCandidate of rolesRaw.split("+")) {
      const trimmedRole = roleCandidate.trim();
      if (isRole(trimmedRole)) {
        roles.push(trimmedRole);
      } else {
        console.error(`[auth] WARNING: ignoring unknown role "${trimmedRole}" in API_KEYS`);
      }
    }

    if (roles.length > 0) {
      keyMap.set(key, roles);
    }
  }

  if (keyMap.size === 0) {
    console.error("[auth] WARNING: API_KEYS not configured - all requests will be rejected");
  }

  return keyMap;
}

// Parsed once at startup (module load time). Fail closed: if this is
// empty, verifyApiKey will never find a match and every request will
// be rejected with 401, which is the safe default.
const apiKeys: Map<string, Role[]> = parseApiKeys(process.env.API_KEYS);

const MAX_KEY_LENGTH = 256;

/** Pads/truncates a string into a fixed-length buffer for constant-time comparison. */
function toFixedBuffer(value: string): Buffer {
  const buf = Buffer.alloc(MAX_KEY_LENGTH);
  const src = Buffer.from(value, "utf8");
  src.copy(buf, 0, 0, Math.min(src.length, MAX_KEY_LENGTH));
  return buf;
}

/**
 * Constant-time string comparison (fixed-length buffers so the
 * candidate's true length/content cannot be inferred from timing).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = toFixedBuffer(a);
  const bBuf = toFixedBuffer(b);
  const bufsEqual = crypto.timingSafeEqual(aBuf, bBuf);
  return bufsEqual && a.length === b.length && a.length <= MAX_KEY_LENGTH && b.length <= MAX_KEY_LENGTH;
}

/**
 * Verifies a raw API key value (already extracted from the
 * Authorization/X-API-Key header) against the configured key map
 * using constant-time comparison. Returns the roles associated with
 * the key, or null if the key is missing/unrecognized.
 */
export function verifyApiKey(rawHeaderValue: string | undefined): Role[] | null {
  if (!rawHeaderValue || rawHeaderValue.length === 0) {
    return null;
  }

  let matchedRoles: Role[] | null = null;
  for (const [configuredKey, roles] of apiKeys) {
    if (constantTimeEquals(rawHeaderValue, configuredKey)) {
      matchedRoles = roles;
    }
  }

  return matchedRoles;
}

/** Extracts the raw API key from `Authorization: Bearer <key>` or `X-API-Key: <key>`. */
function extractApiKey(req: Request): string | undefined {
  const authHeader = req.header("Authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match) {
      return match[1];
    }
  }

  const apiKeyHeader = req.header("X-API-Key");
  if (apiKeyHeader && apiKeyHeader.trim().length > 0) {
    return apiKeyHeader.trim();
  }

  return undefined;
}

/**
 * Express middleware factory: rejects requests that don't present a
 * recognized API key (401) or whose key's roles don't intersect
 * `allowedRoles` (403). On success, attaches `req.actorRole` (the
 * matched allowed role) and `req.apiKey` (the raw key, never logged).
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawKey = extractApiKey(req);
    const roles = verifyApiKey(rawKey);

    if (!roles) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const matchedRole = roles.find((role) => allowedRoles.includes(role));
    if (!matchedRole) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    req.actorRole = matchedRole;
    req.apiKey = rawKey;
    next();
  };
}
