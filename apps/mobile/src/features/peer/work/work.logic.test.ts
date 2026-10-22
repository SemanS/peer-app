import { deriveNeedsYou } from "@t3tools/client-runtime/peer/needs-you";
import {
  boardCards,
  boardCardTitle,
  buildWorkTree,
  projectCounts,
  type WorkProjectNode,
} from "@t3tools/client-runtime/peer/work";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId, type PeerHubStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  homeWorkSubtitle,
  mergeWorkEnvironments,
  mobileWork,
  workCardAction,
  workEmptyText,
  workGroups,
  workNotices,
  type WorkEnvironment,
} from "./work.logic";

const LAPTOP = EnvironmentId.make("laptop");
const DESKTOP = EnvironmentId.make("desktop");
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const SEEN = "2026-10-10T11:59:30.000Z";
const ANA = "ana@acme.test";
const BEN = "ben@acme.test";

type HubThread = PeerHubStatus["workspaces"][number]["projects"][number]["work"]["threads"][number];

const hubThread = (
  id: string,
  title: string,
  overrides: Partial<HubThread> & Pick<HubThread, "email" | "environment">,
): HubThread => ({
  id,
  task: "pay",
  title,
  status: "working",
  source: "peer",
  seenAt: SEEN,
  ...overrides,
});

/**
 * Ana's computer as Peer reports it: workspace Acme with the project Kirkwood, checked out as this
 * computer's own T3 project, and what the Hub reports of everyone's threads.
 */
function computer(
  environmentId: EnvironmentId,
  threads: ReadonlyArray<HubThread>,
  overrides: Partial<Record<keyof PeerHubStatus, unknown>> = {},
): PeerHubStatus {
  return {
    signedIn: true,
    email: ANA,
    environmentId,
    error: null,
    sharedThreads: [],
    requests: [],
    agents: { herdr: "running", list: [] },
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        projects: [
          {
            project: {
              id: "kirkwood",
              name: "Kirkwood",
              role: "member",
              members: [
                { email: ANA, name: "Ana" },
                { email: BEN, name: "Ben" },
              ],
              capacity: { personal: "any", personalHarnesses: [] },
            },
            repositories: [{ id: "app", state: "ready", projectId: `${environmentId}-kirkwood` }],
            work: {
              areas: [],
              tasks: [
                {
                  id: "pay",
                  key: "PAY-1",
                  title: "Split payments",
                  status: "open",
                  createdBy: ANA,
                  createdAt: "2026-10-01T00:00:00Z",
                  updatedAt: "2026-10-01T00:00:00Z",
                },
              ],
              threads,
              assignments: {},
            },
          },
        ],
      },
    ],
    coordination: {
      enabled: true,
      sessions: [],
      overlaps: [],
      findings: [],
      contexts: [],
      candidates: [],
    },
    ...overrides,
  } as unknown as PeerHubStatus;
}

