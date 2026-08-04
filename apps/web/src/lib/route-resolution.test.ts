import { describe, expect, it } from "vitest";
import { resolveAppRoute, resolvePublicRoute } from "./route-resolution";

describe("route resolution", () => {
  it("resolves canonical builder and original topic routes", () => {
    expect(resolvePublicRoute(["ai-builders", "lovable"])).toBe("ai-builders/lovable");
    expect(resolvePublicRoute(["form-builders", "framer"])).toBe("form-builders/framer");
    expect(resolvePublicRoute(["guides", "form-monitoring"])).toBe("guides/form-monitoring");
    expect(resolvePublicRoute(["lovable"])).toBeNull();
  });

  it("resolves only exact app and form routes", () => {
    expect(resolveAppRoute(["app", "billing"])).toEqual({ kind: "top", route: "app/billing" });
    expect(resolveAppRoute(["app", "forms", "form-id", "protection"])).toEqual({
      kind: "form",
      formId: "form-id",
      route: "protection",
    });
    expect(resolveAppRoute(["app", "submissions", "submission-id"])).toEqual({
      kind: "submission",
      submissionId: "submission-id",
    });
    expect(resolveAppRoute(["app", "unknown"])).toBeNull();
    expect(resolveAppRoute(["app", "forms", "form-id", "spam"])).toBeNull();
    expect(resolveAppRoute(["app", "forms", "form-id", "extra", "path"])).toBeNull();
  });
});
