import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AuthorizationError,
  createOpaqueToken,
  hashPassword,
  hashToken,
  requirePermission,
  verifyPassword,
  type AuthAdapter,
  type DeviceSession,
  type Permission,
  type SessionIdentity,
  type WorkspaceRole,
} from "@formsentinel/auth";
import { entitlementLimit, type PlanId } from "@formsentinel/config";
import { formDefinition } from "@formsentinel/form-schema";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  verifiedAt: string | null;
  deletionRequestedAt: string | null;
  createdAt: string;
}
export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  plan: PlanId;
  createdAt: string;
}
export interface MembershipRecord {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
}
export interface FormFieldRecord {
  name: string;
  type: "text" | "email" | "textarea" | "tel" | "url" | "number" | "checkbox";
  required: boolean;
}
export interface FormRecord {
  id: string;
  workspaceId: string;
  name: string;
  endpointKey: string;
  platform: string;
  template: string;
  sourceUrl: string | null;
  successRedirect: string | null;
  allowedOrigins: string[];
  honeypotField: string;
  notificationEmail: string | null;
  fields: FormFieldRecord[];
  active: boolean;
  createdAt: string;
}
export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  deviceLabel: string;
  ipHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
interface TokenRecord {
  id: string;
  userId: string;
  kind: "verify_email" | "magic_link" | "password_reset";
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
}
export interface OnboardingRecord {
  userId: string;
  workspaceId: string;
  useCase: string | null;
  currentStep: number;
  completedAt: string | null;
  updatedAt: string;
}
export interface InvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<WorkspaceRole, "owner">;
  tokenHash: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

interface LocalState {
  users: UserRecord[];
  sessions: SessionRecord[];
  tokens: TokenRecord[];
  workspaces: WorkspaceRecord[];
  memberships: MembershipRecord[];
  invitations: InvitationRecord[];
  onboarding: OnboardingRecord[];
  workspaceSelections: { userId: string; workspaceId: string }[];
  forms: FormRecord[];
}

const emptyState = (): LocalState => ({
  users: [],
  sessions: [],
  tokens: [],
  workspaces: [],
  memberships: [],
  invitations: [],
  onboarding: [],
  workspaceSelections: [],
  forms: [],
});
const now = () => new Date().toISOString();
const expires = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "workspace";

export interface WorkspaceRepository {
  createWorkspace(userId: string, name: string): Promise<WorkspaceRecord>;
  listWorkspaces(userId: string): Promise<readonly WorkspaceRecord[]>;
  selectWorkspace(userId: string, workspaceId: string): Promise<WorkspaceRecord>;
  getCurrentWorkspace(userId: string): Promise<WorkspaceRecord | null>;
  getMembership(userId: string, workspaceId: string): Promise<MembershipRecord | null>;
  requireAccess(
    userId: string,
    workspaceId: string,
    permission: Permission,
  ): Promise<MembershipRecord>;
  listMembers(userId: string, workspaceId: string): Promise<readonly MembershipRecord[]>;
  updateMemberRole(
    userId: string,
    workspaceId: string,
    memberId: string,
    role: Exclude<WorkspaceRole, "owner">,
  ): Promise<boolean>;
  inviteMember(
    userId: string,
    workspaceId: string,
    email: string,
    role: Exclude<WorkspaceRole, "owner">,
  ): Promise<{ invitation: InvitationRecord; token: string }>;
  acceptInvitation(userId: string, token: string): Promise<boolean>;
  saveOnboarding(
    userId: string,
    input: { workspaceId: string; useCase?: string; currentStep: number; completed?: boolean },
  ): Promise<OnboardingRecord>;
  getOnboarding(userId: string): Promise<OnboardingRecord | null>;
}

