import { describe, expect, it } from "vitest";
import { diffSchemas, DriftLifecycle, visualSchemaDiff } from "./index";
const oldSchema = {
  fields: [
    { name: "email", type: "email", required: true },
    { name: "full_name", type: "text", required: false },
  ],
};
const newSchema = {
  fields: [
    { name: "email", type: "text", required: false },
    { name: "fullname", type: "text", required: false },
    { name: "profile[age]", type: "number", required: false },
  ],
};
describe("schema drift", () => {
  it("produces deterministic canonical changes", () => {
    const changes = diffSchemas(oldSchema, newSchema);
    expect(changes.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "addition",
        "removal",
        "rename_candidate",
        "type",
        "required",
        "nesting",
      ]),
    );
    expect(visualSchemaDiff(changes)).toContain("email");
  });
  it("preserves immutable history through accept, concurrency and rollback", () => {
    const lifecycle = new DriftLifecycle("test");
    const first = lifecycle.initialize("f1", oldSchema);
    const observation = lifecycle.observe("f1", newSchema, {
      submissionId: "s1",
      deploymentId: "d1",
    })!;
    expect(observation.firstSubmissionId).toBe("s1");
    const accepted = lifecycle.decide(observation.id, 1, "accept");
    expect(accepted.newVersion?.version).toBe(2);
    expect(() => lifecycle.decide(observation.id, 1, "reject")).toThrow("optimistic_lock_failed");
    const rollback = lifecycle.rollback(first.id);
    expect(rollback.version).toBe(3);
    expect(rollback.definition).toEqual(first.definition);
  });
  it("ignores only an exact fingerprint temporarily", () => {
    const lifecycle = new DriftLifecycle("test");
    lifecycle.initialize("f1", oldSchema);
    const now = new Date("2026-01-01T00:00:00Z");
    const observed = lifecycle.observe("f1", newSchema, {}, now)!;
    lifecycle.decide(
      observed.id,
      1,
      "ignore",
      { ignoreUntil: new Date(now.getTime() + 1000) },
      now,
    );
    expect(lifecycle.observe("f1", newSchema, {}, new Date(now.getTime() + 500))).toBeNull();
    expect(lifecycle.observe("f1", newSchema, {}, new Date(now.getTime() + 1500))).not.toBeNull();
  });
});
