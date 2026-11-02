import { debugPathOf } from "../src/peerHub/core/metricsLog.ts";
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off globalDate:off globalDateInEffect:off globalFetch:off globalFetchInEffect:off globalConsole:off globalConsoleInEffect:off globalRandom:off globalRandomInEffect:off preferSchemaOverJson:off anyUnknownInErrorContext:off - host-side lab harness: drives real server processes and the scripts agents run.
// Coordination lab: two Peer servers (Ana's and Bob's computers) against a local Peer Hub, one
// project both checked out, and two agents simulated by running exactly the scripts Claude Code
// runs: the hook, the wake-up wait and `peer`. It checks the protocol end to end:
//
//   1. Ana's agent changes src/pricing.ts; nobody else is there, so it hears nothing.
//   2. Bob's agent is about to change the same file: it hears who changed it and how to tell them,
//      and goes on. Nothing refuses an edit.
//   3. Codex agents take part as Claude Code's do.
//   4. A slow hub at a session's start: Peer's hook answers before its script gives up, and what
//      was not ready reaches the agent at its next step instead of being lost.
//   5. Two computers edit one file at the same moment: the hub registers each claim in one step, so
//      both go on and at least one hears of the other. Repeated with a new file each time.
//   6. Jujutsu (LAB_VCS=jj only; peer-lab/jujutsu.ts): six simulated steps, each in task checkouts of its own and
//      read from the logs and the repositories. follow-local: an amend of the change an agent builds on moves its
//      change, and it hears so once. overtaken: an edit not yet snapshotted when a rewrite arrives ends in one
//      version, with the agent told once. follow-remote: a force-push is fetched at the next step after 30 s.
//      protect: jj refuses a squash into another agent's change, the agent hears whose it is, and
//      `--ignore-immutable` is stopped. undo: a person's undo of a restore leaves one version with the file.
//      push: a push that carries an unlanded change stops once with the push notice and the repeat runs.
//
// It prints what each agent was told and leaves both computers' coordination logs.
//
//   PEERHUB_BIN=../server/target/debug/peerhub node apps/server/scripts/peer-coordination-lab.ts
//   KEEP_LAB=1 keeps the throwaway homes and logs.
//   LAB_RACE_RUNS=100 repeats step 5's race that many times (20 by default).
//   LAB_VCS=jj makes each computer's clone a colocated Jujutsu repository (`jj git init --colocate`; the
//   origin stays a bare Git repository). A task's branch is a bookmark on the working copy and the
//   landing cases run `jj commit` and `jj git push`. A last step makes a task's checkout as herdr's
//   launcher does, a jj workspace with its bookmark and checks `jj status` stays clean. The contract
//   scenario is Git only.
//   LAB_JJ_STEPS=2,4,6 (with LAB_VCS=jj) runs only those of step 6's seven; LAB_JJ_ONLY=1 runs them without the
//   rest of the program. Every jj the lab runs gets XDG_CONFIG_HOME (and, without real agents, HOME) inside the
//   lab's directory, where jj 0.46 keeps repository and workspace configuration.
//   REAL_SCENARIO=follow (LAB_VCS=jj; peer-lab/follow.ts) is the paid measure of building on a teammate's change:
//   Ana's agent changes orderTotal() to cents, Bob's agent is started from her change, and Ana amends it while he
//   works. It reports whether Bob's final tree is right, whether an edit was lost, how many converges ran, the
//   moved notices Bob's agent heard and the characters Peer added. With REAL_AGENTS=1 it spends the person's
//   subscription and runs only after the maintainer agrees; without it scripted stand-ins play both agents.
//   REAL_SCENARIO=rooms LAB_SHARED=1 REAL_AGENTS=1 (LAB_VCS=jj for Jujutsu) proves one room across two projects: a
//   message in the room starts one real agent, with a checkout of its own in both, and each project's diff shows its work.
//   REAL_SCENARIO=rooms LAB_RETRY=1 REAL_AGENTS=1 (LAB_VCS=jj for Jujutsu) proves Try again on real agents in chats: an
//   open run that committed goes on in its checkout, on its model, as one run; a run that ended gets a new one there; a
//   run that left nothing starts over from the base. The room's diff shows the commit throughout. A task starts from
//   what a teammate pushed, and the person's own checkout stays where it was. Peer remembers each checkout it made, once;
//   closing a chat removes those that hold nothing and keeps the one with a commit no remote has. Nobody syncs: the room
//   says an agent stopped by itself, at its session's end and, for one killed outright, when its lease runs out. An agent
//   that read a message on a hook leaves it `taken`, and gets the same words and a working Try again.
//   REAL_SCENARIO=rooms (peer-lab/rooms.ts) proves a task's room: Bob names Ana's agent and nothing reaches it until she
//   passes it on, she declines and Bob's status moves with no new message, Bob withdraws, a hostile message stays
//   fenced, an agent cannot name an agent, Bob's own agent answers from a review session on his computer after Ana's run
//   ended, and a restart with a `taken` delivery starts nothing. A stand-in herdr takes the agents Peer starts.
//   LAB_CONTRACT=hard (with REAL_SCENARIO=contract) gives nothing of Ana's change away: neutral
//   titles and branches, and both agents start together.
//   LAB_CONTRACT=hidden (with REAL_SCENARIO=contract) is a dependency nobody names: Ana's task makes
//   orderTotal() return integer cents under the same name, Bob's adds loyalty points in a new file.
//   REAL_SCENARIO=memory (peer-lab/ownMemory.ts, REAL_AGENTS=1, kernel only) measures whether an agent picks the right
//   memory store; LAB_VIKING_URL names the OpenViking server, LAB_MEMORY_ARM=none|tools|hint|card what the agent has, and
//   LAB_MEMORY=adapter whether an agent opens a store for another agent that cannot.
//   REAL_SCENARIO=ready (peer-lab/ready.ts, REAL_AGENTS=1, kernel only) measures whether an agent surfaces a person's
//   decisions, with a card that says not to stop (LAB_READY=card) and without one.
//   LAB_CONTRACT=deferred is the hidden seed with Bob told to compute his points from orderTotal() and to
//   keep his branch right with the code it has, so that what he learns of Ana's change belongs to whoever
//   lands both. LAB_INTEGRATE=1 (implied by deferred; peer-lab/hidden.ts) then adds the integration step:
//   after both agents finish and their sessions end, a fresh session on Ana's computer, on KRK-1, is asked
//   to merge Bob's branch into hers, make sure it works and push it, and the lab runs its checks on what
//   was pushed to origin.git. It reports whether that session was given what the agents wrote in KRK-1's
//   room (Ana's debug log: the hook that carried it, landing.stopped), whether the pushed tree is right, and
//   the characters Peer added to it. The arms are the default and LAB_PEER=off. Without REAL_AGENTS=1
//   scripted stand-ins play every session: Bob's asks KRK-1 and says there, in words that defer the change,
//   what whoever lands both has to do, the integrator divides by a hundred only if Peer told it so, and the
//   dry run checks that the arms differ as they should.
//
// The computers run apps/server/dist/bin.mjs: build it (`vp pack` in apps/server) after changing the
// broker, or the lab tests the build it finds. LAB_SERVER_BIN=<dir>/bin.mjs runs a private build
// (`vp pack -d <fresh-empty-dir>` in apps/server). After packing succeeds, attach its runtime
// node_modules and copy the web build to <dir>/client. Never pack into a directory that already
// contains links: the bundle cleaner may follow them. The private build leaves dist alone.
//
// REAL_AGENTS=1 HERDR_BIN=… runs real agents instead (Sonnet, one herdr server per computer, Peer's
// hooks passed with --settings, the user's own settings and MCP servers left out) in the scenarios
// below that ask for them. It spends the person's subscription.
//
// REAL_SCENARIO=contract (peer-lab/contract.ts): a contract migration. Ana's agent renames
// Invoice.amount (dollars) to amountCents (integer cents); Bob's adds an invoice total in a new file.
// Arms run on the same seeds: LAB_PEER=off (no Peer) and none of them
// (Peer as it is). The lab merges both branches
// and runs checks the agents never saw, then reports clean integration, whether Bob's code uses
// amountCents, and the characters Peer added to each agent's context. With
// REAL_AGENTS=1 the agents are real (REAL_KINDS, claude,codex by default) and each arm spends the
// person's subscription; without it, scripted stand-ins for the model do what Peer's words say, a
// dry run of everything else that spends nothing.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";
import { RpcClient, RpcSerialization } from "effect/rpc";

import {
  ORCHESTRATION_PROTOCOL_VERSION,
  PEER_JUJUTSU_METHODS,
  PEER_ROOM_SESSION_ENDED,
  PEER_ROOMS_METHODS,
  WS_METHODS,
  WsRpcGroup,
  type PeerRoomMessage,
} from "@t3tools/contracts";

import { codexPeerPluginEnabled, codexPeerPluginPaths } from "../src/peerHub/codexPlugin.ts";
import {
  claudeHookGroups,
  codexHookGroups,
  type HookGroup,
} from "../src/peerHub/core/adapters/scripts.ts";

import {
  ROOMS_ANA_TASK,
  ROOMS_REAL_OWN,
  ROOMS_REAL_QUESTION,
  ROOMS_TASK,
  deliveryOf,
  runRooms,
  standInHerdr,
  wholeFence,
  type RoomsAgent,
  type RoomsKit,
  type RoomsPerson,
  type RoomsRun,
} from "./peer-lab/rooms.ts";
import { peerAdded, toldTexts, type LabEvent } from "./peer-lab/told.ts";
import { dropOperatorPeerPath, dropOperatorSession } from "./peer-lab/operatorEnv.ts";
import {
  ADAPTER_ANA_TASK,
  ADAPTER_BOB_TASK,
  ADAPTER_CARD,
  MEMORY_CARD,
  MEMORY_TASK,
  MEMORY_TASKS,
  adapterRight,
  claudeMcpConfig,
  judgeLoyalty,
  memoryArmOf,
  memoryFacts,
  memoryServers,
  writeKontextEntries,
  writeMemorySeed,
} from "./peer-lab/ownMemory.ts";
import { AWAY, READY_CARD, READY_TASK, READY_TASKS, writeReadySeed } from "./peer-lab/ready.ts";
import {
  ANA_TASK,
  ARM_LABELS,
  BOB_TASK,
  HARD_TASKS as HARD_CONTRACT_TASKS,
  TASKS as EASY_CONTRACT_TASKS,
  agentReport,
  armOf,
  commitWork,
  currentBranch,
  formatResult,
  integrate,
  runStub,
  writeSeed,
  type Work,
} from "./peer-lab/contract.ts";
import {
  FOLLOW_AMEND_TASK,
  FOLLOW_ANA_TASK,
  FOLLOW_BOB_TASK,
  FOLLOW_TASKS,
  checkFollowTree,
  followResult,
  formatFollow,
  pushAnas,
  runFollowStub,
} from "./peer-lab/follow.ts";
import {
  chosenSteps as chosenJujutsuSteps,
  jjHomeEnv,
  runJujutsuSteps,
  type JujutsuKit,
} from "./peer-lab/jujutsu.ts";
import {
  DEFERRED_BOB_TASK,
  HIDDEN_ANA_TASK,
  HIDDEN_BOB_TASK,
  HIDDEN_TASKS,
  finishIntegration,
  formatHidden,
  integratePrompt,
  integrateHidden,
  integratorReport,
  landed,
  runDeferredStub,
  runHiddenStub,
  runIntegratorStub,
  startIntegration,
  writeHiddenSeed,
  wasGiven,
  type IntegratorReport,
} from "./peer-lab/hidden.ts";

// Run from an agent's shell, the lab would hand that agent's Peer session to every child it starts.

const droppedOperatorKeys = dropOperatorSession(process.env);
if (droppedOperatorKeys.length > 0)
  say("left out of every child's environment", droppedOperatorKeys.join(", "));
// …and a bare `peer` in a lab agent's shell would reach the operator's real Peer.
const droppedPeerPath = dropOperatorPeerPath(process.env);
if (droppedPeerPath.length > 0) say("left out of every child's PATH", droppedPeerPath.join(", "));
const repoRoot = NodePath.resolve(import.meta.dirname, "../../..");
const peerhubBin = process.env.PEERHUB_BIN ?? "peerhub";
const hubPort = 42000 + Math.floor(Math.random() * 1000);
const hubUrl = `http://127.0.0.1:${hubPort}`;
const lab = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-lab-"));
const REAL = process.env.REAL_AGENTS === "1";
// jj 0.46 keeps a repository's and a workspace's configuration under the user's config directory, so a
// lab that runs jj would leave a directory there for every repository it makes. Every process the lab
// starts gets a home of its own that goes with the lab. Real agents keep the person's HOME, where their
// Claude Code or Codex signs in; jj finds its configuration through XDG_CONFIG_HOME alone.
if (process.env.LAB_VCS === "jj") {
  const jjHome = NodePath.join(lab, "jj-home");
  NodeFS.mkdirSync(jjHome, { recursive: true });
  Object.assign(process.env, jjHomeEnv(jjHome, REAL));
}
/**
 * REAL_SCENARIO=follow (LAB_VCS=jj, `peer-lab/follow.ts`): Bob's agent is started from Ana's change and Ana amends it
 * while he works. Real agents with REAL_AGENTS=1 (paid, only after the maintainer agrees), scripted stand-ins without.
 */
const FOLLOW = process.env.REAL_SCENARIO === "follow";
/** REAL_SCENARIO=rooms (`peer-lab/rooms.ts`): a task's room between two people and their agents. */
const ROOMS = process.env.REAL_SCENARIO === "rooms";
/** LAB_SHARED=1: the room of a workspace, two projects and one real agent. */
const SHARED = ROOMS && REAL && process.env.LAB_SHARED === "1";
/** LAB_RETRY=1: Try again on the work real agents left in chats. */
const RETRY = ROOMS && REAL && process.env.LAB_RETRY === "1";
if (process.env.LAB_VCS !== undefined && !["git", "jj"].includes(process.env.LAB_VCS)) {
  throw new Error(`LAB_VCS must be git or jj, not ${process.env.LAB_VCS}`);
}
/** LAB_VCS=jj: every computer's clone is a colocated Jujutsu repository (design D9 of add-jujutsu-support). */
const JJ = process.env.LAB_VCS === "jj";
if (FOLLOW && !JJ) throw new Error("REAL_SCENARIO=follow needs LAB_VCS=jj");
if (JJ && process.env.REAL_SCENARIO === "contract") {
  throw new Error("LAB_VCS=jj runs the default program and follow; this scenario is Git only");
}
/** REAL_SCENARIO=contract: a contract migration, with real agents or, without REAL_AGENTS=1, scripted stand-ins. */
const CONTRACT = process.env.REAL_SCENARIO === "contract";
/** REAL_SCENARIO=memory (`peer-lab/ownMemory.ts`): an agent, kontext and OpenViking, with nothing of them in Peer. */
const MEMORY = process.env.REAL_SCENARIO === "memory";
const MEMORY_ADAPTER = MEMORY && process.env.LAB_MEMORY === "adapter";
const MEMORY_ARM = memoryArmOf(process.env);
/** REAL_SCENARIO=ready (`peer-lab/ready.ts`): what an agent surfaces when it is asked at the end. */
const READY = process.env.REAL_SCENARIO === "ready";
/** The scenarios that bring their own project, instead of the pricing files of the default program. */
const OWN_SEED = CONTRACT || FOLLOW || MEMORY || READY;
/** LAB_CONTRACT=hard: the contract scenario with nothing that gives Ana's change away (contract.ts). */
const CONTRACT_HARD = CONTRACT && process.env.LAB_CONTRACT === "hard";
if (
  CONTRACT &&
  process.env.LAB_CONTRACT !== undefined &&
  !["hard", "hidden", "deferred"].includes(process.env.LAB_CONTRACT)
) {
  throw new Error(`LAB_CONTRACT must be hard, hidden or deferred, not ${process.env.LAB_CONTRACT}`);
}
/**
 * LAB_CONTRACT=deferred: the hidden seed with Bob told to compute his points from orderTotal() and to keep his
 * branch right with the code it has (hidden.ts). Whatever he learns of Ana's change is for whoever lands both.
 */
const CONTRACT_DEFERRED = CONTRACT && process.env.LAB_CONTRACT === "deferred";
/** LAB_CONTRACT=hidden or deferred: a dependency nobody names, a unit that changes under the same name (hidden.ts). */
const CONTRACT_HIDDEN = CONTRACT && (process.env.LAB_CONTRACT === "hidden" || CONTRACT_DEFERRED);
if (process.env.LAB_INTEGRATE !== undefined && !["0", "1"].includes(process.env.LAB_INTEGRATE)) {
  throw new Error(`LAB_INTEGRATE must be 0 or 1, not ${process.env.LAB_INTEGRATE}`);
}
/**
 * LAB_INTEGRATE=1 (implied by LAB_CONTRACT=deferred): after both agents finish, a fresh session on Ana's computer
 * merges Bob's branch into hers and pushes it, and the lab checks what was pushed (hidden.ts).
 */
const INTEGRATE = CONTRACT_DEFERRED || process.env.LAB_INTEGRATE === "1";
if (process.env.LAB_INTEGRATE_ASK !== undefined && process.env.LAB_INTEGRATE_ASK !== "quick") {
  throw new Error(`LAB_INTEGRATE_ASK is quick or unset, not ${process.env.LAB_INTEGRATE_ASK}`);
}
/** LAB_INTEGRATE_ASK=quick: the integrator is asked to merge and push, not to make sure the result works. */
const INTEGRATE_QUICK = process.env.LAB_INTEGRATE_ASK === "quick";
if (INTEGRATE && !CONTRACT_HIDDEN) {
  throw new Error(
    "LAB_INTEGRATE=1 needs REAL_SCENARIO=contract with LAB_CONTRACT=hidden or deferred",
  );
}
const CONTRACT_TASKS = CONTRACT_HIDDEN
  ? HIDDEN_TASKS
  : CONTRACT_HARD
    ? HARD_CONTRACT_TASKS
    : EASY_CONTRACT_TASKS;
const CONTRACT_ANA_TASK = CONTRACT_HIDDEN ? HIDDEN_ANA_TASK : ANA_TASK;
const CONTRACT_BOB_TASK = CONTRACT_DEFERRED
  ? DEFERRED_BOB_TASK
  : CONTRACT_HIDDEN
    ? HIDDEN_BOB_TASK
    : BOB_TASK;
/** The contract scenario's arm: `LAB_PEER=off`, or Peer as it is. */
const ARM = CONTRACT ? armOf(process.env) : ("peer" as const);
/** The server the computers run: the bundle in apps/server/dist, or `LAB_SERVER_BIN` (a private build, `vp pack -d <dir>`). */
const bin = process.env.LAB_SERVER_BIN ?? NodePath.join(repoRoot, "apps/server/dist/bin.mjs");
/** A stand-in for the Claude Code that judges related work in the background, and what it was asked. */
const children: NodeChildProcess.ChildProcess[] = [];

function say(step: string, detail = "") {
  console.log(`[lab] ${step}${detail === "" ? "" : `: ${detail}`}`);
}
function told(agent: string, text: string | null | undefined) {
  console.log(
    `\n  ┌ ${agent} was told:\n  │ ${(text ?? "(nothing)").replaceAll("\n", "\n  │ ")}\n  └\n`,
  );
}
function check(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(`expected: ${what}`);
  say("ok", what);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function spawnLogged(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = NodeChildProcess.spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  const output: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  return { child, output };
}

async function waitFor(what: string, ready: () => Promise<boolean>, output: string[]) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await ready().catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not start:\n${output.join("").slice(-2000)}`);
}

const hub = spawnLogged(peerhubBin, ["serve"], {
  ...process.env,
  PEERHUB_DB: "mem://lab",
  PEERHUB_BIND: `127.0.0.1:${hubPort}`,
  PEERHUB_PUBLIC_URL: hubUrl,
  PEERHUB_MAIL: "echo",
  PEERHUB_SECRET_KEY: NodeCrypto.randomBytes(32).toString("hex"),
});

async function hubCall(path: string, init: { method?: string; session?: string; body?: unknown }) {
  const response = await fetch(`${hubUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.session === undefined ? {} : { authorization: `Bearer ${init.session}` }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function git(cwd: string, ...args: string[]) {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "lab",
      GIT_AUTHOR_EMAIL: "lab@acme.test",
      GIT_COMMITTER_NAME: "lab",
      GIT_COMMITTER_EMAIL: "lab@acme.test",
    },
  });
}

/** jj in `cwd`, as the lab's `lab` identity, without a pager or colour. */
function jj(cwd: string, ...args: string[]) {
  return NodeChildProcess.execFileSync("jj", ["--no-pager", "--color=never", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, JJ_USER: "lab", JJ_EMAIL: "lab@acme.test" },
  });
}