export interface FormRepository {
  createForm(
    userId: string,
    workspaceId: string,
    input: Omit<FormRecord, "id" | "workspaceId" | "endpointKey" | "createdAt" | "active">,
  ): Promise<FormRecord>;
  listForms(userId: string, workspaceId: string): Promise<readonly FormRecord[]>;
  getForm(userId: string, workspaceId: string, formId: string): Promise<FormRecord | null>;
  getFormByEndpoint(endpointKey: string): Promise<FormRecord | null>;
}

export interface AccountRepository {
  requestAccountDeletion(userId: string): Promise<string>;
}

export class LocalDevelopmentRepository
  implements AuthAdapter, WorkspaceRepository, FormRepository, AccountRepository
{
  private state: LocalState = emptyState();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(
    file: string,
    environment: "development" | "test" | "production" = (process.env.NODE_ENV as
      "development" | "test" | "production") || "development",
  ) {
    if (environment === "production")
      throw new Error("The local JSON repository is disabled in production.");
    this.file = resolve(file);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.state = {
        ...emptyState(),
        ...(JSON.parse(await readFile(this.file, "utf8")) as Partial<LocalState>),
      };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const lock = `${this.file}.lock`;
      const deadline = Date.now() + 5_000;
      while (true) {
        try {
          await mkdir(lock);
          break;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
          if (Date.now() >= deadline)
            throw new Error("Timed out acquiring the local repository lock.");
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        }
      }
      try {
        const state = this.state as LocalState & { phase2?: unknown };
        try {
          const latest = JSON.parse(await readFile(this.file, "utf8")) as { phase2?: unknown };
          if (latest.phase2 !== undefined) state.phase2 = latest.phase2;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        const temporary = `${this.file}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(state, null, 2), {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.file);
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
    });
    await this.writeQueue;
  }

  async register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<{ userId: string; verificationToken: string }> {
    await this.load();
    const email = normalizeEmail(input.email);
    if (this.state.users.some((user) => user.email === email))
      throw new Error("An account already exists for this email address.");
    const user: UserRecord = {
      id: crypto.randomUUID(),
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      verifiedAt: null,
      deletionRequestedAt: null,
      createdAt: now(),
    };
    const verificationToken = createOpaqueToken();
    this.state.users.push(user);
    this.state.tokens.push({
      id: crypto.randomUUID(),
      userId: user.id,
      kind: "verify_email",
      tokenHash: hashToken(verificationToken),
      expiresAt: expires(24),
      consumedAt: null,
    });
    await this.persist();
    return { userId: user.id, verificationToken };
  }

  private async consumeToken(token: string, kind: TokenRecord["kind"]): Promise<UserRecord | null> {
    await this.load();
    const record = this.state.tokens.find(
      (item) =>
        item.kind === kind &&
        item.tokenHash === hashToken(token) &&
        !item.consumedAt &&
        item.expiresAt > now(),
    );
    if (!record) return null;
    record.consumedAt = now();
    return this.state.users.find((user) => user.id === record.userId) ?? null;
  }

  async verifyEmail(token: string): Promise<{ userId: string; email: string } | null> {
    const user = await this.consumeToken(token, "verify_email");
    if (!user) return null;
    user.verifiedAt = now();
    await this.persist();
    return { userId: user.id, email: user.email };
  }

  async authenticate(
    email: string,
    password: string,
  ): Promise<{ userId: string; email: string } | null> {
    await this.load();
    const user = this.state.users.find((item) => item.email === normalizeEmail(email));
    if (
      !user?.verifiedAt ||
      !user.passwordHash ||
      !(await verifyPassword(password, user.passwordHash))
    )
      return null;
    return { userId: user.id, email: user.email };
  }

  private async issueEmailToken(
    email: string,
    kind: "magic_link" | "password_reset",
    validHours: number,
  ): Promise<{ token: string } | null> {
    await this.load();
    const user = this.state.users.find((item) => item.email === normalizeEmail(email));
    if (!user?.verifiedAt) return null;
    const token = createOpaqueToken();
    this.state.tokens.push({
      id: crypto.randomUUID(),
      userId: user.id,
      kind,
      tokenHash: hashToken(token),
      expiresAt: expires(validHours),
      consumedAt: null,
    });
    await this.persist();
    return { token };
  }

  createMagicLink(email: string) {
    return this.issueEmailToken(email, "magic_link", 1);
  }
  createPasswordReset(email: string) {
    return this.issueEmailToken(email, "password_reset", 1);
  }

  async consumeMagicLink(token: string): Promise<{ userId: string; email: string } | null> {
    const user = await this.consumeToken(token, "magic_link");
    if (!user?.verifiedAt) return null;
    await this.persist();
    return { userId: user.id, email: user.email };
  }

  async resetPassword(token: string, password: string): Promise<boolean> {
    const user = await this.consumeToken(token, "password_reset");
    if (!user) return false;
    user.passwordHash = await hashPassword(password);
    for (const session of this.state.sessions.filter(
      (item) => item.userId === user.id && !item.revokedAt,
    ))
      session.revokedAt = now();
    await this.persist();
    return true;
  }

  async createSession(
    userId: string,
    device: { label: string; ipHash: string },
  ): Promise<{ token: string; expiresAt: string }> {
    await this.load();
    const user = this.state.users.find((item) => item.id === userId);
    if (!user?.verifiedAt) throw new Error("Verified user not found.");
    const token = createOpaqueToken();
    const expiresAt = expires(24 * 30);
    this.state.sessions.push({
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(token),
      deviceLabel: device.label,
      ipHash: device.ipHash,
      createdAt: now(),
      lastSeenAt: now(),
      expiresAt,
      revokedAt: null,
    });
    await this.persist();
    return { token, expiresAt };
  }

  async resolveSession(token: string): Promise<SessionIdentity | null> {
    await this.load();
    const session = this.state.sessions.find(
      (item) => item.tokenHash === hashToken(token) && !item.revokedAt && item.expiresAt > now(),
    );
    if (!session) return null;
    const user = this.state.users.find((item) => item.id === session.userId);
    if (!user) return null;
    session.lastSeenAt = now();
    return {
      sessionId: session.id,
      userId: user.id,
      email: user.email,
      expiresAt: session.expiresAt,
    };
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    await this.load();
    const session = this.state.sessions.find(
      (item) => item.userId === userId && item.id === sessionId && !item.revokedAt,
    );
    if (!session) return false;
    session.revokedAt = now();
    await this.persist();
    return true;
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    await this.load();
    const sessions = this.state.sessions.filter(
      (item) => item.userId === userId && item.id !== exceptSessionId && !item.revokedAt,
    );
    sessions.forEach((session) => {
      session.revokedAt = now();
    });
    if (sessions.length) await this.persist();
    return sessions.length;
  }

  async listSessions(userId: string): Promise<readonly DeviceSession[]> {
    await this.load();
    return this.state.sessions
      .filter((item) => item.userId === userId && !item.revokedAt && item.expiresAt > now())
      .map(({ id: sessionId, deviceLabel, createdAt, lastSeenAt, expiresAt }) => ({
        id: sessionId,
        deviceLabel,
        createdAt,
        lastSeenAt,
        expiresAt,
      }));
  }

  async createWorkspace(userId: string, name: string): Promise<WorkspaceRecord> {
    await this.load();
    if (!this.state.users.some((user) => user.id === userId)) throw new Error("User not found.");
    const base = slugify(name);
    let slug = base;
    while (this.state.workspaces.some((workspace) => workspace.slug === slug))
      slug = `${base}-${createOpaqueToken(3).toLowerCase()}`;
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name: name.trim(),
      slug,
      plan: "free",
      createdAt: now(),
    };
    this.state.workspaces.push(workspace);
    this.state.memberships.push({
      workspaceId: workspace.id,
      userId,
      role: "owner",
      createdAt: now(),
    });
    if (!this.state.workspaceSelections.some((selection) => selection.userId === userId))
      this.state.workspaceSelections.push({ userId, workspaceId: workspace.id });
    await this.persist();
    return workspace;
  }

  async listWorkspaces(userId: string): Promise<readonly WorkspaceRecord[]> {
    await this.load();
    const ids = new Set(
      this.state.memberships
        .filter((item) => item.userId === userId)
        .map((item) => item.workspaceId),
    );
    return this.state.workspaces.filter((workspace) => ids.has(workspace.id));
  }

  async selectWorkspace(userId: string, workspaceId: string): Promise<WorkspaceRecord> {
    await this.requireAccess(userId, workspaceId, "workspace:read");
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new AuthorizationError("Workspace not found.");
    const selection = this.state.workspaceSelections.find((item) => item.userId === userId);
    if (selection) selection.workspaceId = workspaceId;
    else this.state.workspaceSelections.push({ userId, workspaceId });
    await this.persist();
    return workspace;
  }

  async getCurrentWorkspace(userId: string): Promise<WorkspaceRecord | null> {
    await this.load();
    const selected = this.state.workspaceSelections.find((item) => item.userId === userId);
    if (
      selected &&
      this.state.memberships.some(
        (item) => item.userId === userId && item.workspaceId === selected.workspaceId,
      )
    )
      return this.state.workspaces.find((item) => item.id === selected.workspaceId) ?? null;
    return (await this.listWorkspaces(userId))[0] ?? null;
  }

  async getMembership(userId: string, workspaceId: string): Promise<MembershipRecord | null> {
    await this.load();
    return (
      this.state.memberships.find(
        (item) => item.userId === userId && item.workspaceId === workspaceId,
      ) ?? null
    );
  }

  async requireAccess(
    userId: string,
    workspaceId: string,
    permission: Permission,
  ): Promise<MembershipRecord> {
    const membership = await this.getMembership(userId, workspaceId);
    requirePermission(membership?.role ?? null, permission);
    return membership as MembershipRecord;
  }

  async listMembers(userId: string, workspaceId: string): Promise<readonly MembershipRecord[]> {
    await this.requireAccess(userId, workspaceId, "members:read");
    return this.state.memberships.filter((item) => item.workspaceId === workspaceId);
  }

  async updateMemberRole(
    userId: string,
    workspaceId: string,
    memberId: string,
    role: Exclude<WorkspaceRole, "owner">,
  ): Promise<boolean> {
    await this.requireAccess(userId, workspaceId, "members:manage");
    const membership = this.state.memberships.find(
      (item) =>
        item.workspaceId === workspaceId && item.userId === memberId && item.role !== "owner",
    );
    if (!membership) return false;
    membership.role = role;
    await this.persist();
    return true;
  }

  async inviteMember(
    userId: string,
    workspaceId: string,
    email: string,
    role: Exclude<WorkspaceRole, "owner">,
  ): Promise<{ invitation: InvitationRecord; token: string }> {
    await this.requireAccess(userId, workspaceId, "members:manage");
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    if (
      this.state.memberships.filter((item) => item.workspaceId === workspaceId).length >=
      entitlementLimit(workspace.plan, "members")
    )
      throw new Error("Workspace member limit reached.");
    const token = createOpaqueToken();
    const invitation: InvitationRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      email: normalizeEmail(email),
      role,
      tokenHash: hashToken(token),
      expiresAt: expires(24 * 7),
      acceptedAt: null,
      createdAt: now(),
    };
    this.state.invitations.push(invitation);
    await this.persist();
    return { invitation, token };
  }

  async acceptInvitation(userId: string, token: string): Promise<boolean> {
    await this.load();
    const user = this.state.users.find((item) => item.id === userId);
    const invitation = this.state.invitations.find(
      (item) => item.tokenHash === hashToken(token) && !item.acceptedAt && item.expiresAt > now(),
    );
    if (!user || !invitation || user.email !== invitation.email) return false;
    if (
      !this.state.memberships.some(
        (item) => item.userId === userId && item.workspaceId === invitation.workspaceId,
      )
    )
      this.state.memberships.push({
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
        createdAt: now(),
      });
    invitation.acceptedAt = now();
    await this.persist();
    return true;
  }

  async saveOnboarding(
    userId: string,
    input: { workspaceId: string; useCase?: string; currentStep: number; completed?: boolean },
  ): Promise<OnboardingRecord> {
    await this.requireAccess(userId, input.workspaceId, "workspace:read");
    let record = this.state.onboarding.find((item) => item.userId === userId);
    if (!record) {
      record = {
        userId,
        workspaceId: input.workspaceId,
        useCase: input.useCase ?? null,
        currentStep: input.currentStep,
        completedAt: input.completed ? now() : null,
        updatedAt: now(),
      };
      this.state.onboarding.push(record);
    } else {
      record.workspaceId = input.workspaceId;
      if (input.useCase !== undefined) record.useCase = input.useCase;
      record.currentStep = input.currentStep;
      if (input.completed) record.completedAt = now();
      record.updatedAt = now();
    }
    await this.persist();
    return record;
  }

  async getOnboarding(userId: string): Promise<OnboardingRecord | null> {
    await this.load();
    return this.state.onboarding.find((item) => item.userId === userId) ?? null;
  }

  async createForm(
    userId: string,
    workspaceId: string,
    input: Omit<FormRecord, "id" | "workspaceId" | "endpointKey" | "createdAt" | "active">,
  ): Promise<FormRecord> {
    await this.requireAccess(userId, workspaceId, "forms:create");
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    if (
      this.state.forms.filter((form) => form.workspaceId === workspaceId).length >=
      entitlementLimit(workspace.plan, "forms")
    )
      throw new Error("Workspace form limit reached.");
    let endpointKey = `fs_${createOpaqueToken(24)}`;
    while (this.state.forms.some((form) => form.endpointKey === endpointKey))
      endpointKey = `fs_${createOpaqueToken(24)}`;
    const fields = formDefinition
      .parse({
        fields: input.fields.map((field) => ({ ...field, label: field.name })),
      })
      .fields.map(({ name, type, required }) => ({ name, type, required }));
    const form: FormRecord = {
      ...input,
      fields,
      id: crypto.randomUUID(),
      workspaceId,
      endpointKey,
      active: true,
      createdAt: now(),
    };
    this.state.forms.push(form);
    await this.persist();
    return form;
  }

  async listForms(userId: string, workspaceId: string): Promise<readonly FormRecord[]> {
    await this.requireAccess(userId, workspaceId, "forms:read");
    return this.state.forms.filter((form) => form.workspaceId === workspaceId);
  }
  async getForm(userId: string, workspaceId: string, formId: string): Promise<FormRecord | null> {
    await this.requireAccess(userId, workspaceId, "forms:read");
    return (
      this.state.forms.find((form) => form.id === formId && form.workspaceId === workspaceId) ??
      null
    );
  }
  async getFormByEndpoint(endpointKey: string): Promise<FormRecord | null> {
    await this.load();
    return this.state.forms.find((form) => form.endpointKey === endpointKey && form.active) ?? null;
  }

  async requestAccountDeletion(userId: string): Promise<string> {
    await this.load();
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) throw new AuthorizationError("Account not found.");
    user.deletionRequestedAt = now();
    await this.revokeAllSessions(userId);
    await this.persist();
    return user.deletionRequestedAt;
  }
}

export function createLocalDevelopmentRepository(
  file = process.env.FORMSENTINEL_LOCAL_DATA_FILE || ".formsentinel/dev-data.json",
): LocalDevelopmentRepository {
  return new LocalDevelopmentRepository(file);
}

export * from "./schema";
