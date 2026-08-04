"use server";
import { credentialsSchema, registrationSchema, sessionCookie } from "@formsentinel/auth";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { repository } from "../lib/repository";
import { clearSessionCookie, currentSession, setSessionCookie } from "../lib/session";
async function startSession(userId: string) {
  const agent = (await headers()).get("user-agent") || "Unknown browser";
  const session = await repository.createSession(userId, {
    label: agent.slice(0, 100),
    ipHash: "development-redacted",
  });
  await setSessionCookie(session.token);
}
export async function signup(formData: FormData) {
  const input = registrationSchema.parse(Object.fromEntries(formData));
  const registration = await repository.register(input);
  const workspace = await repository.createWorkspace(
    registration.userId,
    `${input.name}'s workspace`,
  );
  await repository.saveOnboarding(registration.userId, {
    workspaceId: workspace.id,
    currentStep: 1,
  });
  const token =
    process.env.NODE_ENV === "production"
      ? ""
      : `?token=${encodeURIComponent(registration.verificationToken)}`;
  redirect(`/verify${token}`);
}
export async function verifyEmail(formData: FormData) {
  const token = String(formData.get("token") || "");
  const identity = await repository.verifyEmail(token);
  if (!identity) redirect("/verify?error=invalid");
  await startSession(identity.userId);
  redirect("/app");
}
export async function login(formData: FormData) {
  const input = credentialsSchema.parse(Object.fromEntries(formData));
  const identity = await repository.authenticate(input.email, input.password);
  if (!identity) redirect("/login?error=invalid");
  await startSession(identity.userId);
  redirect("/app");
}
export async function logoutCurrent() {
  const session = await currentSession();
  if (session) await repository.revokeSession(session.userId, session.sessionId);
  await clearSessionCookie();
  redirect("/login");
}
export async function revokeDeviceSession(formData: FormData) {
  const session = await currentSession();
  if (!session) redirect("/login");
  await repository.revokeSession(session.userId, String(formData.get("sessionId") || ""));
  redirect("/app/settings/security");
}
export async function logoutAll() {
  const session = await currentSession();
  if (session) await repository.revokeAllSessions(session.userId);
  (await cookies()).delete(sessionCookie.name);
  redirect("/login");
}
export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") || "");
  const result = await repository.createMagicLink(email);
  const token = process.env.NODE_ENV === "production" ? "" : result?.token;
  redirect(`/magic-link?requested=1${token ? `&token=${encodeURIComponent(token)}` : ""}`);
}
export async function requestReset(formData: FormData) {
  const email = String(formData.get("email") || "");
  const result = await repository.createPasswordReset(email);
  const token = process.env.NODE_ENV === "production" ? "" : result?.token;
  redirect(`/reset?requested=1${token ? `&token=${encodeURIComponent(token)}` : ""}`);
}
export async function requestDeletion() {
  const session = await currentSession();
  if (!session) redirect("/login");
  await repository.requestAccountDeletion(session.userId);
  await clearSessionCookie();
  redirect("/login?deleted=requested");
}
export async function consumeMagicLink(formData: FormData) {
  const token = String(formData.get("token") || "");
  const identity = await repository.consumeMagicLink(token);
  if (!identity) redirect("/magic-link?error=invalid");
  await startSession(identity.userId);
  redirect("/app");
}
export async function completeReset(formData: FormData) {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  if (password.length < 12 || !(await repository.resetPassword(token, password)))
    redirect("/reset?error=invalid");
  redirect("/login?reset=complete");
}
export async function selectWorkspace(formData: FormData) {
  const session = await currentSession();
  if (!session) redirect("/login");
  await repository.selectWorkspace(session.userId, String(formData.get("workspaceId") || ""));
  redirect("/app");
}
export async function createWorkspace(formData: FormData) {
  const session = await currentSession();
  if (!session) redirect("/login");
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) throw new Error("Workspace name must have at least two characters.");
  const workspace = await repository.createWorkspace(session.userId, name);
  await repository.selectWorkspace(session.userId, workspace.id);
  redirect("/app");
}