/** LAB_VCS=jj: a clone Peer made becomes a colocated jj repository; its `main` becomes a bookmark. */
function colocate(checkout: string) {
  jj(checkout, "git", "init", "--colocate");
  check(
    NodeFS.existsSync(NodePath.join(checkout, ".jj")),
    `${checkout} is a colocated jj repository`,
  );
}

/**
 * A new branch for the task from where the checkout stands, as `git checkout -b` makes it. In jj the
 * task's bookmark goes on the working-copy change (as herdr's launcher puts it), and a bookmark there
 * before goes back to the change below it, where Git would have left that branch.
 */
function branchOff(checkout: string, name: string) {
  if (!JJ) return void git(checkout, "checkout", "--quiet", "-b", name);
  jj(checkout, "bookmark", "move", "--from", "@", "--to", "@-", "--allow-backwards");
  jj(checkout, "bookmark", "create", name, "-r", "@");
}

/** Whether kontext is installed: the memory scenario's project keeps its rules with it. */
const kontext = (() => {
  try {
    NodeChildProcess.execFileSync("kontext", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A small project both agents will work on, as a bare origin. */
/** A second project's repository, a copy of the first's history. */
function makeSiteOrigin(origin: string): string {
  const site = NodePath.join(lab, "site.git");
  NodeChildProcess.execFileSync("git", ["clone", "--quiet", "--bare", origin, site]);
  return site;
}

function makeOrigin(): string {
  const work = NodePath.join(lab, "seed");
  NodeFS.mkdirSync(NodePath.join(work, "src"), { recursive: true });
  // The contract scenario starts from its own project: invoices in dollars.
  if (CONTRACT) (CONTRACT_HIDDEN ? writeHiddenSeed : writeSeed)(work);
  // The follow scenario starts from the hidden seed: orderTotal() in euros, used by the receipt and VAT.
  if (FOLLOW) writeHiddenSeed(work);
  if (MEMORY) writeMemorySeed(work, { hint: MEMORY_ARM === "hint" || MEMORY_ARM === "card" });
  if (READY) writeReadySeed(work);
  if (!OWN_SEED) {
    NodeFS.writeFileSync(
      NodePath.join(work, "src/pricing.ts"),
      "export function price(items: number[]): number {\n  return items.reduce((sum, item) => sum + item, 0);\n}\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(work, "src/cart.ts"),
      'import { price } from "./pricing";\n\nexport const cartTotal = (items: number[]) => price(items);\n',
    );
  }
  if (REAL && !OWN_SEED) {
    // Prices are integer cents, and other files rely on it: something worth keeping.
    NodeFS.writeFileSync(
      NodePath.join(work, "src/format.ts"),
      "export const formatPrice = (cents: number): string => `€${(cents / 100).toFixed(2)}`;\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(work, "src/receipt.ts"),
      'import { formatPrice } from "./format";\nimport { price } from "./pricing";\n\nexport const receiptLine = (items: number[]) => formatPrice(price(items));\n',
    );
  }
  git(work, "init", "--quiet", "--initial-branch", "main");
  // What the person set up in the memory scenario: Peer knows nothing of it.
  if (MEMORY && !MEMORY_ADAPTER && MEMORY_ARM !== "none") {
    if (kontext) NodeChildProcess.execFileSync("kontext", ["init", "--no-hooks"], { cwd: work });
    writeKontextEntries(work);
  }
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "pricing");
  const origin = NodePath.join(lab, "origin.git");
  git(lab, "clone", "--quiet", "--bare", work, origin);
  return origin;
}

/** Ana's session with the hub, to read what it stores. */
let hubSession = "";
/** KRK-1's id at the hub, with real agents. */
let krk1Id = "";

async function setUpWorkspace() {
  const started = await hubCall("/v1/auth/email/start", {
    method: "POST",
    body: { email: "ana@acme.test" },
  });
  const finished = await hubCall("/v1/auth/email/verify", {
    method: "POST",
    body: { email: "ana@acme.test", code: started.code },
  });
  const admin = finished.session as string;
  hubSession = admin;
  await hubCall("/v1/workspaces", {
    method: "POST",
    session: admin,
    body: { slug: "acme", name: "Acme", allowedDomains: ["acme.test"] },
  });
  const origin = makeOrigin();
  await hubCall("/v1/workspaces/acme/config", {
    method: "PUT",
    session: admin,
    body: {
      revision: "lab",
      config: {
        people: { "ana@acme.test": { name: "Ana" }, "bob@acme.test": { name: "Bob" } },
        projects: {
          lab: { name: "Lab", repositories: [{ id: "app", url: origin, branch: "main" }] },
          ...(SHARED
            ? {
                site: {
                  name: "Site",
                  repositories: [{ id: "app", url: makeSiteOrigin(origin), branch: "main" }],
                },
              }
            : {}),
        },
      },
    },
  });
  if (CONTRACT) {
    for (const task of CONTRACT_TASKS)
      await hubCall("/v1/workspaces/acme/projects/lab/tasks", {
        method: "POST",
        session: admin,
        body: { title: task.title, key: task.key },
      });
  } else if (MEMORY || READY) {
    for (const task of MEMORY ? MEMORY_TASKS : READY_TASKS) {
      const made = await hubCall("/v1/workspaces/acme/projects/lab/tasks", {
        method: "POST",
        session: admin,
        body: { title: task.title, key: task.key },
      });
      if (task.key === "KRK-1") krk1Id = String(made.id);
    }
  } else if (REAL && !FOLLOW && !ROOMS) {
    const krk1 = await hubCall("/v1/workspaces/acme/projects/lab/tasks", {
      method: "POST",
      session: admin,
      body: { title: "Pricing", key: "KRK-1" },
    });
    krk1Id = String(krk1.id);
  }
}

const startComputer = Effect.fn("lab.startComputer")(function* (
  name: string,
  email: string,
  herdrSocket?: string,
  hubOverride?: string,
  /** More environment for this computer's Peer: a switch the lab turns by itself. */
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const home = NodePath.join(lab, name.toLowerCase());
  const workspaceRoot = NodePath.join(home, "workspace");
  const port = 43000 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    PEER_HUB_URL: hubOverride ?? hubUrl,
    PEER_WORKSPACE: workspaceRoot,
    // Never this machine's real herdr or Claude Code settings.
    HERDR_SOCKET_PATH: herdrSocket ?? NodePath.join(home, "no-herdr.sock"),
    CLAUDE_CONFIG_DIR: NodePath.join(home, "claude"),
    T3CODE_TELEMETRY_ENABLED: "false",
    ...(REAL
      ? {}
      : {
          // Peer adds its hooks to this computer's own Codex, never this machine's, and hands
          // nothing to Codex threads: the lab's Codex sessions are made up.
          CODEX_HOME: NodePath.join(home, "codex"),
          PEER_CODEX_QUEUE: "off",
        }),
    // The lab reads the debug log (texts, paths, answers), with real agents as with simulated ones.
    PEER_COORDINATION_DEBUG: "1",
    // The contract scenario's arm: what this computer has on.
    ...extraEnv,
  };
  const server = yield* serve(name, home, port, env);
  const client = yield* connect(home, port, env);

  const pending = yield* client[WS_METHODS.peerHubStartSignIn]({ email });
  yield* client[WS_METHODS.peerHubFinishSignIn]({
    code: pending.pendingSignIn?.echoedCode ?? "",
  });
  const opened = yield* client[WS_METHODS.peerHubOpenProject]({
    workspace: "acme",
    projectId: "lab",
  });
  const checkout = opened.workspaces[0]?.projects.find((p) => p.project.id === "lab")
    ?.repositories[0];
  if (checkout?.state !== "ready") throw new Error(`${name} could not check the project out`);
  if (JJ) colocate(checkout.path);
  const coordinated = yield* client[WS_METHODS.peerHubSetCoordination]({ enabled: true });
  say(`${name}'s computer`, `checkout ${checkout.path}, log ${coordinated.coordination.logPath}`);
  // LAB_CAPTURE_DIR: where each computer's Peer listens, so a film can show its app beside its agent.
  if (process.env.LAB_CAPTURE_DIR) {
    NodeFS.mkdirSync(process.env.LAB_CAPTURE_DIR, { recursive: true });
    NodeFS.appendFileSync(
      NodePath.join(process.env.LAB_CAPTURE_DIR, "computers.jsonl"),
      `${JSON.stringify({ name, port, home, bin, at: Date.now() })}\n`,
    );
  }
  const scriptsDir = NodePath.join(home, "userdata", "coord");
  return {
    name,
    home,
    port,
    env,
    server,
    client,
    checkout: checkout.path,
    scripts: {
      hook: NodePath.join(scriptsDir, "hook"),
      wait: NodePath.join(scriptsDir, "wait"),
      peer: NodePath.join(scriptsDir, "bin", "peer"),
    },
    log: debugPathOf(coordinated.coordination.logPath),
  };
});

type Computer = Effect.Success<ReturnType<typeof startComputer>>;

/** A computer's Peer server on its home, until it says it listens. */
const serve = Effect.fn("lab.serve")(function* (
  name: string,
  home: string,
  port: number,
  env: NodeJS.ProcessEnv,
) {
  const server = spawnLogged(
    process.execPath,
    [
      bin,
      "serve",
      "--base-dir",
      home,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-browser",
    ],
    env,
  );
  yield* Effect.promise(() =>
    waitFor(
      `${name}'s server`,
      async () => server.output.join("").includes("Listening on"),
      server.output,
    ),
  );
  yield* Effect.sleep("1500 millis");
  return server;
});

/** A client of a computer's Peer, as its app connects: a session token, a ticket, the WebSocket. */
const connect = Effect.fn("lab.connect")(function* (
  home: string,
  port: number,
  env: NodeJS.ProcessEnv,
) {
  const token = NodeChildProcess.execFileSync(
    process.execPath,
    [bin, "auth", "session", "issue", "--base-dir", home, "--token-only", "--label", "lab"],
    { env, encoding: "utf8" },
  ).trim();
  const ticket = yield* Effect.promise(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/websocket-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return ((await response.json()) as { ticket: string }).ticket;
  });
  const url = `ws://127.0.0.1:${port}/ws?wsTicket=${encodeURIComponent(ticket)}&orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}`;
  const protocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({ retryTransientErrors: false }),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Socket.layerWebSocket(url).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
        RpcSerialization.layerJson,
      ),
    ),
  );
  const context = yield* Layer.build(protocol);
  return yield* RpcClient.make(WsRpcGroup).pipe(Effect.provide(context));
});

/**
 * Peer quits on a computer and starts again, as for an update: its server stops as the app quits
 * (its broker keeps what each agent was told), then starts on the same home and resumes
 * coordination by itself, while the agents run on in herdr.
 */
const restartComputer = Effect.fn("lab.restartComputer")(function* (
  computer: Computer,
  during: () => Promise<void> = async () => {},
) {
  const child = computer.server.child;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  yield* Effect.promise(() => Promise.race([exited, sleep(20_000)]));
  check(child.exitCode !== null || child.signalCode !== null, `${computer.name}'s Peer quit`);
  yield* Effect.promise(during);
  computer.server = yield* serve(computer.name, computer.home, computer.port, computer.env);
  computer.client = yield* connect(computer.home, computer.port, computer.env);
});

/** What a hook printed for Claude Code. */
type HookOut = {
  readonly hookSpecificOutput?: {
    readonly additionalContext?: string;
    readonly permissionDecision?: string;
    readonly permissionDecisionReason?: string;
    readonly updatedInput?: { readonly command?: string };
    /** Codex's answer to a PermissionRequest. */
    readonly decision?: { readonly behavior?: string };
  };
} | null;

