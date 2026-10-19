// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a broker in a temporary checkout with its `.ai`, a project checkout kontext keeps knowledge in.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  KnowledgeRpcGroup,
  PeerKeptAs,
  type PeerHubStatus,
  type PeerKnowledgeCandidate,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as RpcTest from "effect/rpc/RpcTest";

import { CoordinationBroker } from "../../core/broker/Broker.ts";
import type { PeerBrokerHost } from "../../core/broker/host.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import type { HubCoordSession, HubCoordView } from "../../core/hub/coordApi.ts";
import * as PeerIndex from "../../core/index/PeerIndex.ts";
import type { PeerHookText, PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  type HubAnswer,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { KontextClient, type KontextClientShape } from "./client/kontext.ts";
import { KnowledgePlugin } from "./index.ts";
import type { KontextEntry } from "../../kontext.ts";

const AS_ONE = { "x-peer-session": "claude:one" };
const GOVERNS = "has an entry that governs what you change";
const GUIDANCE =
  "This project's local guidance on what to mark [project]:\nMark how prices round; leave UI copy unmarked.";

const coordination: PeerHubStatus["coordination"] = {
  enabled: true,
  policy: "notify",
  claudeHooks: true,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

type EngineCall = { readonly operation: string; readonly input: Record<string, unknown> };
const machineResult = (result: unknown) => ({
  code: 0,
  stdout: JSON.stringify({ schema_version: 1, ok: true, result }),
  stderr: "",
});

const bookEntries: ReadonlyArray<KontextEntry> = [
  {
    id: "rounding",
    kind: "decision",
    title: "Round each line before the total",
    status: "accepted",
    date: "2026-10-05",
    summary: "Totals are sums of rounded lines.",
    tags: [],
    paths: ["src/pricing/total.ts"],
    file: ".ai/decisions/rounding.md",
    body: "Round per line.",
    markdown: "# Rounding\n",
  },
  {
    id: "marks",
    kind: "convention",
    title: "What to mark for the project",
    status: null,
    date: "2026-10-04",
    summary: "Mark how prices round; leave UI copy unmarked.",
    tags: ["peer-skill"],
    paths: [],
    file: ".ai/conventions/marks.md",
    body: "Mark how prices round; leave UI copy unmarked.",
    markdown: "# Guidance\n",
  },
  {
    id: "prices",
    kind: "decision",
    title: "Keep prices in cents",
    status: null,
    date: null,
    summary: "Prices are integers.",
    tags: [],
    paths: [],
    file: ".ai/decisions/prices.md",
    body: "Prices are integers.",
    markdown: "# Prices\n",
  },
];

/** The engine supplies already-parsed entries; broker tests exercise delivery, not a second parser. */
const fixtureKontext = (projectEntries: ReadonlyArray<KontextEntry> = bookEntries) => {
  const asked: EngineCall[] = [];
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      asked.push({ operation, input });
      if (operation === "entries.list") {
        const kinds = input.kinds as string[] | undefined;
        const tags = input.tags as string[] | undefined;
        const entries = projectEntries.filter(
          (entry) =>
            (kinds === undefined || kinds.includes(entry.kind)) &&
            (tags === undefined || tags.some((tag) => entry.tags.includes(tag))),
        );
        return machineResult({
          entries,
          total: entries.length,
          next_offset: null,
          snapshot: "fixture-book",
        });
      }
      if (operation === "entries.get") {
        const entry = projectEntries.find((entry) => entry.id === input.id);
        return entry === undefined
          ? {
              code: 1,
              stdout: JSON.stringify({
                schema_version: 1,
                ok: false,
                error: { code: "not_found", message: "No such entry" },
              }),
              stderr: "",
            }
          : machineResult({ entry });
      }
      if (operation === "entries.search") {
        const entries = projectEntries.filter((entry) =>
          `${entry.title} ${entry.body}`.toLowerCase().includes(String(input.query).toLowerCase()),
        );
        return machineResult({ entries, total: entries.length });
      }
      if (operation === "entries.governing") {
        const paths = input.paths as string[];
        const excluded = (input.exclude_ids ?? []) as string[];
        const entry = projectEntries[0]!;
        return machineResult({
          matches:
            paths.includes("src/pricing/total.ts") && !excluded.includes(entry.id)
              ? [
                  {
                    entry,
                    pattern: "src/pricing/total.ts",
                    path: "src/pricing/total.ts",
                    specificity: 3,
                  },
                ]
              : [],
          snapshot: "fixture-book",
        });
      }
      if (operation === "status")
        return machineResult({
          api_version: 1,
          version: "1",
          store: { configured: true, dir: ".ai" },
          capabilities: [
            "entries.list",
            "entries.get",
            "entries.search",
            "entries.governing",
            "drafts.stage",
          ],
          llm: { available: false },
        });
      throw new Error(`Unexpected engine operation: ${operation}`);
    },
  };
  return { asked, client };
};

