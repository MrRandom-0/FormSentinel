import { NextResponse, type NextRequest } from "next/server";
import {
  httpSecurityHeaders,
  trustedRequestHost,
  validCsrfOrigin,
} from "@formsentinel/security/headers";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const csrfExempt = ["/api/billing/stripe/webhook", "/api/development/v1/forms/"];

export function middleware(request: NextRequest) {
  const production = process.env.NODE_ENV === "production";
  const allowedHosts = (process.env.TRUSTED_HOSTS ?? (production ? "" : "localhost,localhost:3000"))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!trustedRequestHost(request.headers.get("host"), allowedHosts))
    return Response.json({ error: "untrusted_host" }, { status: 400 });
  const cookieAuthenticated = request.cookies.has("formsentinel_session");
  if (
    cookieAuthenticated &&
    mutationMethods.has(request.method) &&
    !csrfExempt.some((path) => request.nextUrl.pathname.startsWith(path)) &&
    !validCsrfOrigin(request.headers.get("origin"), request.nextUrl.origin)
  )
    return Response.json({ error: "csrf_rejected" }, { status: 403 });
  const suppliedId = request.headers.get("x-request-id");
  const requestId =
    suppliedId && /^[A-Za-z0-9_-]{8,100}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  for (const [name, value] of Object.entries(httpSecurityHeaders(production)))
    response.headers.set(name, value);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
