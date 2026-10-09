import { describe, expect, it } from "vite-plus/test";
import type { PeerAuditEntry } from "@t3tools/contracts";
import { describeAuditEntry } from "./peerAudit.ts";
const entry: PeerAuditEntry = {
  seq: 1,
  at: "now",
  kind: "member.removed",
  actor: { type: "person", email: "ana@acme.test", session: "ref", signedInAt: "then" },
  subject: "bob@acme.test",
  project: null,
  details: { keysQueued: 2 },
};
describe("audit wording", () => {
  it("names membership consequences and role changes", () => {
    expect(describeAuditEntry(entry)).toBe(
      "ana@acme.test removed bob@acme.test (2 keys queued for revocation)",
    );
    expect(
      describeAuditEntry({
        ...entry,
        kind: "member.role-changed",
        details: { from: "member", to: "admin" },
      }),
    ).toContain("from member to admin");
  });
  it("names the Hub and unknown kinds without showing unknown payloads", () => {
    expect(describeAuditEntry({ ...entry, kind: "key.revoked", actor: { type: "hub" } })).toBe(
      "Peer Hub revoked a key for bob@acme.test",
    );
    const line = describeAuditEntry({
      ...entry,
      kind: "future.action",
      details: { unsafe: "must-not-show" },
    });
    expect(line).toContain("future.action");
    expect(line).not.toContain("must-not-show");
  });
});
