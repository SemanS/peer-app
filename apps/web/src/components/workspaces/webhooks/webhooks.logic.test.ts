import { describe, expect, it } from "@effect/vitest";
import { webhooksView } from "./webhooks.logic";

describe("webhook settings", () => {
  it("shows loading, refusal, an empty setup hint and loaded rows", () => {
    expect(webhooksView("admin", { data: null, error: null, isPending: true })).toEqual({
      kind: "loading",
    });
    expect(webhooksView("admin", { data: null, error: "No access", isPending: false })).toEqual({
      kind: "error",
      message: "No access",
    });
    expect(
      webhooksView("owner", {
        data: { revision: null, webhooks: [] },
        error: null,
        isPending: false,
      })?.kind,
    ).toBe("empty");
    expect(webhooksView("member", { data: null, error: "No access", isPending: false })).toBeNull();
  });
});