function agent(
  computer: Computer,
  sessionId: string,
  pane: string,
  /** More environment for this agent's shell and hooks: `PEER_COORDINATION=off`, as a run with no Peer gives it. */
  extraEnv: NodeJS.ProcessEnv = {},
  /** Where it works: a task's worktree of the checkout (the checkout itself by default). */
  cwd: string = computer.checkout,
) {
  const env = {
    ...process.env,
    HERDR_PANE_ID: pane,
    PEER_SESSION: sessionId,
    PEER_SESSION_TOKEN: "",
    CODEX_THREAD_ID: "",
    ...extraEnv,
  };
  let sessionEnvFile: string | undefined;
  let lastPeerStatus = 0;
  const base = { session_id: sessionId, cwd, transcript_path: "/dev/null" };
  const file = (path: string) => NodePath.join(cwd, path);
  return {
    name: `${computer.name}'s agent`,
    cli: computer.scripts.peer,
    file,
    hook(event: string, extra: Record<string, unknown> = {}): HookOut {
      const out = NodeChildProcess.execFileSync("sh", [computer.scripts.hook], {
        env,
        input: JSON.stringify({ ...base, hook_event_name: event, ...extra }),
        encoding: "utf8",
      }).trim();
      return out === "" ? null : (JSON.parse(out) as HookOut);
    },
    edit(event: "PreToolUse" | "PostToolUse", path: string) {
      return this.hook(event, {
        tool_name: "Edit",
        tool_input: { file_path: file(path), old_string: "a", new_string: "b" },
      });
    },
    /**
     * A hook run that is started but has not begun: its script waits for the event, which `go()`
     * hands it, so two agents' hooks can begin in the same moment (`hook` waits for its run).
     */
    prepare(event: string, extra: Record<string, unknown> = {}) {
      const child = NodeChildProcess.spawn("sh", [computer.scripts.hook], {
        env,
        stdio: ["pipe", "pipe", "ignore"],
      });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      const finished = new Promise<HookOut>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", () => resolve(out.trim() === "" ? null : (JSON.parse(out) as HookOut)));
      });
      return {
        go(): Promise<HookOut> {
          child.stdin.end(JSON.stringify({ ...base, hook_event_name: event, ...extra }));
          return finished;
        },
      };
    },
    /** Runs `peer …` the way the agent's Bash tool would: its hook first, then what the hook made of it. */
    peer(...args: string[]) {
      const command = ["peer", ...args.map((a) => `"${a}"`)].join(" ");
      const gate = this.hook("PreToolUse", { tool_name: "Bash", tool_input: { command } });
      const rewritten = gate?.hookSpecificOutput?.updatedInput?.command;
      if (gate?.hookSpecificOutput?.permissionDecision !== "allow" || rewritten === undefined) {
        throw new Error(`Peer's own command was not let through: ${JSON.stringify(gate)}`);
      }
      const prefix =
        sessionEnvFile === undefined ? "" : `. '${sessionEnvFile.replaceAll("'", "'\\''")}'; `;
      const result = NodeChildProcess.spawnSync("sh", ["-c", `${prefix}${rewritten}`], {
        env,
        cwd,
        encoding: "utf8",
      });
      if (result.error) throw result.error;
      lastPeerStatus = result.status ?? 4;
      return (lastPeerStatus === 0 ? result.stdout : result.stderr).trim();
    },
    async peerAsync(...args: string[]) {
      const command = ["peer", ...args.map((a) => '"' + a + '"')].join(" ");
      const gate = await this.prepare("PreToolUse", {
        tool_name: "Bash",
        tool_input: { command },
      }).go();
      const rewritten = gate?.hookSpecificOutput?.updatedInput?.command;
      if (!rewritten || gate?.hookSpecificOutput?.permissionDecision !== "allow")
        throw new Error("Peer command was not let through.");
      const prefix =
        sessionEnvFile === undefined ? "" : ". '" + sessionEnvFile.replaceAll("'", "'\\''") + "'; ";
      return new Promise<string>((resolve, reject) => {
        const child = NodeChildProcess.spawn("sh", ["-c", prefix + rewritten], {
          env,
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "",
          err = "";
        child.stdout.on("data", (b: Buffer) => {
          out += b.toString();
        });
        child.stderr.on("data", (b: Buffer) => {
          err += b.toString();
        });
        child.on("error", reject);
        child.on("close", (status) => {
          lastPeerStatus = status ?? 4;
          resolve((status === 0 ? out : err).trim());
        });
      });
    },
    get peerStatus() {
      return lastPeerStatus;
    },
    /**
     * A session starting as Claude Code starts it: the SessionStart hook may write the
     * session's environment, which every later Bash command of the session sources.
     */
    start(): { readonly envFile: string; readonly told: string | undefined } {
      const envFile = NodePath.join(computer.home, `env-${sessionId}.sh`);
      sessionEnvFile = envFile;
      NodeFS.writeFileSync(envFile, "");
      const out = NodeChildProcess.execFileSync("sh", [computer.scripts.hook], {
        env: { ...env, CLAUDE_ENV_FILE: envFile },
        input: JSON.stringify({ ...base, hook_event_name: "SessionStart", source: "startup" }),
        encoding: "utf8",
      }).trim();
      return { envFile, told: context(out === "" ? null : (JSON.parse(out) as HookOut)) };
    },
    /** A command as the agent's Bash tool runs it: in the session's environment. */
    shell(envFile: string, command: string): string {
      return NodeChildProcess.execFileSync("sh", ["-c", `. '${envFile}'; ${command}`], {
        env,
        cwd,
        encoding: "utf8",
      }).trim();
    },
    /** The Stop hook's background wait: resolves with what woke the agent, or null. */
    idle(): Promise<string | null> {
      this.hook("Stop");
      return new Promise((resolve) => {
        const child = NodeChildProcess.spawn("sh", [computer.scripts.wait], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        children.push(child);
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("exit", (code) => resolve(code === 2 ? stderr.trim() : null));
        child.stdin.end(JSON.stringify({ ...base, hook_event_name: "Stop" }));
      });
    },
  };
}

/**
 * An agent as Codex runs Peer's hooks: the hook told it is Codex's, Codex's
 * payloads, its shell as Bash and its edits as apply_patch with paths relative
 * to its directory, and its commands given their thread as CODEX_THREAD_ID.
 */
function codexAgent(
  computer: Computer,
  sessionId: string,
  pane: string,
  /** The installed Peer plugin whose wrapper runs its hooks, as Codex runs them. */
  plugin?: string,
) {
  const env = { ...process.env, HERDR_PANE_ID: pane };
  const base = {
    session_id: sessionId,
    cwd: computer.checkout,
    transcript_path: null,
    model: "gpt-5",
    permission_mode: "default",
    turn_id: "turn-1",
  };
  const patch = (paths: ReadonlyArray<string>) =>
    [
      "*** Begin Patch",
      ...paths.flatMap((path) => [`*** Update File: ${path}`, "@@", "-a", "+b"]),
      "*** End Patch",
    ].join("\n");
  return {
    name: `${computer.name}'s agent (Codex)`,
    hook(event: string, extra: Record<string, unknown> = {}): HookOut {
      const script =
        plugin === undefined
          ? [computer.scripts.hook, "codex"]
          : [NodePath.join(plugin, "scripts", "hook.sh")];
      const out = NodeChildProcess.execFileSync("sh", script, {
        env,
        input: JSON.stringify({ ...base, hook_event_name: event, ...extra }),
        encoding: "utf8",
      }).trim();
      return out === "" ? null : (JSON.parse(out) as HookOut);
    },
    patch(event: "PreToolUse" | "PostToolUse", paths: ReadonlyArray<string>) {
      return this.hook(event, {
        tool_name: "apply_patch",
        tool_use_id: "call-patch",
        tool_input: { command: patch(paths) },
        ...(event === "PostToolUse"
          ? { tool_response: "Success. Updated the following files" }
          : {}),
      });
    },
    /** `peer …` as Codex's Bash runs it: the hook rewrites it, Codex runs what it was given. */
    peer(...args: string[]): {
      readonly ran: string;
      readonly out: string;
      readonly status: number;
    } {
      const command = `peer ${args.map((a) => `"${a}"`).join(" ")} 2>&1 | head -20`;
      const gate = this.hook("PreToolUse", {
        tool_name: "Bash",
        tool_use_id: "call-peer",
        tool_input: { command },
      });
      const ran = gate?.hookSpecificOutput?.updatedInput?.command;
      if (gate?.hookSpecificOutput?.permissionDecision !== "allow" || ran === undefined) {
        throw new Error(`Peer's own command was not let through: ${JSON.stringify(gate)}`);
      }
      const result = NodeChildProcess.spawnSync("sh", ["-c", ran], {
        env: { ...env, CODEX_THREAD_ID: sessionId },
        cwd: computer.checkout,
        encoding: "utf8",
      });
      if (result.error) throw result.error;
      return {
        ran,
        out: ((result.status ?? 4) === 0 ? result.stdout : result.stderr).trim(),
        status: result.status ?? 4,
      };
    },
    /** Codex asking its person for a tool call. */
    permission(toolName: string, toolInput: Record<string, unknown>) {
      return this.hook("PermissionRequest", { tool_name: toolName, tool_input: toolInput });
    },
  };
}

const context = (out: HookOut) => out?.hookSpecificOutput?.additionalContext;
const decision = (out: HookOut) => out?.hookSpecificOutput?.permissionDecision;

/** A computer's status as its Peer last had it: the lab's observation, never a request of its own. */
const cachedStatus = (computer: Computer) =>
  Effect.runPromise(
    computer.client[WS_METHODS.peerHubSubscribe]({}).pipe(
      Stream.runHead,
      Effect.map((value) => {
        if (value._tag === "None") throw new Error("no cached status");
        return value.value;
      }),
    ),
  );

/** How many times step 5 races the two computers for a new file. */
const RACE_RUNS = Math.max(1, Number(process.env.LAB_RACE_RUNS) || 20);

/** Whether the hub decides edits (`/intent`): a hub from before it answers 404, or 405. */
async function hubDecidesEdits(): Promise<boolean> {
  const response = await fetch(`${hubUrl}/v1/workspaces/acme/coord/lab/intent`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${hubSession}` },
    body: JSON.stringify({ environment: "lab-probe", session: "claude:lab-probe", paths: [] }),
  });
  await response.arrayBuffer();
  return response.status !== 404 && response.status !== 405;
}

/** What the hub said of each file, in order, as a computer's Peer logged it: `intent` is its word, not the computer's. */
function hubVerdicts(computer: Computer, sessions: ReadonlyArray<string>): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const entry of events(computer)) {
    if (entry.event !== "intent" || !sessions.includes(String(entry.session))) continue;
    for (const one of entry.verdicts as ReadonlyArray<{ path: string; verdict: string }>) {
      byFile.set(one.path, [...(byFile.get(one.path) ?? []), one.verdict]);
    }
  }
  return byFile;
}

/**
 * Ana's and Bob's agents run the PreToolUse hook for the same file nobody touched, started in the
 * same moment on two computers. The hub registers each claim in one step: both go on, and at least
 * one hears that the other is there. A new file each time.
 */
async function sameMomentEdits(ana: Computer, bob: Computer, runs: number) {
  const agents = [
    agent(ana, "lab-race-ana", "w7:p1"),
    agent(bob, "lab-race-bob", "w7:p1"),
  ] as const;
  const sessions = ["claude:lab-race-ana", "claude:lab-race-bob"];
  for (const one of agents) one.start();
  // The hub knows the sessions its computers reported: let both be.
  await sleep(1500);

  // Alone on a file, an agent is cleared by the hub: the log shows it was asked, so this build of
  // the computers' Peer asks the hub at all.
  const [first] = agents;
  const alone = first.edit("PreToolUse", "lab-race/probe.ts");
  await sleep(300);
  check(
    decision(alone) === undefined &&
      hubVerdicts(ana, sessions).get("lab-race/probe.ts")?.[0] === "clear",
    "an agent alone on a file is cleared by the hub (the log has its word; if not, the server build predates Peer's intent calls: `vp pack` in apps/server)",
  );

  const files: string[] = [];
  const walls: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const file = `lab-race/run-${run}.ts`;
    files.push(file);
    // Both hooks are started and wait for their event, which they get in the same tick.
    const hooks = agents.map((one) =>
      one.prepare("PreToolUse", {
        tool_name: "Edit",
        tool_input: { file_path: one.file(file), old_string: "a", new_string: "b" },
      }),
    );
    await sleep(50);
    const began = Date.now();
    const outs = await Promise.all(hooks.map((hook) => hook.go()));
    walls.push(Date.now() - began);
    const stopped = outs.filter((out) => decision(out) !== undefined);
    if (stopped.length > 0) {
      throw new Error(
        `run ${run + 1} of ${runs} (${file}): nothing refuses an edit, got ${JSON.stringify(outs)}`,
      );
    }
    if (run === 0) told("the agents at the same moment", outs.map(context).join(" / "));
  }
  await sleep(300);
  check(
    files.every((file) => {
      const firsts = [ana, bob].map((one) => hubVerdicts(one, sessions).get(file)?.[0] ?? "(none)");
      return firsts.toSorted().join() === "clear,notify";
    }),
    `in each of ${runs} races the hub cleared one first edit and told the other of it: it decided, not the computers' own views`,
  );
  const fellBack = [ana, bob].flatMap((one) =>
    events(one).filter(
      (entry) =>
        /^intent\.(failed|unverified)$/.test(entry.event) &&
        sessions.includes(String(entry.session)),
    ),
  );
  check(fellBack.length === 0, "the hub answered every one of them: no fallback was needed");
  const ordered = walls.toSorted((a, b) => a - b);
  say(
    "the two first edits, from the same moment to both answers",
    `p50 ${ordered[Math.floor(ordered.length / 2)]} ms, p95 ${ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))]} ms, max ${ordered.at(-1)} ms`,
  );
  for (const one of agents) one.hook("SessionEnd", { reason: "exit" });
}

/**
 * The settings calls Peer's Settings make, through each computer's own Peer against the real Hub, so
 * a Hub answer the app's contracts cannot read fails here and not in a person's Settings. Ana is the
 * admin, Bob a member.
 */
const settingsSurface = Effect.fn("lab.settingsSurface")(function* (ana: Computer, bob: Computer) {
  const workspace = "acme";
  const view = yield* ana.client[WS_METHODS.peerSettingsGet]({ workspace });
  check(view.rights.admin && view.revision.seq > 0, "the admin reads the settings in the app");
  // A workspace setting (its lines name no id) and a new project (its line says one thing).
  const base = view.revision.seq;
  const set = [
    { path: ["currency"], value: "USD" },
    { path: ["projects", "lab-two"], value: { name: "Lab two", leads: ["ana@acme.test"] } },
  ];
  const preview = yield* ana.client[WS_METHODS.peerSettingsPreview]({ workspace, base, set });
  told("the app's preview", JSON.stringify(preview).slice(0, 600));
  check(
    preview.kind === "preview" &&
      preview.lines.some((line) => line.from === undefined) &&
      preview.lines.some((line) => line.scope.id === undefined),
    "a preview reads a line that says one thing and a workspace's line",
  );
  const saved = yield* ana.client[WS_METHODS.peerSettingsSave]({
    workspace,
    base,
    set,
    message: "A second project, priced in dollars",
  });
  check(
    saved.kind === "saved" && saved.revision?.seq === base + 1,
    "the admin saves both as one revision",
  );
  const secrets = yield* ana.client[WS_METHODS.peerSettingsSecrets]({ workspace });
  const record = yield* ana.client[WS_METHODS.peerSettingsDomainRecord]({
    workspace,
    domain: "acme.test",
  });
  told("the domain's record", JSON.stringify(record));
  check(
    Array.isArray(secrets.secrets) && record.domain === "acme.test",
    "the admin reads the secrets and the domain's record",
  );

  // Bob, a member: his part, and a change that is not his to make.
  const his = yield* bob.client[WS_METHODS.peerSettingsGet]({ workspace });
  check(
    !his.rights.admin &&
      Object.keys((his.document.people as object | undefined) ?? {}).join() === "bob@acme.test",
    "a member reads his own part of the people",
  );
  const refused = yield* bob.client[WS_METHODS.peerSettingsPreview]({
    workspace,
    base: his.revision.seq,
    set: [{ path: ["currency"], value: "EUR" }],
  });
  told("Bob's change to the currency", JSON.stringify(refused));
  check(
    refused.kind === "forbidden" && refused.refused.some((r) => r.owners.includes("admins")),
    "a member's change to a workspace setting is refused, saying who makes it",
  );
});

/** Polls `ready` until it holds, or fails naming what was expected. */
async function until(what: string, ready: () => boolean | Promise<boolean>, ms = 20_000) {
  for (let waited = 0; waited < ms; waited += 250) {
    if (await ready()) return;
    await sleep(250);
  }
  throw new Error(`expected: ${what}`);
}

/**
 * LAB_VCS=jj: a task's own checkout as herdr's launcher makes it, before its agent starts. No herdr runs
 * in this lab, so the lab calls the launcher's checkout step itself.
 */
async function jjTaskCheckoutStep(computer: Computer) {
  const { prepareHerdrTaskWorktree } =
    await import("../src/peerHub/plugins/herdr/client/worktree.ts");
  const { currentRef } = await import("../src/peerHub/core/vcs.ts");
  const worktrees = NodePath.join(
    NodeFS.realpathSync(computer.home),
    "workspace/.worktrees/acme/lab/app",
  );
  const tree = await prepareHerdrTaskWorktree({
    checkout: computer.checkout,
    baseBranch: "main",
    worktrees,
    task: "KRK-J",
  });
  check(
    tree.vcs === "jj" && NodeFS.statSync(NodePath.join(tree.cwd, ".jj")).isDirectory(),
    "a task's checkout in a jj repository is a jj workspace: .jj is in it",
  );
  const name = NodePath.basename(tree.cwd);
  check(
    jj(computer.checkout, "workspace", "list")
      .split("\n")
      .some((line) => line.startsWith(`${name}:`)),
    "jj workspace list names it",
  );
  const onAt = jj(
    tree.cwd,
    "log",
    "--no-graph",
    "-r",
    "@",
    "-T",
    'local_bookmarks.map(|b| b.name()).join("\\n")',
  );
  check(
    onAt.split("\n").includes(tree.branch),
    `its bookmark ${tree.branch} is on its working-copy change`,
  );
  check((await currentRef(tree.cwd)) === tree.branch, "and Peer reads that bookmark as its branch");
  const status = jj(tree.cwd, "status");
  told("jj status in the task's checkout", status);
  check(status.includes("no changes"), "and jj status stays clean");
}

/**
 * LAB_VCS=jj: the six simulated steps of add-jujutsu-team-features (`peer-lab/jujutsu.ts`). The lab lends
 * them its computers, hooks, Hub and the RPC calls of the plugins they check.
 */
function jujutsuKit(ana: Computer, bob: Computer): JujutsuKit {
  const rpc = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
  const place = { workspace: "acme", project: "lab" } as const;
  // The steps hold the computers as the module types them; their Peers' clients are the lab's.
  const full = (computer: { readonly name: string }) => (computer.name === ana.name ? ana : bob);
  const sessions = new Map<string, string>();
  const sessionOf = async (person: "ana" | "bob") => {
    const known = sessions.get(person);
    if (known !== undefined) return known;
    const email = `${person}@acme.test`;
    const started = await hubCall("/v1/auth/email/start", { method: "POST", body: { email } });
    const finished = await hubCall("/v1/auth/email/verify", {
      method: "POST",
      body: { email, code: started.code },
    });
    sessions.set(person, finished.session as string);
    return finished.session as string;
  };
  return {
    ana,
    bob,
    origin: NodePath.join(lab, "origin.git"),
    directory: lab,
    say,
    check,
    told,
    sleep,
    until,
    addTask: async (title, key) => {
      await hubCall("/v1/workspaces/acme/projects/lab/tasks", {
        method: "POST",
        session: hubSession,
        body: { title, key },
      });
      for (const computer of [ana, bob])
        await until(`${computer.name}'s Peer knows ${key}`, async () => {
          const synced = await rpc(computer.client[WS_METHODS.peerHubSync]({}));
          const tasks = synced.workspaces[0]?.projects.find((p) => p.project.id === "lab")?.work
            .tasks;
          return tasks?.some((one) => one.key === key) === true;
        });
    },
    worktree: async (computer, key, base) => {
      const { prepareHerdrTaskWorktree } =
        await import("../src/peerHub/plugins/herdr/client/worktree.ts");
      const tree = await prepareHerdrTaskWorktree({
        checkout: computer.checkout,
        baseBranch: base,
        // Real paths, as the launcher's: the lab is under /var on a Mac.
        worktrees: NodePath.join(
          NodeFS.realpathSync(computer.home),
          "workspace/.worktrees/acme/lab/app",
        ),
        task: key,
      });
      return { cwd: tree.cwd, branch: tree.branch };
    },
    agent: (computer, session, pane, cwd) => agent(full(computer), session, pane, {}, cwd),
    events: (computer) => events(full(computer)),
    jj: (cwd, ...args) => jj(cwd, ...args),
    git: (cwd, ...args) => git(cwd, ...args),
    reportThread: async ({ person, environment, branch, title, task }) => {
      await hubCall("/v1/workspaces/acme/threads", {
        method: "PUT",
        session: await sessionOf(person),
        body: {
          environment,
          threads: [
            {
              id: `${environment}-${branch}`,
              project: "lab",
              repository: "app",
              title,
              status: "working",
              harness: "claude",
              branch,
              ...(task === undefined ? {} : { task }),
              vcs: "jj",
              source: "peer",
            },
          ],
        },
      });
      // A hook reads what its Peer last synced: wait until both computers' Peers have the thread.
      for (const computer of [ana, bob])
        await until(`${computer.name}'s Peer knows the thread on ${branch}`, async () => {
          const synced = await rpc(computer.client[WS_METHODS.peerHubSync]({}));
          const work = synced.workspaces[0]?.projects.find((p) => p.project.id === "lab")?.work;
          return work?.threads.some((one) => one.branch === branch) === true;
        });
    },
    operations: {
      preview: (computer, operation) =>
        rpc(
          full(computer).client[PEER_JUJUTSU_METHODS.peerJujutsuPreviewUndo]({
            ...place,
            operation,
          }),
        ),
      undo: (computer, operation) =>
        rpc(full(computer).client[PEER_JUJUTSU_METHODS.peerJujutsuUndo]({ ...place, operation })),
      newestUser: async (computer) =>
        (await rpc(full(computer).client[PEER_JUJUTSU_METHODS.peerJujutsuOperations](place)))
          .operations[0]?.user,
    },
  };
}

const program = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const ana = yield* startComputer("Ana", "ana@acme.test");
  const bob = yield* startComputer("Bob", "bob@acme.test");
  if (process.env.LAB_JJ_ONLY === "1") {
    check(JJ, "LAB_JJ_ONLY=1 needs LAB_VCS=jj");
    yield* Effect.promise(() =>
      runJujutsuSteps(jujutsuKit(ana, bob), chosenJujutsuSteps(process.env.LAB_JJ_STEPS)),
    );
    return;
  }
  const anas = agent(ana, "lab-ana", "w1:p1");
  const bobs = agent(bob, "lab-bob", "w1:p1");

  // 1. Ana's agent changes pricing alone: nothing to hear.
  const anaStart = context(anas.hook("SessionStart", { source: "startup" }));
  told(anas.name, anaStart);
  anas.hook("UserPromptSubmit", { prompt: "Add 20% VAT to price() in src/pricing.ts" });
  const first = anas.edit("PreToolUse", "src/pricing.ts");
  check(
    decision(first) === undefined && context(first) === undefined,
    "an agent alone on a file hears nothing",
  );
  anas.edit("PostToolUse", "src/pricing.ts");
  yield* Effect.promise(() => sleep(1200));

  // 2. Bob's agent is about to change the same file.
  const { envFile: bobsEnv } = bobs.start();
  told(
    bobs.name,
    context(bobs.hook("UserPromptSubmit", { prompt: "Rename price() to totalPrice() everywhere" })),
  );
  const heard = bobs.edit("PreToolUse", "src/pricing.ts");
  told(bobs.name, context(heard));
  check(decision(heard) === undefined, "nothing stops the second agent");
  check(
    context(heard)?.includes("Ana's agent") === true && context(heard)?.includes("note") === true,
    "it hears who changed the file and how to tell them",
  );
  check(context(bobs.edit("PreToolUse", "src/pricing.ts")) === undefined, "and hears it once");
  // As agents like to run it: through a pipe, found on the session's PATH.
  const piped = bobs.shell(bobsEnv, "peer status 2>&1 | head -3");
  told(`${bobs.name} (peer status 2>&1 | head -3)`, piped);
  check(
    piped.includes("Peer · project lab · you: Bob's agent"),
    "peer works in any command, and knows which session calls",
  );
  bobs.edit("PostToolUse", "src/pricing.ts");
  bobs.edit("PreToolUse", "src/cart.ts");
  bobs.edit("PostToolUse", "src/cart.ts");

  const terminalEnv = {
    ...process.env,
    PEER_SESSION: "",
    PEER_SESSION_TOKEN: "",
    CODEX_THREAD_ID: "",
    HERDR_PANE_ID: "w1:p1",
  };
  const publicStatus = NodeChildProcess.spawnSync("sh", [ana.scripts.peer, "status"], {
    env: terminalEnv,
    cwd: ana.checkout,
    encoding: "utf8",
  });
  check(
    publicStatus.status === 0,
    "a terminal may read project status without borrowing an agent session",
  );
  const terminalNote = NodeChildProcess.spawnSync(
    "sh",
    [ana.scripts.peer, "note", "A person cannot write as an agent"],
    { env: terminalEnv, cwd: ana.checkout, encoding: "utf8" },
  );
  check(
    terminalNote.status === 3 && terminalNote.stderr.startsWith("peer: refused:"),
    "matching an agent's pane and checkout does not authorize a terminal to write",
  );

  // 3. Codex agents take part as Claude Code's do. Peer adds its hooks to Codex as a plugin, beside
  //    its person's own, and a Codex session on Ana's computer meets Bob's Claude Code session.
  const codexHome = NodePath.join(ana.home, "codex");
  const codexHooksFile = NodePath.join(codexHome, "hooks.json");
  const codexConfig = NodePath.join(codexHome, "config.toml");
  const codexPlugin = codexPeerPluginPaths(codexHome).installed;
  NodeFS.mkdirSync(codexHome, { recursive: true });
  const theirHooks = JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "/usr/bin/true" }] }] },
  });
  NodeFS.writeFileSync(codexHooksFile, theirHooks);
  const withCodex = yield* ana.client[WS_METHODS.peerHubSetCoordination]({ codexHooks: true });
  const pluginHooks = (
    JSON.parse(NodeFS.readFileSync(NodePath.join(codexPlugin, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
    }
  ).hooks;
  check(
    pluginHooks.Stop?.[0]?.hooks[0]?.command === 'sh "${PLUGIN_ROOT}/scripts/hook.sh"' &&
      pluginHooks.PreToolUse?.[0]?.matcher === "Bash|apply_patch" &&
      codexPeerPluginEnabled(NodeFS.readFileSync(codexConfig, "utf8")) === true,
    "Peer adds its hooks to Codex as a plugin",
  );
  check(
    NodeFS.readFileSync(codexHooksFile, "utf8") === theirHooks,
    "and leaves its person's own hooks as they are",
  );
  check(
    NodeFS.readFileSync(NodePath.join(codexHome, "rules", "peer.rules"), "utf8").includes(
      JSON.stringify(ana.scripts.peer),
    ),
    "and lets only its own command past Codex's sandbox",
  );
  check(
    withCodex.coordination.codexHooks === true &&
      withCodex.coordination.codexHooksTrusted === false,
    "Peer says Codex runs them only once its person trusts them",
  );
  // Its person reviews them in Peer's settings, which approves them where Codex looks.
  const codexReview = withCodex.coordination.codexHookHomes?.[0];
  check(codexReview !== undefined, "and shows them for review");
  const trustedNow = yield* ana.client[WS_METHODS.peerHubSetCoordination]({
    codexHookApproval: { home: codexReview.home, reviewId: codexReview.reviewId },
  });
  const approved = NodeFS.readFileSync(codexConfig, "utf8");
  check(
    trustedNow.coordination.codexHooksTrusted === true &&
      codexReview.hooks.every((hook) => approved.includes(JSON.stringify(hook.key))) &&
      approved.includes("trusted_content_hash"),
    "and that Codex runs them once its person trusted them",
  );

  const codexs = codexAgent(ana, "lab-ana-codex", "w1:p4", codexPlugin);
  const codexStart = context(codexs.hook("SessionStart", { source: "startup" }));
  told(codexs.name, codexStart);
  check(
    codexStart?.includes("You are Ana's agent here.") === true &&
      codexStart.includes(ana.scripts.peer),
    "a Codex session starts with who it is and where Peer's command is",
  );
  codexs.hook("UserPromptSubmit", { prompt: "Show the VAT of each cart line in src/cart.ts" });
  const codexHeard = codexs.patch("PreToolUse", ["src/lines.ts", "src/cart.ts"]);
  told(`${codexs.name} (a patch on two files)`, context(codexHeard));
  check(
    decision(codexHeard) === undefined && context(codexHeard)?.includes("Bob's agent") === true,
    "a Codex patch hears of a file Bob's agent changed, whichever file of the patch it is",
  );
  codexs.patch("PostToolUse", ["src/lines.ts", "src/cart.ts"]);
  yield* Effect.promise(() => sleep(3500));
  const codexView = yield* Effect.promise(() =>
    hubCall("/v1/workspaces/acme/coord", { session: hubSession }),
  );
  const codexSession = (
    codexView.sessions as ReadonlyArray<{ id: string; files?: ReadonlyArray<string> }>
  ).find((session) => session.id === "codex:lab-ana-codex");
  check(
    codexSession?.files?.includes("src/cart.ts") === true &&
      codexSession.files.includes("src/lines.ts"),
    "the team sees every file its patch changed",
  );
  const asks = codexs.permission("Bash", { command: "rm -rf build" });
  check(asks === null, "anything else waits for its person");
  // The log is written after the hook answered: wait for its line to land.
  let blocked = false;
  for (let attempt = 0; attempt < 20 && !blocked; attempt += 1) {
    blocked = events(ana).some(
      (entry) => entry.event === "session.blocked" && entry.session === "codex:lab-ana-codex",
    );
    if (!blocked) yield* Effect.promise(() => sleep(500));
  }
  check(blocked, "and the agent counts as waiting, not working");
  codexs.hook("SessionEnd", { reason: "other" });
  const withoutCodex = yield* ana.client[WS_METHODS.peerHubSetCoordination]({ codexHooks: false });
  check(
    withoutCodex.coordination.codexHooks === false &&
      !NodeFS.existsSync(codexPlugin) &&
      codexPeerPluginEnabled(NodeFS.readFileSync(codexConfig, "utf8")) === false &&
      !NodeFS.existsSync(NodePath.join(codexHome, "rules", "peer.rules")) &&
      NodeFS.readFileSync(codexHooksFile, "utf8") === theirHooks,
    "taking Peer's plugin out of Codex leaves its person's own hooks",
  );

  // 4. A slow hub at a session's start: its hook answers before its script gives up (4 s), and
  //    what Peer had not got ready by then reaches the agent at its next step.
  const slowAgent = agent(bob, "lab-bob-slow", "w5:p1");
  const hubPid = hub.child.pid;
  check(hubPid !== undefined, "the lab knows its hub's process");
  process.kill(hubPid, "SIGSTOP");
  const began = Date.now();
  let slowStart: string | undefined;
  try {
    slowStart = slowAgent.start().told;
  } finally {
    process.kill(hubPid, "SIGCONT");
  }
  const tookMs = Date.now() - began;
  say(
    "a session starts while the hub does not answer",
    `${tookMs} ms, told: ${slowStart ?? "(nothing yet)"}`,
  );
  check(tookMs < 4400, "its hook answers before its script gives up on it");
  check(
    slowStart?.includes("run `peer` as is, with no names or IDs") === true,
    "and it is told all of it, since nothing of it waits for the hub",
  );
  slowAgent.hook("SessionEnd", { reason: "exit" });

  // 5. Two computers edit one file at the same moment: the hub registers each claim in one step.
  if (yield* Effect.promise(hubDecidesEdits)) {
    yield* Effect.promise(() => sameMomentEdits(ana, bob, RACE_RUNS));
  } else {
    observe(
      false,
      "step 5 (two computers edit one file at the same moment) was not run: this hub has no /intent",
    );
  }

  yield* settingsSurface(ana, bob);

  // J. LAB_VCS=jj: a task's own checkout is a jj workspace with its bookmark, and its index stays out of jj.
  if (JJ) yield* Effect.promise(() => jjTaskCheckoutStep(ana));

  // K. LAB_VCS=jj: the seven steps of add-jujutsu-team-features (LAB_JJ_STEPS=2,4,6 runs some).
  if (JJ)
    yield* Effect.promise(() =>
      runJujutsuSteps(jujutsuKit(ana, bob), chosenJujutsuSteps(process.env.LAB_JJ_STEPS)),
    );

  for (const computer of [ana, bob]) {
    const lines = NodeFS.readFileSync(computer.log, "utf8").trim().split("\n");
    const events = lines.map((line) => (JSON.parse(line) as { event: string }).event);
    const tally = new Map<string, number>();
    for (const event of events) tally.set(event, (tally.get(event) ?? 0) + 1);
    const counts = [...tally.entries()];
    say(
      `${computer.name}'s log`,
      `${computer.log} — ${lines.length} events: ${counts.map(([e, n]) => `${e}×${n}`).join(", ")}`,
    );
  }
}).pipe(Effect.scoped);

