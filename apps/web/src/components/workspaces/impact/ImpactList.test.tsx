import { AuthOrchestrationOperateScope, EnvironmentId } from "@t3tools/contracts";
import type { PeerImpactRecord, PeerImpactView } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Read = {
  data: PeerImpactView | null;
  error: string | null;
  isPending: boolean;
  refresh: () => void;
};
const mocks = vi.hoisted(() => ({
  read: { current: undefined as unknown as Read },
  command: vi.fn(),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerImpactList: () => "list",
    peerImpactDismiss: "dismiss",
    peerImpactReopen: "reopen",
  },
}));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => mocks.read.current }));
vi.mock("../../../state/session", () => ({
  useEnvironmentSessionState: () => ({
    hasError: false,
    data: { authenticated: true, scopes: ["orchestration:operate"] },
  }),
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.command }));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => null }));

import { ImpactList } from "./ImpactList";

const record: PeerImpactRecord = {
  id: "abc",
  project: "shop",
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
const view = (state: PeerImpactRecord["state"]): PeerImpactView => ({
  provided: [],
  records: [{ ...record, state, ...(state === "dismissed" ? { dismissedBy: "ana@test" } : {}) }],
});
const status = {
  email: "ana@test",
  plugins: [{ id: "impact", active: true }],
  workspaces: [{ slug: "team", projects: [{ project: { id: "shop" } }] }],
  impact: { revision: 1 },
} as unknown as Parameters<typeof ImpactList>[0]["status"];

let renderer: ReactTestRenderer | null = null;
const element = () => (
  <ImpactList
    environmentId={EnvironmentId.make("env")}
    status={status}
    place={{ workspace: "team" }}
  />
);
const card = () => renderer!.root.findByType("details");
const text = () => JSON.stringify(renderer!.toJSON());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  expect(AuthOrchestrationOperateScope).toBe("orchestration:operate");
  mocks.command.mockReset();
  mocks.read.current = { data: view("open"), error: null, isPending: false, refresh: () => {} };
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("an impact overlap in a list", () => {
  it("stays open after Dismiss while the list is read again, and shows who dismissed it", async () => {
    await act(async () => {
      renderer = create(element());
    });
    expect(card().props.open).toBe(false);
    await act(async () => card().props.onToggle({ currentTarget: { open: true } }));
    expect(card().props.open).toBe(true);

    // Dismiss: the list is read again, which empties the query for a moment, then it answers.
    let refreshed = () => {};
    const done = new Promise<void>((resolve) => (refreshed = resolve));
    mocks.read.current = { ...mocks.read.current, refresh: () => refreshed() };
    await act(async () => renderer!.update(element()));
    mocks.command.mockImplementation(async () => {
      mocks.read.current = { data: null, error: null, isPending: true, refresh: () => {} };
      return { _tag: "Success" };
    });
    const dismiss = renderer!.root
      .findAllByType("button")
      .find((b) => b.children.includes("Dismiss"));
    await act(async () => {
      dismiss!.props.onClick();
      await done;
    });
    // The query atom pushes its new state to the list; the test renderer needs the push spelled out.
    await act(async () => renderer!.update(element()));
    expect(renderer!.root.findAllByType("details")).toEqual([]);
    mocks.read.current = {
      data: view("dismissed"),
      error: null,
      isPending: false,
      refresh: () => {},
    };
    await act(async () => renderer!.update(element()));

    expect(card().props.open).toBe(true);
    expect(text()).toContain("Dismissed by ");
    expect(text()).toContain("Reopen");
  });

  it("stays closed when the person did not open it", async () => {
    await act(async () => {
      renderer = create(element());
    });
    mocks.read.current = { data: null, error: null, isPending: true, refresh: () => {} };
    await act(async () => renderer!.update(element()));
    mocks.read.current = {
      data: view("dismissed"),
      error: null,
      isPending: false,
      refresh: () => {},
    };
    await act(async () => renderer!.update(element()));
    expect(card().props.open).toBe(false);
  });
});
