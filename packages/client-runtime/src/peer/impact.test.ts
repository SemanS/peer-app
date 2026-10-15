import { describe, expect, it } from "vite-plus/test";
import type { PeerImpactRecord, PeerImpactStatus } from "@t3tools/contracts";
import {
  impactContactLabel,
  impactCount,
  impactRows,
  impactRunning,
  visibleImpactRecords,
  impactAction,
  impactProjectIds,
  impactPlaceAllowed,
  filterImpactView,
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
      "Task B changed price in money.ts (signature changed); Task A uses it from receipt (receipt.ts).",
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
  // Enabled, but not running because agent coordination is off: the switch reads off, and says why.
  const running = { ...plugin, active: true, reason: undefined };
  const idle = { enabled: false, forcedOff: false } as unknown as PeerImpactStatus;
  expect(impactControl(idle, running)).toMatchObject({
    on: false,
    locked: false,
    reason: "Impact overlaps wait for agent coordination, which is off on this computer.",
  });
  expect(impactControl({ ...idle, enabled: true }, running).reason).toContain("CodeGraph indexes");
  expect(
    impactRootLabel({ root: "/work", state: "uninitialized", commands: ["codegraph init /work"] }),
  ).toBe("No CodeGraph index. Initialize this checkout yourself.");
  expect(impactRootLabel({ root: "/work", state: "pending", commands: [] })).toContain("pending");
  expect(impactRootLabel({ root: "/work", state: "pending", commands: [], waiting: 1 })).toBe(
    "1 changed file waits for CodeGraph and is left out until the index is current.",
  );
  expect(impactRootLabel({ root: "/work", state: "pending", commands: [], waiting: 3 })).toBe(
    "3 changed files wait for CodeGraph and are left out until the index is current.",
  );
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

it("removes revoked projects immediately even while the Hub view and revision are unchanged", () => {
  const projectIds = impactProjectIds(
    [{ slug: "team", projects: [{ project: { id: "other" } }] }],
    "team",
  );
  expect(projectIds).toEqual(["other"]);
  expect(impactPlaceAllowed(projectIds, { workspace: "team", project: "app" })).toBe(false);
  expect(impactPlaceAllowed(projectIds, { workspace: "team" })).toBe(true);
  expect(impactPlaceAllowed([], { workspace: "team" })).toBe(false);
  const old = {
    records: [record],
    provided: [
      {
        project: "app",
        name: "price",
        path: "money.ts",
        side: record.sides[0],
        change: "signature" as const,
        rev: 1,
        changedAt: "now",
      },
    ],
  };
  expect(filterImpactView(old, projectIds)).toEqual({ records: [], provided: [] });
  expect(impactProjectIds([], "team")).toEqual([]);
});

describe("impact wording", () => {
  it("says an item as one sentence whatever the change and the calls", () => {
    const item = record.items[0]!;
    const sentence = (change: typeof item.change, from: typeof item.from) =>
      impactRows({ ...record, items: [{ ...item, change, from }] })[0]?.label;
    expect(sentence("body", [])).toBe(
      "Task B changed price in money.ts (body changed); Task A uses it.",
    );
    expect(
      sentence("removed", [
        { name: "a", path: "a.ts" },
        { name: "b", path: "b.ts" },
      ]),
    ).toBe("Task B changed price in money.ts (removed); Task A uses it from a (a.ts), b (b.ts).");
  });
  it("tells when the Hub was last heard in words, never as a raw timestamp", () => {
    const now = Date.parse("2026-10-15T16:50:00.000Z");
    const status = (lastContact?: string) =>
      ({ lastContact }) as unknown as Parameters<typeof impactContactLabel>[0];
    expect(impactContactLabel(status("2026-10-15T16:47:00.000Z"), now)).toBe(
      "Last contact 3 min ago.",
    );
    expect(impactContactLabel(status("2026-10-15T16:50:10.000Z"), now)).toBe(
      "Last contact just now.",
    );
    expect(impactContactLabel(status(), now)).toBe("No impact contact yet.");
    expect(impactContactLabel(status("not a time"), now)).toBe("No impact contact yet.");
    expect(impactContactLabel(undefined, now)).toBe("No impact contact yet.");
  });
});

describe("when Impact's views show", () => {
  const plugins = [{ id: "impact", title: "Impact", enabled: true, active: true }];
  const status = (enabled?: boolean) =>
    ({
      plugins,
      ...(enabled === undefined ? {} : { impact: { enabled } }),
    }) as unknown as Parameters<typeof impactRunning>[0];
  it("hides them while the environment does not run Impact, so no list is asked for and fails", () => {
    expect(impactRunning(status(true))).toBe(true);
    // Agent coordination off: the plugin is on but idle; its list answers "off".
    expect(impactRunning(status(false))).toBe(false);
    // An environment that reports no Impact status keeps what the plugin list says.
    expect(impactRunning(status())).toBe(true);
    expect(
      impactRunning({
        plugins: [{ ...plugins[0]!, active: false }],
        impact: { enabled: true },
      } as never),
    ).toBe(false);
  });
});