const herdrBin = process.env.HERDR_BIN ?? "herdr";

function startHerdr(name: string) {
  const base = NodePath.join(lab, `${name.toLowerCase()[0]}h`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: NodePath.join(base, "c"),
    XDG_STATE_HOME: NodePath.join(base, "s"),
    // The "none" arm: Peer's hooks and `peer` do nothing for the agents, as if Peer were not there.
    ...((CONTRACT && ARM === "none") || (MEMORY && process.env.LAB_PEER === "off")
      ? { PEER_COORDINATION: "off" }
      : {}),
    // The rooms scenario's panes run what Peer starts: its `claude` is the lab's, and no person's shell files move it.
    ...(ROOMS ? { ZDOTDIR: NodePath.join(base, "z") } : {}),
    // LAB_CLAUDE_CONFIG_ANA / _BOB: that computer's Claude Code signs in with its own account, as two people's would.
    ...(process.env[`LAB_CLAUDE_CONFIG_${name.toUpperCase()}`]
      ? { CLAUDE_CONFIG_DIR: process.env[`LAB_CLAUDE_CONFIG_${name.toUpperCase()}`] }
      : {}),
    // A bare `peer` in the agent's shell is its own computer's, as on a person's computer.
    PATH: [
      ...(ROOMS || MEMORY || READY ? [NodePath.join(base, "bin")] : []),
      NodePath.join(lab, name.toLowerCase(), "userdata", "coord", "bin"),
      process.env.PATH ?? "",
    ]
      .filter((part) => part !== "")
      .join(NodePath.delimiter),
  };
  for (const key of ["HERDR_SOCKET_PATH", "HERDR_SESSION", "HERDR_ENV", "HERDR_PANE_ID"])
    delete env[key];
  if (ROOMS) NodeFS.mkdirSync(NodePath.join(base, "z"), { recursive: true });
  // The operator's own stores stay out of reach: an agent gets a store only through the MCP servers the arm gives it.
  if (MEMORY || READY) {
    NodeFS.mkdirSync(NodePath.join(base, "bin"), { recursive: true });
    for (const tool of ["ov", "openviking", "ovk", ...(MEMORY_ARM === "none" ? ["kontext"] : [])])
      NodeFS.writeFileSync(
        NodePath.join(base, "bin", tool),
        `#!/bin/sh\necho "${tool}: command not found" >&2\nexit 127\n`,
        { mode: 0o755 },
      );
  }
  const server = spawnLogged(herdrBin, ["server"], env);
  return { env, base, server, socket: NodePath.join(base, "c", "herdr", "herdr.sock") };
}
type HerdrServer = ReturnType<typeof startHerdr>;

function herdrJson(h: HerdrServer, ...args: string[]): Record<string, any> {
  try {
    const out = NodeChildProcess.execFileSync(herdrBin, args, { env: h.env, encoding: "utf8" });
    return JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as Record<string, any>;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    return { error: stderr.trim() };
  }
}
function herdrText(h: HerdrServer, ...args: string[]): string {
  try {
    return NodeChildProcess.execFileSync(herdrBin, args, { env: h.env, encoding: "utf8" });
  } catch {
    return "";
  }
}

/**
 * LAB_CAPTURE_HOLD (seconds), with LAB_CAPTURE_DIR: once the agents are done, the computers stay up this long, or until
 * `<dir>/stop` appears, so a film can show the apps' last state (or a person can look around the UI of a dry run).
 */
async function holdForFilm() {
  const dir = process.env.LAB_CAPTURE_DIR;
  const hold = Number(process.env.LAB_CAPTURE_HOLD ?? "0");
  if (dir === undefined || dir === "" || !(hold > 0)) return;
  say(
    "film",
    `holding ${hold} s for the apps' last state (touch ${NodePath.join(dir, "stop")} to end it)`,
  );
  for (let waited = 0; waited < hold * 1000; waited += 1000) {
    if (NodeFS.existsSync(NodePath.join(dir, "stop"))) return;
    await sleep(1000);
  }
}

/**
 * LAB_CAPTURE_DIR: every second, each agent's visible screen with its colours, as `<dir>/<computer>/<ms>.ansi`, for a
 * film of the run. Returns what stops it.
 */
function captureScreens(
  panes: () => ReadonlyArray<{
    computer: { name: string };
    h: HerdrServer;
    pane: string;
    /** The folder of an agent that shares its computer with another (`ana-codex`). */
    label?: string;
  }>,
): () => void {
  const dir = process.env.LAB_CAPTURE_DIR;
  if (dir === undefined || dir === "") return () => {};
  const timer = setInterval(() => {
    for (const { computer, h, pane, label } of panes()) {
      const to = NodePath.join(dir, (label ?? computer.name).toLowerCase());
      NodeFS.mkdirSync(to, { recursive: true });
      const screen = herdrText(h, "pane", "read", pane, "--source", "visible", "--format", "ansi");
      if (screen !== "") NodeFS.writeFileSync(NodePath.join(to, `${Date.now()}.ansi`), screen);
    }
  }, 1000);
  return () => clearInterval(timer);
}

/** Peer's hooks and the permissions a lab agent needs, as the file a Claude Code takes with --settings. */
function writeClaudeSettings(
  computer: Computer,
  options: {
    readonly hooks?: Record<string, ReadonlyArray<HookGroup>>;
    readonly allow?: ReadonlyArray<string>;
    /** Permission rules as they are, such as a whole MCP server's tools. */
    readonly rules?: ReadonlyArray<string>;
  } = {},
) {
  const settings = NodePath.join(computer.home, "claude-settings.json");
  // Peer's hooks as Peer installs them, and the shell commands agents read and edit with, so nobody
  // waits for an approval.
  const shell = [
    "grep",
    "rg",
    "cat",
    "ls",
    "find",
    "head",
    "tail",
    "wc",
    "sed",
    "perl",
    "awk",
    "git diff",
    "git status",
    "git log",
    ...(options.allow ?? []),
  ];
  NodeFS.writeFileSync(
    settings,
    JSON.stringify(
      {
        hooks: options.hooks ?? claudeHookGroups(computer.scripts),
        permissions: {
          allow: [...shell.map((command) => `Bash(${command}:*)`), ...(options.rules ?? [])],
        },
      },
      null,
      2,
    ),
  );
  return settings;
}

/**
 * A pane Peer starts runs a bare `claude`. This one takes the computer's own settings and none of the person's, so its
 * hooks reach the lab's Peer and never the operator's. What the lab starts itself already says so.
 */
function writeClaudeWrapper(h: HerdrServer, computer: Computer) {
  const real = NodeChildProcess.execFileSync("sh", ["-c", "command -v claude"], {
    encoding: "utf8",
  }).trim();
  const settings = writeClaudeSettings(computer);
  const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const bin = NodePath.join(h.base, "bin");
  NodeFS.mkdirSync(bin, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(bin, "claude"),
    [
      "#!/bin/sh",
      `if [ "$1" = "--setting-sources" ]; then exec ${quoted(real)} "$@"; fi`,
      `printf '%s\\n' "$*" >> ${quoted(NodePath.join(h.base, "claude-args.log"))}`,
      `printf '%s\\n' "$$" >> ${quoted(NodePath.join(h.base, "claude-pids.log"))}`,
      `exec ${quoted(real)} --setting-sources project --settings ${quoted(settings)} --strict-mcp-config --permission-mode acceptEdits --model ${quoted(process.env.LAB_CLAUDE_MODEL ?? "sonnet")} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

async function startClaude(
  h: HerdrServer,
  computer: Computer,
  name: string,
  options: {
    /** Other hooks than Peer's own. */
    readonly hooks?: Record<string, ReadonlyArray<HookGroup>>;
    /** More shell commands the agent may run unasked. */
    readonly allow?: ReadonlyArray<string>;
    /** Where it works: a task's worktree of the checkout (the checkout itself by default). */
    readonly cwd?: string;
    /** Permission rules as they are, such as a whole MCP server's tools. */
    readonly rules?: ReadonlyArray<string>;
    /** An `--mcp-config` file: the only MCP servers it gets. */
    readonly mcpConfig?: string;
  } = {},
) {
  const settings = writeClaudeSettings(computer, options);
  const created = herdrJson(
    h,
    "workspace",
    "create",
    "--cwd",
    options.cwd ?? computer.checkout,
    "--label",
    name,
    "--no-focus",
  );
  const pane = created.result?.root_pane?.pane_id as string;
  const claudeArgs = [
    "--setting-sources",
    "project",
    "--settings",
    settings,
    "--strict-mcp-config",
    ...(options.mcpConfig === undefined ? [] : ["--mcp-config", options.mcpConfig]),
    "--permission-mode",
    "acceptEdits",
    "--model",
    process.env.LAB_CLAUDE_MODEL ?? "sonnet",
    // A lab agent never reaches the person's own browser, whatever its permission mode lets it ask.
    "--no-chrome",
  ];
  let lastScreen = "";
  for (let launch = 0; launch < 3; launch += 1) {
    herdrJson(
      h,
      "agent",
      "start",
      name,
      "--kind",
      "claude",
      "--pane",
      pane,
      "--timeout",
      "90000",
      "--",
      ...claudeArgs,
    );
    // First run in a new folder, Claude Code asks whether to trust it with "No, exit" preselected:
    // move to "Yes" and confirm only once the cursor is there. herdr may call it idle before that
    // dialog shows, so it has started only once its prompt (with the permission mode) is on screen.
    for (let step = 0; step < 40; step += 1) {
      const got = herdrJson(h, "agent", "get", pane);
      const status = got.result?.agent?.agent_status;
      const screen = herdrText(h, "pane", "read", pane, "--source", "visible");
      lastScreen = screen;
      if (
        (status === "idle" || status === "done") &&
        screen.includes("accept edits on") &&
        !screen.includes("trust this folder")
      ) {
        herdrText(h, "agent", "rename", pane, name);
        say(`${name} started`, `${computer.name}'s Claude Code in herdr pane ${pane}`);
        return pane;
      }
      // A Claude Code with a fresh config dir may first offer the person's own Chrome to the agent: keep it off
      // (the default), so no lab agent ever drives a real browser.
      if (screen.includes("Claude in Chrome extension detected")) {
        herdrText(
          h,
          "pane",
          "send-keys",
          pane,
          /❯\s*No, keep browser tools off/.test(screen) ? "enter" : "up",
        );
      } else if (screen.includes("Yes, I trust this folder")) {
        herdrText(
          h,
          "pane",
          "send-keys",
          pane,
          /❯\s*Yes, I trust this folder/.test(screen) ? "enter" : "down",
        );
      } else if (!screen.includes("Claude Code") && step > 3 && got.result?.agent === undefined) {
        break; // it exited: start it again (a session-start hook may keep the screen blank a while)
      }
      await sleep(1500);
    }
  }
  throw new Error(`${name}'s Claude Code did not start; its screen:\n${lastScreen.slice(-2000)}`);
}

/** A value as TOML writes it inline, for Codex's `-c key=value`. */
function tomlInline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(tomlInline).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)} = ${tomlInline(item)}`)
      .join(", ")}}`;
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * How the lab runs this person's own Codex (their sign-in, their CODEX_HOME,
 * left as they are) as one of its computers' agents: with that computer's
 * Peer hooks, and without the person's own hooks, plugins and MCP servers.
 * Every setting is a `-c` for this run; nothing is written to their Codex.
 */
function codexLabArgs(
  computer: Computer,
  hooks: Record<string, ReadonlyArray<HookGroup>> = codexHookGroups(computer.scripts),
  /** Where it works, when not the checkout itself: a task's worktree. */
  cwd: string = computer.checkout,
  /** MCP servers it gets, as Codex's config names them. */
  mcp: Readonly<Record<string, unknown>> = {},
): string[] {
  const codexHome = process.env.CODEX_HOME ?? NodePath.join(NodeOS.homedir(), ".codex");
  const read = (file: string) => {
    try {
      return NodeFS.readFileSync(NodePath.join(codexHome, file), "utf8");
    } catch {
      return "";
    }
  };
  // Their hooks.json hooks, each turned off by the key Codex keeps its trust under.
  const theirs: Record<string, { enabled: boolean }> = {};
  const hooksFile = NodePath.join(codexHome, "hooks.json");
  try {
    const declared = (JSON.parse(read("hooks.json") || "{}") as CodexHooksFile).hooks ?? {};
    for (const [event, groups] of Object.entries(declared)) {
      const label = event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      for (const [g, group] of groups.entries()) {
        for (const h of (group.hooks ?? []).keys()) {
          theirs[`${hooksFile}:${label}:${g}:${h}`] = { enabled: false };
        }
      }
    }
  } catch {
    // No hooks of theirs to turn off.
  }
  const servers = [
    ...read("config.toml").matchAll(/^\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm),
  ].map((match) => match[1] ?? match[2] ?? "");
  // Their own skills (their Peer's recipes among them, which name their real Peer) are theirs.
  const skills = (() => {
    try {
      return NodeFS.readdirSync(NodePath.join(codexHome, "skills"), { withFileTypes: true });
    } catch {
      return [];
    }
  })()
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => NodePath.join(codexHome, "skills", entry.name, "SKILL.md"))
    .filter((path) => NodeFS.existsSync(path));
  const trusted = [...new Set([computer.checkout, cwd])].flatMap((path) => [
    path,
    NodeFS.realpathSync(path),
  ]);
  return [
    "-c",
    `hooks=${tomlInline({ state: theirs, ...hooks })}`,
    // The lab vets its own hooks; Codex would otherwise wait for its person to trust them.
    "--dangerously-bypass-hook-trust",
    "-c",
    "features.plugins=false",
    ...(skills.length === 0
      ? []
      : ["-c", `skills.config=${tomlInline(skills.map((path) => ({ path, enabled: false })))}`]),
    ...(servers.length === 0 && Object.keys(mcp).length === 0
      ? []
      : [
          "-c",
          `mcp_servers=${tomlInline({ ...Object.fromEntries(servers.map((name) => [name, { enabled: false }])), ...mcp })}`,
        ]),
    "-c",
    `projects=${tomlInline(Object.fromEntries(trusted.map((path) => [path, { trust_level: "trusted" }])))}`,
    "-c",
    "check_for_update_on_startup=false",
    "-c",
    "notify=[]",
    "-c",
    'approval_policy="never"',
    "-c",
    'sandbox_mode="danger-full-access"',
    // Their model (LAB_CODEX_MODEL names another), at an effort that keeps a lab step short.
    ...(process.env.LAB_CODEX_MODEL
      ? ["-c", `model=${JSON.stringify(process.env.LAB_CODEX_MODEL)}`]
      : []),
    "-c",
    'model_reasoning_effort="medium"',
  ];
}
type CodexHooksFile = {
  readonly hooks?: Record<string, ReadonlyArray<{ readonly hooks?: ReadonlyArray<unknown> }>>;
};

/** This person's own Codex as a computer's agent, in a herdr pane of that computer. */
async function startCodex(
  h: HerdrServer,
  computer: Computer,
  name: string,
  hooks?: Record<string, ReadonlyArray<HookGroup>>,
  /** Where it works: a task's worktree of the checkout (the checkout itself by default). */
  cwd: string = computer.checkout,
  /** MCP servers it gets, as Codex's config names them. */
  mcp: Readonly<Record<string, unknown>> = {},
) {
  const created = herdrJson(h, "workspace", "create", "--cwd", cwd, "--label", name, "--no-focus");
  const pane = created.result?.root_pane?.pane_id as string;
  // Its settings would be too long a line for the pane's shell to take: a launcher holds them.
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const launcher = NodePath.join(
    computer.home,
    cwd === computer.checkout ? "codex-lab.sh" : `codex-lab-${name}.sh`,
  );
  NodeFS.writeFileSync(
    launcher,
    `#!/bin/sh\nexec codex ${codexLabArgs(computer, hooks, cwd, mcp).map(quote).join(" ")} "$@"\n`,
    { mode: 0o755 },
  );
  for (let launch = 0; launch < 3; launch += 1) {
    herdrText(h, "pane", "run", pane, launcher);
    for (let step = 0; step < 40; step += 1) {
      const agentState = herdrJson(h, "agent", "get", pane).result?.agent;
      const screen = herdrText(h, "pane", "read", pane, "--source", "visible");
      const asking = /trust the (files|contents)|Hooks need review|Update available|Sign in/i.test(
        screen,
      );
      if (
        agentState?.agent === "codex" &&
        (agentState.agent_status === "idle" || agentState.agent_status === "done") &&
        screen.includes("Ask Codex") &&
        !asking
      ) {
        herdrText(h, "agent", "rename", pane, name);
        say(`${name} started`, `${computer.name}'s Codex in herdr pane ${pane}`);
        return pane;
      }
      if (asking && step > 10) {
        console.log(screen);
        throw new Error(`${name}'s Codex waits on a question the lab does not answer`);
      }
      await sleep(1500);
    }
  }
  throw new Error(`${name}'s Codex did not start`);
}

const statusOf = (h: HerdrServer, pane: string) =>
  (herdrJson(h, "agent", "get", pane).result?.agent?.agent_status as string | undefined) ?? "?";

/** What real agents did that Peer cannot make them do: reported, never failed on. */
function observe(ok: unknown, what: string) {
  say(ok ? "seen" : "NOT seen", what);
}

/** The coordination events of a computer, in order. */
function events(computer: Computer): Array<{ event: string; t: string; [field: string]: unknown }> {
  if (!NodeFS.existsSync(computer.log)) return [];
  return NodeFS.readFileSync(computer.log, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { event: string; t: string; [field: string]: unknown });
}