/** acme's app project, where Vir's agent works on KRK-2 on another computer. */
const virOnSpeakers = (candidates?: HubCoordView["candidates"]): Partial<PeerBrokerHost> => {
  const at = new Date().toISOString();
  const vir: HubCoordSession = {
    id: "claude:vir",
    project: "app",
    email: "vir@acme.test",
    environment: "vir-laptop",
    label: "Speakers can be named",
    agent: "claude",
    task: "task-2",
    status: "working",
    files: [],
    claims: [],
    seenAt: at,
  };
  const view: HubCoordView = {
    sessions: [vir],
    overlaps: [],
    at,
    ...(candidates === undefined ? {} : { candidates }),
  };
  return {
    tasks: () => [{ id: "task-2", key: "KRK-2", title: "Speakers", status: "open" }],
    taskName: (_workspace, _project, task) => (task === "task-2" ? "KRK-2 · Speakers" : task),
    report: async () => view,
    view: async () => view,
  };
};

/**
 * Ana's Peer with the knowledge plugin, and a broker in acme's app checkout (its `.ai` holds two
 * decisions and the project's guidance) over `host`'s hub, as coordination hands it to core.
 */
const anaWithKnowledge = (
  host: Partial<PeerBrokerHost> = virOnSpeakers(),
  wrapEngine: (client: KontextClientShape) => KontextClientShape = (client) => client,
  /** A Hub Ana is signed in to, and the entries kontext reads (a test may change them). */
  options: { readonly hubUrl?: string; readonly entries?: ReadonlyArray<KontextEntry> } = {},
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      options.hubUrl === undefined
        ? coreLayer(yield* seedState(), { plugins: [KnowledgePlugin] })
        : coreLayer(yield* seedState(signedInSeed(options.hubUrl)), {
            session: "phs_test",
            plugins: [KnowledgePlugin],
          }),
    );
    return yield* Effect.gen(function* () {
      const kontext = fixtureKontext(options.entries);
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins.pipe(
        Effect.provideService(KontextClient, wrapEngine(kontext.client)),
      );
      const plugins = yield* PeerPlugins.PeerPlugins;
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => brokerFixture(() => ({ ...host, ...pluginsOf(plugins) }))),
        (made) => Effect.promise(() => made.dispose()),
      );
      const agents = yield* PeerAgents.PeerAgents;
      const index = yield* PeerIndex.PeerIndex;
      yield* agents.attach(fixture.broker);
      yield* index.attach(fixture.broker);
      /** What a hook of Ana's agent `one` (or of `session`) tells it. */
      const told = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
        Effect.promise(async () => {
          const answer = await fixture.broker["hook"](
            { session_id: "one", cwd: fixture.root, ...body },
            headers,
          );
          const output = answer?.hookSpecificOutput as
            | { readonly additionalContext?: unknown }
            | undefined;
          return typeof output?.additionalContext === "string" ? output.additionalContext : "";
        });
      const edit = (file: string) => ({
        tool_name: "Edit",
        tool_input: {
          file_path: NodePath.join(fixture.root, file),
          old_string: "a",
          new_string: "b",
        },
      });
      const run = (command: string, args: ReadonlyArray<string> = []) =>
        Effect.promise(() => fixture.broker["runCli"](command, args, AS_ONE));
      const client = yield* PeerHubClient.PeerHubClient;
      /** The findings Ana's agent `one` heard, as its next report gives the Hub. */
      const heard = () => [...(fixture.broker.sessions.get("claude:one")?.heard ?? [])];
      return { fixture, plugins, status, agents, index, kontext, told, edit, run, client, heard };
    }).pipe(Effect.provide(core));
  });

