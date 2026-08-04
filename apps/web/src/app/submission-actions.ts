"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "../lib/session";
import { repository, submissionStore } from "../lib/repository";
const actions = new Set(["view", "resolve", "spam", "legitimate", "delete", "restore"]);
export async function updateSubmission(formData: FormData) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) throw new Error("Workspace not found.");
  const id = String(formData.get("submissionId") || "");
  const action = String(formData.get("action") || "");
  if (!actions.has(action)) throw new Error("Invalid submission action.");
  await submissionStore().updateSubmission(
    session.userId,
    workspace.id,
    id,
    action as "view" | "resolve" | "spam" | "legitimate" | "delete" | "restore",
  );
  revalidatePath(`/app/submissions/${id}`);
  revalidatePath("/app/submissions");
}
export async function addSubmissionTag(formData: FormData) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) throw new Error("Workspace not found.");
  const id = String(formData.get("submissionId") || "");
  await submissionStore().addTag(
    session.userId,
    workspace.id,
    id,
    String(formData.get("tag") || ""),
  );
  revalidatePath(`/app/submissions/${id}`);
}
export async function retrySubmission(formData: FormData) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) throw new Error("Workspace not found.");
  const id = String(formData.get("submissionId") || "");
  await submissionStore().retrySubmission(session.userId, workspace.id, id);
  revalidatePath(`/app/submissions/${id}`);
}
