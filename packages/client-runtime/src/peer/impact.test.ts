import { describe, expect, it } from "vite-plus/test";
import type { PeerImpactRecord, PeerImpactStatus } from "@t3tools/contracts";
import { impactCount, impactRows, visibleImpactRecords } from "./impact.ts";
const record: PeerImpactRecord = {
  id: "abc",
  project: "app",
  sides: [
    { session: "a", email: "ana@test", environment: "one", label: "Task A", task: "a" },
    { session: "b", email: "bob@test", environment: "two", label: "Task B", task: "b" },
  ],
  items: [
    {
      name: "price",
      path: "money.ts",
      changer: "b",
      change: "signature",
      from: [{ name: "receipt", path: "receipt.ts" }],
    },
  ],
  state: "open",
  live: true,
  reopened: false,
  openedAt: "now",
  updatedAt: "now",
};
describe("shared impact projections", () => {
  it("keeps both directions and live dismissed records, excluding ended/cleared and other places", () => {
    expect(impactRows(record)[0]?.label).toBe(
      "Task B changed price in money.ts; Task A uses it from receipt.",
    );
    const view = {
      provided: [],
      records: [
        record,
        { ...record, id: "dismissed", state: "dismissed" as const },
        { ...record, id: "ended", live: false },
        { ...record, id: "cleared", state: "cleared" as const },
        { ...record, id: "other", project: "other" },
      ],
    };
    expect(
      visibleImpactRecords(view, { workspace: "team", project: "app", task: "b" }).map(
        (row) => row.id,
      ),
    ).toEqual(["abc", "dismissed"]);
    expect(visibleImpactRecords(view, { workspace: "team", task: "unknown" })).toEqual([]);
  });
  it("reads task badge counts without loading a full view or another environment's workspace", () => {
    const status: PeerImpactStatus = {
      enabled: true,
      forcedOff: false,
      autoIndex: false,
      hubSupport: "supported",
      roots: [],
      revision: 1,
      counts: [
        { workspace: "team", project: "app", task: "a", count: 2 },
        { workspace: "team", project: "other", task: "a", count: 5 },
        { workspace: "else", project: "app", task: "a", count: 9 },
      ],
    };
    expect(impactCount(status, { workspace: "team", project: "app", task: "a" })).toBe(2);
    expect(impactCount(undefined, { workspace: "team" })).toBe(0);
  });
});