describe("knowledge for agents", () => {
  it.effect("starts an agent with the `.ai` in its index, then the project's guidance", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
      assert.include(start, "`peer knowledge <id or words>` reads project decisions");
      assert.include(start, "Other work on this project now");
      assert.include(
        start,
        "Project knowledge, kept by its people (3 entries; `peer knowledge <words>` reads or searches them):",
      );
      assert.include(
        start,
        "- decision: Round each line before the total · governs src/pricing/total.ts",
      );
      // The guidance is the plugin's block: after Peer's own start text, its index included.
      assert.isTrue(start.endsWith(`\n\n${GUIDANCE}`));
      assert.isBelow(start.indexOf("Project knowledge"), start.indexOf(GUIDANCE));
      assert.isTrue(ana.kontext.asked.some((call) => call.operation === "entries.list"));
      assert.isTrue(ana.kontext.asked.every((call) => call.operation.startsWith("entries.")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells Codex's and Claude Code's agents, once, of an entry that governs a file", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      // A Codex session hears it from its hooks, before it changes the file.
      const codex = yield* ana.told(
        { session_id: "two", hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") },
        { "x-peer-agent": "codex" },
      );
      assert.include(codex, GOVERNS);
      assert.include(codex, "Read it: peer knowledge rounding");
      const before = yield* ana.told({
        hook_event_name: "PreToolUse",
        ...ana.edit("src/pricing/total.ts"),
      });
      assert.include(
        before,
        "It governs `src/pricing/total.ts`, and you change `src/pricing/total.ts`. Read it: peer knowledge rounding",
      );
      // Said once: not again when the edit is done, nor at the next step.
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PostToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
      assert.notInclude(
        yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Go on." }),
        GOVERNS,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "does not tell an agent again, after Peer restarts, of an entry it heard governs a file",
    () =>
      Effect.gen(function* () {
        const ana = yield* anaWithKnowledge();
        const edit = { hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") };
        assert.include(yield* ana.told(edit), GOVERNS);
        // Peer quits for an update and starts again on the same computer.
        yield* Effect.promise(() => ana.fixture.broker.stop());
        const again = new CoordinationBroker(ana.fixture.broker.host);
        yield* ana.agents.attach(again);
        yield* ana.index.attach(again);
        const answer = yield* Effect.promise(() =>
          again.hook({ session_id: "one", cwd: ana.fixture.root, ...edit }, {}),
        );
        const said = (
          answer?.hookSpecificOutput as { readonly additionalContext?: unknown } | undefined
        )?.additionalContext;
        assert.notInclude(typeof said === "string" ? said : "", GOVERNS);
        yield* Effect.promise(() => again.stop());
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("delivers a slow governing query on the next step without starting it again", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let queries = 0;
      const ana = yield* anaWithKnowledge(virOnSpeakers(), (client) => ({
        run: async (args, cwd, stdin, timeout) => {
          if (args[3] === "entries.governing") {
            queries += 1;
            started.resolve();
            await release.promise;
          }
          return client.run(args, cwd, stdin, timeout);
        },
      }));
      yield* Effect.promise(() => ana.fixture.register("one"));
      const [session] = yield* ana.agents.sessions;
      assert.isDefined(session);
      yield* ana.index.entries(session!);
      const active = yield* ana.plugins.active;
      const notice = active.find((plugin) => plugin.id === "knowledge")?.contributions.hooks
        ?.notices?.[0];
      assert.isDefined(notice);
      const context = {
        session: session!,
        event: "pre-tool" as const,
        remainingMs: 1000,
        tool: "Edit",
        paths: ["src/pricing/total.ts"],
      };
      const first = yield* notice!.read(context).pipe(Effect.forkScoped);
      yield* Effect.promise(() => started.promise);
      yield* TestClock.adjust("401 millis");
      assert.isNull(yield* Fiber.join(first));
      assert.strictEqual(queries, 1);
      release.resolve();
      const later = yield* notice!.read(context);
      assert.include(typeof later === "string" ? later : (later?.text ?? ""), GOVERNS);
      assert.strictEqual(queries, 1);
      assert.isNull(yield* notice!.read(context));
      assert.strictEqual(queries, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("hears of what a shell command changed when it is done", () =>
    Effect.gen(function* () {
      const shell = { ran: false };
      const ana = yield* anaWithKnowledge({
        ...virOnSpeakers(),
        // git sees nothing changed when the session starts, and the total changed after the command.
        gitStatus: async () => (shell.ran ? " M src/pricing/total.ts\0" : ""),
      });
      yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Round the total." });
      shell.ran = true;
      const after = yield* ana.told({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "sed -i '' s/a/b/ src/pricing/total.ts" },
      });
      assert.include(after, GOVERNS);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads, lists and searches the entries with peer knowledge, and lists it in help", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      assert.include(
        yield* ana.run("help"),
        "  peer knowledge [<id or words>]  the project's decisions, conventions, learnings and incidents: list, search or read one",
      );
      const one = yield* ana.run("knowledge", ["rounding"]);
      assert.include(one, "decision (accepted, 2026-10-05) · Round each line before the total");
      assert.include(one, "check your change against it");
      assert.include(yield* ana.run("knowledge"), "Project knowledge, kept by its people");
      assert.include(yield* ana.run("knowledge", ["cents"]), "Keep prices in cents");
      // Read, it is not said again when the agent changes what it governs.
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("gives peer index and peer find the project's work and its `.ai`", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      const listed = yield* ana.run("index");
      assert.include(listed, "Other work on this project now:");
      assert.include(listed, "`peer knowledge <id>` reads a decision of the project");
      assert.include(listed, "Project knowledge, kept by its people (3 entries;");
      assert.include(listed, "· rounding");
      const [session] = yield* ana.agents.sessions;
      assert.deepStrictEqual(
        (yield* ana.index.entries(session!)).map((entry) => entry.id),
        ["rounding", "marks", "prices"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("knowledge turned off", () => {
  it.effect("starts an agent with its work and shared context, but no `.ai` and no guidance", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
      assert.include(start, "Other work on this project now");
      assert.include(start, "Peer keeps your private working context in");
      assert.notInclude(start, "Project knowledge");
      assert.notInclude(start, "guidance on what to mark");
      assert.notInclude(start, "peer knowledge");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says nothing of an entry that governs a file the agent changes", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
      assert.notInclude(
        yield* ana.told({ hook_event_name: "PostToolUse", ...ana.edit("src/pricing/total.ts") }),
        GOVERNS,
      );
      // On again, the entry is said at the next step.
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: true });
      assert.include(
        yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Go on." }),
        GOVERNS,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses peer knowledge in one line, and leaves it out of help and status", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      yield* Effect.promise(() =>
        expect(
          ana.fixture.broker["runCli"]("knowledge", ["rounding"], AS_ONE),
        ).rejects.toMatchObject({
          status: 409,
          message: "knowledge is turned off on this environment.",
        }),
      );
      assert.notInclude(yield* ana.run("help"), "peer knowledge");
      const status = yield* ana.run("status");
      assert.include(status, "Commands: peer index · peer context [<task>] · peer note");
      assert.notInclude(status, "peer knowledge");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("lists only the work in peer index, and gives peer find no entries", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      yield* Effect.promise(() => ana.fixture.register("one"));
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      const listed = yield* ana.run("index");
      assert.include(listed, "Other work on this project now:");
      assert.include(listed, "KRK-2 · Speakers");
      assert.notInclude(listed, "Project knowledge");
      assert.notInclude(listed, "peer knowledge");
      const [session] = yield* ana.agents.sessions;
      assert.deepStrictEqual(yield* ana.index.entries(session!), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("knowledge candidates in the status", () => {
  it.effect("counts the candidates waiting per project while on, and none while off", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge(virOnSpeakers([{ project: "app", proposed: 2 }]));
      yield* Effect.promise(() => ana.fixture.broker["syncNow"]("acme", 3000));
      const waiting = (status: PeerHubStatus) => status.coordination.candidates;
      assert.deepStrictEqual(waiting(yield* ana.status.publish), [
        { workspace: "acme", project: "app", proposed: 2 },
      ]);
      yield* ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      assert.deepStrictEqual(waiting(yield* ana.status.publish), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** A candidate of acme's Payments project that came already worded, from a task's context. */
const CANDIDATE: PeerKnowledgeCandidate = {
  id: "c1",
  project: "pay",
  text: "Prices are integers of cents",
  sources: [
    {
      finding: "f1",
      email: "vir@acme.test",
      session: "claude:vir",
      task: "krk-1",
      text: "Prices are integers of cents",
      tagged: true,
      independent: true,
      at: "2026-10-08T10:00:00Z",
      origin: "context:task:krk-1@v3",
    },
  ],
  finders: 1,
  status: "proposed",
  firstAt: "2026-10-08T10:00:00Z",
  lastAt: "2026-10-08T10:00:00Z",
  kind: "decision",
  detail: "Floats lose cents; every amount is an integer.",
};

/** A Hub that has the candidate above, and takes what people decide on it. */
const candidateHub: HubAnswer = (url) =>
  url === "/v1/workspaces/acme/candidates/pay"
    ? [200, [CANDIDATE, { ...CANDIDATE, id: "c2" }]]
    : ["/v1/workspaces/acme/candidates/pay/c1", "/v1/workspaces/acme/candidates/pay/c2"].includes(
          url,
        )
      ? [200, { ...CANDIDATE, id: url.endsWith("/c2") ? "c2" : "c1", status: "promoted" }]
      : [404, { error: { code: "not_found", message: "Not here." } }];

/** A compatible engine returns its staged entry; the Hub remains Peer's responsibility. */
const workingKontext = (_checkout: string) => {
  const asked: EngineCall[] = [];
  const receipts = new Map<string, { readonly fingerprint: unknown; readonly result: unknown }>();
  const failure = (code: string, message: string) => ({
    code: 1,
    stdout: JSON.stringify({ schema_version: 1, ok: false, error: { code, message } }),
    stderr: "",
  });
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      asked.push({ operation, input });
      if (operation === "status")
        return machineResult({
          api_version: 1,
          version: "1",
          store: { configured: true, dir: ".ai" },
          capabilities: ["entries.list", "entries.search", "drafts.stage", "drafts.formalize"],
          llm: { available: false },
        });
      if (operation === "entries.list" || operation === "entries.search")
        return machineResult({ entries: [], total: 0, next_offset: null });
      if (operation === "operations.get") {
        const previous = receipts.get(String(input.operation_id));
        if (previous === undefined) return failure("not_found", "No local receipt");
        if (previous.fingerprint !== input.fingerprint)
          return failure(
            "operation_conflict",
            "This candidate was already kept with different text",
          );
        return machineResult(previous.result);
      }
      if (operation === "drafts.stage") {
        const entry = input.entry as {
          readonly kind: string;
          readonly title: string;
          readonly body: string;
        };
        const result = {
          entry: {
            ...entry,
            id: "cents",
            file: ".ai/decisions/cents.md",
            markdown: "# Kept finding\n",
          },
          path: ".ai/decisions/cents.md",
          staged: true,
          replayed: false,
          notes: [],
          related: [],
        };
        receipts.set(String(input.operation_id), { fingerprint: input.fingerprint, result });
        return machineResult(result);
      }
      throw new Error(`Unexpected engine operation: ${operation}`);
    },
  };
  return { asked, client };
};

/** Ana signed in to `hubUrl`, in acme's Payments project, whose `api` checkout is `checkout`. */
const paymentsAt = (hubUrl: string, checkout: string) =>
  JSON.stringify({
    hubUrl,
    email: "ana@acme.test",
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        manifest: {
          version: 2,
          workspace: { slug: "acme", name: "Acme", currency: "EUR" },
          member: { email: "ana@acme.test", name: "Ana", role: "member" },
          knowledge: {},
          projects: [
            {
              id: "pay",
              name: "Payments",
              role: "lead",
              members: [],
              repositories: [{ id: "api", url: "https://github.com/acme/api.git", branch: "main" }],
              knowledge: { kontext: true, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
          ],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
    localCheckouts: { "acme/pay/api": checkout },
  });

describe("keeping knowledge", () => {
  it.effect(
    "writes a kept candidate with kontext, staged, tells the Hub, and is refused while off",
    () =>
      Effect.gen(function* () {
        const checkout = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
          prefix: "peer-kontext-",
        });
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.join(checkout, ".git"));
          await NodeFSP.mkdir(NodePath.join(checkout, ".ai"));
          await NodeFSP.writeFile(NodePath.join(checkout, ".ai", "kontext.toml"), "");
        });
        const hub = yield* standInHub({ current: candidateHub });
        const kontext = workingKontext(checkout);
        const core = yield* Layer.build(
          coreLayer(yield* seedState(paymentsAt(hub.url, checkout)), {
            session: "phs_test",
            plugins: [KnowledgePlugin],
          }),
        );
        const plugins = yield* Effect.gen(function* () {
          yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() =>
            Effect.succeed(coordination),
          );
          yield* PeerPlugins.startPlugins.pipe(
            Effect.provideService(KontextClient, kontext.client),
          );
          return yield* PeerPlugins.PeerPlugins;
        }).pipe(Effect.provide(core));
        const wrap: PeerRpcWrap = {
          effect: (_method, effect) => effect,
          stream: (_method, stream) => stream,
        };
        const client = yield* RpcTest.makeClient(KnowledgeRpcGroup).pipe(
          Effect.provide(
            PeerHub.rpcLayer(wrap).pipe(
              Layer.provide(
                Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
              ),
            ),
          ),
        );
        const keep = client["peerHub.keepCandidate"]({
          workspace: "acme",
          project: "pay",
          id: "c1",
        });

        assert.deepStrictEqual(yield* keep, {
          checkout,
          keptAs: {
            path: ".ai/decisions/cents.md",
            title: "Prices are integers of cents",
            kind: "decision",
          },
          related: null,
          asWritten: null,
        });
        const firstStage = kontext.asked.find((call) => call.operation === "drafts.stage");
        assert.isDefined(firstStage);
        // What it stands on goes with it: its tasks and where it was read, never an address.
        assert.deepStrictEqual(firstStage?.input.entry, {
          kind: "decision",
          title: "Prices are integers of cents",
          body: "Floats lose cents; every amount is an integer.",
          paths: [],
          extra: { external_refs: ["task:krk-1", "context:task:krk-1@v3"], finders: 1 },
        });
        assert.notInclude(JSON.stringify(firstStage?.input), "vir@acme.test");
        assert.notInclude(JSON.stringify(firstStage?.input), "claude:vir");
        assert.isString(firstStage?.input.operation_id);
        assert.isTrue(
          kontext.asked.some(
            (call) =>
              call.operation === "entries.search" &&
              call.input.query === "Prices are integers of cents",
          ),
        );
        assert.isTrue(
          kontext.asked.every(
            (call) => !["capture", "promote", "distill", "search"].includes(call.operation),
          ),
        );
        const decided = hub.calls.find((call) => call.method === "POST");
        assert.strictEqual(decided?.url, "/v1/workspaces/acme/candidates/pay/c1");
        const decision = Schema.fromJsonString(
          Schema.Struct({ status: Schema.String, keptAs: PeerKeptAs }),
        );
        assert.deepStrictEqual(yield* Schema.decodeUnknownEffect(decision)(decided?.body), {
          status: "promoted",
          keptAs: {
            path: ".ai/decisions/cents.md",
            title: "Prices are integers of cents",
            kind: "decision",
          },
        });

        // A changed retry of the same candidate must not create a second knowledge entry.
        const stageCount = kontext.asked.filter((call) => call.operation === "drafts.stage").length;
        const changedRetry = yield* client["peerHub.keepCandidate"]({
          workspace: "acme",
          project: "pay",
          id: "c1",
          text: "Different text after this candidate was kept.",
        }).pipe(Effect.result);
        assert.isTrue(Result.isFailure(changedRetry));
        assert.strictEqual(
          kontext.asked.filter((call) => call.operation === "drafts.stage").length,
          stageCount,
        );

        // The person's edited text for a fresh candidate is kept as they wrote it.
        yield* client["peerHub.keepCandidate"]({
          workspace: "acme",
          project: "pay",
          id: "c2",
          text: "Prices are integer cents, never floats.",
        });
        const stages = kontext.asked.filter((call) => call.operation === "drafts.stage");
        assert.deepStrictEqual(stages.at(-1)?.input.entry, {
          kind: "decision",
          title: "Prices are integer cents, never floats.",
          body: "Floats lose cents; every amount is an integer.",
          paths: [],
          extra: { external_refs: ["task:krk-1", "context:task:krk-1@v3"], finders: 1 },
        });
        assert.notStrictEqual(firstStage?.input.operation_id, stages.at(-1)?.input.operation_id);
        assert.isTrue(
          kontext.asked.some(
            (call) =>
              call.operation === "entries.search" &&
              call.input.query === "Prices are integer cents, never floats.",
          ),
        );

        // While off, keeping is refused before kontext or the Hub hear of it.
        yield* plugins.setPlugin({ id: "knowledge", enabled: false });
        const asked = kontext.asked.length;
        const calls = hub.calls.length;
        const refused = yield* keep.pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused)) {
          assert.strictEqual(
            refused.failure.message,
            "Knowledge is turned off on this environment.",
          );
        }
        assert.strictEqual(kontext.asked.length, asked);
        assert.strictEqual(hub.calls.length, calls);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

/** A challenge of `rounding` on acme's app project: two agents on their own, and Vir seconded it. */
const ROUNDING_CHALLENGE = {
  id: "ch1",
  project: "app",
  entry: "rounding",
  reason: "Totals round once now",
  sources: [
    {
      finding: "f-krk-7",
      email: "vir@acme.test",
      session: "claude:vir",
      task: "task-2",
      text: "Totals round once now",
      tagged: false,
      independent: true,
      at: "2026-10-18T10:00:00Z",
    },
    {
      finding: "f-krk-9",
      email: "eva@acme.test",
      session: "codex:eva",
      task: "task-9",
      text: "roundLine was removed in KRK-9",
      tagged: false,
      independent: true,
      at: "2026-10-18T11:00:00Z",
    },
  ],
  finders: 2,
  people: ["vir@acme.test"],
  status: "open",
  firstAt: "2026-10-18T10:00:00Z",
  lastAt: "2026-10-18T11:00:00Z",
};

/** A Hub that serves knowledge at `revision`, with the project's challenges as `challenges` says. */
const challengeHub = (revision: number, challenges: { current: ReadonlyArray<unknown> }) => ({
  current: ((url) =>
    url === "/v1/me"
      ? [200, meAnswer({ knowledge: revision })]
      : url === "/v1/workspaces/acme/challenges/app"
        ? [200, challenges.current]
        : [404, { error: { code: "not_found", message: "no such route" } }]) as HubAnswer,
});

describe("knowledge challenges for agents", () => {
  it.effect(
    "tells a disputed entry once with who disputes it, fences its reasons, and marks its sources heard",
    () =>
      Effect.gen(function* () {
        const hub = yield* standInHub(challengeHub(2, { current: [ROUNDING_CHALLENGE] }));
        const ana = yield* anaWithKnowledge(virOnSpeakers(), undefined, { hubUrl: hub.url });
        yield* ana.client.me;
        const edit = { hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") };
        const said = yield* ana.told(edit);
        assert.include(said, GOVERNS);
        assert.include(
          said,
          "Disputed: 2 agents on other work and 1 person said it may no longer hold (peer knowledge rounding shows why).",
        );
        assert.include(said, "write `- [against rounding] why` under For the team");
        // Told agents are no independent challengers: what it says next is weighed as an echo.
        assert.includeMembers(ana.heard(), ["f-krk-7", "f-krk-9"]);
        assert.notInclude(yield* ana.told(edit), GOVERNS);

        const read = yield* ana.run("knowledge", ["rounding"]);
        assert.include(read, "<shared-context>");
        assert.include(read, "an agent on task-9");
        assert.include(read, "roundLine was removed in KRK-9");
        assert.include(read, "write `- [against rounding] why` under For the team");
        // The core tool calls are never blocked or changed by a challenge.
        assert.notInclude(said, "deny");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells an entry again when another agent joins its challenge", () =>
    Effect.gen(function* () {
      const challenges = { current: [{ ...ROUNDING_CHALLENGE, finders: 1 }] as unknown[] };
      const hub = yield* standInHub(challengeHub(2, challenges));
      const ana = yield* anaWithKnowledge(virOnSpeakers(), undefined, { hubUrl: hub.url });
      yield* ana.client.me;
      const edit = { hook_event_name: "PreToolUse", ...ana.edit("src/pricing/total.ts") };
      assert.include(yield* ana.told(edit), "Disputed: 1 agent on other work");
      challenges.current = [ROUNDING_CHALLENGE];
      const listener = (yield* ana.plugins.active).find((plugin) => plugin.id === "knowledge")
        ?.contributions.hubChanges;
      yield* listener!.onPing({ workspace: "acme", name: "coord" } as never);
      // The read the ping started is in flight: the next step waits for it a moment.
      assert.include(yield* ana.told(edit), "Disputed: 2 agents on other work");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("asks a Hub that serves knowledge at revision 1 nothing of challenges", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub(challengeHub(1, { current: [ROUNDING_CHALLENGE] }));
      const ana = yield* anaWithKnowledge(virOnSpeakers(), undefined, { hubUrl: hub.url });
      yield* ana.client.me;
      const said = yield* ana.told({
        hook_event_name: "PreToolUse",
        ...ana.edit("src/pricing/total.ts"),
      });
      assert.include(said, "say so to your person");
      assert.notInclude(said, "Disputed");
      assert.notInclude(said, "[against");
      assert.isFalse(hub.calls.some((call) => call.url?.includes("/challenges/")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("knowledge told by version", () => {
  it.effect(
    "tells an entry again once it changed, and after a compaction only what governs the files in work",
    () =>
      Effect.gen(function* () {
        const entries = [...bookEntries];
        const hub = yield* standInHub(challengeHub(2, { current: [ROUNDING_CHALLENGE] }));
        const ana = yield* anaWithKnowledge(virOnSpeakers(), undefined, {
          hubUrl: hub.url,
          entries,
        });
        yield* ana.client.me;
        yield* Effect.promise(() => ana.fixture.register("one"));
        const [session] = yield* ana.agents.sessions;
        assert.isDefined(session);
        const hooks = (yield* ana.plugins.active).find((plugin) => plugin.id === "knowledge")
          ?.contributions.hooks;
        const textOf = (said: PeerHookText | null) =>
          typeof said === "string" ? said : (said?.text ?? "");
        const step = Effect.map(
          hooks!.notices![0]!.read({
            session: session!,
            event: "pre-tool",
            remainingMs: 1000,
            tool: "Edit",
            paths: ["src/pricing/total.ts"],
          }),
          textOf,
        );
        assert.include(yield* step, GOVERNS);
        assert.strictEqual(yield* step, "");

        // Someone replaced the entry's text in the book: a new version is news.
        entries[0] = { ...entries[0]!, markdown: "# Rounding, once per total\n" };
        yield* TestClock.adjust("61 seconds");
        assert.include(yield* step, "It changed since you were told of it.");
        assert.strictEqual(yield* step, "");
        const heard = ana.heard();
        assert.includeMembers(heard, ["f-krk-7", "f-krk-9"]);

        // A compacted conversation hears again what governs the files it works on; what it
        // heard of other agents' findings stays heard.
        const start = textOf(
          (yield* hooks!.sessionStart!({
            session: session!,
            event: "session-start",
            source: "compact",
            remainingMs: 1000,
          })) ?? null,
        );
        assert.include(start, GOVERNS);
        assert.include(start, "Read it: peer knowledge rounding");
        assert.notInclude(start, "Read it: peer knowledge prices");
        assert.includeMembers(ana.heard(), heard);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("passes kontext's brief what Peer's own start leaves of one budget", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge();
      const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
      const budget = /pass budget_tokens: (\d+); Peer gave you about (\d+) tokens/.exec(start);
      assert.isNotNull(budget);
      assert.strictEqual(Number(budget![1]) + Number(budget![2]), 1500);
      // A step that changes nothing adds no knowledge.
      assert.notInclude(
        yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Go on." }),
        "Project knowledge",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
