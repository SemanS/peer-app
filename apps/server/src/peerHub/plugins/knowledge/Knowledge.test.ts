// @effect-diagnostics nodeBuiltinImport:off globalDate:off - a broker in a temporary checkout with its `.ai`, a project checkout kontext keeps knowledge in.
import * as NodeChildProcess from "node:child_process";
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
      if (operation === "drafts.capture")
        return machineResult({
          id: "2026-10-28-totals",
          location: "inbox:2026-10-28-totals",
          entry: input.entry,
          related_entries: [],
          replayed: false,
        });
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
  /**
   * A Hub Ana is signed in to, the entries kontext reads (a test may change them), and the
   * peer-hub.json she starts with (what acme's app project says, say).
   */
  options: {
    readonly hubUrl?: string;
    readonly entries?: ReadonlyArray<KontextEntry>;
    readonly seed?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      options.hubUrl === undefined
        ? coreLayer(yield* seedState(options.seed), { plugins: [KnowledgePlugin] })
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

/** Ana's peer-hub.json where acme's app project lets its agents keep a personal harness memory. */
const personalMemorySeed = JSON.stringify({
  hubUrl: null,
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
            id: "app",
            name: "App",
            role: "lead",
            members: [],
            repositories: [],
            knowledge: { kontext: true, company: false },
            tools: [],
            capacity: { personal: "any", personalHarnesses: [] },
            agents: { memory: "personal" },
          },
        ],
      },
      lastSyncAt: null,
    },
  ],
  joinable: [],
  lastSyncAt: null,
  sharedInstances: {},
});
const MEMORY_FILE = "/Users/ana/.claude/projects/-Users-ana-app/memory/feedback_tests.md";
const MEMORY_LINE = "Keep nothing about this project in your harness memory";
const memoryWrite = {
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: MEMORY_FILE, content: "- run the real lab first" },
};
type Decided = { readonly permissionDecision?: string; readonly permissionDecisionReason?: string };
const decided = (answer: Record<string, unknown> | null) =>
  (answer?.hookSpecificOutput ?? {}) as Decided;

