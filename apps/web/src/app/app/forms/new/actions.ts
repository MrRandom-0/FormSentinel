"use server";
import { redirect } from "next/navigation";
import { formDefinition } from "@formsentinel/form-schema";
import { formConfigurationSchema } from "@formsentinel/forms";
import { requireSession } from "../../../../lib/session";
import { repository } from "../../../../lib/repository";
export async function createForm(formData: FormData) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) throw new Error("Create a workspace first.");
  const parsed = formConfigurationSchema.parse({
    name: formData.get("name"),
    platform: formData.get("platform"),
    template: formData.get("template"),
    sourceUrl: formData.get("sourceUrl"),
    successRedirect: formData.get("successRedirect"),
    allowedOrigins: String(formData.get("allowedOrigins") || "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
    honeypotField: formData.get("honeypotField"),
    notificationEmail: formData.get("notificationEmail"),
  });
  const names = formData.getAll("fieldName").map(String);
  const types = formData.getAll("fieldType").map(String);
  const definition = formDefinition.parse({
    fields: names.map((name, index) => ({
      name,
      label: name,
      type: types[index],
      required: formData.get(`fieldRequired-${index}`) === "on",
    })),
  });
  if (definition.fields.some((field) => field.name === parsed.honeypotField))
    throw new Error("The honeypot name must not match a submission field.");
  const fields = definition.fields.map(({ name, type, required }) => ({ name, type, required }));
  const form = await repository.createForm(session.userId, workspace.id, {
    name: parsed.name,
    platform: parsed.platform,
    template: parsed.template,
    sourceUrl: parsed.sourceUrl || null,
    successRedirect: parsed.successRedirect || null,
    allowedOrigins: parsed.allowedOrigins,
    honeypotField: parsed.honeypotField,
    notificationEmail: parsed.notificationEmail || null,
    fields,
  });
  await repository.saveOnboarding(session.userId, {
    workspaceId: workspace.id,
    currentStep: 4,
    completed: true,
  });
  redirect(`/app/forms/${form.id}/setup`);
}
