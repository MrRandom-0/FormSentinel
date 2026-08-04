import { describe, expect, it } from "vitest";
import { FormSentinelClient } from "./index";
describe("React SDK exports", () => {
  it("wraps the dependency-light typed core", () =>
    expect(FormSentinelClient).toBeTypeOf("function"));
});
