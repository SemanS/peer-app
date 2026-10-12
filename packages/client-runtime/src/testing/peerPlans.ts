/**
 * What the Plans tests share, in the client runtime and in both apps: the scenario of the design's
 * task context page. Bob's Claude on ORD-9 declared plan v2, its Codex declared nothing, Ana's Codex
 * works on ORD-11 and Bob has another task, ORD-15; the Hub finds three places where ORD-9's plan
 * meets other work. Only tests import it.
 */
import type {
  PeerHubStatus,
  PeerPlan,
  PeerPlanRelation,
  PeerPlanSide,
  PeerPlansView,
} from "@t3tools/contracts";

export const NOW = Date.parse("2026-10-12T20:13:00Z");
export const PAY = { workspace: "acme", project: "pay" };

export const task = (id: string, key: string, title: string) => ({
  id,
  key,
  title,
  status: "open",
  createdBy: "ana@acme.test",
  createdAt: "2026-10-10T09:00:00Z",
  updatedAt: "2026-10-10T09:00:00Z",
});
const member = (email: string, name: string) => ({ email, name, role: "member" });

export const session = (id: string, email: string, taskId: string | undefined, over = {}) => ({
  id,
  workspace: "acme",
  project: "pay",
  email,
  environment: email.startsWith("ana") ? "ana-laptop" : "mac",
  label: `Work of ${id}`,
  agent: id.split(":")[0],
  ...(taskId === undefined ? {} : { task: taskId }),
  status: "working",
  files: [],
  claims: [],
  local: false,
  ...over,
});

export const TASKS: ReadonlyArray<object> = [
  task("ord-9", "ORD-9", "Refund fee field"),
  task("ord-11", "ORD-11", "Receipt totals in cents"),
  task("ord-15", "ORD-15", "Refund reasons"),
];

export function status(
  sessions: ReadonlyArray<object>,
  tasks: ReadonlyArray<object> = TASKS,
): PeerHubStatus {
  return {
    email: "bob@acme.test",
    signedIn: true,
    plugins: [{ id: "plans", title: "Plans", enabled: true, active: true }],
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        projects: [
          {
            project: {
              id: "pay",
              name: "Payments",
              role: "member",
              members: [member("bob@acme.test", "Bob"), member("ana@acme.test", "Ana")],
            },
            repositories: [],
            work: {
              areas: [],
              tasks,
              threads: [],
              assignments: {},
            },
          },
        ],
      },
    ],
    coordination: { enabled: true, sessions },
  } as unknown as PeerHubStatus;
}

export const bobClaude = session("claude:b1", "bob@acme.test", "ord-9");
export const bobCodex = session("codex:b2", "bob@acme.test", "ord-9");
export const bobOther = session("claude:b3", "bob@acme.test", "ord-15");
export const anaCodex = session("codex:a1", "ana@acme.test", "ord-11");
export const everyone = [bobClaude, bobCodex, bobOther, anaCodex];

export const side = (s: ReturnType<typeof session>): PeerPlanSide => ({
  session: s.id,
  email: s.email,
  environment: s.environment,
  label: s.label,
  ...(s.task === undefined ? {} : { task: s.task }),
});

export const plan = (s: ReturnType<typeof session>, over: Partial<PeerPlan> = {}): PeerPlan => ({
  project: "pay",
  session: s.id,
  email: s.email,
  environment: s.environment,
  ...(s.task === undefined ? {} : { task: s.task }),
  label: s.label,
  seq: 1,
  version: 1,
  changes: [],
  maybes: [],
  uses: [],
  provides: [],
  declaredAt: "2026-10-12T19:50:00Z",
  updatedAt: "2026-10-12T20:01:00Z",
  live: true,
  ...over,
});

export const relation = (id: string, over: Partial<PeerPlanRelation> = {}): PeerPlanRelation => ({
  id,
  kind: "use",
  project: "pay",
  a: side(bobClaude),
  b: side(anaCodex),
  item: { path: "src/tax.ts", name: "applyTax" },
  certain: true,
  observed: false,
  ...over,
});

export const view = (
  plans: ReadonlyArray<PeerPlan>,
  relations: ReadonlyArray<PeerPlanRelation>,
): PeerPlansView => ({ plans, relations, omitted: 0, at: "2026-10-12T20:13:00Z" });

/** What Bob's Claude on ORD-9 declared, and what the Hub finds where it meets other work. */
export const bobsPlan = plan(bobClaude, {
  version: 2,
  changes: [{ path: "src/payments/fees.ts", name: "Fee.refundCents" }],
  maybes: [{ path: "src/payments/" }],
  uses: [{ path: "src/tax.ts", name: "applyTax" }],
  provides: [
    {
      name: "Fee.refundCents",
      path: "src/payments/fees.ts",
      contract: "integer cents, never negative",
    },
  ],
});
export const meetings = [
  relation("r-contract", { contract: "takes cents, returns cents" }),
  relation("r-maybe", {
    kind: "same-change",
    b: side(bobOther),
    item: { path: "src/payments/refunds.ts" },
    certain: false,
  }),
  relation("r-observed", { item: { path: "src/payments/totals.ts" }, observed: true }),
];
