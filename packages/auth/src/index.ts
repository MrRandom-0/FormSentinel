import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const scrypt = promisify(nodeScrypt);

export const roles = ["owner", "administrator", "developer", "analyst", "viewer"] as const;
export type WorkspaceRole = (typeof roles)[number];
export const permissions = [
  "workspace:read",
  "workspace:update",
  "members:read",
  "members:manage",
  "forms:read",
  "forms:create",
  "forms:update",
  "forms:delete",
  "submissions:read",
  "submissions:update",
  "submissions:export",
  "integrations:manage",
  "api_keys:manage",
  "billing:manage",
  "audit:read",
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<WorkspaceRole, ReadonlySet<Permission>> = {
  owner: new Set(permissions),
  administrator: new Set(permissions.filter((permission) => permission !== "billing:manage")),
  developer: new Set([
    "workspace:read",
    "members:read",
    "forms:read",
    "forms:create",
    "forms:update",
    "forms:delete",
    "submissions:read",
    "submissions:update",
    "integrations:manage",
    "api_keys:manage",
  ]),
  analyst: new Set([
    "workspace:read",
    "members:read",
    "forms:read",
    "submissions:read",
    "submissions:export",
    "audit:read",
  ]),
  viewer: new Set(["workspace:read", "members:read", "forms:read", "submissions:read"]),
};

export function hasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function requirePermission(role: WorkspaceRole | null, permission: Permission): void {
  if (!role || !hasPermission(role, permission)) {
    throw new AuthorizationError(`Permission denied: ${permission}`);
  }
}

export class AuthorizationError extends Error {
  constructor(message = "Permission denied") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
});

export const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(80),
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = stored.split(":");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(
    password,
    Buffer.from(saltValue, "base64url"),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  email: string;
  expiresAt: string;
}

export interface AuthAdapter {
  register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<{ userId: string; verificationToken: string }>;
  verifyEmail(token: string): Promise<{ userId: string; email: string } | null>;
  authenticate(email: string, password: string): Promise<{ userId: string; email: string } | null>;
  createMagicLink(email: string): Promise<{ token: string } | null>;
  consumeMagicLink(token: string): Promise<{ userId: string; email: string } | null>;
  createPasswordReset(email: string): Promise<{ token: string } | null>;
  resetPassword(token: string, password: string): Promise<boolean>;
  createSession(
    userId: string,
    device: { label: string; ipHash: string },
  ): Promise<{ token: string; expiresAt: string }>;
  resolveSession(token: string): Promise<SessionIdentity | null>;
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number>;
  listSessions(userId: string): Promise<readonly DeviceSession[]>;
}

export interface DeviceSession {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current?: boolean;
}

export const sessionCookie = {
  name: "formsentinel_session",
  maxAgeSeconds: 60 * 60 * 24 * 30,
  options(production: boolean) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: production,
      path: "/",
      maxAge: this.maxAgeSeconds,
    };
  },
};