describe("the agents' harness memory", () => {
  it.effect(
    "starts an `off` project's agent with the line once, and refuses its memory writes",
    () =>
      Effect.gen(function* () {
        const ana = yield* anaWithKnowledge();
        const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
        assert.include(start, MEMORY_LINE);
        assert.include(start, "`peer capture --kind");
        assert.lengthOf(start.split(MEMORY_LINE), 2);
        // Not said again after a compaction: the refusal and the environment still hold.
        assert.notInclude(
          yield* ana.told({ hook_event_name: "SessionStart", source: "compact" }),
          MEMORY_LINE,
        );
        const answer = decided(
          yield* Effect.promise(() =>
            ana.fixture.broker["hook"](
              { session_id: "one", cwd: ana.fixture.root, ...memoryWrite },
              {},
            ),
          ),
        );
        assert.equal(answer.permissionDecision, "deny");
        const reason = answer.permissionDecisionReason ?? "";
        assert.include(reason, "this project keeps no harness memory");
        assert.include(reason, "`peer capture`");
        assert.notInclude(reason, "\n");
        // Any other file outside the repository is not Peer's to refuse.
        const elsewhere = decided(
          yield* Effect.promise(() =>
            ana.fixture.broker["hook"](
              {
                session_id: "one",
                cwd: ana.fixture.root,
                ...memoryWrite,
                tool_input: { file_path: "/Users/ana/notes/todo.md", content: "x" },
              },
              {},
            ),
          ),
        );
        assert.isUndefined(elsewhere.permissionDecision);
        yield* Effect.promise(() => ana.fixture.broker.host.log.idle());
        const log = yield* Effect.promise(() => NodeFSP.readFile(ana.fixture.debugPath, "utf8"));
        const refused = log
          .trim()
          .split("\n")
          .map(
            (line) =>
              JSON.parse(line) as {
                readonly event: string;
                readonly chars?: number;
                readonly paths?: string[];
              },
          )
          .filter((line) => line.event === "knowledge.memory-refused");
        assert.lengthOf(refused, 1);
        assert.deepEqual(refused[0]?.paths, [MEMORY_FILE]);
        assert.equal(refused[0]?.chars, reason.length);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says and refuses nothing where the project allows a personal memory", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge(virOnSpeakers(), (client) => client, {
        seed: personalMemorySeed,
      });
      const start = yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
      assert.notInclude(start, MEMORY_LINE);
      const answer = decided(
        yield* Effect.promise(() =>
          ana.fixture.broker["hook"](
            { session_id: "one", cwd: ana.fixture.root, ...memoryWrite },
            {},
          ),
        ),
      );
      assert.isUndefined(answer.permissionDecision);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "captures a lesson into kontext's inbox with peer capture, and asks for its proof",
    () =>
      Effect.gen(function* () {
        const ana = yield* anaWithKnowledge();
        yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
        yield* ana.told({
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "cargo test money" },
          tool_response: { stdout: "test result: ok. 3 passed", stderr: "" },
        });
        const answer = yield* ana.run("capture", [
          "--kind",
          "learning",
          "--title",
          "Totals round per line",
          "--what",
          "The total is the sum of rounded lines.",
          "--why",
          "Two agents summed first and rounded last.",
          "--paths",
          "src/pricing/",
        ]);
        assert.include(
          answer,
          "Captured learning 2026-10-28-totals in the project's knowledge inbox",
        );
        assert.include(answer, "reviewed when a person promotes and commits it");
        const asked = ana.kontext.asked.find((call) => call.operation === "drafts.capture");
        assert.deepEqual(asked?.input, {
          entry: {
            kind: "learning",
            title: "Totals round per line",
            body: "## What\n\nThe total is the sum of rounded lines.\n\n## Why\n\nTwo agents summed first and rounded last.",
            paths: ["src/pricing/"],
          },
          source: "peer:claude:one",
        });
        // A learning without a check is asked for its proof at the next step, as after ctx_capture.
        const next = yield* ana.told({
          hook_event_name: "PostToolUse",
          tool_name: "Read",
          tool_input: { file_path: NodePath.join(ana.fixture.root, "README.md") },
        });
        assert.include(next, "Peer: this entry has no check. You ran `cargo test money`");
        assert.include(next, "id 2026-10-28-totals");
        assert.include(yield* ana.run("help"), "peer capture");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "refuses peer capture where the repository keeps no kontext store, and on bad arguments",
    () =>
      Effect.gen(function* () {
        const ana = yield* anaWithKnowledge(virOnSpeakers(), (client) => ({
          run: async (args, cwd, stdin, timeoutMs) =>
            args[3] === "status"
              ? machineResult({
                  api_version: 1,
                  version: "1",
                  store: { configured: false, dir: ".ai" },
                  capabilities: [],
                  llm: { available: false },
                })
              : client.run(args, cwd, stdin, timeoutMs),
        }));
        yield* ana.told({ hook_event_name: "SessionStart", source: "startup" });
        yield* Effect.promise(() =>
          expect(
            ana.fixture.broker["runCli"](
              "capture",
              ["--kind", "learning", "--title", "t", "--what", "w", "--why", "y"],
              AS_ONE,
            ),
          ).rejects.toMatchObject({
            message: "this project keeps no kontext store in its repository",
          }),
        );
        assert.isFalse(ana.kontext.asked.some((call) => call.operation === "drafts.capture"));
        yield* Effect.promise(() =>
          expect(
            ana.fixture.broker["runCli"]("capture", ["--kind", "incident"], AS_ONE),
          ).rejects.toMatchObject({ message: "--kind is decision, convention or learning" }),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
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

  it.effect("asks a capture without a check about the test the agent ran, once", () =>
    Effect.gen(function* () {
      const ana = yield* anaWithKnowledge(virOnSpeakers());
      yield* ana.told({ hook_event_name: "UserPromptSubmit", prompt: "Round the total." });
      const capture = {
        hook_event_name: "PostToolUse",
        tool_name: "mcp__kontext__ctx_capture",
        tool_input: { kind: "learning", title: "Totals round per line", body: "…" },
        tool_response: [
          { type: "text", text: "Captured as inbox:2026-10-27-totals in the local inbox." },
        ],
      };
      // No test ran yet: nothing to name.
      assert.notInclude(yield* ana.told(capture), "this entry has no check");
      yield* ana.told({
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "cargo test pricing" },
      });
      assert.notInclude(yield* ana.told(capture), "this entry has no check");
      yield* ana.told({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "cargo test money" },
        tool_response: { stdout: "test result: ok. 3 passed", stderr: "" },
      });
      const asked = yield* ana.told(capture);
      assert.include(asked, "Peer: this entry has no check. You ran `cargo test money`");
      assert.include(
        asked,
        'ctx_inbox (action verify, id 2026-10-27-totals, verify "cargo test money")',
      );
      // A capture that names its check is not asked.
      assert.notInclude(
        yield* ana.told({
          ...capture,
          tool_input: { ...capture.tool_input, verify: "cargo test money" },
        }),
        "this entry has no check",
      );
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
          way: "new",
        });
        const firstStage = kontext.asked.find((call) => call.operation === "drafts.stage");
        assert.isDefined(firstStage);
        // What it stands on goes with it: its tasks and where it was read, never an address.
        assert.deepStrictEqual(firstStage?.input.entry, {
          kind: "decision",
          title: "Prices are integers of cents",
          body: "Floats lose cents; every amount is an integer.",
          paths: [],
          extra: { external_refs: ["task:krk-1", "context:task:krk-1@v3"], finders: "1" },
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
          extra: { external_refs: ["task:krk-1", "context:task:krk-1@v3"], finders: "1" },
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

describe("knowledge drift at peer review", () => {
  const DRIFTED = {
    base: "b".repeat(40),
    head: "working",
    entries: [
      {
        id: "rounding",
        kind: "decision",
        title: "Round each line before the total",
        path: ".ai/decisions/rounding.md",
        changed: ["src/pricing/total.ts"],
        commits: [{ sha: "c".repeat(40), subject: "Round the total once" }],
      },
    ],
  };
  /** Ana's agent `one` on KRK-2, whose moves the host records, and a kontext that answers drift with `drift`. */
  const onTask = (
    revision: number,
    drift: { current: () => ReturnType<typeof machineResult> },
    /** What `drafts.verify` answers, where kontext runs checks. */
    verified?: () => ReturnType<typeof machineResult>,
  ) =>
    Effect.gen(function* () {
      const moved: string[] = [];
      const driftAsked: unknown[] = [];
      const hub = yield* standInHub(challengeHub(revision, { current: [] }));
      const ana = yield* anaWithKnowledge(
        {
          ...virOnSpeakers(),
          taskOf: () => "task-2",
          finishTask: async (_workspace, _project, task, _session, status) => {
            moved.push(`${task} ${status}`);
          },
        },
        (client) => ({
          run: (args, cwd, stdin, timeoutMs) =>
            args[3] === "entries.drift"
              ? Promise.resolve(drift.current()).finally(() =>
                  driftAsked.push(JSON.parse(stdin ?? "{}")),
                )
              : args[3] === "drafts.verify" && verified !== undefined
                ? Promise.resolve(verified())
                : client.run(args, cwd, stdin, timeoutMs),
        }),
        { hubUrl: hub.url },
      );
      yield* ana.client.me;
      yield* Effect.promise(() => ana.fixture.register("one"));
      const review = Effect.promise(() =>
        ana.fixture.broker["runCli"]("review", [], AS_ONE).then(
          (text) => text,
          (error: { reason?: string; next?: string }) =>
            `refused: ${error.reason ?? String(error)}\nNext: ${error.next ?? ""}`,
        ),
      );
      const asked = () => driftAsked;
      return { ana, moved, review, asked };
    });

  it.effect("stops the review while an entry the change drifted from is not settled", () =>
    Effect.gen(function* () {
      const drift = { current: () => machineResult(DRIFTED) };
      const { ana, moved, review } = yield* onTask(3, drift);
      const stopped = yield* review;
      assert.include(stopped, "refused: project knowledge was not checked against your change");
      assert.include(
        stopped,
        '- rounding (decision: "Round each line before the total"): you changed src/pricing/total.ts in 1 commit',
      );
      assert.include(stopped, "kontext confirm <id>");
      assert.include(stopped, "`- [against <id>] why` under For the team");
      assert.include(stopped, "Next: settle each entry above, then run peer review again.");
      assert.deepStrictEqual(moved, []);

      // Challenged in its own context: settled, and the task moves.
      const session = ana.fixture.broker.sessions.get("claude:one")!;
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(session.ownContextPath), { recursive: true });
        await NodeFSP.writeFile(
          session.ownContextPath,
          "# Working context\n\n## For the team\n- [against rounding] Totals round once since KRK-2\n",
        );
      });
      assert.include(yield* review, "Task moved to review");
      assert.deepStrictEqual(moved, ["task-2 review"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("runs an entry's check first: a pass lets the review through, a failure is named", () =>
    Effect.gen(function* () {
      const checked = {
        ...DRIFTED,
        entries: DRIFTED.entries.map((entry) => ({ ...entry, verify: "cargo test rounding" })),
      };
      const outcome = (passed: boolean) =>
        machineResult({
          id: "rounding",
          command: "cargo test rounding",
          passed,
          exit_code: passed ? 0 : 101,
          timed_out: false,
          output_tail: passed ? "ok" : "test rounding ... FAILED",
          at: "2026-10-27T10:00:00Z",
          commit: "a".repeat(40),
          path: ".ai/confirmations.log",
        });
      const failing = yield* onTask(3, { current: () => machineResult(checked) }, () =>
        outcome(false),
      );
      const stopped = yield* failing.review;
      assert.include(
        stopped,
        "  its check `cargo test rounding` exited 101 at aaaaaaa: test rounding ... FAILED",
      );
      assert.deepStrictEqual(failing.moved, []);

      const passing = yield* onTask(3, { current: () => machineResult(checked) }, () =>
        outcome(true),
      );
      assert.include(yield* passing.review, "Task moved to review");
      assert.deepStrictEqual(passing.moved, ["task-2 review"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("lets the review through once kontext lists nothing, as after kontext confirm", () =>
    Effect.gen(function* () {
      const drift = { current: () => machineResult({ ...DRIFTED, entries: [] }) };
      const { moved, review, asked } = yield* onTask(3, drift);
      assert.include(yield* review, "Task moved to review");
      assert.deepStrictEqual(moved, ["task-2 review"]);
      // The working tree against where the task left the default branch: kontext's defaults.
      assert.deepStrictEqual(asked(), [{}]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says nothing of drift where kontext has none, or the Hub is older", () =>
    Effect.gen(function* () {
      const older = {
        current: () => ({
          code: 1,
          stdout: JSON.stringify({
            schema_version: 1,
            ok: false,
            error: { code: "unsupported_operation", message: "unknown operation 'entries.drift'" },
          }),
          stderr: "",
        }),
      };
      const withOlderKontext = yield* onTask(3, older);
      const said = yield* withOlderKontext.review;
      assert.strictEqual(said, "Task moved to review with current shared input versions.");

      const withOlderHub = yield* onTask(2, { current: () => machineResult(DRIFTED) });
      assert.include(yield* withOlderHub.review, "Task moved to review");
      assert.isEmpty(withOlderHub.asked());
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("knowledge changed on the default branch", () => {
  const CHANGED = "the project's knowledge changed on the default branch";
  const landed = (id: string, more: Record<string, unknown> = {}) => ({
    id,
    kind: "learning",
    title: `Learning ${id}`,
    file: `.ai/learnings/${id}.md`,
    paths: [],
    revision: `rev-${id}`,
    change: "added",
    ...more,
  });
  /**
   * Ana's agent `one` in a checkout whose remote default branch Peer saw at a first commit, over a
   * kontext with `entries.changed` (listing `changes` for any move) unless `older`.
   */
  const anaOnMain = (
    changes: { current: ReadonlyArray<unknown> },
    options: { readonly older?: boolean } = {},
  ) =>
    Effect.gen(function* () {
      const asked: unknown[] = [];
      const ana = yield* anaWithKnowledge(virOnSpeakers(), (client) => ({
        run: async (args, cwd, stdin, timeoutMs) => {
          if (args[3] === "entries.changed") {
            asked.push(JSON.parse(stdin ?? "{}"));
            return machineResult({ changes: changes.current });
          }
          const answer = await client.run(args, cwd, stdin, timeoutMs);
          if (args[3] !== "status" || options.older === true) return answer;
          const status = JSON.parse(answer.stdout) as { result: { capabilities: string[] } };
          return machineResult({
            ...status.result,
            capabilities: [...status.result.capabilities, "entries.changed"],
          });
        },
      }));
      const git = (...args: string[]) =>
        NodeChildProcess.execFileSync("git", ["-C", ana.fixture.root, ...args], {
          encoding: "utf8",
        }).trim();
      git("init", "-q");
      /** A teammate's commit lands on the remote default branch, and this checkout fetched it. */
      const land = () => {
        git(
          "-c",
          "user.name=Vir",
          "-c",
          "user.email=vir@acme.test",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "land",
        );
        git("update-ref", "refs/remotes/origin/main", git("rev-parse", "HEAD"));
      };
      land();
      yield* Effect.promise(() => ana.fixture.register("one"));
      const [session] = yield* ana.agents.sessions;
      const hooks = (yield* ana.plugins.active).find((plugin) => plugin.id === "knowledge")
        ?.contributions.hooks;
      /** One step's notice, as core asks it before a tool call that changes `paths`. */
      const step = (paths: ReadonlyArray<string> = []) =>
        Effect.map(
          hooks!.notices![0]!.read({
            session: session!,
            event: "pre-tool",
            remainingMs: 1000,
            tool: "Edit",
            paths,
          }),
          (said) => (typeof said === "string" ? said : (said?.text ?? "")),
        );
      // The first read of the book is the baseline of the default branch.
      yield* step();
      /** A minute later the book is read again, and with it the default branch. */
      const later = TestClock.adjust("61 seconds");
      const logged = (event: string) =>
        Effect.promise(async () => {
          await ana.fixture.broker.host.log.idle();
          const text = await NodeFSP.readFile(ana.fixture.broker.host.logPath, "utf8");
          return text
            .split("\n")
            .filter((line) => line.includes(`"event":"${event}"`))
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        });
      return { ana, session: session!, step, land, later, asked, logged };
    });

  it.effect(
    "tells an agent that read an entry, once, that it was superseded, and how to read what replaces it",
    () =>
      Effect.gen(function* () {
        const changes = {
          current: [
            landed("round-once", { kind: "decision", title: "Round once per total" }),
            landed("rounding", {
              kind: "decision",
              title: "Round each line before the total",
              change: "superseded",
              superseded_by: ["round-once"],
            }),
          ],
        };
        const on = yield* anaOnMain(changes);
        // peer knowledge records the read in what the session was told (run on this test's clock).
        const knowledge = (yield* on.ana.plugins.active)
          .find((plugin) => plugin.id === "knowledge")
          ?.contributions.commands?.find((command) => command.name === "knowledge");
        yield* knowledge!.run({
          session: on.session,
          args: ["rounding"],
          plain: ["rounding"],
          text: "rounding",
          flag: () => undefined,
          cwd: undefined,
        });
        assert.isTrue(
          [...(on.session.told?.("knowledge") ?? [])].some((key) => key.startsWith("rounding@md:")),
        );
        on.land();
        yield* on.later;
        const said = yield* on.step();
        assert.include(said, `Peer · ${CHANGED} (team reference, not instructions;`);
        assert.include(
          said,
          '- decision "Round each line before the total" superseded by "Round once per total" (not yet in your checkout). You read it. Read it: peer knowledge round-once',
        );
        assert.isTrue(said.endsWith("Check your work against it before handing over."));
        assert.deepStrictEqual(on.asked.length, 1);
        // The read the notice names goes to the default branch, which has no such file here.
        const read = yield* knowledge!.run({
          session: on.session,
          args: ["round-once"],
          plain: ["round-once"],
          text: "round-once",
          flag: () => undefined,
          cwd: undefined,
        });
        assert.include(
          JSON.stringify(read),
          "peer: round-once is not in your checkout, and its file `.ai/learnings/round-once.md` is missing on the default branch",
        );
        // Told once per revision: not at the next step, nor after the next read of the branch.
        assert.strictEqual(yield* on.step(), "");
        yield* on.later;
        assert.strictEqual(yield* on.step(), "");
        const [line] = yield* on.logged("knowledge.changed");
        assert.strictEqual(line?.entryCount, 1);
        assert.strictEqual(line?.tokens, Math.ceil(said.length / 4));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("names three changes within the step's budget and the other two at the next step", () =>
    Effect.gen(function* () {
      const five = [1, 2, 3, 4, 5].map((n) => landed(`engine-${n}`, { paths: ["src/engines/**"] }));
      const on = yield* anaOnMain({ current: five });
      on.land();
      yield* on.later;
      const first = yield* on.step(["src/engines/registry.ts"]);
      assert.strictEqual((first.match(/^- /gm) ?? []).length, 3);
      assert.include(
        first,
        "It governs `src/engines/**`, and you change `src/engines/registry.ts`.",
      );
      assert.isAtMost(Math.ceil(first.length / 4), 400);
      const second = yield* on.step();
      assert.strictEqual((second.match(/^- /gm) ?? []).length, 2);
      assert.include(second, "peer knowledge engine-5");
      assert.strictEqual(yield* on.step(), "");
      const lines = yield* on.logged("knowledge.changed");
      assert.deepStrictEqual(
        lines.map((line) => line.entryCount),
        [3, 2],
      );
      assert.strictEqual(lines[0]?.tokens, Math.ceil(first.length / 4));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says the change after what governs the files, within one budget", () =>
    Effect.gen(function* () {
      const on = yield* anaOnMain({ current: [landed("engines", { paths: ["src/engines/**"] })] });
      on.land();
      yield* on.later;
      const said = yield* on.step(["src/pricing/total.ts", "src/engines/registry.ts"]);
      assert.isBelow(said.indexOf(GOVERNS), said.indexOf(CHANGED));
      assert.isAtMost(said.length, 1200);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells a session that relies on none of the changed entries nothing", () =>
    Effect.gen(function* () {
      const on = yield* anaOnMain({
        current: [landed("engines", { paths: ["src/engines/**"] }), landed("prices")],
      });
      on.land();
      yield* on.later;
      assert.notInclude(yield* on.step(["README.md"]), CHANGED);
      assert.deepStrictEqual(yield* on.logged("knowledge.changed"), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("tells nobody with a kontext before entries.changed, and governs as before", () =>
    Effect.gen(function* () {
      const on = yield* anaOnMain(
        { current: [landed("engines", { paths: ["src/engines/**"] })] },
        { older: true },
      );
      on.land();
      yield* on.later;
      const said = yield* on.step(["src/engines/registry.ts", "src/pricing/total.ts"]);
      assert.notInclude(said, CHANGED);
      assert.include(said, GOVERNS);
      assert.deepStrictEqual(on.asked, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("says nothing of changes while the plugin is off", () =>
    Effect.gen(function* () {
      const on = yield* anaOnMain({ current: [landed("engines", { paths: ["src/engines/**"] })] });
      yield* on.ana.plugins.setPlugin({ id: "knowledge", enabled: false });
      on.land();
      yield* on.later;
      assert.notInclude(
        yield* on.ana.told({
          hook_event_name: "PreToolUse",
          ...on.ana.edit("src/engines/registry.ts"),
        }),
        CHANGED,
      );
      assert.deepStrictEqual(on.asked, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
