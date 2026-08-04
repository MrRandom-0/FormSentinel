import { describe, expect, it } from "vitest";
import { LocalAgencyStore } from "./index";
describe("agency isolation", () => {
  it("requires explicit client workspace grants without weakening isolation", () => {
    const store = new LocalAgencyStore("test");
    const agency = store.create("Agency", "owner");
    store.grantClient(
      "owner",
      agency.id,
      "client-a",
      ["health:read", "reports:read"],
      ["client-viewer"],
    );
    expect(store.requireClient("owner", agency.id, "client-a", "health:read").workspaceId).toBe(
      "client-a",
    );
    expect(() => store.requireClient("owner", agency.id, "client-b", "health:read")).toThrow(
      "forbidden",
    );
    expect(store.requireViewer("client-viewer", agency.id, "client-a").workspaceId).toBe(
      "client-a",
    );
    expect(() => store.requireViewer("client-viewer", agency.id, "client-b")).toThrow("forbidden");
  });
  it("refuses production local storage", () =>
    expect(() => new LocalAgencyStore("production")).toThrow());
});
