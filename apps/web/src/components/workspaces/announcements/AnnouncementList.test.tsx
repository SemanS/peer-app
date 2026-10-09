import { EnvironmentId, type PeerAnnouncementList, type PeerHubStatus } from "@t3tools/contracts";
import { act, type ButtonHTMLAttributes } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const list = vi.hoisted(() => ({
  data: null as PeerAnnouncementList | null,
  pending: false,
  listeners: new Set<() => void>(),
  refresh: vi.fn(),
}));
vi.mock("../../../state/query", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useEnvironmentQuery: () => {
      const data = useSyncExternalStore(
        (listener) => {
          list.listeners.add(listener);
          return () => list.listeners.delete(listener);
        },
        () => list.data,
      );
      return { data, isPending: list.pending, error: null, refresh: list.refresh };
    },
  };
});
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("./atoms", () => ({ announcementAtoms: { list: () => null, withdraw: null } }));
vi.mock("./AnnouncementReceipts", () => ({ AnnouncementReceipts: () => null }));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => null }));
vi.mock("../../ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import { AnnouncementList } from "./AnnouncementList";

const initial: PeerAnnouncementList = {
  at: "2026-10-09T19:28:00Z",
  announcements: [
    {
      id: "ann-e3",
      project: "cafe",
      author: { kind: "person", email: "author@example.test" },
      text: "Receipt totals must match checkout.",
      wake: true,
      status: "active",
      createdAt: "2026-10-09T19:28:00Z",
      expiresAt: "2026-10-09T20:28:00Z",
      counts: { waiting: 4, "not-following": 0, offered: 0, "model-input": 0, acknowledged: 0 },
    },
  ],
};
// The project revision does not change when another agent acknowledges an announcement.
const status = {
  workspaces: [],
  announcements: {
    unsupported: [],
    wake: true,
    projects: [{ workspace: "team", project: "cafe", active: 1, rev: "ann-e3" }],
  },
} as unknown as PeerHubStatus;

let renderer: ReactTestRenderer | null;
let page: EventTarget & { visibilityState: DocumentVisibilityState };
let environmentId: EnvironmentId;
let sequence = 0;

function publish(data: PeerAnnouncementList) {
  list.data = data;
  for (const listener of list.listeners) listener();
}
function render(recent = false) {
  return (
    <AnnouncementList
      environmentId={environmentId}
      status={status}
      workspace="team"
      project="cafe"
      recent={recent}
    />
  );
}
async function mount(recent = false) {
  await act(async () => {
    renderer = create(render(recent));
  });
}
async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}
function text() {
  return renderer!.root
    .findAllByType("p")
    .flatMap((node) => node.children)
    .join(" ");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(initial.at));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  page = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", new EventTarget());
  environmentId = EnvironmentId.make(`announcement-list-${++sequence}`);
  renderer = null;
  list.listeners.clear();
  list.pending = false;
  list.data = initial;
  list.refresh.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("announcement list receipt refresh", () => {
  it.each([false, true])(
    "updates ACK counts without a revision change (recent: %s)",
    async (recent) => {
      list.refresh.mockImplementation(() =>
        publish({
          ...initial,
          announcements: initial.announcements.map((row) => ({
            ...row,
            counts: { ...row.counts, waiting: 2, acknowledged: 2 },
          })),
        }),
      );
      await mount(recent);
      expect(text()).toContain("4 waiting for a step");
      await advance(14_999);
      expect(list.refresh).not.toHaveBeenCalled();
      await advance(1);
      expect(text()).toContain("2 waiting for a step");
      expect(text()).toContain("2 acknowledged");
    },
  );

  it("pauses while hidden or a read is pending and stops after expiry or unmount", async () => {
    await mount(true);
    await act(async () => {
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(30_000);
    expect(list.refresh).not.toHaveBeenCalled();
    await act(async () => {
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
    });
    expect(list.refresh).toHaveBeenCalledTimes(1);
    list.pending = true;
    await act(async () => renderer!.update(render(true)));
    await advance(30_000);
    expect(list.refresh).toHaveBeenCalledTimes(1);
    list.pending = false;
    await act(async () => renderer!.update(render(true)));
    await advance(15_000);
    expect(list.refresh).toHaveBeenCalledTimes(2);
    await act(async () =>
      publish({
        ...initial,
        announcements: initial.announcements.map((row) => ({ ...row, status: "expired" })),
      }),
    );
    await advance(30_000);
    expect(list.refresh).toHaveBeenCalledTimes(2);
    await act(async () => renderer!.unmount());
    renderer = null;
    await advance(30_000);
    expect(list.refresh).toHaveBeenCalledTimes(2);
  });

  it("does not poll recent terminal announcements", async () => {
    list.data = {
      ...initial,
      announcements: initial.announcements.map((row) => ({ ...row, status: "withdrawn" })),
    };
    await mount(true);
    await advance(60_000);
    expect(list.refresh).not.toHaveBeenCalled();
  });
});
