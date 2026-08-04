import { describe, expect, it } from "vitest";
import { AuthorizationError, hasPermission, requirePermission } from "./index";

describe("workspace permissions", () => {
  it("gives only owners billing access", () => {
    expect(hasPermission("owner", "billing:manage")).toBe(true);
    expect(hasPermission("administrator", "billing:manage")).toBe(false);
  });

  it("enforces the five-role permission matrix", () => {
    expect(hasPermission("administrator", "members:manage")).toBe(true);
    expect(hasPermission("developer", "forms:create")).toBe(true);
    expect(hasPermission("developer", "members:manage")).toBe(false);
    expect(hasPermission("analyst", "submissions:export")).toBe(true);
    expect(hasPermission("analyst", "forms:create")).toBe(false);
    expect(hasPermission("viewer", "forms:read")).toBe(true);
    expect(hasPermission("viewer", "forms:create")).toBe(false);
    expect(() => requirePermission("viewer", "forms:update")).toThrow(AuthorizationError);
  });

  it("denies anonymous access", () => {
    expect(() => requirePermission(null, "workspace:read")).toThrow(AuthorizationError);
  });
});
