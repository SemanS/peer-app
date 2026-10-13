import type { PeerPlan, PeerPlanRelation, PeerPlanSide, PeerPluginId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import type { PeerSessionView } from "../../core/plugin.ts";
import type { Voice } from "./text.ts";

// This module supplies the plugin's shared test values; it is a test file so that the size budgets
// do not count it.

export const AT = Date.parse("2026-10-12T20:12:00Z");
export const ENVIRONMENT = "bob-mac";
export const ROOT = "/work/pay/api";

/** Bob's Claude Code session on task ORD-9 of the Payments project, as plugins see it. */
export function sessionView(overrides: Partial<PeerSessionView> = {}): PeerSessionView {
  const local = new Map<PeerPluginId, unknown>();
  const told = new Map<PeerPluginId, Set<string>>();
  return {
    id: "claude:b",
    agent: "claude",
    adapter: "hooks",
    runtimeGeneration: "run-1",
    workspace: "acme",
    project: "pay",
    repositoryId: "api",
    root: ROOT,
    cwd: ROOT,
    task: "ord-9",
    thread: undefined,
    pane: undefined,
    status: "working",
    keeps: false,
    files: [],
    claims: [],
    local: <S>(plugin: PeerPluginId, init: () => S): S => {
      if (!local.has(plugin)) local.set(plugin, init());
      return local.get(plugin) as S;
    },
    told: (plugin) => {
      const set = told.get(plugin) ?? new Set<string>();
      told.set(plugin, set);
      return set;
    },
    ...overrides,
  };
}

export const side = (
  session: string,
  task: string | undefined,
  email = "ana@acme.test",
  environment = "ana-mac",
): PeerPlanSide => ({
  session,
  email,
  environment,
  label: `Thread of ${session}`,
  ...(task === undefined ? {} : { task }),
});

/** Bob's side, the reader of most texts. */
export const BOB = side("claude:b", "ord-9", "bob@acme.test", ENVIRONMENT);
export const ANA = side("codex:a", "ord-11");

/** `a` uses what `b` changes, unless `over` says otherwise. */
export const relation = (id: string, over: Partial<PeerPlanRelation> = {}): PeerPlanRelation => ({
  id,
  kind: "use",
  project: "pay",
  a: BOB,
  b: ANA,
  item: { path: "src/tax.ts", name: "applyTax" },
  certain: true,
  observed: false,
  ...over,
});

export const plan = (over: Partial<PeerPlan> = {}): PeerPlan => ({
  project: "pay",
  session: "claude:b",
  email: "bob@acme.test",
  environment: ENVIRONMENT,
  task: "ord-9",
  label: "Refund fee field",
  seq: AT - 720_000,
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
  declaredAt: "2026-10-12T20:00:00Z",
  updatedAt: "2026-10-12T20:00:00Z",
  live: true,
  ...over,
});

const KEYS: Readonly<Record<string, string>> = {
  "ord-9": "ORD-9",
  "ord-11": "ORD-11",
  "ord-15": "ORD-15",
};
const NAMES: Readonly<Record<string, string>> = {
  "ana@acme.test": "Ana",
  "bob@acme.test": "Bob",
};

/** How Bob's agent reads names: tasks by key, people by first name. */
export const voice = (over: Partial<Voice> = {}): Voice => ({
  reader: { session: "claude:b", email: "bob@acme.test", environment: ENVIRONMENT },
  person: (email) => NAMES[email] ?? email,
  task: (id) => (id === undefined ? undefined : KEYS[id]),
  now: AT,
  ...over,
});

it("supplies the plugin's shared test values", () => {
  expect(sessionView().told?.("plans")).toBeInstanceOf(Set);
  expect(relation("r").a).toEqual(BOB);
});
