// @vitest-environment jsdom

import {
  EnvironmentId,
  PeerHubError,
  type PeerAgreement,
  type PeerAgreementsStatus,
  type PeerHubStatus,
  type PeerTask,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const NOW = vi.hoisted(() => Date.parse("2026-10-13T14:00:00Z"));

// What the Hub's view says (the one read a card or a section makes), and what was asked of it.
const read = vi.hoisted(() => ({
  asked: [] as unknown[],
  result: { data: null as unknown, error: null as string | null, isPending: false },
  refresh: vi.fn(),
  // The real query is a subscription: a new read re-renders the component that asked, memoized or not.
  listeners: new Set<() => void>(),
  answer(result: { data: unknown; error: string | null; isPending: boolean }) {
    this.result = result;
    for (const listener of this.listeners) listener();
  },
}));
// What the Hub answers to a close or a reopen, and what was sent.
const commands = vi.hoisted(() => ({
  sent: [] as Array<{ command: string; value: unknown }>,
  answer: (_command: string, _value: unknown): Promise<unknown> => Promise.resolve(undefined),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerAgreementsView: (target: unknown) => ({ peerAgreementsView: target }),
    peerAgreementsClose: "close",
    peerAgreementsReopen: "reopen",
  },
}));
vi.mock("../../../state/query", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    read.listeners.add(listener);
    return () => read.listeners.delete(listener);
  };
  return {
    useEnvironmentQuery: (atom: unknown) => {
      read.asked.push(atom);
      const result = useSyncExternalStore(subscribe, () => read.result);
      return { ...result, refresh: read.refresh };
    },
  };
});
vi.mock("../../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (value: unknown) => {
    commands.sent.push({ command, value });
    return commands.answer(command, value);
  },
}));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => NOW }));
vi.mock("../PeerPageHeader", () => ({
  PeerSectionLabel: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key] ?? "")} {...props}>
      {children}
    </a>
  ),
}));

import { AgreementsNeedsYou } from "./AgreementsNeedsYou";
import { AgreementsSection } from "./AgreementsSection";

const environmentId = EnvironmentId.make("mac");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const task = (id: string, key: string, title: string): PeerTask => ({
  id,
  key,
  title,
  status: "open",
  createdBy: "ana@acme.test",
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-01T09:00:00Z",
});

/** Bob's status, with the lab project of the acme workspace open in it. */
const statusOf = (
  agreements?: Partial<PeerAgreementsStatus["workspaces"][number]>,
): PeerHubStatus =>
  ({
    email: "bob@acme.test",
    signedIn: true,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        projects: [
          {
            project: {
              id: "lab",
              name: "Lab",
              role: "member",
              members: [
                { email: "ana@acme.test", name: "Ana" },
                { email: "bob@acme.test", name: "Bob" },
              ],
            },
            work: {
              areas: [],
              tasks: [
                task("krk-1", "KRK-1", "Round prices"),
                task("krk-2", "KRK-2", "Loyalty points"),
              ],
              threads: [],
            },
          },
        ],
      },
    ],
    ...(agreements === undefined
      ? {}
      : {
          agreements: {
            enabled: true,
            forcedOff: false,
            hubSupport: "supported",
            workspaces: [{ workspace: "acme", open: 1, dueForMe: [], ...agreements }],
          },
        }),
  }) as unknown as PeerHubStatus;

const agreement = (id: string, over: Partial<PeerAgreement> = {}): PeerAgreement => ({
  id,
  project: "lab",
  tasks: ["krk-1", "krk-2"],
  words: "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
  by: { email: "bob@acme.test", task: "krk-2" },
  settledAt: hoursAgo(2),
  sides: [
    { session: "claude:abc", environment: "env-a", email: "ana@acme.test", task: "krk-1" },
    { session: "codex:def", environment: "env-b", email: "bob@acme.test", task: "krk-2" },
  ],
  state: "open",
  landed: [],
  ...over,
});
const due = (id: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, { state: "due", dueFor: "krk-2", landed: ["krk-1"], ...over });
const closedByAna = (id: string, why: string, over: Partial<PeerAgreement> = {}) =>
  agreement(id, {
    state: "closed",
    closed: { at: hoursAgo(1), by: "ana@acme.test", why },
    ...over,
  });
