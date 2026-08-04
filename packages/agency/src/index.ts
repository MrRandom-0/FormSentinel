export type AgencyRole = "owner" | "manager" | "viewer";
export type ClientGrant =
  "health:read" | "reports:read" | "forms:manage" | "monitors:manage" | "routing:manage";
export interface AgencyAccount {
  id: string;
  name: string;
  members: readonly { userId: string; role: AgencyRole }[];
}
export interface AgencyClient {
  agencyId: string;
  workspaceId: string;
  grants: readonly ClientGrant[];
  branding?: { name: string; logoUrl?: string; primaryColor?: string };
  viewerUserIds: readonly string[];
}
export interface AgencyTemplate {
  id: string;
  agencyId: string;
  kind: "form" | "monitor" | "routing";
  name: string;
  definition: Readonly<Record<string, unknown>>;
  usageNotes: string;
  version: number;
}
const roleAllows = (role: AgencyRole, grant: ClientGrant) =>
  role === "owner" ||
  role === "manager" ||
  (role === "viewer" && ["health:read", "reports:read"].includes(grant));
export class LocalAgencyStore {
  private readonly accounts: AgencyAccount[] = [];
  private readonly clients: AgencyClient[] = [];
  private readonly templates: AgencyTemplate[] = [];
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Local agency adapter is disabled in production.");
  }
  create(name: string, ownerUserId: string): AgencyAccount {
    const account = {
      id: crypto.randomUUID(),
      name: name.trim(),
      members: [{ userId: ownerUserId, role: "owner" as const }],
    };
    this.accounts.push(account);
    return structuredClone(account);
  }
  addMember(actorId: string, agencyId: string, userId: string, role: AgencyRole): AgencyAccount {
    const account = this.account(actorId, agencyId, "owner");
    if (account.members.some((item) => item.userId === userId)) throw new Error("member_exists");
    const updated = { ...account, members: [...account.members, { userId, role }] };
    this.accounts[this.accounts.findIndex((item) => item.id === agencyId)] = updated;
    return structuredClone(updated);
  }
  grantClient(
    actorId: string,
    agencyId: string,
    workspaceId: string,
    grants: readonly ClientGrant[],
    viewerUserIds: readonly string[] = [],
  ): AgencyClient {
    this.account(actorId, agencyId, "manager");
    const record = {
      agencyId,
      workspaceId,
      grants: [...new Set(grants)],
      viewerUserIds: [...new Set(viewerUserIds)],
    };
    const index = this.clients.findIndex(
      (item) => item.agencyId === agencyId && item.workspaceId === workspaceId,
    );
    if (index >= 0) this.clients[index] = record;
    else this.clients.push(record);
    return structuredClone(record);
  }
  requireClient(
    userId: string,
    agencyId: string,
    workspaceId: string,
    grant: ClientGrant,
  ): AgencyClient {
    const account = this.accounts.find((item) => item.id === agencyId);
    const member = account?.members.find((item) => item.userId === userId);
    const client = this.clients.find(
      (item) => item.agencyId === agencyId && item.workspaceId === workspaceId,
    );
    if (!member || !client || !client.grants.includes(grant) || !roleAllows(member.role, grant))
      throw new Error("forbidden");
    return structuredClone(client);
  }
  requireViewer(userId: string, agencyId: string, workspaceId: string): AgencyClient {
    const client = this.clients.find(
      (item) =>
        item.agencyId === agencyId &&
        item.workspaceId === workspaceId &&
        item.viewerUserIds.includes(userId),
    );
    if (!client) throw new Error("forbidden");
    return structuredClone(client);
  }
  saveTemplate(
    actorId: string,
    agencyId: string,
    input: Omit<AgencyTemplate, "id" | "agencyId" | "version">,
  ): AgencyTemplate {
    this.account(actorId, agencyId, "manager");
    const template = { ...input, id: crypto.randomUUID(), agencyId, version: 1 };
    this.templates.push(template);
    return structuredClone(template);
  }
  dashboard(
    userId: string,
    agencyId: string,
    health: Readonly<Record<string, number>>,
  ): readonly { workspaceId: string; score: number | null }[] {
    this.account(userId, agencyId, "viewer");
    return this.clients
      .filter((item) => item.agencyId === agencyId && item.grants.includes("health:read"))
      .map((item) => ({ workspaceId: item.workspaceId, score: health[item.workspaceId] ?? null }));
  }
  private account(userId: string, agencyId: string, minimum: AgencyRole): AgencyAccount {
    const account = this.accounts.find((item) => item.id === agencyId);
    const member = account?.members.find((item) => item.userId === userId);
    const ranks = { viewer: 0, manager: 1, owner: 2 };
    if (!account || !member || ranks[member.role] < ranks[minimum]) throw new Error("forbidden");
    return account;
  }
}
