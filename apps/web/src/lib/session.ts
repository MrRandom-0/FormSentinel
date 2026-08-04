import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie } from "@formsentinel/auth";
import { repository } from "./repository";
export async function currentSession() {
  const token = (await cookies()).get(sessionCookie.name)?.value;
  return token ? repository.resolveSession(token) : null;
}
export async function requireSession() {
  const session = await currentSession();
  if (!session) redirect("/login?next=/app");
  return session;
}
export async function setSessionCookie(token: string) {
  (await cookies()).set(
    sessionCookie.name,
    token,
    sessionCookie.options(process.env.NODE_ENV === "production"),
  );
}
export async function clearSessionCookie() {
  (await cookies()).delete(sessionCookie.name);
}
