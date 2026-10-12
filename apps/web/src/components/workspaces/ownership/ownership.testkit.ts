/**
 * Fixtures for the ownership plugin's web tests: project `ordering` of workspace `acme`, with its
 * people, tasks, owner map and calls, and the status and slot props of whoever looks at it. Tests
 * only; nothing in the app imports this.
 */
import type { NeedsYouItem } from "@t3tools/client-runtime/peer/needs-you";
import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import type {
  PeerHubStatus,
  PeerOwnerCall,
  PeerOwnershipProject,
  PeerProjectState,
  PeerTask,
  PeerWorkThread,
  PeerWorkspaceRole,
} from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { TaskSlotProps } from "../slots.types";
import { buildWorkTree, type WorkProjectNode, type WorkTaskNode } from "../workTree.logic";

export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";
export const CYRIL = "cyril@acme.test";
export const EVA = "eva@acme.test";
/** Not on the project any more. */
export const DAN = "dan@acme.test";

export const NOW = Date.parse("2026-10-12T21:00:00Z");
export const iso = (at: number) => DateTime.formatIso(DateTime.makeUnsafe(at));
export const minutesAgo = (count: number) => iso(NOW - count * 60_000);

export const ENV = EnvironmentId.make("env-here");

const MEMBERS = [
  { email: ANA, name: "Ana" },
  { email: BOB, name: "Bob" },
  { email: CYRIL, name: "Cyril" },
  { email: EVA, name: "Eva" },
];

/** Ordering's tasks as the Hub lists them: VL7 and VL9 are owned, VL10 sits in Ana's area. */
export function hubTask(id: string, overrides: Partial<PeerTask> = {}): PeerTask {
  return {
    id,
    key: id.toUpperCase(),
    title: `Task ${id}`,
    status: "open",
    createdBy: ANA,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    ...overrides,
  };
}

const TASKS = [
  hubTask("vl7", { title: "Receipt totals in cents", area: "Payments" }),
  hubTask("vl9", { title: "Refund fee field", area: "Payments" }),
  hubTask("vl10", { title: "Checkout copy", area: "Payments" }),
  hubTask("vl11", { title: "Menu photos", area: "Menu" }),
];

/** What the Hub says of ordering's ownership: Ana owns Payments and VL7, Bob owns VL9, Eva leads. */
function ownershipView(overrides: Partial<PeerOwnershipProject> = {}): PeerOwnershipProject {
  return {
    workspace: "acme",
    project: "ordering",
    at: minutesAgo(0),
    leads: [EVA],
    map: {
      version: 3,
      areas: { Payments: ANA },
      paths: { "src/payments/**": ANA },
      decide: ["src/payments/**"],
    },
    tasks: {
      vl7: {
        project: "ordering",
        task: "vl7",
        owner: ANA,
        since: minutesAgo(120),
        reason: "request",
      },
      vl9: {
        project: "ordering",
        task: "vl9",
        owner: BOB,
        since: minutesAgo(30),
        reason: "named",
        by: EVA,
      },
    },
    calls: [],
    ...overrides,
  };
}

/** Bob's agent asks Ana to change a path she decides, 40 minutes ago. */
export function ownerCall(overrides: Partial<PeerOwnerCall> = {}): PeerOwnerCall {
  return {
    id: "call-1",
    project: "ordering",
    task: "vl9",
    session: "claude:s1",
    email: BOB,
    environment: "env-bob",
    owner: ANA,
    paths: ["src/payments/fees.ts"],
    reason: "add a refund fee field",
    state: "pending",
    onBehalf: false,
    createdAt: minutesAgo(40),
    updatedAt: minutesAgo(40),
    expiresAt: iso(NOW - 40 * 60_000 + 7 * 86_400_000),
    ...overrides,
  };
}

export interface Looking {
  /** Their role on the project and in the workspace. */
  readonly project?: "lead" | "member";
  readonly workspace?: PeerWorkspaceRole;
  /** What the Hub said of ownership; null where the plugin is off or the Hub says nothing. */
  readonly ownership?: Partial<PeerOwnershipProject> | null;
  readonly members?: ReadonlyArray<{ readonly email: string; readonly name: string }>;
  readonly tasks?: ReadonlyArray<PeerTask>;
  readonly areas?: ReadonlyArray<string>;
  readonly sessions?: ReadonlyArray<Record<string, unknown>>;
  /** The chats the Hub reports on the project, everyone's. */
  readonly threads?: ReadonlyArray<PeerWorkThread>;
  readonly overlaps?: ReadonlyArray<Record<string, unknown>>;
  /** Whether this computer's agents coordinate; on by default. */
  readonly coordination?: boolean;
  /** What the person's own app holds of requests, which no view of the team may carry. */
  readonly requests?: PeerHubStatus["requests"];
}

