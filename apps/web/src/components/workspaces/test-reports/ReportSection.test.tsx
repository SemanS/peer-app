import type { PeerHubStatus, PeerTestReport } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ANA, CYRIL, EVA, slotProps } from "../ownership/ownership.testkit";

const hub = vi.hoisted(() => ({
  reports: [] as unknown[],
  setOwner: vi.fn(),
  refresh: vi.fn(),
  allowed: true,
}));

vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerTestsList: (query: unknown) => query,
    peerTestsFile: { name: "file", permissionAtom: () => "allowed" },
    peerTestsRemove: { name: "remove", permissionAtom: () => "allowed" },
    peerTestsSetOwner: { name: "setOwner", permissionAtom: () => "allowed" },
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => hub.allowed }));
vi.mock("../../../state/use-atom-command", () => ({
  useAtomCommand: (atom: { name: string }) => (atom.name === "setOwner" ? hub.setOwner : vi.fn()),
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: hub.reports, error: null, refresh: hub.refresh }),
}));
vi.mock("../../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: async () => true } }),
}));

import { ReportSection } from "./ReportSection";

const ANAS: PeerTestReport = {
  project: "ordering",
  task: "vl7",
  author: ANA,
  number: 2,
  result: "mixed",
  summary: "Unit tests pass; the phone was not checked",
  items: [
    {
      kind: "pass",
      text: "cargo test features::handoff",
      seen: { failed: false, at: "2026-10-12T14:02:00Z" },
    },
    { kind: "pass", text: "manual check of the login flow" },
    { kind: "unverified", text: "iPhone layout" },
  ],
  role: "author",
  at: "2026-10-12T14:05:00Z",
};
const CYRILS: PeerTestReport = {
  ...ANAS,
  author: CYRIL,
  number: 1,
  result: "pass",
  role: "review",
  items: [{ kind: "pass", text: "vp test run x.test.ts" }],
  at: "2026-10-12T13:00:00Z",
};

let renderer: ReactTestRenderer | null = null;
const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const buttons = () => renderer!.root.findAllByType("button").map(words);
const ownerSelects = () =>
  renderer!.root.findAll(
    (node) => typeof node.type !== "string" && typeof node.props.onValueChange === "function",
  );

async function show(email: string) {
  const props = slotProps(email, "vl7");
  await act(async () => {
    renderer = create(<ReportSection {...props} status={props.status as PeerHubStatus} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hub.reports = [CYRILS, ANAS];
  hub.setOwner.mockReset();
  hub.refresh.mockReset();
  hub.allowed = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("a task's test reports", () => {
  it("lists every report newest first, with where each claim comes from", async () => {
    await show(CYRIL);
    const text = words(renderer!.root);
    expect(text.indexOf("Report 2")).toBeLessThan(text.indexOf("Report 1"));
    expect(text).toMatch(/seen run by Peer, passed, \d\d:\d\d/u);
    expect(text).toContain("author-reported");
    expect(text).toContain("You · review session");
    expect(text).toContain("Needs an owner");
  });

  it("offers Replace and Remove on the person's own report only", async () => {
    await show(CYRIL);
    expect(buttons().filter((label) => label === "Replace")).toHaveLength(1);
    expect(buttons().filter((label) => label === "Remove")).toHaveLength(1);
    expect(buttons()).not.toContain("File a report");
  });

  it("offers to file a report to someone who has none", async () => {
    await show(EVA);
    expect(buttons()).toContain("File a report");
    expect(buttons()).not.toContain("Replace");
  });

  it("gives the owner picker to the task's owner and a lead, not to another member", async () => {
    await show(CYRIL);
    expect(ownerSelects()).toHaveLength(0);
    await act(async () => renderer?.unmount());
    await show(ANA);
    expect(ownerSelects()).toHaveLength(1);
    await act(async () => renderer?.unmount());
    await show(EVA);
    expect(ownerSelects()).toHaveLength(1);
  });

  it("names the newer report when a save was made from a replaced one", async () => {
    hub.setOwner.mockResolvedValue(
      AsyncResult.success({ kind: "stale", number: 3, report: { ...ANAS, number: 3 } }),
    );
    await show(ANA);
    await act(async () => ownerSelects()[0]!.props.onValueChange(EVA));
    expect(hub.setOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ author: ANA, index: 2, number: 2, owner: EVA }),
      }),
    );
    const notices = renderer!.root
      .findAll((node) => node.type === "p" && node.props.role === "status")
      .map(words);
    expect(notices.join(" ")).toContain("report 3 replaced the one you assigned from");
    expect(hub.refresh).toHaveBeenCalled();
  });
});
