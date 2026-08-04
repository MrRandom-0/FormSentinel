import { describe, expect, it } from "vitest";
import { DevelopmentTestConsole, developmentPipelineStages } from "./index";
describe("development test console", () => {
  it("labels every simulated stage", async () => {
    const console = new DevelopmentTestConsole("test");
    const capture = await console.capture({
      kind: "submission",
      recipient: "team@example.test",
      subject: "Test",
      body: "{}",
    });
    expect(capture.adapter).toBe("development");
    expect(capture.stages).toEqual(developmentPipelineStages);
  });
  it("refuses production", () => {
    expect(() => new DevelopmentTestConsole("production")).toThrow(/disabled/);
  });
});