const view = (...agreements: ReadonlyArray<PeerAgreement>) => ({
  agreements,
  at: "2026-10-13T14:00:00Z",
});

/** Bob has one due agreement waiting on KRK-2, and the Hub's view holds it. */
const waiting = statusOf({ open: 2, dueForMe: [{ project: "lab", id: "a1" }] });

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  read.asked.length = 0;
  read.result = { data: null, error: null, isPending: false };
  read.refresh.mockClear();
  commands.sent.length = 0;
  commands.answer = () => Promise.resolve(AsyncResult.success({ agreement: agreement("a1") }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const show = (ui: ReactNode) => act(async () => root.render(ui));
const text = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
const press = (label: string) => act(async () => button(label)?.click());
const links = () =>
  [...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]);
const alerts = () =>
  [...container.querySelectorAll("[role=alert]")].map((alert) => alert.textContent);
const refused = (error: unknown) => AsyncResult.failure(Cause.fail(error));

const needsYou = (status: PeerHubStatus = waiting) => (
  <AgreementsNeedsYou environmentId={environmentId} status={status} plugins={[]} />
);

describe("the agreements that wait on the person in Needs you", () => {
  it("shows the task, the one that landed, who settled it and when, and the words, with what to do", async () => {
    read.result.data = view(due("a1"));
    await show(needsYou());
    for (const line of [
      "Agreement due — KRK-1 landed",
      "KRK-2 · Loyalty points",
      "Settled 2 h ago by your agent on KRK-2",
      "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
    ])
      expect(text()).toContain(line);
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Handled",
    ]);
    expect(links()).toEqual([["Open task", "/task/acme/lab/krk-2"]]);
  });

  it("reads the project's agreements, again whenever the status field's revision moves", async () => {
    read.result.data = view(due("a1"));
    await show(needsYou());
    expect(read.asked.at(-1)).toEqual({
      peerAgreementsView: {
        environmentId,
        input: { workspace: "acme", project: "lab" },
        revision: "2|lab/a1",
      },
    });
    await show(needsYou(statusOf({ open: 3, dueForMe: [{ project: "lab", id: "a1" }] })));
    expect(read.asked.at(-1)).toMatchObject({ peerAgreementsView: { revision: "3|lab/a1" } });
  });

  it("renders the words as text, never as markup or a link of its own", async () => {
    const hostile = "<img src=x onerror=alert(1)> [pay now](https://evil.example) **bold**";
    read.result.data = view(due("a1", { words: hostile }));
    await show(needsYou());
    expect(text()).toContain(hostile);
    expect(container.querySelector("img, script, b, strong")).toBeNull();
    expect(links()).toEqual([["Open task", "/task/acme/lab/krk-2"]]);
  });

  it("is absent while nothing waits, and then reads nothing", async () => {
    read.result.data = view(due("a1"));
    await show(needsYou(statusOf({ open: 1, dueForMe: [] })));
    expect(container.innerHTML).toBe("");
    await show(needsYou(statusOf()));
    expect(container.innerHTML).toBe("");
    expect(read.asked).toEqual([]);
  });

  it("closes it as handled on Handled, and leaves the card to the status refresh", async () => {
    read.result.data = view(due("a1"));
    await show(needsYou());
    await press("Handled");
    expect(commands.sent).toEqual([
      {
        command: "close",
        value: {
          environmentId,
          input: { workspace: "acme", project: "lab", id: "a1", why: "handled" },
        },
      },
    ]);
    expect(read.refresh).toHaveBeenCalledTimes(1);
    // The Hub has answered, but only the status says the agreement no longer waits.
    expect(text()).toContain("KRK-2 · Loyalty points");
    await show(needsYou(statusOf({ open: 1, dueForMe: [] })));
    expect(container.innerHTML).toBe("");
  });

  it("keeps the card and says why when the Hub refuses, and lets the person try again", async () => {
    read.result.data = view(due("a1"));
    commands.answer = () =>
      Promise.resolve(
        refused(
          new PeerHubError({ code: "forbidden", detail: "only project members may do this" }),
        ),
      );
    await show(needsYou());
    await press("Handled");
    expect(alerts()).toEqual(["only project members may do this"]);
    expect(text()).toContain("KRK-2 · Loyalty points");
    expect(button("Handled")?.disabled).toBe(false);
    expect(read.refresh).not.toHaveBeenCalled();
    commands.answer = () => Promise.resolve(AsyncResult.success({ agreement: agreement("a1") }));
    await press("Handled");
    expect(alerts()).toEqual([]);
    expect(commands.sent).toHaveLength(2);
  });

  it("says the agreement changed when it did, and reads it again", async () => {
    read.result.data = view(due("a1"));
    commands.answer = () =>
      Promise.resolve(
        refused(new PeerHubError({ code: "agreement_state", detail: "agreement is closed" })),
      );
    await show(needsYou());
    await press("Handled");
    expect(alerts()).toEqual(["This agreement changed since you opened it, so nothing was done."]);
    expect(read.refresh).toHaveBeenCalledTimes(1);
  });

  it("turns Handled off while the Hub has not answered", async () => {
    read.result.data = view(due("a1"));
    let answer!: (value: unknown) => void;
    commands.answer = () => new Promise((resolve) => (answer = resolve));
    await show(needsYou());
    await press("Handled");
    expect(button("Handled")?.disabled).toBe(true);
    await press("Handled");
    expect(commands.sent).toHaveLength(1);
    await act(async () => answer(AsyncResult.success({ agreement: agreement("a1") })));
    expect(button("Handled")?.disabled).toBe(false);
  });

  it("has no card for what the Hub's view holds as closed or not due", async () => {
    read.result.data = view(closedByAna("a1", "handled", { dueFor: "krk-2" }));
    await show(needsYou());
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(text()).not.toContain("Loading agreements…");
  });

  it("says it is loading before the first read arrives, and when it could not read", async () => {
    await show(needsYou());
    expect(container.querySelector("[role=status]")?.textContent).toBe("Loading agreements…");
    await act(async () =>
      read.answer({ data: null, error: "The environment request failed.", isPending: false }),
    );
    expect(alerts()).toEqual(["The environment request failed."]);
    expect(text()).not.toContain("Loading agreements…");
    await press("Retry");
    expect(read.refresh).toHaveBeenCalledTimes(1);
  });
});