/** The Claude Code sessions a computer's Peer met. */
const sessionsOf = (computer: Computer) =>
  new Set(
    events(computer)
      .filter((entry) => entry.event === "session.started")
      .map((entry) => String(entry.session)),
  );

/** Real agents' permission prompts, answered as a person at the keyboard would in a throwaway checkout. */
function approveAll(
  agents: ReadonlyArray<{
    readonly computer: Computer;
    readonly h: HerdrServer;
    readonly pane: string;
  }>,
) {
  for (const { computer, h, pane } of agents) {
    if (statusOf(h, pane) !== "blocked") continue;
    const screen = herdrText(h, "pane", "read", pane, "--source", "visible");
    if (/Do you want to proceed\?|❯\s*1\. Yes/.test(screen)) {
      herdrText(h, "pane", "send-keys", pane, "enter");
      say("approved", `${computer.name}'s agent's permission prompt`);
    }
  }
}

/** Waits until every agent has been idle for 45 s together, or `limitMs` has passed. */
async function quietUntil(
  agents: ReadonlyArray<{
    readonly computer: Computer;
    readonly h: HerdrServer;
    readonly pane: string;
  }>,
  limitMs: number,
  every: () => void = () => {},
) {
  let quiet = 0;
  for (let elapsed = 0; elapsed < limitMs && quiet < 45_000; elapsed += 5000) {
    await sleep(5000);
    approveAll(agents);
    every();
    const statuses = agents.map(({ h, pane }) => statusOf(h, pane));
    quiet = statuses.every((s) => s === "idle" || s === "done") ? quiet + 5000 : 0;
    say("agents", `Ana's ${statuses[0]}, Bob's ${statuses[1]}`);
  }
}

/** How many messages agents wrote in the room of the lab project's task `key`, as the Hub holds them. */
async function agentWordsInRoom(key: string) {
  const { projects } = (await hubCall("/v1/workspaces/acme/work", { session: hubSession })) as {
    projects?: { lab?: { tasks?: ReadonlyArray<{ id: string; key?: string }> } };
  };
  const task = projects?.lab?.tasks?.find((one) => one.key === key);
  if (task === undefined) return 0;
  const room = `/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(task.id)}/room`;
  const { messages } = (await hubCall(`${room}?limit=200`, { session: hubSession })) as {
    messages: ReadonlyArray<{ author: { run?: string } }>;
  };
  return messages.filter((one) => one.author.run !== undefined).length;
}

/**
 * The integration step (`LAB_INTEGRATE=1`, implied by `LAB_CONTRACT=deferred`; see `peer-lab/hidden.ts`): the
 * committed tips are recorded before anyone merges, then a fresh session on Ana's computer merges and pushes.
 */
async function integrationStep(input: {
  readonly ana: Computer;
  readonly bob: Computer;
  readonly anaHerdr: HerdrServer | undefined;
  /** The first agents' panes (real runs). */
  readonly live: ReadonlyArray<{ computer: Computer; h: HerdrServer; pane: string }>;
  /** The fresh session's pane, once there is one: the caller prints its last screen. */
  readonly fresh: Array<{ computer: Computer; h: HerdrServer; pane: string }>;
  readonly where: {
    readonly origin: string;
    readonly ana: Work;
    readonly bob: Work;
    readonly scratch: string;
  };
}): Promise<IntegratorReport> {
  const { ana, bob, where } = input;
  const said = await agentWordsInRoom(HIDDEN_TASKS[0].key);
  const start = startIntegration(where);
  say(
    "integration",
    `Bob's branch ${where.bob.branch} (${start.tips.bob.slice(0, 10)}) is in Ana's checkout as ${start.branch}; Ana's branch ${start.anaBranch} is at ${start.tips.ana.slice(0, 10)}`,
  );
  // The fresh session is on KRK-1 because Ana's branch names it: an agent may have left another.
  const onTask = new RegExp(`(^|[^a-z0-9])${HIDDEN_TASKS[0].key}($|[^a-z0-9])`, "i").test(
    start.anaBranch,
  );
  const sayOnTask =
    "Ana's checkout is on a branch that names KRK-1, so the fresh session is on that task";
  if (REAL) observe(onTask, sayOnTask);
  else check(onTask, sayOnTask);
  const earlier = sessionsOf(ana);
  const prompt = integratePrompt(start.branch, INTEGRATE_QUICK);
  let sessions: ReadonlyArray<string>;
  if (REAL && input.anaHerdr !== undefined) {
    // Both first agents are done. Their sessions end, so that nobody who took part is still there to
    // be woken by the session that merges, and its edit of Bob's file meets nobody's.
    const bobs = sessionsOf(bob);
    for (const one of input.live) herdrJson(one.h, "agent", "prompt", one.pane, "/exit");
    say("integration", "both agents exit");
    const ended = (computer: Computer, ids: ReadonlySet<string>) =>
      [...ids].every((id) =>
        events(computer).some((entry) => entry.event === "session.ended" && entry.session === id),
      );
    for (
      let waited = 0;
      waited < 90_000 && !(ended(ana, earlier) && ended(bob, bobs));
      waited += 3000
    )
      await sleep(3000);
    observe(ended(ana, earlier), "Ana's first agent's session ended");
    observe(ended(bob, bobs), "Bob's agent's session ended");
    // A fresh Claude Code on Ana's computer; the lab's default allows git to read only.
    const pane = await startClaude(input.anaHerdr, ana, "ana-next", {
      allow: ["git fetch", "git merge", "git add", "git commit", "git push"],
    });
    const fresh = { computer: ana, h: input.anaHerdr, pane };
    input.fresh.push(fresh);
    herdrJson(input.anaHerdr, "agent", "prompt", pane, prompt);
    say("Ana's fresh agent prompted (KRK-1)", prompt);
    await quietUntil([fresh], 10 * 60_000);
    sessions = [...sessionsOf(ana)].filter((id) => !earlier.has(id));
  } else {
    // With no Peer the stand-in's hooks do nothing, as an agent's would not.
    const stand = agent(
      ana,
      "contract-ana-next",
      "w13:p3",
      ARM === "none" ? { PEER_COORDINATION: "off" } : {},
    );
    const outcome = await runIntegratorStub({
      integrator: stand,
      checkout: ana.checkout,
      branch: start.branch,
      told,
    });
    say(
      "integration",
      outcome.divided
        ? "the scripted integrator put Bob's file right for cents (Peer had told it to), committed and pushed"
        : "the scripted integrator merged and pushed what it had: Peer told it nothing to put right",
    );
    sessions = ["claude:contract-ana-next"];
  }
  // The logs are written a moment after the hooks answer.
  await sleep(1500);
  const finish = finishIntegration({
    origin: where.origin,
    ana: where.ana,
    start,
    scratch: where.scratch,
  });
  return integratorReport({ start, finish, events: events(ana), sessions, said });
}

/**
 * Waits for the agents as `quietUntil` does, with their person away: an agent that stops on a question it put to its
 * person gets the lab's answer that nobody is there, and so does one that ends its turn before `done()`. Returns what
 * they asked, as the screen showed it.
 */
async function waitWithPersonAway(
  agents: ReadonlyArray<{
    readonly computer: Computer;
    readonly h: HerdrServer;
    readonly pane: string;
  }>,
  limitMs: number,
  done: () => boolean,
) {
  const asked: string[] = [];
  let quiet = 0;
  const lastIdle = new Set<string>();
  for (let elapsed = 0; elapsed < limitMs && quiet < 30_000; elapsed += 3000) {
    await sleep(3000);
    approveAll(agents);
    const statuses = agents.map(({ h, pane }) => statusOf(h, pane));
    for (const { computer, h, pane } of agents) {
      if (statusOf(h, pane) !== "blocked") continue;
      const screen = herdrText(h, "pane", "read", pane, "--source", "visible");
      if (!/Enter to select/.test(screen)) continue;
      asked.push(screen.slice(-1400));
      say("stopped to ask", `${computer.name}'s agent`);
      herdrText(h, "pane", "send-keys", pane, "esc");
      await sleep(2500);
      herdrJson(h, "agent", "prompt", pane, AWAY);
    }
    quiet = statuses.every((s) => s === "idle" || s === "done") ? quiet + 3000 : 0;
    if (quiet >= 12_000 && !done() && agents[0] !== undefined && !lastIdle.has("asked")) {
      lastIdle.add("asked");
      const { h, pane } = agents[0];
      asked.push(herdrText(h, "pane", "read", pane, "--source", "visible").slice(-1400));
      say("ended its turn with the work undone", "the lab says its person is away");
      herdrJson(h, "agent", "prompt", pane, AWAY);
      quiet = 0;
    }
  }
  return asked;
}

/** The lab's agent of `kind` on a computer, with these MCP servers, or none. */
const startOwnAgent = (
  kind: string | undefined,
  h: HerdrServer,
  computer: Computer,
  name: string,
  servers: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
) =>
  kind === "codex"
    ? startCodex(h, computer, name, undefined, computer.checkout, servers)
    : startClaude(h, computer, name, {
        rules: Object.keys(servers).map((server) => `mcp__${server}`),
        ...(Object.keys(servers).length === 0
          ? {}
          : { mcpConfig: claudeMcpConfig(computer.home, servers) }),
      });

const kontextBin = () =>
  NodeChildProcess.execFileSync("which", ["kontext"], { encoding: "utf8" }).trim();

const vikingUrl = () => {
  const url = process.env.LAB_VIKING_URL;
  if (url === undefined) throw new Error("REAL_SCENARIO=memory needs LAB_VIKING_URL");
  return url;
};

/** A person's card on their computer, as Settings saves it. */
const saveCard = Effect.fn("lab.saveCard")(function* (
  computer: Computer,
  text: string,
  teammatesMayWake = false,
) {
  yield* computer.client[WS_METHODS.peerCardSave]({ text, teammatesMayWake });
  say(`${computer.name}'s card`, `${text} (teammates may wake: ${teammatesMayWake})`);
});

/** REAL_SCENARIO=memory (`peer-lab/ownMemory.ts` has the project, the facts and the checks). */
const memoryProgram = Effect.gen(function* () {
  if (!REAL) throw new Error("REAL_SCENARIO=memory needs REAL_AGENTS=1");
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const peerOff = process.env.LAB_PEER === "off";
  const [anaKind, bobKind] = (process.env.REAL_KINDS ?? "claude,codex").split(",");
  const anaHerdr = startHerdr("Ana");
  const ana = yield* startComputer("Ana", "ana@acme.test", anaHerdr.socket);
  say(
    "memory",
    MEMORY_ADAPTER
      ? `adapter variant, Peer ${peerOff ? "off" : "on"}, Ana ${anaKind}, Bob ${bobKind}`
      : `arm ${MEMORY_ARM}, agent ${anaKind}`,
  );
  const servers = memoryServers(vikingUrl(), kontextBin());
  if (!MEMORY_ADAPTER) {
    branchOff(ana.checkout, MEMORY_TASKS[0].branch);
    if (MEMORY_ARM === "card") yield* saveCard(ana, MEMORY_CARD);
    const pane = yield* Effect.promise(() =>
      startOwnAgent(anaKind, anaHerdr, ana, "ana", MEMORY_ARM === "none" ? {} : servers),
    );
    const live = [{ computer: ana, h: anaHerdr, pane }];
    herdrJson(anaHerdr, "agent", "prompt", pane, MEMORY_TASK);
    say("Ana's agent prompted", MEMORY_TASK);
    const asked = yield* Effect.promise(() =>
      waitWithPersonAway(live, 8 * 60_000, () =>
        NodeFS.existsSync(NodePath.join(ana.checkout, "src", "loyalty.js")),
      ),
    );
    const verdict = judgeLoyalty(ana.checkout);
    say(
      "memory result",
      JSON.stringify({
        arm: MEMORY_ARM,
        kind: anaKind,
        checkout: NodeFS.realpathSync(ana.checkout),
        verdict,
        facts: memoryFacts(verdict),
        asked,
        added: peerAdded(events(ana) as ReadonlyArray<LabEvent>),
      }),
    );
    if (NodeFS.existsSync(NodePath.join(ana.checkout, "src", "loyalty.js")))
      told(
        "Ana's agent's code",
        NodeFS.readFileSync(NodePath.join(ana.checkout, "src", "loyalty.js"), "utf8"),
      );
    return;
  }
  const bobHerdr = startHerdr("Bob");
  const bob = yield* startComputer("Bob", "bob@acme.test", bobHerdr.socket);
  branchOff(ana.checkout, MEMORY_TASKS[1].branch);
  branchOff(bob.checkout, MEMORY_TASKS[0].branch);
  if (process.env.LAB_ADAPTER_CARD === "1") yield* saveCard(ana, ADAPTER_CARD, true);
  const anaPane = yield* Effect.promise(() =>
    startOwnAgent(anaKind, anaHerdr, ana, "ana", { openviking: servers.openviking }),
  );
  const bobPane = yield* Effect.promise(() => startOwnAgent(bobKind, bobHerdr, bob, "bob"));
  const live = [
    { computer: ana, h: anaHerdr, pane: anaPane },
    { computer: bob, h: bobHerdr, pane: bobPane },
  ];
  herdrJson(anaHerdr, "agent", "prompt", anaPane, ADAPTER_ANA_TASK);
  say("Ana's agent prompted", ADAPTER_ANA_TASK);
  herdrJson(bobHerdr, "agent", "prompt", bobPane, ADAPTER_BOB_TASK);
  say("Bob's agent prompted", ADAPTER_BOB_TASK);
  yield* Effect.promise(() => quietUntil(live, 8 * 60_000));
  // Words for Bob's stopped agent wait for him: he reads them and passes them on, as from the Feed.
  const waiting = (yield* Effect.promise(() => cachedStatus(bob))).rooms?.waiting ?? [];
  for (const { workspace, project, task, seq } of waiting) {
    say("Bob passes on", `#${seq} of ${task}`);
    yield* bob.client[PEER_ROOMS_METHODS.peerRoomsPass]({ workspace, project, task, seq });
  }
  if (waiting.length > 0) yield* Effect.promise(() => quietUntil(live, 8 * 60_000));
  const verdict = judgeLoyalty(bob.checkout);
  say(
    "memory result",
    JSON.stringify({
      arm: peerOff
        ? "adapter-no-peer"
        : process.env.LAB_ADAPTER_CARD === "1"
          ? "adapter-card"
          : "adapter",
      kinds: [anaKind, bobKind],
      checkouts: [ana.checkout, bob.checkout].map((path) => NodeFS.realpathSync(path)),
      verdict,
      right: adapterRight(verdict),
      passedOn: waiting.length,
      added: {
        ana: peerAdded(events(ana) as ReadonlyArray<LabEvent>),
        bob: peerAdded(events(bob) as ReadonlyArray<LabEvent>),
      },
    }),
  );
  if (NodeFS.existsSync(NodePath.join(bob.checkout, "src", "loyalty.js")))
    told(
      "Bob's agent's code",
      NodeFS.readFileSync(NodePath.join(bob.checkout, "src", "loyalty.js"), "utf8"),
    );
}).pipe(Effect.scoped);

/** REAL_SCENARIO=ready (`peer-lab/ready.ts` has the project and the words). */
const readyProgram = Effect.gen(function* () {
  if (!REAL) throw new Error("REAL_SCENARIO=ready needs REAL_AGENTS=1");
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const mode = process.env.LAB_READY ?? "off";
  if (!["off", "on", "card"].includes(mode))
    throw new Error(`LAB_READY is off, on or card, not ${mode}`);
  const [kind] = (process.env.REAL_KINDS ?? "claude").split(",");
  const herdr = startHerdr("Ana");
  const ana = yield* startComputer("Ana", "ana@acme.test", herdr.socket);
  branchOff(ana.checkout, READY_TASKS[0].branch);
  if (mode === "card") yield* saveCard(ana, READY_CARD);
  const pane = yield* Effect.promise(() => startOwnAgent(kind, herdr, ana, "ana"));
  const live = [{ computer: ana, h: herdr, pane }];
  herdrJson(herdr, "agent", "prompt", pane, READY_TASK);
  say("Ana's agent prompted", READY_TASK);
  const refunds = NodePath.join(ana.checkout, "src", "refunds.js");
  const stops = yield* Effect.promise(() =>
    waitWithPersonAway(live, 8 * 60_000, () => NodeFS.existsSync(refunds)),
  );
  // Peer's start text tells it to say so itself; a turn that ends without it is what this measures.
  yield* Effect.promise(() => quietUntil(live, 5 * 60_000));
  const lastWords = herdrText(herdr, "pane", "read", pane, "--source", "recent");
  const room = yield* Effect.promise(() =>
    hubCall(`/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(krk1Id)}/room?limit=100`, {
      session: hubSession,
    }).catch((error: unknown) => ({ error: String(error) })),
  );
  say(
    "ready result",
    JSON.stringify({
      mode,
      stops,
      kind,
      checkout: NodeFS.realpathSync(ana.checkout),
      implemented: NodeFS.existsSync(refunds),
      room,
      lastWords,
      code: NodeFS.existsSync(refunds) ? NodeFS.readFileSync(refunds, "utf8") : "",
      added: peerAdded(events(ana) as ReadonlyArray<LabEvent>),
    }),
  );
}).pipe(Effect.scoped);

/**
 * REAL_SCENARIO=contract (`peer-lab/contract.ts`): two agents' branches merge and run tests they never saw;
 * the arm says what Peer tells them.
 */
