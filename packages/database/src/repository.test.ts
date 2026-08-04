import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorizationError } from "@formsentinel/auth";
import { LocalDevelopmentRepository } from "./index";

const dirs: string[] = [];
async function repository() {
  const directory = await mkdtemp(join(tmpdir(), "formsentinel-"));
  dirs.push(directory);
  return new LocalDevelopmentRepository(join(directory, "data.json"), "test");
}
afterEach(async () =>
  Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))),
);
async function user(repo: LocalDevelopmentRepository, email: string) {
  const registration = await repo.register({
    name: "Test User",
    email,
    password: "correct horse battery staple",
  });
  await repo.verifyEmail(registration.verificationToken);
  return registration.userId;
}
const formInput = {
  name: "Contact",
  platform: "nextjs",
  template: "contact",
  sourceUrl: "https://example.test/contact",
  successRedirect: "https://example.test/thanks",
  allowedOrigins: ["https://example.test"],
  honeypotField: "company_website",
  notificationEmail: "team@example.test",
  fields: [{ name: "email", type: "email" as const, required: true }],
};

describe("local development repository", () => {
  it("rejects unverified password, magic-link, and session authentication", async () => {
    const repo = await repository();
    const registration = await repo.register({
      name: "Pending User",
      email: "pending@example.test",
      password: "correct horse battery staple",
    });
    expect(
      await repo.authenticate("pending@example.test", "correct horse battery staple"),
    ).toBeNull();
    expect(await repo.createMagicLink("pending@example.test")).toBeNull();
    await expect(
      repo.createSession(registration.userId, { label: "Browser", ipHash: "hashed" }),
    ).rejects.toThrow(/Verified/);
    expect(await repo.verifyEmail("invalid-token")).toBeNull();
    expect(await repo.verifyEmail(registration.verificationToken)).toMatchObject({
      userId: registration.userId,
    });
    expect(
      await repo.authenticate("pending@example.test", "correct horse battery staple"),
    ).toMatchObject({
      userId: registration.userId,
    });
  });
  it("persists authentication, one-time tokens, and session revocation", async () => {
    const repo = await repository();
    const userId = await user(repo, "auth@example.test");
    expect(
      await repo.authenticate("AUTH@example.test", "correct horse battery staple"),
    ).toMatchObject({ userId });
    const magic = await repo.createMagicLink("auth@example.test");
    expect((await repo.consumeMagicLink(magic!.token))?.userId).toBe(userId);
    expect(await repo.consumeMagicLink(magic!.token)).toBeNull();
    const session = await repo.createSession(userId, { label: "Vitest", ipHash: "hashed" });
    const reset = await repo.createPasswordReset("auth@example.test");
    expect(await repo.resetPassword(reset!.token, "new correct horse password")).toBe(true);
    expect(await repo.resetPassword(reset!.token, "another password value")).toBe(false);
    expect(await repo.resolveSession(session.token)).toBeNull();
    expect(await repo.authenticate("auth@example.test", "correct horse battery staple")).toBeNull();
    expect(
      await repo.authenticate("auth@example.test", "new correct horse password"),
    ).toMatchObject({ userId });
  });
  it("lists device sessions and supports current or all-device logout", async () => {
    const repo = await repository();
    const userId = await user(repo, "sessions@example.test");
    const first = await repo.createSession(userId, { label: "Laptop", ipHash: "one" });
    const second = await repo.createSession(userId, { label: "Phone", ipHash: "two" });
    const sessions = await repo.listSessions(userId);
    expect(sessions.map((session) => session.deviceLabel)).toEqual(["Laptop", "Phone"]);
    const firstIdentity = await repo.resolveSession(first.token);
    expect(await repo.revokeSession(userId, firstIdentity!.sessionId)).toBe(true);
    expect(await repo.resolveSession(first.token)).toBeNull();
    expect(await repo.revokeAllSessions(userId)).toBe(1);
    expect(await repo.resolveSession(second.token)).toBeNull();
  });
  it("persists onboarding after reopening the JSON file", async () => {
    const repo = await repository();
    const userId = await user(repo, "onboard@example.test");
    const workspace = await repo.createWorkspace(userId, "Acme");
    await repo.saveOnboarding(userId, {
      workspaceId: workspace.id,
      useCase: "contact forms",
      currentStep: 3,
    });
    const reopened = new LocalDevelopmentRepository(
      (repo as unknown as { file: string }).file,
      "test",
    );
    expect(await reopened.getOnboarding(userId)).toMatchObject({
      currentStep: 3,
      useCase: "contact forms",
    });
  });
  it("enforces tenant isolation and opaque unique endpoints", async () => {
    const repo = await repository();
    const first = await user(repo, "one@example.test");
    const second = await user(repo, "two@example.test");
    const firstWorkspace = await repo.createWorkspace(first, "First");
    const alternateWorkspace = await repo.createWorkspace(first, "Alternate");
    await repo.selectWorkspace(first, alternateWorkspace.id);
    expect((await repo.getCurrentWorkspace(first))?.id).toBe(alternateWorkspace.id);
    await repo.selectWorkspace(first, firstWorkspace.id);
    const secondWorkspace = await repo.createWorkspace(second, "Second");
    const firstForm = await repo.createForm(first, firstWorkspace.id, formInput);
    const secondForm = await repo.createForm(second, secondWorkspace.id, formInput);
    expect(firstForm.endpointKey).toMatch(/^fs_[A-Za-z0-9_-]{32,}$/);
    expect(secondForm.endpointKey).not.toBe(firstForm.endpointKey);
    await expect(repo.getForm(second, firstWorkspace.id, firstForm.id)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(await repo.getForm(first, firstWorkspace.id, secondForm.id)).toBeNull();
  });
  it("rejects duplicate and invalid persisted schema fields", async () => {
    const repo = await repository();
    const userId = await user(repo, "schema@example.test");
    const workspace = await repo.createWorkspace(userId, "Schema");
    await expect(
      repo.createForm(userId, workspace.id, {
        ...formInput,
        fields: [
          { name: "email", type: "email", required: true },
          { name: "email", type: "text", required: false },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      repo.createForm(userId, workspace.id, {
        ...formInput,
        fields: [{ name: "bad name", type: "text", required: true }],
      }),
    ).rejects.toThrow();
  });
  it("refuses production use", () => {
    expect(() => new LocalDevelopmentRepository("data.json", "production")).toThrow(/disabled/);
  });
});
