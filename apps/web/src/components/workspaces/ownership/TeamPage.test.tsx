import type { PeerCoordEvent } from "@t3tools/contracts";
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  work: { current: null as unknown },
  history: {
    data: null as unknown,
    error: null as string | null,
    refresh: vi.fn(),
    isPending: false,
    isSuccess: true,
    dataUpdatedAt: 0,
  },
  command: vi.fn(),
  navigate: vi.fn(),
  openSettings: vi.fn(),
  pick: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock("../useWorkData", () => ({ useWorkData: () => mocks.work.current }));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => mocks.history }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerHubCoordEvents: () => null,
    peerOwnership: { setMap: null, decide: null, setTaskOwner: null, withdraw: null },
  },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.command }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a data-to={to} data-params={JSON.stringify(params)} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("../PeerPageHeader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../PeerPageHeader")>()),
  PeerPageHeader: ({
    project,
    page,
    state,
  }: {
    project?: { name: string };
    page: ReactNode;
    state?: { label: ReactNode; tone: string };
  }) => (
    <header data-header>
      <span data-project>{project?.name}</span>
      <span data-page>{page}</span>
      <span data-state={state?.tone}>{state?.label}</span>
    </header>
  ),
}));
vi.mock("../../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => NOW }));
vi.mock("../settings/peerSettingsLinks", () => ({ useOpenPeerSettings: () => mocks.openSettings }));
vi.mock("../useWorkActions", () => ({ below: () => ({ x: 0, y: 0 }), pickFromMenu: mocks.pick }));
vi.mock("./ownerDialog", () => ({ openOwnerDialog: mocks.dialog }));
vi.mock("./OwnerCallDecision", () => ({
  OwnerCallDecision: (props: Record<string, unknown>) => <div data-decision-dialog {...props} />,
}));
vi.mock("../../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactElement }) => render,
  TooltipPopup: () => null,
}));
vi.mock("../../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  PopoverPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
}));

import { TeamPage } from "./TeamPage";
import {
  ANA,
  BOB,
  CYRIL,
  ENV,
  EVA,
  NOW,
  coordSession,
  hubTask,
  minutesAgo,
  ownerCall,
  statusFor,
  teamProject,
  workThread,
  type Looking,
} from "./ownership.testkit";
import type { PeerWebPlugin } from "../slots.types";

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ordering as the Hub tells it to everyone: four members, Eva leads; chats, requests and sessions of its own. */
const TASKS = [
  hubTask("vl7", { title: "Receipt totals in cents", area: "Payments" }),
  hubTask("vl9", { title: "Refund fee field", area: "Payments" }),
  hubTask("vl10", { title: "Checkout copy", area: "Payments" }),
  hubTask("vl11", { title: "Menu photos", area: "Menu" }),
];
const THREADS = [
  workThread("t1", "vl9", BOB, "working"),
  workThread("t2", "vl9", BOB, "working"),
  workThread("t3", "vl7", ANA, "idle"),
  workThread("t4", "vl11", CYRIL, "blocked"),
];
const REQUESTS = [
  {
    workspace: "acme",
    request: {
      id: "r1",
      project: "ordering",
      task: "vl9",
      sender: ANA,
      recipient: BOB,
      title: "SECRET request title",
      prompt: "SECRET request prompt",
      status: "pending",
      createdAt: minutesAgo(300),
      updatedAt: minutesAgo(300),
    },
  },
] as unknown as Looking["requests"];
const WORLD: Looking = {
  tasks: TASKS,
  threads: THREADS,
  requests: REQUESTS,
  sessions: [
    coordSession("claude:b1", BOB, "vl9", {
      files: ["src/payments/fees.ts"],
      activeAt: minutesAgo(5),
    }),
  ],
};

const event = (kind: string, minutes: number, id: string, extra: Partial<PeerCoordEvent> = {}) =>
  ({
    id,
    kind,
    project: "ordering",
    at: minutesAgo(minutes),
    paths: [],
    participants: [],
    ...extra,
  }) as PeerCoordEvent;