const section = (over: Partial<Parameters<typeof AgreementsSection>[0]> = {}) => (
  <AgreementsSection
    environmentId={environmentId}
    status={statusOf({ open: 2 })}
    workspace="acme"
    project="lab"
    scope="task:krk-2"
    contextText={null}
    {...over}
  />
);

describe("the Agreements section of a task's context page", () => {
  it("lists each agreement with the other task, who settled it and when, its state and the words", async () => {
    read.result.data = view(due("a1"), closedByAna("a2", "handled", { settledAt: hoursAgo(30) }));
    await show(section());
    for (const line of [
      "Agreements",
      "With KRK-1 · Round prices",
      "Due — KRK-1 landed",
      "Settled 2 h ago by your agent on KRK-2",
      "Closed · handled by Ana · 1 h ago",
      "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
    ])
      expect(text()).toContain(line);
    expect(links()).toEqual([
      ["KRK-1 · Round prices", "/task/acme/lab/krk-1"],
      ["KRK-1 · Round prices", "/task/acme/lab/krk-1"],
    ]);
  });

  it("reads the project's agreements, again whenever the status field's revision moves", async () => {
    read.result.data = view(due("a1"));
    await show(section());
    expect(read.asked.at(-1)).toEqual({
      peerAgreementsView: {
        environmentId,
        input: { workspace: "acme", project: "lab" },
        revision: "2|",
      },
    });
  });

  it("renders the words as text, never as markup", async () => {
    const hostile = "<script>alert(1)</script> **bold** [x](https://evil.example)";
    read.result.data = view(agreement("a1", { words: hostile }));
    await show(section());
    expect(text()).toContain(hostile);
    expect(container.querySelector("script, b, strong")).toBeNull();
    expect(links()).toEqual([["KRK-1 · Round prices", "/task/acme/lab/krk-1"]]);
  });

  it("offers Close, as handled or not needed, to an open or due agreement", async () => {
    read.result.data = view(agreement("a1"), closedByAna("a2", "handled"));
    await show(section());
    expect(button("Reopen")).toBeDefined();
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Handled",
      "Not needed",
      "Reopen",
    ]);
    await press("Not needed");
    expect(commands.sent).toEqual([
      {
        command: "close",
        value: {
          environmentId,
          input: { workspace: "acme", project: "lab", id: "a1", why: "not-needed" },
        },
      },
    ]);
    await press("Handled");
    expect(commands.sent.at(-1)).toMatchObject({
      command: "close",
      value: { input: { id: "a1", why: "handled" } },
    });
    expect(read.refresh).toHaveBeenCalledTimes(2);
  });

  it("offers Reopen only to one a person closed while no task landed, and reopens it", async () => {
    read.result.data = view(
      closedByAna("a1", "handled"),
      agreement("a2", { state: "closed", closed: { at: hoursAgo(1), why: "expired" } }),
      closedByAna("a3", "handled", { landed: ["krk-1"] }),
    );
    await show(section());
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Reopen"]);
    await press("Reopen");
    expect(commands.sent).toEqual([
      {
        command: "reopen",
        value: { environmentId, input: { workspace: "acme", project: "lab", id: "a1" } },
      },
    ]);
    expect(read.refresh).toHaveBeenCalledTimes(1);
  });

  it("says why a close was refused beside the agreement that was refused", async () => {
    read.result.data = view(agreement("a1"), agreement("a2", { tasks: ["krk-2", "krk-3"] }));
    commands.answer = () =>
      Promise.resolve(
        refused(new PeerHubError({ code: "forbidden", detail: "not on the project" })),
      );
    await show(section());
    await press("Handled");
    expect(alerts()).toEqual(["not on the project"]);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("li")[0]?.textContent).toContain("not on the project");
    expect(container.querySelectorAll("li")[1]?.textContent).not.toContain("not on the project");
  });

  it("is absent where the task has no agreement, and before the first read arrives", async () => {
    read.result.data = view(agreement("a1", { tasks: ["krk-1", "krk-3"] }));
    await show(section());
    expect(container.innerHTML).toBe("");
    read.result = { data: null, error: null, isPending: true };
    await show(section());
    expect(container.innerHTML).toBe("");
  });

  it("is absent on the project's shared context, which no task owns, and then reads nothing", async () => {
    read.result.data = view(due("a1"));
    await show(section({ scope: "project" }));
    expect(container.innerHTML).toBe("");
    expect(read.asked).toEqual([]);
  });

  it("holds the agreements on screen while the next read arrives, and never another task's", async () => {
    read.result.data = view(due("a1"));
    await show(section());
    read.result = { data: null, error: null, isPending: true };
    await show(section({ status: statusOf({ open: 3 }) }));
    expect(text()).toContain("Due — KRK-1 landed");
    await show(section({ scope: "task:krk-3", status: statusOf({ open: 3 }) }));
    expect(container.innerHTML).toBe("");
  });

  it("says when agreements could not be read, and reads again on Retry", async () => {
    read.result = { data: null, error: "The environment request failed.", isPending: false };
    await show(section());
    expect(alerts()).toEqual(["The environment request failed."]);
    await press("Retry");
    expect(read.refresh).toHaveBeenCalledTimes(1);
  });
});