const contractProgram = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const anaHerdr = REAL ? startHerdr("Ana") : undefined;
  const bobHerdr = REAL ? startHerdr("Bob") : undefined;
  const ana = yield* startComputer("Ana", "ana@acme.test", anaHerdr?.socket);
  const bob = yield* startComputer("Bob", "bob@acme.test", bobHerdr?.socket);
  // A scripted agent of a dry run. With no Peer its hooks and commands do nothing, as a real agent's would not.
  const standIn = (computer: Computer, id: string, pane: string) =>
    agent(computer, id, pane, ARM === "none" ? { PEER_COORDINATION: "off" } : {});
  branchOff(ana.checkout, CONTRACT_TASKS[0].branch);
  branchOff(bob.checkout, CONTRACT_TASKS[1].branch);
  for (const computer of [ana, bob]) {
    let known = false;
    for (let attempt = 0; attempt < 20 && !known; attempt += 1) {
      const synced = yield* computer.client[WS_METHODS.peerHubSync]({});
      const tasks = synced.workspaces[0]?.projects.find((p) => p.project.id === "lab")?.work.tasks;
      known = tasks?.some((task) => task.key === "KRK-2") === true;
      if (!known) yield* Effect.promise(() => sleep(500));
    }
    check(known, `${computer.name}'s Peer knows both tasks`);
  }
  // The arm, as each computer's Peer says it.
  say("arm", ARM_LABELS[ARM]);
  // LAB_WAKE=1: each person's card lets a colleague's words wake their idle agent.
  if (process.env.LAB_WAKE === "1")
    for (const computer of [ana, bob]) yield* saveCard(computer, "", true);
  const live: Array<{ computer: Computer; h: HerdrServer; pane: string }> = [];
  /** The fresh session of the integration step, once there is one. */
  const fresh: Array<{ computer: Computer; h: HerdrServer; pane: string }> = [];
  try {
    if (REAL && anaHerdr !== undefined && bobHerdr !== undefined) {
      const [anaKind, bobKind] = (process.env.REAL_KINDS ?? "claude,codex").split(",");
      const start = (kind: string | undefined, h: HerdrServer, computer: Computer, name: string) =>
        kind === "codex" ? startCodex(h, computer, name) : startClaude(h, computer, name);
      const anaPane = yield* Effect.promise(() => start(anaKind, anaHerdr, ana, "ana"));
      const bobPane = yield* Effect.promise(() => start(bobKind, bobHerdr, bob, "bob"));
      live.push(
        { computer: ana, h: anaHerdr, pane: anaPane },
        { computer: bob, h: bobHerdr, pane: bobPane },
      );
      const stopCapture = captureScreens(() => [...live, ...fresh]);
      herdrJson(anaHerdr, "agent", "prompt", anaPane, CONTRACT_ANA_TASK);
      say("Ana's agent prompted (KRK-1)", CONTRACT_ANA_TASK);
      // Bob's agent is asked once Ana's has begun to change things; in the hard and hidden runs, at once.
      if (!CONTRACT_HARD && !CONTRACT_HIDDEN) {
        for (let waited = 0; waited < 120_000; waited += 2000) {
          yield* Effect.promise(() => sleep(2000));
          approveAll(live);
          if (events(ana).some((e) => e.event === "hook" && e.hookEvent === "PostToolUse")) break;
        }
      }
      herdrJson(bobHerdr, "agent", "prompt", bobPane, CONTRACT_BOB_TASK);
      say("Bob's agent prompted (KRK-2)", CONTRACT_BOB_TASK);
      yield* Effect.promise(() => quietUntil(live, 12 * 60_000));
      yield* Effect.promise(holdForFilm);
      stopCapture();
    } else if (CONTRACT_DEFERRED) {
      yield* Effect.promise(() =>
        runDeferredStub({
          ana: standIn(ana, "contract-ana", "w13:p1"),
          bob: standIn(bob, "contract-bob", "w13:p1"),
          pause: sleep,
          told,
          waiting: () =>
            events(ana).some(
              (entry) => entry.event === "wait" && entry.session === "claude:contract-ana",
            ),
        }),
      );
      yield* Effect.promise(holdForFilm);
    } else if (CONTRACT_HIDDEN) {
      yield* Effect.promise(() =>
        runHiddenStub({
          ana: standIn(ana, "contract-ana", "w13:p1"),
          bob: standIn(bob, "contract-bob", "w13:p1"),
          pause: sleep,
        }),
      );
      yield* Effect.promise(holdForFilm);
    } else {
      yield* Effect.promise(() =>
        runStub({
          ana: standIn(ana, "contract-ana", "w13:p1"),
          bob: standIn(bob, "contract-bob", "w13:p1"),
          pause: sleep,
        }),
      );
    }
    // The logs are written a moment after the hooks answer.
    yield* Effect.promise(() => sleep(1500));

    // What each agent changed is committed on its own branch; both are merged and checked.
    const branches = [ana, bob].map((computer) => ({
      checkout: computer.checkout,
      branch: currentBranch(computer.checkout),
    }));
    for (const computer of [ana, bob]) {
      const files = commitWork(computer.checkout, `${computer.name}'s agent`);
      say(`${computer.name}'s agent changed`, files.join(", ") || "nothing");
      if (files.length > 0)
        told(`${computer.name}'s change`, git(computer.checkout, "show", "--format=", "HEAD"));
    }
    const scratch = NodePath.join(lab, "contract-merge");
    NodeFS.mkdirSync(scratch, { recursive: true });
    const where = {
      origin: NodePath.join(lab, "origin.git"),
      ana: branches[0]!,
      bob: branches[1]!,
      scratch,
    };
    const reports = { ana: agentReport(events(ana)), bob: agentReport(events(bob)) };
    // The branches are judged as they are, before anyone merges them: the integration step changes Ana's.
    const hidden = CONTRACT_HIDDEN ? integrateHidden(where) : undefined;
    const plain = hidden === undefined ? integrate(where) : undefined;
    const integration = hidden ?? plain!;
    const integrator = INTEGRATE
      ? yield* Effect.promise(() => integrationStep({ ana, bob, anaHerdr, live, fresh, where }))
      : undefined;
    const result = { arm: ARM, dry: !REAL, integration, ...reports, integrator };
    say(
      "contract",
      `variant: ${CONTRACT_DEFERRED ? "deferred (the hidden seed; Bob computes his points from orderTotal() and keeps his branch right with the code it has; a fresh session on Ana's computer then merges his branch and pushes)" : CONTRACT_HIDDEN ? `hidden (orderTotal() changes its unit under the same name; nobody names the dependency; both agents start together${INTEGRATE ? "; a fresh session on Ana's computer then merges Bob's branch and pushes" : ""})` : CONTRACT_HARD ? "hard (titles and branches give nothing away; both agents start together)" : "default"}`,
    );
    const lines =
      hidden !== undefined
        ? formatHidden({ ...result, integration: hidden })
        : formatResult({ ...result, integration: plain! });
    for (const line of lines) say("contract", line);
    say("contract result", JSON.stringify(result));

    // What the run must have been, whatever the agents did: the checks say it, and with real agents
    // what they did is reported, not failed on.
    const judge = (ok: unknown, what: string) => (REAL ? observe(ok, what) : check(ok, what));
    judge(integration.ana.ok, "Ana's agent made the change it was asked for");
    judge(
      integration.bob.ok,
      "Bob's agent's code works against a contract: the old one, or the new one he was told of",
    );
    judge(integration.merge === "clean", "the two branches merge without a conflict");
    if (REAL) {
      // What real agents do is the measure: reported, whichever way it goes.
      observe(integration.clean, "the merged branches integrate cleanly");
      observe(
        integration.bobUsesCents,
        CONTRACT_HIDDEN ? "Bob's code allows for cents" : "Bob's code uses amountCents",
      );
      if (integrator !== undefined) {
        observe(integrator.said > 0, "the agents wrote in KRK-1's room");
        observe(wasGiven(integrator.given), "the integrator was given the room's words");
        observe(landed(integrator), "the integrator's merge landed and was pushed");
        observe(integrator.tree?.ok === true, "the pushed tree is right");
      }
    } else if (CONTRACT_HIDDEN) {
      // The scripted Bob writes for the orderTotal his checkout shows, as an agent told nothing would:
      // the checks must catch the hundredfold points once both branches are merged.
      check(!integration.clean, "a dry run's merged branches give a hundred times the points");
      check(!integration.bobUsesCents, "Bob's scripted code does not allow for cents");
      if (integrator !== undefined) {
        // The scripted integrator acts on what Peer told it: at its push it hears what the agents said
        // in KRK-1's room, when coordination is on and they said something (deferred).
        const informed = CONTRACT_DEFERRED && ARM !== "none";
        check(
          integrator.said > 0 === informed,
          informed
            ? "KRK-1's room holds what the scripted agents said"
            : "the scripted agents wrote nothing in KRK-1's room",
        );
        check(
          landed(integrator) && integrator.merge.head !== integrator.tips.ana,
          "the scripted integrator's merge landed: Bob's tip is in its history, no merge is going on, nothing is left uncommitted, and it was pushed",
        );
        check(
          integrator.given.carried.length === (informed ? 1 : 0),
          informed
            ? "Peer gave the integrator the room's words, once"
            : "Peer gave the integrator none of the room's words",
        );
        check(
          integrator.tree?.ok === informed,
          informed
            ? "the pushed tree is right: the integrator put Bob's points right for cents"
            : "the pushed tree is not right: nobody told the integrator, and the points are a hundredfold",
        );
        if (!informed)
          check(
            integrator.tree?.detail === "12.50 euros earn 12 points: expected 12, got 1250",
            "and the tree says how it is not right: 12.50 euros earn 1250 points",
          );
        check(
          (integrator.added.chars === 0) === (ARM === "none"),
          ARM === "none"
            ? "Peer added nothing to the integrator"
            : "Peer added to the integrator's context",
        );
      }
    } else {
      // Nothing tells the scripted agents of the contract, so Bob writes against the one he has.
      check(!integration.clean, `a dry run with ${ARM_LABELS[ARM]} does not integrate`);
      check(!integration.bobUsesCents, "Bob's scripted code does not use amountCents");
    }
  } finally {
    if (REAL) {
      for (const { computer, h, pane } of live) {
        console.log(`\n===== ${computer.name}'s agent, last screen =====`);
        console.log(
          herdrText(h, "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"),
        );
        console.log(`===== ${computer.name}'s coordination log =====`);
        for (const entry of events(computer)) {
          if (/^(cli|decision|news|wake|overlap\.opened)$/.test(entry.event))
            console.log(JSON.stringify(entry).slice(0, 900));
        }
      }
      for (const { computer, h, pane } of fresh) {
        console.log(`\n===== ${computer.name}'s fresh agent (the integrator), last screen =====`);
        console.log(
          herdrText(h, "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"),
        );
        console.log(`===== ${computer.name}'s landing log =====`);
        for (const entry of events(computer)) {
          if (/^landing\./.test(entry.event)) console.log(JSON.stringify(entry).slice(0, 900));
        }
      }
      for (const herdr of [anaHerdr, bobHerdr])
        if (herdr !== undefined) herdrText(herdr, "server", "stop");
    }
  }
}).pipe(Effect.scoped);

/**
 * REAL_SCENARIO=follow (`peer-lab/follow.ts`): Ana's agent changes orderTotal() to cents, Bob's agent is started from
 * her change, and Ana amends it while he works. The lab does what the people would: Ana's `jj git push` (Peer never
 * pushes), and Bob's start from her bookmark. It reports whether Bob's final tree is right, whether any edit was lost,
 * how many converges ran, the moved notices Bob's agent heard and the characters Peer added.
 */
const followProgram = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const anaHerdr = REAL ? startHerdr("Ana") : undefined;
  const bobHerdr = REAL ? startHerdr("Bob") : undefined;
  const ana = yield* startComputer("Ana", "ana@acme.test", anaHerdr?.socket);
  const bob = yield* startComputer("Bob", "bob@acme.test", bobHerdr?.socket);
  const kit = jujutsuKit(ana, bob);
  const live: Array<{ computer: Computer; h: HerdrServer; pane: string }> = [];
  try {
    let bobCwd = "";
    if (REAL && anaHerdr !== undefined && bobHerdr !== undefined) {
      for (const task of FOLLOW_TASKS)
        yield* Effect.promise(() => kit.addTask(task.title, task.key));
      // jj commands the agents read with need no approval; nothing they may run rewrites anything.
      const allow = ["jj log", "jj diff", "jj status", "jj show", "jj file show", "jj interdiff"];
      const anaTree = yield* Effect.promise(() => kit.worktree(ana, FOLLOW_TASKS[0].key, "main"));
      const anaPane = yield* Effect.promise(() =>
        startClaude(anaHerdr, ana, "ana", { cwd: anaTree.cwd, allow }),
      );
      live.push({ computer: ana, h: anaHerdr, pane: anaPane });
      const stopCapture = captureScreens(() => live);
      herdrJson(anaHerdr, "agent", "prompt", anaPane, FOLLOW_ANA_TASK);
      say("Ana's agent prompted (KRK-1)", FOLLOW_ANA_TASK);
      const snapshots = (computer: Computer) =>
        events(computer).filter((e) => e.event === "jujutsu.snapshot" && e.changed === true).length;
      // Ana's change exists once her agent has edited and gone quiet; then she pushes it, as she would.
      for (let waited = 0; waited < 10 * 60_000; waited += 3000) {
        yield* Effect.promise(() => sleep(3000));
        approveAll(live);
        if (snapshots(ana) > 0 && ["idle", "done"].includes(statusOf(anaHerdr, anaPane))) break;
      }
      check(snapshots(ana) > 0, "Ana's agent made a change Peer snapshotted");
      pushAnas(kit, { ...anaTree, key: FOLLOW_TASKS[0].key }, FOLLOW_TASKS[0].title);
      const bobTree = yield* Effect.promise(() =>
        kit.worktree(bob, FOLLOW_TASKS[1].key, anaTree.branch),
      );
      bobCwd = bobTree.cwd;
      const bobPane = yield* Effect.promise(() =>
        startClaude(bobHerdr, bob, "bob", { cwd: bobTree.cwd, allow }),
      );
      live.push({ computer: bob, h: bobHerdr, pane: bobPane });
      herdrJson(bobHerdr, "agent", "prompt", bobPane, FOLLOW_BOB_TASK);
      say("Bob's agent prompted (KRK-2), started from Ana's change", FOLLOW_BOB_TASK);
      // Ana amends while Bob works, and pushes the new version when her agent is quiet again.
      const before = snapshots(ana);
      herdrJson(anaHerdr, "agent", "prompt", anaPane, FOLLOW_AMEND_TASK);
      say("Ana's agent prompted to amend", FOLLOW_AMEND_TASK);
      let pushed = false;
      for (let waited = 0; waited < 12 * 60_000 && !pushed; waited += 3000) {
        yield* Effect.promise(() => sleep(3000));
        approveAll(live);
        if (snapshots(ana) > before && ["idle", "done"].includes(statusOf(anaHerdr, anaPane))) {
          kit.jj(anaTree.cwd, "git", "push", "--bookmark", anaTree.branch);
          pushed = true;
        }
      }
      observe(pushed, "Ana amended her change and pushed the new version");
      yield* Effect.promise(() => quietUntil(live, 12 * 60_000));
      yield* Effect.promise(holdForFilm);
      stopCapture();
    } else {
      const stand = yield* Effect.promise(() => runFollowStub(kit));
      bobCwd = stand.bob.cwd;
    }
    // The logs are written a moment after the hooks answer.
    yield* Effect.promise(() => sleep(1500));

    // Bob's workspace as it ends: the status snapshots what the agent last wrote.
    jj(bobCwd, "status");
    const split = new Set(
      parseDivergent(
        jj(bobCwd, "log", "--no-graph", "-r", "divergent()", "-T", 'change_id ++ "\\n"'),
      ),
    );
    const work = NodePath.join(lab, "follow-checks");
    const tree = checkFollowTree(bobCwd, work);
    const result = followResult({
      dry: !REAL,
      tree,
      present: (path) => NodeFS.existsSync(NodePath.join(bobCwd, path)),
      ana: events(ana),
      bob: events(bob),
      twoVersions: split.size,
    });
    for (const line of formatFollow(result)) say("follow", line);
    say("follow result", JSON.stringify(result));
    const judge = (ok: unknown, what: string) => (REAL ? observe(ok, what) : check(ok, what));
    judge(tree.ok, "Bob's final tree is right, with Ana's amend in it");
    judge(result.lost.length === 0, "no edit made through an agent's tools was lost");
    judge(result.twoVersions === 0, "no change is left with two versions");
    judge(result.moved === 1, "Bob's agent heard once that Ana's change moved");
  } finally {
    if (REAL) {
      for (const { computer, h, pane } of live) {
        console.log(`\n===== ${computer.name}'s agent, last screen =====`);
        console.log(
          herdrText(h, "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"),
        );
        console.log(`===== ${computer.name}'s jujutsu log =====`);
        for (const entry of events(computer)) {
          if (/^(jujutsu|landing|changes)\./.test(entry.event))
            console.log(JSON.stringify(entry).slice(0, 900));
        }
      }
      for (const herdr of [anaHerdr, bobHerdr])
        if (herdr !== undefined) herdrText(herdr, "server", "stop");
    }
  }
}).pipe(Effect.scoped);

/** A line in each project: the agent can reach the second one only through the folder it was given. */
const SHARED_ASK = (project: string) =>
  `Add the comment \`// marker-shared\` as the first line of src/pricing.ts in this project and also in the ${project} project, whose folder Peer gives you. Do not commit, do not run tests. Then say so in this room with peer room say, and run peer status from the ${project} folder. Also add a file notes.md saying done in the Notes project, whose folder Peer gives you too.`;

/**
 * LAB_SHARED=1: one room across Lab and Site. Ana's own message in Lab's chat starts one real agent; judged from what
 * the Hub, her log and each project's room diff say.
 */
const sharedRoomProgram = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const herdr = startHerdr("Ana");
  const bobHerdr = startHerdr("Bob");
  const ana = yield* startComputer("Ana", "ana@acme.test", herdr.socket);
  writeClaudeWrapper(herdr, ana);
  const opened = yield* ana.client[WS_METHODS.peerHubOpenProject]({
    workspace: "acme",
    projectId: "site",
  });
  const siteCheckout = opened.workspaces[0]?.projects.find((p) => p.project.id === "site")
    ?.repositories[0];
  if (siteCheckout?.state !== "ready") throw new Error("Site could not be checked out");
  if (JJ) colocate(siteCheckout.path);
  // A third project no workspace shares, with rules of its own, which the agent must follow.
  const localFolder = NodePath.join(lab, "notes");
  NodeChildProcess.execFileSync("git", [
    "clone",
    "--quiet",
    NodePath.join(lab, "site.git"),
    localFolder,
  ]);
  NodeFS.writeFileSync(
    NodePath.join(localFolder, "CLAUDE.md"),
    "Every file you add here starts with the line `marker-notes-rule`.\n",
  );
  NodeChildProcess.execFileSync("git", ["-C", localFolder, "add", "CLAUDE.md"]);
  NodeChildProcess.execFileSync("git", [
    "-C",
    localFolder,
    "-c",
    "user.name=lab",
    "-c",
    "user.email=lab@acme.test",
    "commit",
    "--quiet",
    "-m",
    "rules",
  ]);
  const group = "lab-shared-room";
  yield* ana.client[PEER_ROOMS_METHODS.peerRoomsFolders]({
    group,
    folders: [
      { name: "Notes", folder: localFolder },
      // A workspace can still name a project as a folder after it was shared.
      { name: "Site", folder: siteCheckout.path },
    ],
  });
  const chat = (projectId: string) =>
    ana.client[WS_METHODS.peerHubCreateTask]({
      workspace: "acme",
      projectId,
      title: "Across both",
      chat: true,
      group,
    });
  const labChat = yield* chat("lab");
  const siteChat = yield* chat("site");
  const place = (project: string, created: typeof labChat) => ({
    workspace: "acme",
    project,
    task: created.createdTask?.id ?? "",
  });
  const labRoom = place("lab", labChat);
  const siteRoom = place("site", siteChat);
  const roomPath = `/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(labRoom.task)}/room`;
  const live: Array<{ computer: Computer; h: HerdrServer; pane: string; label?: string }> = [];
  const panes = () =>
    (herdrJson(herdr, "agent", "list").result?.agents ?? []) as ReadonlyArray<{
      readonly pane_id: string;
    }>;
  try {
    for (const folder of [ana.checkout, siteCheckout.path]) {
      const pane = yield* Effect.promise(() =>
        startClaude(herdr, ana, "trust", { cwd: NodeFS.realpathSync(folder) }),
      );
      herdrJson(herdr, "agent", "prompt", pane, "/exit");
      yield* Effect.promise(() => sleep(4000));
      herdrText(herdr, "pane", "close", pane);
    }
    const asked = yield* Effect.promise(() =>
      Effect.runPromise(
        ana.client[PEER_ROOMS_METHODS.peerRoomsPost]({
          ...labRoom,
          op: "shared-ask",
          text: SHARED_ASK("Site"),
          to: [
            {
              kind: "agent",
              email: "ana@acme.test",
              model: process.env.LAB_MODEL ?? "claude-haiku-5-5",
            },
          ],
        }),
      ),
    );
    const delivery = async () =>
      deliveryOf(
        (
          (await hubCall(`${roomPath}?limit=50`, { session: hubSession }))
            .messages as ReadonlyArray<PeerRoomMessage>
        ).find((one) => one.seq === asked.seq),
        "ana@acme.test",
      );
    let answered = false;
    for (let waited = 0; waited < 6 * 60_000 && !answered; waited += 3000) {
      yield* Effect.promise(() => sleep(3000));
      answered = (yield* Effect.promise(delivery))?.state === "answered";
      for (const { pane_id: pane } of panes()) {
        if (!live.some((one) => one.pane === pane)) live.push({ computer: ana, h: herdr, pane });
        const screen = herdrText(herdr, "pane", "read", pane, "--source", "visible");
        if (screen.includes("Yes, I trust this folder"))
          herdrText(herdr, "pane", "send-keys", pane, "enter");
      }
      approveAll(live);
    }
    say("delivery", JSON.stringify(yield* Effect.promise(delivery)));
    // A follow-up to the room reaches the agent that runs, and starts no second one.
    const followed = yield* Effect.promise(() =>
      Effect.runPromise(
        ana.client[PEER_ROOMS_METHODS.peerRoomsPost]({
          ...labRoom,
          op: "shared-follow-up",
          text: "In one short sentence, name the folders you work in, in the room.",
          to: [{ kind: "agent", email: "ana@acme.test" }],
        }),
      ),
    );
    const followUp = async () =>
      deliveryOf(
        (
          (await hubCall(`${roomPath}?limit=50`, { session: hubSession }))
            .messages as ReadonlyArray<PeerRoomMessage>
        ).find((one) => one.seq === followed.seq),
        "ana@acme.test",
      );
    let heard = false;
    for (let waited = 0; waited < 3 * 60_000 && !heard; waited += 3000) {
      yield* Effect.promise(() => sleep(3000));
      heard = (yield* Effect.promise(followUp))?.state === "answered";
      approveAll(live);
    }
    say("follow-up", JSON.stringify(yield* Effect.promise(followUp)));
    check(heard, "a follow-up in the room reached the agent");
    check(panes().length === 1, "the follow-up started no second agent");
    const read = yield* Effect.promise(() =>
      Effect.runPromise(ana.client[PEER_ROOMS_METHODS.peerRoomsRead]({ ...labRoom, limit: 50 })),
    );
    say("run's projects", JSON.stringify(read.runProjects));
    const reached = Object.values(read.runProjects ?? {})[0] ?? [];
    check(
      reached.toSorted().join() === "Notes,site",
      "the room says the run works in Site and Notes, once each",
    );
    check(
      !(NodeFS.readdirSync(NodePath.join(lab, "ana"), { recursive: true }) as string[]).some(
        (entry) => entry.includes(`_folders${NodePath.sep}${NodePath.basename(siteCheckout.path)}`),
      ),
      "a shared project named as a folder gets no second checkout",
    );
    const diffOf = (room: typeof labRoom) =>
      Effect.promise(() => Effect.runPromise(ana.client[PEER_ROOMS_METHODS.peerRoomsDiff](room)));
    const labDiff = yield* diffOf(labRoom);
    const siteDiff = yield* diffOf(siteRoom);
    const patchOf = (diff: typeof labDiff) => (diff.state === "here" ? diff.patch : "");
    say("lab diff", `${labDiff.folder} ${patchOf(labDiff).slice(0, 300)}`);
    say("site diff", `${siteDiff.folder} ${patchOf(siteDiff).slice(0, 300)}`);
    // Bob's agent, on Site alone, edits the file Ana's agent edited there from Lab's session.
    const bob = yield* startComputer("Bob", "bob@acme.test", bobHerdr.socket);
    writeClaudeWrapper(bobHerdr, bob);
    const bobOpened = yield* bob.client[WS_METHODS.peerHubOpenProject]({
      workspace: "acme",
      projectId: "site",
    });
    const bobSite = bobOpened.workspaces[0]?.projects.find((p) => p.project.id === "site")
      ?.repositories[0];
    if (bobSite?.state !== "ready") throw new Error("Bob could not check Site out");
    if (JJ) colocate(bobSite.path);
    const bobPane = yield* Effect.promise(() =>
      startClaude(bobHerdr, bob, "bob", { cwd: NodeFS.realpathSync(bobSite.path) }),
    );
    live.push({ computer: bob, h: bobHerdr, pane: bobPane });
    herdrJson(
      bobHerdr,
      "agent",
      "prompt",
      bobPane,
      "Add the comment `// from bob` as the first line of src/pricing.ts. Do not commit. Then say done.",
    );
    for (let waited = 0; waited < 3 * 60_000; waited += 3000) {
      yield* Effect.promise(() => sleep(3000));
      approveAll(live);
      if (
        waited > 15_000 &&
        ["idle", "done"].includes(statusOf(bobHerdr, bobPane)) &&
        NodeFS.readFileSync(NodePath.join(bobSite.path, "src/pricing.ts"), "utf8").includes(
          "from bob",
        )
      )
        break;
    }
    const overlaps = [...events(ana), ...events(bob)].filter((entry) =>
      /overlap/i.test(entry.event),
    );
    say("overlap events", JSON.stringify(overlaps).slice(0, 700));
    check(overlaps.length > 0, "Bob's edit on Site meets the edit Ana's agent made there from Lab");
    // The work on Site is handed off from Site's folder.
    herdrJson(
      herdr,
      "agent",
      "prompt",
      live.find((one) => one.computer === ana)?.pane ?? "",
      `Commit your change in this folder: cd ${siteDiff.folder ?? ""} and commit it there. Then run peer ready from that folder. If Peer refuses, do what it says and run it again until it hands off. Tell me its last output.`,
    );
    const siteTask = async () => {
      const read = await Effect.runPromise(ana.client[WS_METHODS.peerHubSync]({}));
      return read.workspaces[0]?.projects
        .find((p) => p.project.id === "site")
        ?.work.tasks.find((one) => one.id === siteRoom.task);
    };
    for (let waited = 0; waited < 2 * 60_000; waited += 3000) {
      yield* Effect.promise(() => sleep(3000));
      approveAll(live);
    }
    const reviews = events(ana).filter((entry) => entry.event === "cli");
    say("cli", JSON.stringify(reviews.slice(-4)).slice(0, 900));
    const reviewed = (yield* Effect.promise(siteTask))?.status;
    check(reviewed === "review", "peer ready from Site's folder moved Site's task to review");
    say(
      "Site's task after peer ready",
      JSON.stringify(yield* Effect.promise(siteTask)).slice(0, 300),
    );
    const siteRuns = (
      (yield* Effect.promise(() =>
        hubCall(`/v1/workspaces/acme/runs/site?task=${encodeURIComponent(siteRoom.task)}`, {
          session: hubSession,
        }),
      )) as unknown as { runs: ReadonlyArray<RoomsRun> }
    ).runs;
    say("runs on Site", JSON.stringify(siteRuns).slice(0, 400));
    const siteEdits = events(ana).filter(
      (entry) =>
        entry.event === "hook" &&
        entry.project === "site" &&
        entry.hookEvent === "PreToolUse" &&
        entry.tool === "Edit",
    );
    check(siteEdits.length > 0, "Site's edit went through a session of Site");
    check(siteRuns.length > 0, "Site's task has a run of its own");
    const notesTree = (
      NodeFS.readdirSync(NodePath.join(lab, "ana"), { recursive: true }) as string[]
    ).find((entry) => entry.includes("_folders") && entry.endsWith("notes.md"));
    const notes =
      notesTree === undefined
        ? ""
        : NodeFS.readFileSync(NodePath.join(lab, "ana", notesTree), "utf8");
    say("notes.md", `${notesTree} ${notes}`);
    check(notes.includes("marker-notes-rule"), "the local project's rules reached the agent");
    check(
      !NodeFS.existsSync(NodePath.join(localFolder, "notes.md")),
      "the local project's work is in a checkout of its own",
    );
    check(answered, "the agent answered in the room");
    check(panes().length === 1, "one agent ran");
    check(patchOf(labDiff).includes("marker-shared"), "Lab's diff shows its edit");
    check(patchOf(siteDiff).includes("marker-shared"), "Site's diff shows its edit");
    check(
      siteDiff.folder !== undefined && !siteDiff.folder.startsWith(siteCheckout.path),
      "Site's work is in a checkout of its own",
    );
  } finally {
    for (const { pane } of live) {
      console.log(`\n===== agent ${pane}, last screen =====`);
      console.log(
        herdrText(herdr, "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "120"),
      );
    }
    for (const entry of events(ana)) {
      if (/^(edit|claim|rooms)/.test(entry.event)) console.log(JSON.stringify(entry).slice(0, 300));
    }
    herdrText(herdr, "server", "stop");
    herdrText(bobHerdr, "server", "stop");
  }
}).pipe(Effect.scoped);

