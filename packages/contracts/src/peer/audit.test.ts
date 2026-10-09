import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PeerAuditPage } from "./audit.ts";
const decodePage = Schema.decodeUnknownSync(PeerAuditPage);
const entry = {
  seq: 1,
  at: "2026-10-09T10:00:00Z",
  kind: "future.action",
  subject: null,
  project: null,
  details: {},
};
describe("audit wire compatibility", () => {
  it("accepts person and Hub actors, an unknown kind and absent next", () => {
    const page = decodePage({
      entries: [
        { ...entry, actor: { type: "hub" } },
        {
          ...entry,
          actor: {
            type: "person",
            email: "ana@acme.test",
            session: "000000000001",
            signedInAt: entry.at,
          },
        },
      ],
    });
    expect(page.entries.map((e) => e.actor.type)).toEqual(["hub", "person"]);
    expect(page.entries[0]?.kind).toBe("future.action");
    expect(page.next).toBeUndefined();
  });
  it("accepts the Hub's explicit null cursor and unsupported fallback", () => {
    expect(decodePage({ entries: [], next: null }).next).toBeNull();
    expect(decodePage({ entries: [], unsupported: true }).unsupported).toBe(true);
  });
});
