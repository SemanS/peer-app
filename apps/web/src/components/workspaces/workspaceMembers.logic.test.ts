import { describe, expect, it } from "vite-plus/test";
import {
  memberActions,
  removalConfirmation,
  pendingRevocationsWarning,
} from "./workspaceMembers.logic";
describe("offboarding decisions", () => {
  it("keeps members out of administration, protects owners and refuses self-removal", () => {
    expect(memberActions("member", "member", false)).toEqual({
      changeRole: false,
      revokeKeys: false,
      remove: false,
    });
    expect(memberActions("admin", "owner", false).remove).toBe(false);
    expect(memberActions("owner", "owner", false).remove).toBe(true);
    expect(memberActions("owner", "owner", true).remove).toBe(false);
  });
  it("makes the full plan and lack of one explicit before consent", () => {
    const text = removalConfirmation("Acme", "bob@acme.test", {
      email: "bob@acme.test",
      role: "member",
      keys: 2,
      invites: 1,
      projects: ["kirkwood"],
      canRemove: true,
    });
    for (const phrase of [
      "2 shared-capacity keys",
      "cannot rejoin by domain",
      "kirkwood",
      "1 invitations",
      "Local clones",
    ])
      expect(text).toContain(phrase);
    expect(removalConfirmation("Acme", "bob", { unsupported: true })).toContain(
      "cannot preview the effect",
    );
    expect(removalConfirmation("Acme", "bob", { unsupported: true })).toContain(
      "may allow them to rejoin by domain",
    );
  });
  it("shows pending gateway failures until the queue is empty", () => {
    expect(pendingRevocationsWarning({ count: 2, lastError: "unreachable" })).toBe(
      "2 key revocations are waiting for the gateway (last error: unreachable).",
    );
    expect(pendingRevocationsWarning({ count: 0 })).toBeNull();
  });
});