/** LAB_RETRY: the work at a first hearing; at a later one the agent finds its file and answers. */
const RETRY_ASK = (file: string) =>
  `I send you this message twice. The first time, ${file} is missing: create it with the one line \`// ${file}\`, commit it on your branch (${JJ ? "jj commit" : "git add, then git commit"}), then stop, without a word in this room and without peer ready. The second time, you find the file there, or you remember making it: then answer this message in the room with peer room say --reply, naming the commit that holds it.`;
const RETRY_READ = (file: string) =>
  `${RETRY_ASK(file)} A reminder from Peer in this session is not the second time, so stay silent then. Once your person continues your run, it is the second time.`;
const RETRY_NOTHING =
  "Change nothing and commit nothing. Stop, without a word in this room and without peer ready.";

/**
 * LAB_RETRY=1: Try again on real agents, in chats of Lab. Each agent stops without answering, and Ana tries again. Judged
 * from where the retry went: its run, its checkout, the commit and the room's diff.
 */
const roomsRetryProgram = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const herdr = startHerdr("Ana");
  const ana = yield* startComputer("Ana", "ana@acme.test", herdr.socket);
  writeClaudeWrapper(herdr, ana);
  const email = "ana@acme.test";
  const model = process.env.LAB_MODEL ?? "claude-haiku-5-5";
  const rpc = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
  const missed: string[] = [];
  const must = (ok: unknown, what: string) => {
    observe(ok, what);
    if (!ok) missed.push(what);
  };
  const live: Array<{ computer: Computer; h: HerdrServer; pane: string }> = [];
  const agents = () =>
    (herdrJson(herdr, "agent", "list").result?.agents ?? []) as ReadonlyArray<{
      readonly pane_id: string;
      readonly cwd?: string;
    }>;
  /** What a person at the screen does while the lab waits. */
  const tend = () => {
    const panes = agents().map((one) => one.pane_id);
    for (const pane of panes) {
      if (!live.some((one) => one.pane === pane)) live.push({ computer: ana, h: herdr, pane });
      const screen = herdrText(herdr, "pane", "read", pane, "--source", "visible");
      if (screen.includes("Yes, I trust this folder"))
        herdrText(
          herdr,
          "pane",
          "send-keys",
          pane,
          /❯\s*Yes, I trust this folder/.test(screen) ? "enter" : "down",
        );
    }
    approveAll(live.filter((one) => panes.includes(one.pane)));
  };
  const waitOn = async (what: string, ready: () => boolean | Promise<boolean>, ms: number) => {
    for (let waited = 0; waited < ms; waited += 3000) {
      if (await ready()) return true;
      await sleep(3000);
      tend();
    }
    say("gave up waiting", what);
    return false;
  };
  const commitsIn = (cwd: string, base = "main") => {
    try {
      return Number(
        NodeChildProcess.execFileSync("git", ["-C", cwd, "rev-list", "--count", `${base}..HEAD`], {
          encoding: "utf8",
        }).trim(),
      );
    } catch {
      return 0;
    }
  };
  const idle = (pane: string) => ["idle", "done"].includes(statusOf(herdr, pane));
  const agentGone = async (pane: string) => {
    await waitOn("the agent to idle", () => idle(pane), 3 * 60_000);
    herdrJson(herdr, "agent", "prompt", pane, "/exit");
    await waitOn("the agent to leave", () => !agents().some((a) => a.pane_id === pane), 30_000);
    herdrText(herdr, "pane", "close", pane);
  };
  /** Its agent dies at once, so no end hook comes. The wrapper's pid is the agent's: it execs. */
  const crash = async (pane: string) => {
    await waitOn("the agent to idle", () => idle(pane), 3 * 60_000);
    const pids = NodeFS.readFileSync(NodePath.join(herdr.base, "claude-pids.log"), "utf8");
    process.kill(Number(pids.trim().split("\n").at(-1)), "SIGKILL");
    await waitOn("the agent to die", () => !agents().some((a) => a.pane_id === pane), 30_000);
    herdrText(herdr, "pane", "close", pane);
  };
  const started = () => agents()[0];
  const claudeArgs = () =>
    NodeFS.readFileSync(NodePath.join(herdr.base, "claude-args.log"), "utf8").trim().split("\n");
  const realPath = (path: string) => (NodeFS.existsSync(path) ? NodeFS.realpathSync(path) : path);
  /** The checkouts Peer means to remove once their task is done, sorted. */
  const remembered = (): ReadonlyArray<string> => {
    const file = (NodeFS.readdirSync(ana.home, { recursive: true }) as string[]).find(
      (entry) => NodePath.basename(entry) === "peer-hub.json",
    );
    try {
      const persisted = JSON.parse(
        NodeFS.readFileSync(NodePath.join(ana.home, file ?? ""), "utf8"),
      );
      return Object.keys(persisted.pluginData?.herdr?.checkouts ?? {})
        .map(realPath)
        .toSorted();
    } catch {
      return [];
    }
  };

  interface ChatHere {
    readonly cwd: string;
    readonly pane: string;
    readonly place: { readonly workspace: string; readonly project: string; readonly task: string };
    readonly deliveryAt: (seq: number) => Promise<ReturnType<typeof deliveryOf>>;
  }

  /** Ana's message in a new chat, until its agent is done with it and `leave` has let it go. */
  const chatUntilStopped = async (
    title: string,
    text: string,
    chosen: string | undefined,
    done: (cwd: string) => boolean,
    leave: (run: string, chat: ChatHere) => Promise<void> = async () => undefined,
    gone: (pane: string) => Promise<void> = agentGone,
  ) => {
    const created = await rpc(
      ana.client[WS_METHODS.peerHubCreateTask]({
        workspace: "acme",
        projectId: "lab",
        title,
        chat: true,
      }),
    );
    const place = { workspace: "acme", project: "lab", task: created.createdTask?.id ?? "" };
    const asked = await rpc(
      ana.client[PEER_ROOMS_METHODS.peerRoomsPost]({
        ...place,
        op: `retry-${place.task}`,
        text,
        to: [{ kind: "agent", email, ...(chosen === undefined ? {} : { model: chosen }) }],
      }),
    );
    const roomPath = `/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(place.task)}/room`;
    const deliveryAt = async (seq: number) =>
      deliveryOf(
        (
          (await hubCall(`${roomPath}?limit=50`, { session: hubSession }))
            .messages as ReadonlyArray<PeerRoomMessage>
        ).find((one) => one.seq === seq),
        email,
      );
    const delivery = () => deliveryAt(asked.seq);
    if (!(await waitOn(`${title}: its agent`, () => agents().length > 0, 3 * 60_000)))
      throw new Error(`${title}: no agent started`);
    const { pane_id: pane, cwd = "" } = started()!;
    say(`${title}: the agent`, `${pane} in ${cwd}`);
    must(
      await waitOn(`${title}: its work`, () => done(cwd) && idle(pane), 6 * 60_000),
      `${title}: its agent did what it was asked`,
    );
    const run = (await delivery())?.run ?? "";
    await leave(run, { cwd, pane, place, deliveryAt });
    await gone(pane);
    // Nobody syncs here: no ping comes on a quiet room, so only Peer can have read it.
    must(
      await waitOn(
        `${title}: the room says it stopped`,
        async () => (await delivery())?.state === "failed",
        5 * 60_000,
      ),
      `${title}: the delivery failed once its session ended`,
    );
    say(`${title}: the delivery`, JSON.stringify(await delivery()));
    const openRuns = async () =>
      (
        await rpc(
          ana.client[WS_METHODS.peerHubRuns]({
            workspace: "acme",
            projectId: "lab",
            taskId: place.task,
          }),
        )
      ).runs.filter((one) => one.state !== "ended");
    const shows = async (file: string) => {
      const diff = await rpc(ana.client[PEER_ROOMS_METHODS.peerRoomsDiff](place));
      say(`${title}: the room's diff`, JSON.stringify(diff).slice(0, 300));
      return diff.state === "here" && diff.patch.includes(file);
    };
    const tryAgainAt = (seq: number) =>
      rpc(ana.client[PEER_ROOMS_METHODS.peerRoomsPass]({ ...place, seq, expect: "failed" }));
    const tryAgain = () => tryAgainAt(asked.seq);
    return {
      cwd,
      delivery,
      deliveryAt,
      openRuns,
      run,
      shows,
      task: place.task,
      tryAgain,
      tryAgainAt,
    };
  };

  try {
    const trust = yield* Effect.promise(() =>
      startClaude(herdr, ana, "trust", { cwd: NodeFS.realpathSync(ana.checkout) }),
    );
    herdrJson(herdr, "agent", "prompt", trust, "/exit");
    yield* Effect.promise(() => sleep(4000));
    herdrText(herdr, "pane", "close", trust);
    // Peer remembers a checkout's kind for 30 s, and the lab made it a jj repository just now.
    if (JJ) yield* Effect.promise(() => sleep(31_000));

    yield* Effect.promise(async () => {
      // An open run on a chosen model: Try again used to start a second run beside it, from main.
      const committed = (file: string) => (cwd: string) =>
        NodeFS.existsSync(NodePath.join(cwd, file)) && commitsIn(cwd) > 0;
      const a = await chatUntilStopped(
        "A",
        RETRY_ASK("retry-a.ts"),
        model,
        committed("retry-a.ts"),
      );
      const firstStart = claudeArgs().length;
      must(
        !JJ || NodeFS.existsSync(NodePath.join(a.cwd, ".jj")),
        "A: on Jujutsu its checkout is a jj workspace",
      );
      must(await a.shows("retry-a.ts"), "A: the room shows the commit of the run that stopped");
      await a.tryAgain();
      must(
        await waitOn(
          "A: the retry's answer",
          async () => (await a.delivery())?.state === "answered",
          6 * 60_000,
        ),
        "A: the retry answered in the room",
      );
      const againA = started();
      say("A: the delivery after Try again", JSON.stringify(await a.delivery()));
      must((await a.delivery())?.run === a.run, "A: the retry is the same run");
      must(againA?.cwd === a.cwd, `A: in the same checkout (${String(againA?.cwd)})`);
      must(commitsIn(a.cwd) > 0, "A: the commit is still there");
      must((await a.openRuns()).length === 1, "A: one open run, so one toggle in the room");
      must(await a.shows("retry-a.ts"), "A: the room still shows the commit");
      const resumed = claudeArgs()[firstStart] ?? "";
      say("A: the retry's claude", resumed);
      must(resumed.includes("--resume"), "A: it resumed its conversation");
      must(resumed.includes(`--model ${model}`), "A: on the model Ana chose");
      await agentGone(againA?.pane_id ?? "");

      // A run that ended: nothing continues it, so a new run goes on in its checkout.
      const b = await chatUntilStopped(
        "B",
        RETRY_ASK("retry-b.ts"),
        undefined,
        committed("retry-b.ts"),
        async (run) => {
          await rpc(
            ana.client[WS_METHODS.peerHubEndRun]({
              workspace: "acme",
              projectId: "lab",
              runId: run,
            }),
          );
        },
      );
      must(await b.shows("retry-b.ts"), "B: the room shows the commit of the run that ended");
      await b.tryAgain();
      must(
        await waitOn(
          "B: the retry's answer",
          async () => (await b.delivery())?.state === "answered",
          6 * 60_000,
        ),
        "B: the retry answered in the room",
      );
      const againB = started();
      must((await b.delivery())?.run !== b.run, "B: the retry is a new run");
      must(againB?.cwd === b.cwd, `B: in the same checkout (${String(againB?.cwd)})`);
      must(commitsIn(b.cwd) > 0, "B: the commit is still there");
      must((await b.openRuns()).length === 1, "B: one open run");
      must(await b.shows("retry-b.ts"), "B: the room still shows the commit");
      await agentGone(againB?.pane_id ?? "");

      // A teammate pushes to main, which Ana's clone has not fetched.
      const teammate = NodePath.join(lab, "teammate");
      git(lab, "clone", "--quiet", NodePath.join(lab, "origin.git"), teammate);
      NodeFS.writeFileSync(NodePath.join(teammate, "team-pushed.ts"), "// pushed\n");
      git(teammate, "add", ".");
      git(teammate, "commit", "--quiet", "-m", "the team's work");
      git(teammate, "push", "--quiet", "origin", "HEAD:main");
      const standing = () =>
        JJ
          ? jj(
              ana.checkout,
              "--ignore-working-copy",
              "log",
              "--no-graph",
              "-r",
              "@ | @-",
              "-T",
              'commit_id ++ "\\n"',
            )
          : git(ana.checkout, "rev-parse", "HEAD");
      const stoodAt = standing();

      // Nothing to keep: the retry goes as it always did, from the base in a new checkout.
      let quiet = 0;
      const c = await chatUntilStopped("C", RETRY_NOTHING, model, () => {
        quiet += 1;
        return quiet > 8;
      });
      must(
        NodeFS.existsSync(NodePath.join(c.cwd, "team-pushed.ts")),
        "C: its agent started from what the team pushed",
      );
      must(
        !NodeFS.existsSync(NodePath.join(ana.checkout, "team-pushed.ts")) && standing() === stoodAt,
        "C: Ana's own checkout stayed where it was",
      );
      await c.tryAgain();
      must(
        await waitOn("C: a new agent", () => agents().length > 0, 3 * 60_000),
        "C: the retry started an agent",
      );
      const againC = started();
      must(againC?.cwd !== c.cwd, `C: in a new checkout (${String(againC?.cwd)})`);
      // Not local main: a fetch moves neither Git's nor a jj bookmark that tracks nothing.
      must(commitsIn(againC?.cwd ?? "", "refs/remotes/origin/main") === 0, "C: from the base");
      await agentGone(againC?.pane_id ?? "");

      // A crash sends no end hook: the session's lease runs out, and the room hears of that too.
      let stilled = 0;
      const d = await chatUntilStopped(
        "D",
        RETRY_NOTHING,
        undefined,
        () => {
          stilled += 1;
          return stilled > 8;
        },
        undefined,
        crash,
      );
      must(
        events(ana).some((entry) => entry.event === "session.expired"),
        "D: its session expired, as no end hook came",
      );
      must(
        (await d.delivery())?.reason === PEER_ROOM_SESSION_ENDED,
        "D: the room says it stopped without answering",
      );
      await d.tryAgain();
      must(
        await waitOn("D: a new agent", () => agents().length > 0, 3 * 60_000),
        "D: Try again started an agent",
      );
      const againD = started();
      must(againD?.cwd !== d.cwd, `D: in a new checkout (${String(againD?.cwd)})`);
      await agentGone(againD?.pane_id ?? "");

      // A live run hears a message on a hook, which proves no reading: only the retired Peer Mod
      // made a delivery `heard`. So what an agent read stays `taken`, and its end fails it as any.
      let settled = 0;
      let read = 0;
      const e = await chatUntilStopped(
        "E",
        RETRY_NOTHING,
        undefined,
        () => {
          settled += 1;
          return settled > 8;
        },
        async (_run, { cwd, pane, place, deliveryAt }) => {
          read = (
            await rpc(
              ana.client[PEER_ROOMS_METHODS.peerRoomsPost]({
                ...place,
                op: `retry-read-${place.task}`,
                text: RETRY_READ("retry-e.ts"),
                to: [{ kind: "agent", email }],
              }),
            )
          ).seq;
          must(
            await waitOn(
              "E: its agent to read it",
              () => committed("retry-e.ts")(cwd) && idle(pane),
              6 * 60_000,
            ),
            "E: its agent read the message on a hook and did what it asked",
          );
          must((await deliveryAt(read))?.state === "taken", "E: the message it read stays `taken`");
        },
      );
      must(
        await waitOn(
          "E: the room says it stopped",
          async () => (await e.deliveryAt(read))?.state === "failed",
          60_000,
        ),
        "E: the message it read failed once its session ended",
      );
      must(
        (await e.deliveryAt(read))?.reason === PEER_ROOM_SESSION_ENDED,
        "E: the room says it stopped without answering",
      );
      await e.tryAgainAt(read);
      must(
        await waitOn(
          "E: the retry's answer",
          async () => (await e.deliveryAt(read))?.state === "answered",
          6 * 60_000,
        ),
        "E: Try again got the message answered",
      );
      const againE = started();
      must(againE?.cwd === e.cwd, `E: in the same checkout (${String(againE?.cwd)})`);
      await agentGone(againE?.pane_id ?? "");

      // A, B and E went on in their checkouts; C's and D's retries, with nothing to keep, made new ones.
      const made = [a.cwd, b.cwd, c.cwd, againC?.cwd ?? "", d.cwd, againD?.cwd ?? "", e.cwd]
        .map(realPath)
        .toSorted();
      const allKnown = await waitOn(
        "Peer to remember its checkouts",
        () => remembered().join() === made.join(),
        30_000,
      );
      say("the checkouts Peer remembers", remembered().join(" "));
      must(allKnown, "Peer remembers each checkout a chat's run made, once");

      for (const task of [a.task, c.task])
        await hubCall(`/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(task)}`, {
          method: "PATCH",
          session: hubSession,
          body: { status: "done" },
        });
      const gone = await waitOn(
        "closed chats' checkouts to go",
        async () => {
          await rpc(ana.client[WS_METHODS.peerHubSync]({}));
          return !NodeFS.existsSync(c.cwd) && !NodeFS.existsSync(againC?.cwd ?? "");
        },
        3 * 60_000,
      );
      say("the checkouts Peer remembers once closed", remembered().join(" "));
      must(gone, "C: closing the chat removed both checkouts, which held nothing");
      must(
        NodeFS.existsSync(a.cwd) && remembered().includes(realPath(a.cwd)),
        "A: closing the chat kept the checkout with a commit no remote has",
      );
      must(
        remembered().join() ===
          [a.cwd, b.cwd, d.cwd, againD?.cwd ?? "", e.cwd].map(realPath).toSorted().join(),
        "Peer forgot only what it removed",
      );
    });
    check(missed.length === 0, `Try again kept the work (missing: ${missed.join("; ")})`);
  } finally {
    for (const { pane } of live) {
      console.log(`\n===== agent ${pane}, last screen =====`);
      console.log(
        herdrText(herdr, "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "60"),
      );
    }
    for (const entry of events(ana)) {
      if (/^rooms|^run\./.test(entry.event)) console.log(JSON.stringify(entry).slice(0, 300));
    }
    herdrText(herdr, "server", "stop");
  }
}).pipe(Effect.scoped);