/** One of the phone's thread shells, on the task by its branch. */
const shell = (
  environmentId: EnvironmentId,
  id: string,
  title: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell =>
  ({
    environmentId,
    id: ThreadId.make(id),
    projectId: ProjectId.make(`${environmentId}-kirkwood`),
    title,
    branch: "pay-1-split",
    runtime: { status: "running" },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    settledAt: null,
    archivedAt: null,
    deletedAt: null,
    modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-5-5" },
    latestUserMessageAt: null,
    updatedAt: "2026-10-10T11:00:00.000Z",
    ...overrides,
  }) as unknown as EnvironmentThreadShell;

const BENS = hubThread("peer:b1", "Refunds", { email: BEN, environment: "ben-laptop" });
const THREADS = [
  shell(LAPTOP, "l1", "Laptop work"),
  shell(DESKTOP, "d1", "Desktop work", { hasPendingApprovals: true, runtime: null }),
];
/** Each computer reports its own thread to the Hub, and sees the other's and Ben's from there. */
const laptop = computer(LAPTOP, [
  hubThread("peer:l1", "Laptop work", { email: ANA, environment: "laptop" }),
  hubThread("peer:d1", "Desktop work", { email: ANA, environment: "desktop", status: "idle" }),
  BENS,
]);
const desktop = computer(DESKTOP, [
  hubThread("peer:l1", "Laptop work", { email: ANA, environment: "laptop", status: "idle" }),
  hubThread("peer:d1", "Desktop work", { email: ANA, environment: "desktop" }),
  BENS,
]);

const environment = (
  environmentId: EnvironmentId,
  status: PeerHubStatus | null,
  connected = true,
): WorkEnvironment => ({
  environmentId,
  label: environmentId === LAPTOP ? "Laptop" : "Desktop",
  connected,
  status,
  error: null,
});

const threadsOf = (project: WorkProjectNode | undefined) => [
  ...(project?.areas.flatMap((area) => area.tasks.flatMap((task) => task.threads)) ?? []),
  ...(project?.unsorted ?? []),
];

const needsOf = (environments: ReadonlyArray<WorkEnvironment>) =>
  deriveNeedsYou({
    environments: environments.map((entry) => ({ ...entry, threads: THREADS })),
    now: NOW,
    unseen: () => false,
  });

describe("the phone's Work", () => {
  it("shows the same projects, counts and grouping as web for one computer", () => {
    const web = buildWorkTree({ status: laptop, localThreads: THREADS, now: NOW });
    const phone = mobileWork({
      environments: [environment(LAPTOP, laptop)],
      threads: THREADS,
      now: NOW,
    }).tree;
    expect(phone.map((project) => project.name)).toEqual(web.map((project) => project.name));
    expect(phone.map((project) => projectCounts(project))).toEqual(
      web.map((project) => projectCounts(project)),
    );
    const grouping = (tree: ReadonlyArray<WorkProjectNode>) =>
      boardCards(tree, { scope: "all", mine: false, query: "" }).map((card) => [
        card.column,
        boardCardTitle(card),
      ]);
    expect(grouping(phone)).toEqual(grouping(web));
  });

  it("merges two computers: each thread once, live from the computer that runs it", () => {
    const work = mobileWork({
      environments: [environment(LAPTOP, laptop), environment(DESKTOP, desktop)],
      threads: THREADS,
      now: NOW,
    });
    expect(work.tree.map((project) => project.name)).toEqual(["Kirkwood"]);
    const threads = threadsOf(work.tree[0]);
    expect(threads.map((thread) => [thread.title, thread.status]).sort()).toEqual([
      ["Desktop work", "blocked"],
      ["Laptop work", "working"],
      ["Refunds", "working"],
    ]);
    const host = (title: string) =>
      work.hosts.get(threads.find((thread) => thread.title === title)?.key ?? "");
    expect([host("Laptop work"), host("Desktop work"), host("Refunds")]).toEqual([
      LAPTOP,
      DESKTOP,
      undefined,
    ]);
    expect(work.sources.get("acme/kirkwood")).toBe(LAPTOP);
    // The task adds up what both computers run.
    expect(work.tree[0]?.areas[0]?.tasks[0]?.status).toBe("blocked");
  });

  it("groups one project's work as the board does, with what waits on the person first", () => {
    const environments = [environment(LAPTOP, laptop), environment(DESKTOP, desktop)];
    const withRequest = computer(LAPTOP, laptop.workspaces[0]!.projects[0]!.work.threads, {
      requests: [
        {
          workspace: "acme",
          request: {
            id: "r1",
            project: "kirkwood",
            task: "pay",
            sender: BEN,
            recipient: ANA,
            title: "Rerun the import",
            prompt: "Please rerun it.",
            status: "pending",
            createdAt: "2026-10-10T10:00:00.000Z",
            updatedAt: "2026-10-10T10:00:00.000Z",
          },
        },
      ],
    });
    environments[0] = environment(LAPTOP, withRequest);
    const work = mobileWork({ environments, threads: THREADS, now: NOW });
    const groups = workGroups(work.tree, work.tree[0]!, needsOf(environments));
    expect(
      groups.map((group) => [group.title, group.cards.map((card) => boardCardTitle(card))]),
    ).toEqual([
      ["Needs you", ["Desktop work", "Rerun the import"]],
      ["Working", ["Laptop work", "Refunds"]],
      ["Needs review", []],
      ["Idle", []],
    ]);
    const [approval, request] = groups[0]!.cards;
    expect(approval?.kind === "thread" && approval.need).toBe("approval");
    expect(workCardAction(approval!, work.hosts, environments)).toEqual({
      kind: "thread",
      environmentId: DESKTOP,
      threadId: ThreadId.make("d1"),
    });
    expect(workCardAction(request!, work.hosts, environments)).toMatchObject({ kind: "request" });
    // Ben's thread waits on nothing of Ana's and has nothing she could open.
    const bens = groups[1]!.cards.find((card) => boardCardTitle(card) === "Refunds")!;
    expect(workCardAction(bens, work.hosts, environments)).toBeNull();
  });

  it("opens an owner's call in the sheet Needs you decides it in, not in a page the phone lacks", () => {
    const asked = "2026-10-10T11:20:00.000Z";
    const withCall = computer(LAPTOP, [BENS], {
      ownership: {
        projects: [
          {
            workspace: "acme",
            project: "kirkwood",
            at: asked,
            leads: [],
            map: { version: 1, areas: {}, paths: { "src/**": ANA }, decide: ["src/**"] },
            tasks: {},
            calls: [
              {
                id: "oc-1",
                project: "kirkwood",
                task: "pay",
                session: "claude:b1",
                email: BEN,
                environment: "ben-laptop",
                owner: ANA,
                paths: ["src/pay.ts"],
                reason: "add a refund field",
                state: "pending",
                onBehalf: false,
                createdAt: asked,
                updatedAt: asked,
                expiresAt: "2026-10-17T11:20:00.000Z",
              },
            ],
          },
        ],
      },
    });
    const environments = [environment(LAPTOP, withCall)];
    const work = mobileWork({ environments, threads: [], now: NOW });
    const [needs] = workGroups(work.tree, work.tree[0]!, needsOf(environments));
    const call = needs?.cards.find((card) => card.kind === "owner-call");
    expect(call && boardCardTitle(call)).toBe("Ben's agent asks to change your path");
    expect(workCardAction(call!, work.hosts, environments)).toMatchObject({
      kind: "owner-call",
      item: { call: { id: "oc-1" }, onBehalf: false },
    });
  });

  it("puts a colleague's waiting thread under Working, waiting on them", () => {
    const blocked = computer(LAPTOP, [{ ...BENS, status: "blocked" }]);
    const environments = [environment(LAPTOP, blocked)];
    const work = mobileWork({ environments, threads: [], now: NOW });
    const [needs, working] = workGroups(work.tree, work.tree[0]!, needsOf(environments));
    expect(needs?.cards).toEqual([]);
    expect(working?.cards).toMatchObject([{ kind: "thread", waitingOn: "Ben" }]);
  });

  it("keeps an away computer's last work, says it is offline and does not open it", () => {
    const previous = mergeWorkEnvironments([environment(LAPTOP, laptop)], new Map()).last;
    const { environments, last } = mergeWorkEnvironments(
      [environment(LAPTOP, null, false)],
      previous,
    );
    expect(environments[0]?.status).toBe(laptop);
    expect([...last.keys()]).toEqual([LAPTOP]);
    const work = mobileWork({ environments, threads: THREADS, now: NOW });
    const laptopWork = threadsOf(work.tree[0]).find((thread) => thread.title === "Laptop work")!;
    expect(work.hosts.get(laptopWork.key)).toBe(LAPTOP);
    expect(workNotices(environments)).toEqual([
      "Laptop is offline. Its work shows as it last reported it.",
    ]);
    const card = boardCards(work.tree, { scope: "all", mine: false, query: "" }).find(
      (candidate) => boardCardTitle(candidate) === "Laptop work",
    )!;
    expect(workCardAction(card, work.hosts, environments)).toEqual({
      kind: "unavailable",
      reason: "Laptop is offline.",
    });
    // A computer the phone no longer knows is forgotten with its work.
    expect(mergeWorkEnvironments([], last).last.size).toBe(0);
  });

  it("prefers a connected computer's report over an away computer's own last word", () => {
    const work = mobileWork({
      environments: [environment(LAPTOP, laptop, false), environment(DESKTOP, desktop)],
      threads: THREADS,
      now: NOW,
    });
    const laptopWork = threadsOf(work.tree[0]).find((thread) => thread.title === "Laptop work")!;
    expect(laptopWork.status).toBe("idle");
    expect(work.hosts.has(laptopWork.key)).toBe(false);
    expect(work.sources.get("acme/kirkwood")).toBe(DESKTOP);
  });

  it("names the chosen project on Home, else how many there are", () => {
    expect(homeWorkSubtitle([laptop, desktop], "all")).toBe("1 team project");
    expect(homeWorkSubtitle([laptop], "acme/kirkwood")).toBe("Kirkwood");
    expect(homeWorkSubtitle([laptop], "acme/gone")).toBe("1 team project");
    expect(homeWorkSubtitle([null, computer(LAPTOP, [], { signedIn: false })], "all")).toBeNull();
  });

  it("says what is missing before there is work to show", () => {
    expect(workEmptyText([], [])).toBe(
      "Local chats are available from Projects. Connect a Hub to add shared team tasks.",
    );
    expect(workEmptyText([environment(LAPTOP, null)], [])).toBe("Loading your team’s work…");
    const signedOut = computer(LAPTOP, [], { signedIn: false });
    expect(workNotices([environment(LAPTOP, signedOut)])).toEqual([]);
    expect(workEmptyText([environment(LAPTOP, computer(LAPTOP, [], { workspaces: [] }))], [])).toBe(
      "Join or create a workspace on web or desktop to work with your team.",
    );
  });
});
