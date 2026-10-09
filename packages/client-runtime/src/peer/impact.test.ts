import { describe, expect, it } from "vite-plus/test";
import type { PeerImpactRecord, PeerImpactStatus } from "@t3tools/contracts";
import {
  impactCount,
  impactRows,
  visibleImpactRecords,
  impactAction,
  impactControl,
  impactRootLabel,
  visibleImpactProvided,
} from "./impact.ts";
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

it("offers reverse controls only for live records and an authenticated operate capability", () => {
  expect(impactAction(record, false)).toBeNull();
  expect(impactAction(record, true)).toEqual({ command: "dismiss", label: "Dismiss" });
  expect(impactAction({ ...record, state: "dismissed" }, true)).toEqual({
    command: "reopen",
    label: "Reopen",
  });
  expect(impactAction({ ...record, live: false }, true)).toBeNull();
  expect(impactAction({ ...record, state: "cleared" }, true)).toBeNull();
});
it("keeps a forced-off explanation and recovery commands readable without an active plugin", () => {
  const plugin = {
    id: "impact",
    title: "Impact",
    enabled: true,
    active: false,
    reason: "PEER_IMPACT=off",
  };
  expect(impactControl(undefined, plugin)).toMatchObject({
    on: false,
    locked: true,
    reason: "Turned off by PEER_IMPACT=off.",
  });
  expect(impactControl(undefined, { ...plugin, reason: "hub" })).toMatchObject({
    on: true,
    locked: false,
  });
  expect(impactControl(undefined, undefined).reason).toContain("does not support");
  expect(
    impactRootLabel({ root: "/work", state: "uninitialized", commands: ["codegraph init /work"] }),
  ).toBe("No CodeGraph index. Initialize this checkout yourself.");
  expect(impactRootLabel({ root: "/work", state: "pending", commands: [] })).toContain("pending");
  const provided = {
    project: "app",
    name: "price",
    path: "money.ts",
    side: record.sides[0],
    change: "signature" as const,
    rev: 1,
    changedAt: "now",
  };
  expect(
    visibleImpactProvided(
      { records: [], provided: [provided, { ...provided, project: "other" }] },
      { workspace: "team", project: "app", task: "a" },
    ),
  ).toEqual([provided]);
  expect(
    visibleImpactProvided({ records: [], provided: [provided] }, { workspace: "team", task: "b" }),
  ).toEqual([]);
});