interface Show {
  readonly viewer?: string;
  readonly looking?: Looking;
  readonly view?: "team" | "owner-map";
  readonly events?: ReadonlyArray<PeerCoordEvent> | null;
  readonly plugins?: ReadonlyArray<PeerWebPlugin>;
  /** Peer has not yet listed the project: what a person not on it sees. */
  readonly project?: string;
  readonly tree?: "missing";
}

async function show({
  viewer = EVA,
  looking = WORLD,
  view = "team",
  events = [],
  plugins = [],
  project = "ordering",
  tree,
}: Show = {}) {
  const status = { ...statusFor(viewer, looking), lastSyncAt: minutesAgo(0) };
  mocks.work.current = {
    environmentId: ENV,
    status,
    plugins,
    tree: tree === "missing" ? [] : [teamProject(viewer, looking)],
    needs: [],
    now: NOW,
  };
  mocks.history.data = events;
  await act(async () => {
    renderer = create(<TeamPage workspace="acme" project={project} view={view} />);
  });
}

const page = () => words(renderer!.root);
const buttons = () => renderer!.root.findAllByType("button");
const button = (label: string) => buttons().find((candidate) => words(candidate) === label);
const section = (label: string) => renderer!.root.findByProps({ "aria-label": label });
/** Everything the page draws, as the renderer holds it: text, labels and every other prop. */
const everything = () => JSON.stringify(renderer!.toJSON());
/** The row of a task on the board: the first list item that starts with its key. */
const row = (key: string) =>
  renderer!.root.findAll((node) => node.type === "li" && words(node).startsWith(`${key} `))[0]!;
/** The picker under a label, which is the Select: the node that takes the choice. */
const picker = (label: string) =>
  renderer!.root
    .findAll((node) => node.type === "label" && words(node).startsWith(label))[0]!
    .find((node) => typeof node.props.onValueChange === "function");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { visibilityState: "visible" });
  for (const mock of [
    mocks.command,
    mocks.navigate,
    mocks.openSettings,
    mocks.pick,
    mocks.dialog,
    mocks.history.refresh,
  ]) {
    mock.mockReset();
  }
  mocks.history.error = null;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.useRealTimers();
});

const CALL = ownerCall({ createdAt: minutesAgo(40) });

describe("every member's Team page", () => {
  it("opens for a member of the project, with its people, signals, areas, owner map and timeline", async () => {
    await show();
    for (const label of [
      "People",
      "Needs a person",
      "Areas and tasks",
      "Owner map",
      "Who decided what",
    ]) {
      expect(section(label), label).toBeDefined();
    }
    expect(page()).toContain("What the team's agents are doing, from facts Peer keeps.");
    expect(page()).toContain(
      "Other people's chats are counted, never listed. Requests and personal metrics stay out.",
    );
    expect(renderer!.root.findByProps({ "data-project": true }).children).toEqual([
      "Ordering demo",
    ]);
  });

  it("says the project is not available to someone who is not on it, and shows nothing of it", async () => {
    await show({ project: "payments", tree: "missing" });
    expect(page()).toContain("This project is not available to you.");
    for (const label of ["People", "Areas and tasks", "Owner map", "Who decided what"]) {
      expect(renderer!.root.findAllByProps({ "aria-label": label }), label).toEqual([]);
    }
    expect(page()).not.toContain("Refund fee field");
    expect(renderer!.root.findByProps({ "data-project": true }).children).toEqual([]);
  });

  it("waits while Peer has not synced, and says so when ownership of the project is not read yet", async () => {
    await show({ looking: { ...WORLD, ownership: null } });
    expect(page()).toContain("Ownership for this project has not been read from Peer Hub yet.");
    expect(renderer!.root.findAllByProps({ "aria-label": "People" })).toEqual([]);
  });

  it("says in its header that this computer coordinates and how old the Hub's view is", async () => {
    await show({
      looking: { ...WORLD, ownership: { at: new Date(NOW - 8_000).toISOString() } },
    });
    const state = renderer!.root.findByProps({ "data-state": "delivery" });
    expect(words(state)).toBe("Coordination on this computer · view 8 s old");
  });
});

