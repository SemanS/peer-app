/**
 * A project of five people as the design's Team page lays it out, for the tests of this folder:
 * Slavo (a lead), Ana, Bob, Cyril and Eva on "Ordering demo", with Bob's agent waiting for Ana's
 * call on `src/payments/fees.ts`. Every chat's title, session label and request here is marked
 * SECRET: nothing the phone shows of the team may carry one.
 */
import {
  EnvironmentId,
  type PeerCoordSession,
  type PeerHubStatus,
  type PeerOverlap,
  type PeerOwnerCall,
  type PeerOwnershipProject,
  type PeerTask,
  type PeerTaskOwner,
  type PeerWorkThread,
} from "@t3tools/contracts";
import {
  deriveNeedsYou,
  type NeedsYouEnvironment,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";

export const SLAVO = "slavo@acme.test";
export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";
export const CYRIL = "cyril@acme.test";
export const EVA = "eva@acme.test";
export const NOW = Date.parse("2026-10-12T21:00:00Z");

const iso = (at: number) => new Date(at).toISOString();
export const minutesAgo = (count: number) => iso(NOW - count * 60_000);
export const hoursAgo = (count: number) => minutesAgo(count * 60);

export const MEMBERS = [
  { email: SLAVO, name: "Slavo" },
  { email: ANA, name: "Ana" },
  { email: BOB, name: "Bob" },
  { email: CYRIL, name: "Cyril" },
  { email: EVA, name: "Eva" },
];

const hubTask = (
  id: string,
  title: string,
  extra: Partial<Omit<PeerTask, "id" | "title">> = {},
): PeerTask => ({
  id,
  key: id.toUpperCase(),
  title,
  status: "open",
  createdBy: ANA,
  createdAt: "2026-10-10T09:00:00Z",
  updatedAt: "2026-10-12T09:00:00Z",
  ...extra,
});

export const TASKS = [
  hubTask("ord-9", "Refund fee field", { area: "Payments" }),
  hubTask("ord-11", "Receipt totals in cents", {
    area: "Payments",
    status: "review",
    updatedAt: hoursAgo(26),
  }),
  hubTask("ord-15", "Refund reasons", { area: "Payments" }),
  hubTask("ord-7", "Order notes header", {
    area: "Orders",
    status: "review",
    updatedAt: hoursAgo(2),
  }),
  hubTask("ord-12", "Menu photos", { area: "Menu" }),
  hubTask("ord-14", "Checkout copy"),
  hubTask("ord-6", "Old fix", { area: "Orders", status: "done" }),
];

/** A chat as the Hub reports it. Its title is a secret: nothing of the team may carry it. */
const chat = (
  id: string,
  task: string | undefined,
  email: string,
  status: PeerWorkThread["status"],
): PeerWorkThread => ({
  id,
  ...(task === undefined ? {} : { task }),
  title: `SECRET title of chat ${id}`,
  email,
  status,
  source: "peer",
  environment: `${email}-laptop`,
  seenAt: minutesAgo(0),
});

export const THREADS = [
  chat("t1", "ord-9", BOB, "working"),
  chat("t2", "ord-9", BOB, "working"),
  chat("t3", "ord-11", ANA, "idle"),
  chat("t4", "ord-15", BOB, "working"),
  chat("t5", "ord-7", SLAVO, "idle"),
  chat("t6", "ord-7", ANA, "working"),
  chat("t7", "ord-12", CYRIL, "blocked"),
  chat("t8", "ord-14", EVA, "working"),
  chat("t9", undefined, ANA, "working"),
];

const owner = (task: string, email: string, reason = "named"): PeerTaskOwner => ({
  project: "ordering",
  task,
  owner: email,
  since: hoursAgo(48),
  reason,
});

/** Bob's agent asked Ana for `src/payments/fees.ts` 40 minutes ago; a call lives 7 days. */
export const call = (overrides: Partial<PeerOwnerCall> = {}): PeerOwnerCall => ({
  id: "oc-1",
  project: "ordering",
  task: "ord-9",
  session: "claude:b1",
  email: BOB,
  environment: "bob-laptop",
  owner: ANA,
  paths: ["src/payments/fees.ts"],
  reason: "add a refund fee field",
  state: "pending",
  onBehalf: false,
  createdAt: minutesAgo(40),
  updatedAt: minutesAgo(40),
  expiresAt: iso(NOW - 40 * 60_000 + 7 * 86_400_000),
  ...overrides,
});

const session = (
  id: string,
  email: string,
  task: string | undefined,
  overrides: Partial<PeerCoordSession> = {},
): PeerCoordSession => ({
  id,
  workspace: "acme",
  project: "ordering",
  email,
  environment: `${email}-laptop`,
  label: `SECRET label of session ${id}`,
  ...(task === undefined ? {} : { task }),
  status: "working",
  files: [],
  claims: [],
  local: false,
  activeAt: minutesAgo(1),
  ...overrides,
});

export const SESSIONS = [
  session("claude:b1", BOB, "ord-9", {
    files: ["src/payments/fees.ts"],
    activeAt: minutesAgo(5),
  }),
  session("claude:b2", BOB, "ord-15", {
    files: ["src/payments/refunds.ts"],
    activeAt: minutesAgo(6),
  }),
  session("claude:c1", CYRIL, "ord-12", {
    status: "blocked",
    files: ["src/orders/notes.ts"],
    activeAt: minutesAgo(18),
  }),
  session("claude:s1", SLAVO, "ord-7", {
    files: ["src/orders/notes.ts"],
    activeAt: minutesAgo(3),
  }),
];

const overlap = (): PeerOverlap => ({
  id: "o1",
  workspace: "acme",
  project: "ordering",
  sessions: ["claude:s1", "claude:c1"],
  files: ["src/orders/notes.ts"],
  state: "open",
  notes: [],
  updatedAt: minutesAgo(35),
});

export function ownershipView(overrides: Partial<PeerOwnershipProject> = {}): PeerOwnershipProject {
  return {
    workspace: "acme",
    project: "ordering",
    at: minutesAgo(0),
    leads: [SLAVO],
    map: {
      version: 7,
      areas: { Orders: SLAVO, Payments: ANA, Menu: CYRIL },
      paths: { "src/payments/**": ANA, "src/orders/**": SLAVO, "src/menu/**": CYRIL },
      decide: ["src/payments/**"],
    },
    tasks: {
      "ord-9": owner("ord-9", BOB, "request"),
      "ord-11": owner("ord-11", ANA),
      "ord-15": owner("ord-15", BOB),
      "ord-7": owner("ord-7", SLAVO),
      "ord-12": owner("ord-12", CYRIL),
    },
    calls: [call()],
    ...overrides,
  };
}

export interface Setup {
  readonly viewer?: string;
  readonly role?: "lead" | "member";
  readonly members?: ReadonlyArray<{ readonly email: string; readonly name: string }>;
  readonly tasks?: ReadonlyArray<PeerTask>;
  readonly threads?: ReadonlyArray<PeerWorkThread>;
  /** Overrides of the ownership view; null leaves the field out, as while the plugin is off. */
  readonly ownership?: Partial<PeerOwnershipProject> | null;
  readonly coordination?: boolean;
  readonly sessions?: ReadonlyArray<PeerCoordSession>;
  readonly overlaps?: ReadonlyArray<PeerOverlap>;
  readonly error?: string | null;
  readonly environmentId?: string;
}

/** What a computer's Peer status holds of "Ordering demo" for the person `setup` names. */
export function statusOf(setup: Setup = {}): PeerHubStatus {
  const viewer = setup.viewer ?? SLAVO;
  const coordination = setup.coordination ?? true;
  return {
    hubUrl: "https://hub.example.test",
    signedIn: true,
    email: viewer,
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        currency: "EUR",
        memberName: "Slavo",
        companyKnowledge: null,
        projects: [
          {
            project: {
              id: "ordering",
              name: "Ordering demo",
              role: setup.role ?? (viewer === SLAVO ? "lead" : "member"),
              members: [...(setup.members ?? MEMBERS)],
              repositories: [],
              knowledge: { kontext: false, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
            repositories: [],
            tools: [],
            sharedCapacity: { enabled: false, instanceIds: [] },
            work: {
              areas: ["Orders", "Payments", "Menu"],
              tasks: [...(setup.tasks ?? TASKS)],
              threads: [...(setup.threads ?? THREADS)],
              assignments: {},
            },
            peers: [],
          },
        ],
        lastSyncAt: null,
        error: null,
      },
    ],
    // What two people asked of each other is theirs: nothing of the team may read it.
    requests: [
      {
        workspace: "acme",
        request: {
          id: "r1",
          project: "ordering",
          task: "ord-9",
          sender: ANA,
          recipient: BOB,
          title: "SECRET request title",
          prompt: "SECRET request prompt",
          status: "pending",
          createdAt: minutesAgo(300),
          updatedAt: minutesAgo(300),
        },
      },
    ],
    joinable: [],
    workspaceRoot: "/w",
    environmentId: EnvironmentId.make(setup.environmentId ?? "env-here"),
    agents: { herdr: "not-running", list: [] },
    github: { cli: false, account: null, signIn: null, error: null },
    coordination: {
      enabled: coordination,
      policy: "coordinate",
      claudeHooks: false,
      logPath: "",
      sessions: coordination ? [...(setup.sessions ?? SESSIONS)] : [],
      overlaps: coordination ? [...(setup.overlaps ?? [overlap()])] : [],
      findings: [],
      contexts: [],
      candidates: [],
    },
    sharedThreads: [],
    syncing: false,
    lastSyncAt: null,
    error: setup.error ?? null,
    ...(setup.ownership === null
      ? {}
      : { ownership: { projects: [ownershipView(setup.ownership)] } }),
  };
}

/** A computer of the phone with the status `setup` describes. */
export function computer(
  setup: Setup = {},
  options: { readonly label?: string; readonly connected?: boolean } = {},
): NeedsYouEnvironment {
  const status = statusOf(setup);
  return {
    environmentId: EnvironmentId.make(status.environmentId),
    label: options.label ?? "Laptop",
    connected: options.connected ?? true,
    status,
    threads: [],
  };
}

/** Needs you for the person, as the phone derives it from its computers. */
export function needsOf(
  environments: ReadonlyArray<NeedsYouEnvironment>,
  now = NOW,
): ReadonlyArray<NeedsYouItem> {
  return deriveNeedsYou({ environments, now, unseen: () => false });
}
