import { describe, expect, it } from "vite-plus/test";
import type { PeerAuditEntry } from "@t3tools/contracts";
import { auditNames, auditRow, describeAuditEntry } from "./peerAudit.ts";
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
describe("audit names", () => {
  const nameOf = auditNames([
    { email: "Ana@acme.test", name: " Ana Novak " },
    { email: "bob@acme.test", name: "Bob" },
    { email: "eve@acme.test", name: "  " },
  ]);

  it("calls a member by name, whatever the case of the address", () => {
    expect(nameOf("ana@acme.test")).toBe("Ana Novak");
    expect(nameOf("BOB@acme.test")).toBe("Bob");
  });

  it("keeps the address of someone with no name, or no longer in the workspace", () => {
    expect(nameOf("eve@acme.test")).toBe("eve@acme.test");
    expect(nameOf("gone@acme.test")).toBe("gone@acme.test");
  });

  it("puts names in the sentences about people, and only there", () => {
    expect(describeAuditEntry(entry, nameOf)).toBe(
      "Ana Novak removed Bob (2 keys queued for revocation)",
    );
    expect(
      describeAuditEntry(
        { ...entry, kind: "key.issued", subject: "bob@acme.test", project: "booking" },
        nameOf,
      ),
    ).toBe("Ana Novak issued a shared-capacity key for Bob in booking");
    // A secret's name and a task are not people, even when one reads like an address.
    expect(
      describeAuditEntry({ ...entry, kind: "secret.written", subject: "bob@acme.test" }, nameOf),
    ).toBe("Ana Novak wrote secret bob@acme.test");
    expect(describeAuditEntry({ ...entry, kind: "task.closed", subject: "BKG-7" }, nameOf)).toBe(
      "Ana Novak closed task BKG-7",
    );
  });

  it("shows the address where no names are given", () => {
    expect(describeAuditEntry(entry)).toContain("ana@acme.test removed bob@acme.test");
  });
});

describe("an audit row", () => {
  const row = (overrides: Partial<PeerAuditEntry> = {}) =>
    auditRow(
      {
        ...entry,
        at: "2026-10-12T13:57:30.550123456Z",
        actor: {
          type: "person",
          email: "ana@acme.test",
          session: "7f3a9c2e51b0",
          signedInAt: "2026-10-12T08:00:00Z",
        },
        ...overrides,
      },
      {
        nameOf: auditNames([{ email: "ana@acme.test", name: "Ana" }]),
        ago: (iso) => (iso.startsWith("2026-10-12T13") ? "2h ago" : ""),
        exact: (iso) => (iso.startsWith("2026-10-12T13") ? "12 Oct 2026, 15:57:30" : ""),
      },
    );

  it("says it in names, how long ago, and the exact time for the tooltip", () => {
    expect(row()).toEqual({
      text: "Ana removed bob@acme.test (2 keys queued for revocation)",
      relative: "2h ago",
      exact: "12 Oct 2026, 15:57:30",
      session: { short: "7f3a9c2e", full: "7f3a9c2e51b0" },
    });
  });

  it("shortens the session to eight characters and keeps the whole one to copy", () => {
    expect(row().session).toEqual({ short: "7f3a9c2e", full: "7f3a9c2e51b0" });
    expect(
      row({
        actor: { type: "person", email: "ana@acme.test", session: "abc", signedInAt: "then" },
      }).session,
    ).toEqual({ short: "abc", full: "abc" });
  });

  it("has no session for the Hub, or an entry that names none", () => {
    expect(row({ actor: { type: "hub" } }).session).toBeNull();
    expect(
      row({ actor: { type: "person", email: "ana@acme.test", session: "", signedInAt: "then" } })
        .session,
    ).toBeNull();
  });

  it("keeps an instant it cannot write as the Hub wrote it", () => {
    expect(row({ at: "sometime" })).toMatchObject({ relative: "sometime", exact: "sometime" });
  });
});
