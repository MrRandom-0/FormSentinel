import { describe, expect, it } from "vitest";
import { UnavailableEmailProvider, oauthAvailability } from "./index";
describe("provider gating", () => {
  it("does not fake email delivery", async () => {
    const provider = new UnavailableEmailProvider();
    expect(provider.availability().available).toBe(false);
    await expect(
      provider.send({ to: "person@example.test", subject: "Test", text: "Body" }),
    ).rejects.toThrow(/unavailable/);
  });
  it("keeps OAuth unavailable even when reserved credentials exist", () => {
    expect(oauthAvailability("github", {}).available).toBe(false);
    expect(
      oauthAvailability("github", { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" })
        .available,
    ).toBe(false);
  });
});