describe("what the page never shows", () => {
  it("counts Bob's two chats on VL9 for Bob, without their titles", async () => {
    await show();
    expect(words(row("VL9"))).toContain("Bob · 2 working");
    const bob = section("People")
      .findAllByType("li")
      .find((card) => words(card).startsWith("B Bob"))!;
    expect(words(bob)).toContain("2 agents at work");
    expect(everything()).not.toContain("SECRET");
  });

  it("shows nothing of a request between two people, nor of a session's label", async () => {
    await show({ viewer: CYRIL });
    expect(everything()).not.toContain("SECRET");
    // The page says that requests stay out; it names none, and none shows among the facts.
    const body = page().replace("Requests and personal metrics stay out.", "");
    expect(body).not.toMatch(/request/i);
  });

  it("shows nothing of a chat to a colleague who looks, whoever's it is", async () => {
    for (const viewer of [ANA, BOB, CYRIL, EVA]) {
      await show({ viewer });
      expect(everything(), viewer).not.toContain("SECRET");
      await act(async () => renderer!.unmount());
    }
  });
});

describe("the people strip", () => {
  const BUSY: Looking = {
    ...WORLD,
    tasks: [
      hubTask("vl7", { title: "Receipt totals in cents", area: "Payments", status: "review" }),
      hubTask("vl8", { title: "Tax rounding", area: "Payments", status: "review" }),
      ...TASKS.slice(1),
    ],
  };

  it("shows each person's agents, tasks and what waits on them: two reviews wait on Ana", async () => {
    await show({ looking: BUSY });
    const cards = section("People")
      .findAllByType("li")
      .map((card) => words(card));
    expect(cards).toHaveLength(4);
    expect(cards[0]).toBe("E Eva You · lead No agents at work Owns no tasks Nothing waits");
    expect(cards.find((card) => card.includes("Ana"))).toContain("2 wait on Ana");
    expect(cards.find((card) => card.includes("Ana"))).toContain("Owns 3 tasks · area Payments");
    expect(cards.find((card) => card.includes("Bob"))).toContain("2 agents at work");
    expect(cards.find((card) => card.includes("Cyril"))).toContain("1 agent waits for Cyril");
  });
});

describe("areas and tasks with their owners", () => {
  it("shows an area with its owner, each task with its owner and state, and a change in the owner's path", async () => {
    await show();
    const payments = section("Payments");
    expect(words(payments)).toContain("A Ana Ana decides changes by others in src/payments/**");
    expect(words(row("VL7"))).toContain("Owner Ana");
    expect(words(row("VL9"))).toContain("Owner Bob");
    expect(words(row("VL9"))).toContain("In progress");
    expect(words(row("VL9"))).toContain("Push stopped: needs Ana's call");
    expect(words(row("VL10"))).toContain("Owned through Payments · Ana");
    // A task nobody owns, and an area nobody owns, say so.
    expect(words(row("VL11"))).toContain("No owner");
    expect(words(section("Menu"))).toContain("– No owner");
  });

  it("opens a task from its title", async () => {
    await show();
    const link = row("VL9").findByProps({ "data-to": "/task/$workspace/$project/$task" });
    expect(JSON.parse(link.props["data-params"])).toEqual({
      workspace: "acme",
      project: "ordering",
      task: "vl9",
    });
  });

  it("adds a plugin's one fact to a task's row, and nothing while the plugin is off", async () => {
    const plans: PeerWebPlugin = {
      id: "dependencies",
      teamTaskFacts: ({ task }) =>
        task.id === "vl9"
          ? { id: "plans", text: "Plans: meets VL11 on applyTax", tone: "knowledge" }
          : undefined,
    };
    await show({ plugins: [plans] });
    expect(words(row("VL9"))).toContain("Plans: meets VL11 on applyTax");
    expect(words(row("VL7"))).not.toContain("Plans");
    await act(async () => renderer!.unmount());
    await show({ plugins: [] });
    expect(page()).not.toContain("Plans:");
  });

  it("says how a task came to have no owner, when the history shows it", async () => {
    await show({
      events: [
        event("task-owner", 120, "e1", {
          email: EVA,
          task: "vl11",
          participants: ["task:vl11", `owner:${EVA}`, "reason:first-agent"],
        }),
        event("task-owner", 100, "e2", {
          email: EVA,
          task: "vl11",
          participants: ["task:vl11", "owner:none", "reason:cleared"],
        }),
      ],
    });
    expect(words(row("VL11"))).toContain("Given back by Eva");
  });
});