/**
 * REAL_SCENARIO=rooms REAL_AGENTS=1: real Claude Code on both computers. Peer starts Bob's agent in his real
 * herdr, so its pane runs the lab's `claude` wrapper. What agents do is observed and reported, never failed on, except
 * what the arm cannot go on without.
 */
const roomsRealProgram = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const anaHerdr = startHerdr("Ana");
  const bobHerdr = startHerdr("Bob");
  const ana = yield* startComputer("Ana", "ana@acme.test", anaHerdr.socket);
  const bob = yield* startComputer("Bob", "bob@acme.test", bobHerdr.socket);
  writeClaudeWrapper(anaHerdr, ana);
  writeClaudeWrapper(bobHerdr, bob);
  const created = yield* Effect.promise(() =>
    hubCall("/v1/workspaces/acme/projects/lab/tasks", {
      method: "POST",
      session: hubSession,
      body: { title: ROOMS_TASK.title, key: ROOMS_TASK.key },
    }),
  );
  const taskId = String(created.id);
  for (const computer of [ana, bob])
    yield* Effect.promise(() =>
      until(`${computer.name}'s Peer knows ${ROOMS_TASK.key}`, async () => {
        const synced = await Effect.runPromise(computer.client[WS_METHODS.peerHubSync]({}));
        return (
          synced.workspaces[0]?.projects
            .find((p) => p.project.id === "lab")
            ?.work.tasks.some((one) => one.key === ROOMS_TASK.key) === true
        );
      }),
    );
  branchOff(ana.checkout, ROOMS_TASK.branch);
  const place = { workspace: "acme", project: "lab", task: taskId };
  const roomPath = `/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(taskId)}/room`;
  const room = async () =>
    (await hubCall(`${roomPath}?limit=200`, { session: hubSession }))
      .messages as ReadonlyArray<PeerRoomMessage>;
  const runs = async () =>
    (
      (await hubCall(`/v1/workspaces/acme/runs/lab?task=${encodeURIComponent(taskId)}`, {
        session: hubSession,
      })) as unknown as { runs: ReadonlyArray<RoomsRun> }
    ).runs;
  const live: Array<{ computer: Computer; h: HerdrServer; pane: string; label?: string }> = [];
  const rpc = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
  /** What this arm must show: reported as any observation, and the run fails at its end without them. */
  const missed: string[] = [];
  const must = (ok: unknown, what: string) => {
    observe(ok, what);
    if (!ok) missed.push(what);
  };
  const herdrAgents = (h: HerdrServer) =>
    (herdrJson(h, "agent", "list").result?.agents ?? []) as ReadonlyArray<{
      readonly pane_id: string;
      readonly agent?: string;
      readonly cwd?: string;
    }>;
  /** A folder Claude Code has not seen asks to be trusted first: as a person, the lab says yes. */
  const acceptTrust = (h: HerdrServer) => {
    for (const { pane_id: pane } of herdrAgents(h)) {
      const screen = herdrText(h, "pane", "read", pane, "--source", "visible");
      if (!screen.includes("Yes, I trust this folder")) continue;
      herdrText(
        h,
        "pane",
        "send-keys",
        pane,
        /❯\s*Yes, I trust this folder/.test(screen) ? "enter" : "down",
      );
      say("trust", `answered in ${pane}`);
    }
  };
  const waitOn = async (what: string, ready: () => Promise<boolean>, ms: number) => {
    for (let waited = 0; waited < ms; waited += 3000) {
      if (await ready()) return true;
      await sleep(3000);
      approveAll(live);
      acceptTrust(anaHerdr);
      acceptTrust(bobHerdr);
    }
    say("gave up waiting", what);
    return false;
  };
  const delivery = async (seq: number, email: string) =>
    deliveryOf(
      (await room()).find((one) => one.seq === seq),
      email,
    );
  const shown = async (chars: number) =>
    JSON.stringify(
      (await room()).map((one) => ({
        seq: one.seq,
        by: one.author.email,
        run: one.author.run,
        replyTo: one.replyTo,
        text: one.text.slice(0, chars),
        to: one.to.map((target) => [target.email, target.state, target.run, target.reason]),
      })),
    );
  try {
    // Claude Code keeps a worktree's trust under its repository's root, and asks in a worktree of a repository it has
    // not seen: a prompt typed then is lost. Trust Bob's checkout now, while no prompt depends on it.
    const trusted = NodeFS.realpathSync(bob.checkout);
    const trustPane = yield* Effect.promise(() =>
      startClaude(bobHerdr, bob, "trust", { cwd: trusted }),
    );
    herdrJson(bobHerdr, "agent", "prompt", trustPane, "/exit");
    yield* Effect.promise(() => sleep(4000));
    herdrText(bobHerdr, "pane", "close", trustPane);

    const anaPane = yield* Effect.promise(() => startClaude(anaHerdr, ana, "ana"));
    live.push({ computer: ana, h: anaHerdr, pane: anaPane });
    herdrJson(anaHerdr, "agent", "prompt", anaPane, ROOMS_ANA_TASK);
    say("Ana's agent prompted", ROOMS_ANA_TASK);
    const editedAna = yield* Effect.promise(() =>
      waitOn(
        "Ana's first turn",
        async () =>
          NodeFS.readFileSync(NodePath.join(ana.checkout, "src/pricing.ts"), "utf8").includes(
            "integer cents",
          ) && ["idle", "done"].includes(statusOf(anaHerdr, anaPane)),
        6 * 60_000,
      ),
    );
    observe(editedAna, "Ana's agent made its edit and went idle");
    git(ana.checkout, "add", "src/pricing.ts");
    git(ana.checkout, "commit", "--quiet", "-m", `${ROOMS_TASK.key}: ${ROOMS_TASK.title}`);
    git(ana.checkout, "push", "--quiet", "origin", ROOMS_TASK.branch);
    say("the lab pushed Ana's branch, as she would", ROOMS_TASK.branch);
    yield* Effect.promise(() =>
      until(
        "the Hub has Ana's run",
        async () => (await runs()).some((run) => run.email === "ana@acme.test"),
        60_000,
      ),
    );
    const anaRun = (yield* Effect.promise(runs)).find((run) => run.email === "ana@acme.test")!;

    // Bob's message waits.
    const asked = yield* Effect.promise(() =>
      rpc(
        bob.client[PEER_ROOMS_METHODS.peerRoomsPost]({
          ...place,
          op: "real-ask",
          text: ROOMS_REAL_QUESTION,
          to: [{ kind: "agent", email: "ana@acme.test" }],
        }),
      ),
    );
    const waited = yield* Effect.promise(() => delivery(asked.seq, "ana@acme.test"));
    check(waited?.state === "waiting", "Bob's message waits for Ana");
    yield* Effect.promise(() => sleep(20_000));
    check(
      !NodeFS.readFileSync(ana.log, "utf8").includes("marker-real"),
      "20 s later Ana's coordination log holds none of it",
    );
    check(["idle", "done"].includes(statusOf(anaHerdr, anaPane)), "and her agent stayed idle");

    // Ana passes it on.
    yield* Effect.promise(() =>
      rpc(ana.client[PEER_ROOMS_METHODS.peerRoomsPass]({ ...place, seq: asked.seq })),
    );
    say("Ana passed it on", `#${asked.seq}`);
    const answered = yield* Effect.promise(() =>
      waitOn(
        "Ana's agent's answer",
        async () => (await delivery(asked.seq, "ana@acme.test"))?.state === "answered",
        6 * 60_000,
      ),
    );
    const heard = events(ana).flatMap((entry) =>
      [...(typeof entry.text === "string" ? [entry.text] : []), ...toldTexts([entry])].filter(
        (text) => text.includes("marker-real"),
      ),
    );
    for (const text of heard) told("Ana's agent (from her log)", text);
    must(
      heard.some((text) => wholeFence(text, "marker-real")),
      "her real agent was told it, fenced",
    );
    must(answered, "her agent answered with --reply and the Hub says `answered`");
    say("the room", yield* Effect.promise(() => shown(300)));

    // Her run ends; Bob's own question starts a run on his computer.
    const anaCount = herdrAgents(anaHerdr).length;
    yield* Effect.promise(() =>
      rpc(
        ana.client[WS_METHODS.peerHubEndRun]({
          workspace: "acme",
          projectId: "lab",
          runId: anaRun.id,
        }),
      ),
    );
    yield* Effect.promise(() =>
      until(
        "the Hub has her run ended",
        async () => (await runs()).some((run) => run.id === anaRun.id && run.endedAt !== undefined),
        60_000,
      ),
    );
    say("Ana's run ended", anaRun.id);
    const anaHooksAtEnd = events(ana).filter((entry) => entry.event === "hook").length;
    const own = yield* Effect.promise(() =>
      rpc(
        bob.client[PEER_ROOMS_METHODS.peerRoomsPost]({
          ...place,
          op: "real-own",
          text: ROOMS_REAL_OWN,
          to: [{ kind: "agent", email: "bob@acme.test" }],
        }),
      ),
    );
    const startedBob = yield* Effect.promise(() =>
      waitOn(
        "Peer to start Bob's agent",
        async () => herdrAgents(bobHerdr).some((one) => one.agent === "claude"),
        3 * 60_000,
      ),
    );
    must(startedBob, "Peer started a Claude Code on Bob's computer");
    const bobPane = herdrAgents(bobHerdr).find((one) => one.agent === "claude");
    if (bobPane !== undefined) {
      live.push({ computer: bob, h: bobHerdr, pane: bobPane.pane_id, label: "bob" });
      say("Bob's pane", JSON.stringify(bobPane));
    }
    const answeredOwn = yield* Effect.promise(() =>
      waitOn(
        "Bob's agent's answer",
        async () => (await delivery(own.seq, "bob@acme.test"))?.state === "answered",
        8 * 60_000,
      ),
    );
    must(answeredOwn, "its answer is in the room and the Hub says `answered`");
    const hubRuns = yield* Effect.promise(runs);
    say("the task's runs", JSON.stringify(hubRuns));
    observe(
      hubRuns.filter((run) => run.email === "ana@acme.test").length === 1 &&
        herdrAgents(anaHerdr).length === anaCount,
      "Ana's computer started nothing",
    );
    must(
      events(ana).filter((entry) => entry.event === "hook").length === anaHooksAtEnd,
      "Ana's agent took no step once the lab had ended her run, whenever the run really ended",
    );
    const ended = events(ana).findIndex((entry) => entry.event === "run.ended");
    say(
      "Ana's log after her run ended",
      JSON.stringify(
        events(ana)
          .slice(ended)
          .filter((entry) => entry.event !== "sync")
          .map((entry) => [entry.t, entry.event, entry.hookEvent ?? ""]),
      ),
    );
    say("the room at the end", yield* Effect.promise(() => shown(600)));
    check(missed.length === 0, `the real arm showed all it must (missing: ${missed.join("; ")})`);
  } finally {
    for (const { computer, h, pane, label } of live) {
      console.log(`\n===== ${label ?? computer.name}'s agent, last screen =====`);
      console.log(
        herdrText(h, "pane", "read", pane, "--source", "recent-unwrapped", "--lines", "200"),
      );
    }
    for (const herdr of [anaHerdr, bobHerdr]) herdrText(herdr, "server", "stop");
  }
}).pipe(Effect.scoped);

/**
 * REAL_SCENARIO=rooms (`peer-lab/rooms.ts`): the people act through their own Peers, the lab reads the Hub and the logs.
 */
const roomsProgram = Effect.gen(function* () {
  yield* Effect.promise(() =>
    waitFor("the hub", async () => (await fetch(`${hubUrl}/health`)).ok, hub.output),
  );
  yield* Effect.promise(setUpWorkspace);
  const scope = yield* Effect.scope;
  const anaHerdr = standInHerdr(NodePath.join(lab, "ah.sock"));
  const bobHerdr = standInHerdr(NodePath.join(lab, "bh.sock"));
  const ana = yield* startComputer("Ana", "ana@acme.test", anaHerdr.socketPath);
  const bob = yield* startComputer("Bob", "bob@acme.test", bobHerdr.socketPath);
  const created = yield* Effect.promise(() =>
    hubCall("/v1/workspaces/acme/projects/lab/tasks", {
      method: "POST",
      session: hubSession,
      body: { title: ROOMS_TASK.title, key: ROOMS_TASK.key },
    }),
  );
  const taskId = String(created.id);
  for (const computer of [ana, bob])
    yield* Effect.promise(() =>
      until(`${computer.name}'s Peer knows ${ROOMS_TASK.key}`, async () => {
        const synced = await Effect.runPromise(computer.client[WS_METHODS.peerHubSync]({}));
        return (
          synced.workspaces[0]?.projects
            .find((p) => p.project.id === "lab")
            ?.work.tasks.some((one) => one.key === ROOMS_TASK.key) === true
        );
      }),
    );
  branchOff(ana.checkout, ROOMS_TASK.branch);
  const sessions = new Map<string, string>();
  const sessionOf = async (who: "ana" | "bob") => {
    const known = sessions.get(who);
    if (known !== undefined) return known;
    const email = `${who}@acme.test`;
    const started = await hubCall("/v1/auth/email/start", { method: "POST", body: { email } });
    const finished = await hubCall("/v1/auth/email/verify", {
      method: "POST",
      body: { email, code: started.code },
    });
    sessions.set(who, finished.session as string);
    return finished.session as string;
  };
  const place = { workspace: "acme", project: "lab", task: taskId };
  const person = (
    computer: Computer,
    email: string,
    herdr: ReturnType<typeof standInHerdr>,
  ): RoomsPerson => {
    const { starts } = herdr;
    const rpc = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
    return {
      email,
      starts,
      post: (op, text, to) =>
        rpc(
          computer.client[PEER_ROOMS_METHODS.peerRoomsPost]({
            ...place,
            op,
            text,
            to: to.map((target) => ({ kind: "agent" as const, email: target })),
          }),
        ),
      pass: (seq) => rpc(computer.client[PEER_ROOMS_METHODS.peerRoomsPass]({ ...place, seq })),
      decline: (seq, reason) =>
        rpc(computer.client[PEER_ROOMS_METHODS.peerRoomsDecline]({ ...place, seq, reason })),
      withdraw: (seq) =>
        rpc(computer.client[PEER_ROOMS_METHODS.peerRoomsWithdraw]({ ...place, seq })),
      endRun: (runId) =>
        rpc(
          computer.client[WS_METHODS.peerHubEndRun]({ workspace: "acme", projectId: "lab", runId }),
        ),
      rooms: async () => (await cachedStatus(computer)).rooms,
      read: async () =>
        (await rpc(computer.client[PEER_ROOMS_METHODS.peerRoomsRead]({ ...place, limit: 50 })))
          .messages,
      log: () => (NodeFS.existsSync(computer.log) ? NodeFS.readFileSync(computer.log, "utf8") : ""),
      losePrompts: (lose) => {
        herdr.control.losePrompts = lose;
      },
    };
  };
  const roomPath = `/v1/workspaces/acme/projects/lab/tasks/${encodeURIComponent(taskId)}/room`;
  const hubAs = async (who: "ana" | "bob", method: string, path: string, body?: unknown) => {
    const response = await fetch(`${hubUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await sessionOf(who)}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  };
  const kit: RoomsKit = {
    ana: person(ana, "ana@acme.test", anaHerdr),
    bob: person(bob, "bob@acme.test", bobHerdr),
    anaAgent: agent(ana, "room-ana", "w30:p1") as RoomsAgent,
    agentOf: (start, session = "room-bob") =>
      agent(
        bob,
        session,
        start.pane,
        Object.fromEntries(Object.entries(start.env)),
        start.cwd,
      ) as RoomsAgent,
    room: async () => (await hubAs("bob", "GET", `${roomPath}?limit=200`)).body.messages,
    runs: async () =>
      (await hubAs("bob", "GET", `/v1/workspaces/acme/runs/lab?task=${encodeURIComponent(taskId)}`))
        .body.runs ?? [],
    hub: hubAs,
    roomPath,
    restartBob: (during) =>
      Effect.runPromise(
        restartComputer(bob, during).pipe(Effect.provideService(Scope.Scope, scope)),
      ),
    say,
    told,
    until,
    sleep,
  };
  try {
    const failed = yield* Effect.promise(() => runRooms(kit));
    yield* Effect.promise(() => sleep(1500));
    say("rooms result", failed.length === 0 ? "every check held" : `${failed.length} failed`);
    for (const what of failed) say("failed", what);
    check(failed.length === 0, "every check of the rooms scenario held");
  } finally {
    anaHerdr.close();
    bobHerdr.close();
  }
}).pipe(Effect.scoped);

/** The change ids a `jj log` of `divergent()` printed, one to a line. */
const parseDivergent = (output: string) => output.split("\n").filter((line) => line.trim() !== "");

try {
  await Effect.runPromise(
    MEMORY
      ? memoryProgram
      : READY
        ? readyProgram
        : CONTRACT
          ? contractProgram
          : FOLLOW
            ? followProgram
            : ROOMS
              ? SHARED
                ? sharedRoomProgram
                : RETRY
                  ? roomsRetryProgram
                  : REAL
                    ? roomsRealProgram
                    : roomsProgram
              : program,
  );
  say("PASS");
  process.exitCode = 0;
} catch (error) {
  say("FAIL", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // The computers first: as their Peers stop, their brokers tell the hub their agents are gone,
  // which needs the hub still up. Then the hub.
  const running = (child: NodeChildProcess.ChildProcess) =>
    child.exitCode === null && child.signalCode === null;
  const peers = children.filter((child) => child !== hub.child && running(child));
  const stop = async (child: NodeChildProcess.ChildProcess) => {
    if (!running(child)) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(5000)]);
    if (running(child)) child.kill("SIGKILL");
    await exited;
  };
  await Promise.all(peers.map(stop));
  await stop(hub.child);
  if (process.env.KEEP_LAB === "1") say("kept", lab);
  else NodeFS.rmSync(lab, { recursive: true, force: true });
  // Whatever a failed step left open (a proxy in front of the hub, a socket) must not keep the lab's own
  // process alive: it ends a few seconds after its cleanup, unless it has already.
  setTimeout(() => process.exit(process.exitCode ?? 1), 5000).unref();
}