/** The status of `email`'s Peer, with ordering open in it. */
export function statusFor(email: string, looking: Looking = {}): PeerHubStatus {
  const state = {
    project: {
      id: "ordering",
      name: "Ordering demo",
      role: looking.project ?? (email === EVA ? "lead" : "member"),
      members: looking.members ?? MEMBERS,
    },
    repositories: [],
    peers: [],
    work: {
      areas: looking.areas ?? ["Payments", "Menu"],
      tasks: looking.tasks ?? TASKS,
      threads: looking.threads ?? [],
      assignments: {},
    },
  } as unknown as PeerProjectState;
  return {
    email,
    signedIn: true,
    environmentId: ENV,
    agents: { herdr: "not-running", list: [] },
    sharedThreads: [],
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: looking.workspace ?? "member",
        memberName: email === EVA ? "Eva" : email.split("@")[0],
        projects: [state],
      },
    ],
    ownership:
      looking.ownership === null
        ? undefined
        : { projects: [ownershipView(looking.ownership ?? {})] },
    coordination: {
      enabled: looking.coordination ?? true,
      sessions: looking.coordination === false ? [] : (looking.sessions ?? []),
      overlaps: looking.coordination === false ? [] : (looking.overlaps ?? []),
      candidates: [],
      contexts: [],
      findings: [],
    },
    ...(looking.requests === undefined ? {} : { requests: looking.requests }),
  } as unknown as PeerHubStatus;
}

/** A task node as the Work tree has it. */
export function taskNode(id: string, overrides: Partial<WorkTaskNode> = {}): WorkTaskNode {
  const hub = TASKS.find((task) => task.id === id);
  return {
    id,
    key: hub?.key,
    title: hub?.title ?? id,
    done: false,
    status: "idle",
    threads: [],
    removable: true,
    context: undefined,
    ...overrides,
  };
}

/** Ordering as the real Work tree builds it for `email`: its chats placed on tasks, with their titles. */
export function teamProject(
  email: string,
  looking: Looking = {},
  now: number = NOW,
): WorkProjectNode {
  const [project] = buildWorkTree({ status: statusFor(email, looking), localThreads: [], now });
  if (project === undefined) throw new Error("ordering is not in the work tree");
  return project;
}

/** What a task slot gets for `id` in `email`'s status. */
export function slotProps(email: string, id: string, looking: Looking = {}): TaskSlotProps {
  const status = statusFor(email, looking);
  return {
    environmentId: ENV,
    status,
    workspace: "acme",
    project: status.workspaces[0]?.projects[0],
    task: taskNode(id),
  };
}

/** Ordering as the Work tree has it for `email`: its tasks by area, with the ownership they see. */
export function workProject(email: string, looking: Looking = {}): WorkProjectNode {
  const status = statusFor(email, looking);
  const workspace = status.workspaces[0]!;
  const state = workspace.projects[0]!;
  const { tasks, areas } = state.work;
  return {
    workspace: "acme",
    workspaceName: "Acme",
    projectId: "ordering",
    name: "Ordering demo",
    areas: areas.map((name) => ({
      name,
      tasks: tasks.filter((task) => task.area === name).map((task) => taskNode(task.id)),
    })),
    unsorted: [],
    context: undefined,
    candidates: 0,
    tasks: [...tasks],
    ownership: projectOwnership(status, workspace, state.project),
  };
}

/** The Needs-you item of a pending call, as `deriveNeedsYou` makes it. */
export function ownerCallItem(
  call: PeerOwnerCall = ownerCall(),
  overrides: Partial<Extract<NeedsYouItem, { readonly kind: "owner-call" }>> = {},
): Extract<NeedsYouItem, { readonly kind: "owner-call" }> {
  return {
    kind: "owner-call",
    key: `owner-call:acme/ordering/${call.id}`,
    title: "Bob's agent asks to change your path",
    rank: 2,
    since: call.createdAt,
    environmentId: ENV,
    environmentLabel: "Laptop",
    offline: false,
    hubError: false,
    workspace: "acme",
    project: "ordering",
    call,
    asker: "Bob",
    owner: "Ana",
    onBehalf: false,
    ...overrides,
  };
}