describe("naming a task's owner from the page", () => {
  it("offers a lead to set the owner of any task on its row, in the task page's own dialog", async () => {
    await show();
    const set = row("VL9").findByProps({ "aria-label": "Set owner of VL9" });
    await act(async () => set.props.onClick());
    expect(mocks.dialog).toHaveBeenCalledWith({
      kind: "set",
      environmentId: ENV,
      workspace: "acme",
      project: "ordering",
      task: "vl9",
    });
    expect(
      section("Areas and tasks").findAll((node) =>
        String(node.props["aria-label"] ?? "").startsWith("Set owner of "),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("offers a workspace admin the same, and a member nothing", async () => {
    await show({ viewer: CYRIL, looking: { ...WORLD, workspace: "admin" } });
    expect(row("VL9").findAllByProps({ "aria-label": "Set owner of VL9" }).length).toBeGreaterThan(
      0,
    );
    await act(async () => renderer!.unmount());
    await show({ viewer: BOB });
    expect(page()).not.toContain("Set owner…");
  });
});

describe("a call the team can read", () => {
  it("shows a project member Bob's pending call to Ana with its paths and reason, though no signal yet", async () => {
    const fresh = ownerCall({ createdAt: minutesAgo(5) });
    await show({ viewer: CYRIL, looking: { ...WORLD, ownership: { calls: [fresh] } } });
    // Five minutes is not yet something that needs a person: the call is among the task's facts.
    expect(words(section("Needs a person"))).not.toContain("waits for Ana's call");
    const said = words(row("VL9"));
    expect(said).toContain("Waiting on Ana's call");
    expect(said).toContain("Bob's agent asked Ana to change a path they decide");
    expect(said).toContain(
      "src/payments/fees.ts · Ana decides changes by others in src/payments/**",
    );
    expect(said).toContain("Reason from Bob's agent: “add a refund fee field”");
    expect(said).toContain("Asked 5 min ago · expires in 6 days");
  });

  it("opens what the call says from its badge, for a member who cannot decide it", async () => {
    await show({ viewer: CYRIL, looking: { ...WORLD, ownership: { calls: [CALL] } } });
    expect(
      buttons().find((candidate) => words(candidate) === "Waiting on Ana's call"),
    ).toBeDefined();
    // Deciding is for the owner, from their Needs you or the task's page: no button here.
    expect(button("Accept…")).toBeUndefined();
    expect(button("Decide")).toBeUndefined();
  });
});

describe("what needs a person", () => {
  const WAITING: Looking = { ...WORLD, ownership: { calls: [CALL] } };

  it("lists a call that has waited 40 minutes, and opens the task for those who do not decide it", async () => {
    await show({ looking: WAITING });
    const signals = words(section("Needs a person"));
    expect(signals).toContain("Bob's agent waits for Ana's call");
    expect(signals).toContain("VL9 · src/payments/fees.ts · “add a refund fee field”");
    expect(signals).toContain("40 min");
    await act(async () => button("Open task")!.props.onClick({ currentTarget: {} }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/task/$workspace/$project/$task",
      params: { workspace: "acme", project: "ordering", task: "vl9" },
    });
  });

  it("opens the call in the owner's view: Ana accepts or declines it from the page", async () => {
    mocks.pick.mockResolvedValue("accept");
    await show({ viewer: ANA, looking: WAITING });
    await act(async () => button("Decide")!.props.onClick({ currentTarget: {} }));
    expect(mocks.pick).toHaveBeenCalledWith(
      [
        { id: "accept", label: "Accept…" },
        { id: "decline", label: "Decline…" },
      ],
      { x: 0, y: 0 },
    );
    const dialog = renderer!.root.findByProps({ "data-decision-dialog": true });
    expect(dialog.props).toMatchObject({
      workspace: "acme",
      project: "ordering",
      asker: "Bob",
      owner: "Ana",
      onBehalf: false,
      task: "VL9",
      decision: "accept",
      call: expect.objectContaining({ id: "call-1" }),
    });
    await act(async () => dialog.props.onClose());
    expect(renderer!.root.findAllByProps({ "data-decision-dialog": true })).toEqual([]);
  });

  it("does nothing when the person leaves the decision menu without choosing", async () => {
    mocks.pick.mockResolvedValue(null);
    await show({ viewer: ANA, looking: WAITING });
    await act(async () => button("Decide")!.props.onClick({ currentTarget: {} }));
    expect(renderer!.root.findAllByProps({ "data-decision-dialog": true })).toEqual([]);
  });

  it("lets a lead name the owner of a task with agents at work and none to own it", async () => {
    await show({
      looking: {
        ...WORLD,
        threads: [...THREADS, workThread("t9", "vl11", BOB, "working")],
      },
    });
    expect(words(section("Needs a person"))).toContain("VL11 has an agent at work and no owner");
    await act(async () => button("Set owner")!.props.onClick({ currentTarget: {} }));
    expect(mocks.dialog).toHaveBeenCalledWith({
      kind: "set",
      environmentId: ENV,
      workspace: "acme",
      project: "ordering",
      task: "vl11",
    });
  });

  it("says nothing waits for a person where no condition holds", async () => {
    await show({
      looking: {
        ...WORLD,
        tasks: [TASKS[0]!],
        threads: [workThread("t3", "vl7", ANA, "idle")],
        sessions: [],
      },
    });
    expect(words(section("Needs a person"))).toBe("Needs a person Nothing waits for a person.");
  });

  it("adds what a plugin says needs a person, after the page's own", async () => {
    const plans: PeerWebPlugin = {
      id: "dependencies",
      teamSignals: () => [
        {
          id: "meets",
          what: "VL9 and VL11 plan the same function",
          detail: "applyTax",
          action: { label: "Open plans", open: (navigate) => void navigate({ to: "/work" }) },
        },
      ],
    };
    await show({ looking: WAITING, plugins: [plans] });
    const signals = words(section("Needs a person"));
    expect(signals.indexOf("Bob's agent waits")).toBeLessThan(
      signals.indexOf("VL9 and VL11 plan the same function"),
    );
    await act(async () => button("Open plans")!.props.onClick());
    expect(mocks.navigate).toHaveBeenLastCalledWith({ to: "/work" });
  });
});

describe("who decided what", () => {
  const HISTORY = [
    event("owner-call", 40, "e1", {
      email: BOB,
      session: "claude:b1",
      task: "vl9",
      paths: ["src/payments/fees.ts"],
      participants: ["call:call-1", `owner:${ANA}`],
    }),
    event("owner-decision", 30, "e2", {
      email: ANA,
      task: "vl9",
      paths: ["src/payments/limits.ts"],
      participants: ["call:call-9", `owner:${ANA}`, `asker:${BOB}`, "decision:declined"],
    }),
    event("owner-map", 20, "e3", { email: EVA, participants: [`area:Menu=${CYRIL}`] }),
  ];
  const decided: Looking = {
    ...WORLD,
    ownership: {
      calls: [
        ownerCall({
          id: "call-9",
          state: "declined",
          paths: ["src/payments/limits.ts"],
          note: "use the existing fee table",
        }),
      ],
    },
  };

  it("lists the history with the person behind each entry, newest first", async () => {
    await show({ looking: decided, events: HISTORY });
    const list = section("Who decided what").findByType("ol");
    expect(list.findAllByType("li").map((item) => words(item))).toEqual([
      "E Eva made Cyril owner of the area Menu 20 min",
      "A Ana declined Bob's agent's call on src/payments/limits.ts: “use the existing fee table” 30 min",
      "B Bob's agent asked Ana to change src/payments/fees.ts for VL9 40 min",
    ]);
  });

  it("shows the first twenty entries and the older ones on request", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      event("task-status", index + 1, `m${index}`, { email: ANA, task: "vl7", status: "review" }),
    );
    await show({ events: many });
    const items = () => section("Who decided what").findByType("ol").findAllByType("li");
    expect(items()).toHaveLength(20);
    await act(async () => button("Show older")!.props.onClick());
    expect(items()).toHaveLength(25);
    expect(button("Show older")).toBeUndefined();
  });

  it("lists the entries Ana made, including her decision on Bob's call, when Eva filters by Ana", async () => {
    await show({ looking: decided, events: HISTORY });
    await act(async () => picker("Person")!.props.onValueChange(ANA));
    const items = section("Who decided what").findByType("ol").findAllByType("li");
    expect(items.map((item) => words(item))).toEqual([
      "A Ana declined Bob's agent's call on src/payments/limits.ts: “use the existing fee table” 30 min",
    ]);
    await act(async () => picker("Person")!.props.onValueChange("all"));
    expect(section("Who decided what").findByType("ol").findAllByType("li")).toHaveLength(3);
  });

  it("narrows by area and by task, and says when nothing matches", async () => {
    await show({ looking: decided, events: HISTORY });
    await act(async () => picker("Area")!.props.onValueChange("Menu"));
    expect(section("Who decided what").findByType("ol").findAllByType("li")).toHaveLength(1);
    await act(async () => picker("Task")!.props.onValueChange("vl9"));
    expect(words(section("Who decided what"))).toContain("Nothing here matches that filter.");
  });

  it("says the history is loading, and that it could not be read while the rest of the page stays", async () => {
    await show({ events: null });
    expect(words(section("Who decided what"))).toContain("Loading the history…");
    await act(async () => renderer!.unmount());
    mocks.history.error = "The environment request failed.";
    await show({ events: null });
    expect(words(section("Who decided what"))).toContain(
      "The history could not be read. The environment request failed.",
    );
    expect(section("Areas and tasks")).toBeDefined();
  });

  it("reads the history again when it is the last half minute, but not while the page is hidden", async () => {
    vi.useFakeTimers();
    await show();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(mocks.history.refresh).toHaveBeenCalledTimes(1);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(mocks.history.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the history again when something it would show changed, and not when only the view's age did", async () => {
    await show({ looking: WAITING_FOR_REVISION });
    expect(mocks.history.refresh).not.toHaveBeenCalled();
    const again = async (looking: Looking) => {
      const status = { ...statusFor(EVA, looking), lastSyncAt: minutesAgo(0) };
      mocks.work.current = {
        ...(mocks.work.current as object),
        status,
        tree: [teamProject(EVA, looking)],
      };
      await act(async () =>
        renderer!.update(<TeamPage workspace="acme" project="ordering" view="team" />),
      );
    };
    await again({ ...WAITING_FOR_REVISION, ownership: { at: minutesAgo(-1) } });
    expect(mocks.history.refresh).not.toHaveBeenCalled();
    await again({ ...WAITING_FOR_REVISION, ownership: { calls: [CALL] } });
    expect(mocks.history.refresh).toHaveBeenCalledTimes(1);
  });
});

const WAITING_FOR_REVISION: Looking = WORLD;

describe("the owner map on the page", () => {
  it("shows the map to everyone, and offers a lead to edit it", async () => {
    await show();
    const map = words(section("Owner map"));
    expect(map).toContain("v3");
    expect(map).toContain("Payments Ana");
    expect(map).toContain("src/payments/** Ana Owner decides");
    expect(button("Edit owner map")).toBeDefined();
    expect(buttons().filter((candidate) => words(candidate) === "Edit owner map")).toHaveLength(2);
  });

  it("opens the owner map from either button", async () => {
    await show();
    for (const open of buttons().filter((candidate) => words(candidate) === "Edit owner map")) {
      await act(async () => open.props.onClick());
      expect(mocks.navigate).toHaveBeenLastCalledWith({
        to: "/team/$workspace/$project",
        params: { workspace: "acme", project: "ordering" },
        search: { view: "owner-map" },
      });
    }
  });

  it("offers a member to read the map, not to edit it", async () => {
    await show({ viewer: BOB });
    expect(button("Edit owner map")).toBeUndefined();
    await act(async () => button("See the owner map")!.props.onClick());
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/team/$workspace/$project",
      params: { workspace: "acme", project: "ordering" },
      search: { view: "owner-map" },
    });
  });

  it("has a page of its own, with a way back to the team", async () => {
    await show({ view: "owner-map" });
    expect(page()).toContain("Who answers for each area and path of Ordering demo.");
    expect(page()).toContain("Leads and admins change it; everyone on the project sees it.");
    expect(page()).toContain("Version 3");
    const crumb = renderer!.root.findByProps({ "data-page": true });
    expect(words(crumb)).toBe("Team Owner map");
    expect(crumb.findByProps({ "data-to": "/team/$workspace/$project" })).toBeDefined();
    // The team's own parts are not on it.
    expect(renderer!.root.findAllByProps({ "aria-label": "People" })).toEqual([]);
  });
});

describe("when this computer's coordination is off", () => {
  it("shows owners, tasks and the timeline, and says what it cannot show", async () => {
    await show({
      looking: { ...WORLD, coordination: false },
      events: [event("task-status", 10, "e1", { email: ANA, task: "vl7", status: "review" })],
    });
    expect(page()).toContain(
      "Agent coordination is off on this computer, so changes agents make in owned paths cannot be shown here.",
    );
    expect(words(row("VL7"))).toContain("Owner Ana");
    expect(words(section("Who decided what"))).toContain("Ana moved VL7 to review");
    expect(words(section("Owner map"))).toContain("Payments Ana");
    // What needs the agents' reports is not claimed: no change in owned paths, no stopped push.
    expect(page()).not.toContain("Changed Ana's path");
    expect(page()).not.toContain("Push stopped");
    expect(words(renderer!.root.findByProps({ "data-state": "neutral" }))).toBe(
      "Coordination off on this computer · view 0 s old",
    );
  });

  it("leads to Coordination & plugins, where it is turned on", async () => {
    await show({ looking: { ...WORLD, coordination: false } });
    await act(async () => button("Open Coordination & plugins")!.props.onClick());
    expect(mocks.openSettings).toHaveBeenCalledWith({ kind: "computer", section: "coordination" });
  });

  it("says nothing of it while coordination is on", async () => {
    await show();
    expect(page()).not.toContain("Agent coordination is off");
  });
});

describe("the team's priority", () => {
  const announcements: PeerWebPlugin = {
    id: "announcements",
    projectActions: [
      {
        id: "notify-agents",
        label: "Notify agents…",
        hint: "Every live agent in the project hears it once",
        icon: (() => null) as never,
        Dialog: ({ onClose }) => <div data-announce-dialog onClick={onClose} />,
      },
    ],
  };

  it("offers to post it as an announcement where that plugin is active, in its own dialog", async () => {
    await show({ plugins: [announcements] });
    expect(renderer!.root.findAllByProps({ "data-announce-dialog": true })).toEqual([]);
    await act(async () => button("Post the team's priority as an announcement")!.props.onClick());
    const dialog = renderer!.root.findByProps({ "data-announce-dialog": true });
    await act(async () => dialog.props.onClick());
    expect(renderer!.root.findAllByProps({ "data-announce-dialog": true })).toEqual([]);
  });

  it("offers nothing where announcements are off", async () => {
    await show({ plugins: [] });
    expect(button("Post the team's priority as an announcement")).toBeUndefined();
  });
});
