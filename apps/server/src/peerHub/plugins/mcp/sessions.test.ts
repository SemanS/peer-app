// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - a private broker and generated shim, never the live Peer socket.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import type { PeerBrokerHost } from "../../core/broker/host.ts";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import type { PeerRuntimeProvider } from "../../core/plugin.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import { coreLayer } from "../../core/testkit.ts";
import { McpPlugin } from "./index.ts";
import { bindPlugin, type PeerPluginEntry } from "../../core/plugin.ts";

const program = <E>(
  body: (
    fixture: Awaited<ReturnType<typeof brokerFixture>>,
    plugins: PeerPlugins.PeerPlugins["Service"],
  ) => Effect.Effect<void, E>,
  extra: ReadonlyArray<PeerPluginEntry> = [],
) =>
  Effect.gen(function* () {
    const fixture = yield* Effect.acquireRelease(
      Effect.promise(() =>
        brokerFixture((host) => ({
          threadAgent: async () => ({
            agent: "cursor",
            nativeId: "native-1",
            cwd: host.scriptsDir.replace(/\/scripts$/, ""),
          }),
          taskOf: () => "task-1",
        })),
      ),
      (fixture) => Effect.promise(fixture.dispose),
    );
    const core = yield* Layer.build(coreLayer(fixture.root, { plugins: [McpPlugin, ...extra] }));
    yield* Effect.gen(function* () {
      yield* PeerPlugins.startPlugins;
      const agents = yield* PeerAgents.PeerAgents;
      const plugins = yield* PeerPlugins.PeerPlugins;
      Object.assign(fixture.broker.host, pluginsOf(plugins));
      yield* agents.attach(fixture.broker);
      yield* body(fixture, plugins);
    }).pipe(Effect.provideContext(core));
  }).pipe(Effect.provide(NodeServices.layer));

const commandOf = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  Effect.map(plugins.contributions, (all) =>
    all.flatMap((p) => p.commands ?? []).find((c) => c.name === "mcp")!,
  );
const headers = { "x-peer-mcp": "mcp-test-1", "x-peer-thread": "thread-1" };
const status = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"peer_status"}}';

describe("coordination tool sessions", () => {
  it.effect(
    "does not leave a session behind when the plugin is disabled during initial binding",
    () =>
      program((fixture, plugins) =>
        Effect.gen(function* () {
          let enter: () => void = () => undefined;
          let release: () => void = () => undefined;
          const entered = new Promise<void>((resolve) => {
            enter = resolve;
          });
          const released = new Promise<void>((resolve) => {
            release = resolve;
          });
          Object.assign(fixture.broker.host, {
            threadAgent: async () => {
              enter();
              await released;
              return { agent: "cursor", nativeId: "slow", cwd: fixture.root };
            },
          });
          const command = yield* commandOf(plugins);
          const first = yield* command.stdio!({ line: status, headers }).pipe(Effect.forkChild);
          yield* Effect.promise(() => entered);
          yield* plugins.setPlugin({ id: "mcp", enabled: false });
          release();
          const reply = JSON.parse(yield* Fiber.join(first));
          assert.isTrue(reply.result.isError);
          assert.equal(fixture.broker.sessions.size, 0);
        }),
      ),
  );
  it.effect(
    "wakes a published herdr pane on overlap notes and delivers the note at its next tool call",
    () =>
      program((fixture, plugins) =>
        Effect.gen(function* () {
          fixture.broker.localRuntimeAgents = async () => [
            {
              id: "herdr:cursor:pane-native",
              paneId: "pane",
              agent: "cursor",
              title: "agent",
              status: "idle",
              cwd: fixture.root,
            },
          ];
          const command = yield* commandOf(plugins);
          const paneHeaders = { "x-peer-mcp": "wake-pane", "x-herdr-pane": "pane" };
          yield* command.stdio!({ line: status, headers: paneHeaders });
          const session = fixture.broker.sessions.get("cursor:pane-native")!;
          session.status = "idle";
          const me = fixture.broker.asHub(session);
          fixture.broker.views.set("acme", {
            sessions: [me, { ...me, id: "other", email: "bob@acme.test" }],
            overlaps: [
              {
                id: "overlap-1",
                project: "app",
                sessions: [session.id, "other"],
                files: ["a.ts"],
                state: "open",
                notes: [
                  {
                    id: "note-1",
                    email: "bob@acme.test",
                    session: "other",
                    text: "I will finish the adapter first.",
                    at: "2026-10-09T10:00:00Z",
                  },
                ],
                openedAt: "2026-10-09T10:00:00Z",
                updatedAt: "2026-10-09T10:00:00Z",
              },
            ],
            at: "2026-10-09T10:00:00Z",
          });
          const prompts: string[] = [];
          let wake: () => void = () => undefined;
          const woken = new Promise<void>((resolve) => {
            wake = resolve;
          });
          const runtime: PeerRuntimeProvider = {
            prefix: "herdr:",
            title: () => undefined,
            pane: () => undefined,
            status: () => "idle",
            view: () => Effect.die("unused"),
            threads: () => Effect.succeed([]),
            wake: (_id, _pane, text) =>
              Effect.sync(() => {
                prompts.push(text);
                wake();
                return { status: "queued" };
              }),
          };
          yield* Effect.promise(() => fixture.broker.wakeRuntime({ ...NO_PLUGINS, runtime }));
          yield* Effect.promise(() => woken);
          assert.deepEqual(prompts, ["[Peer coordination update]"]);
          const answer = JSON.parse(yield* command.stdio!({ line: status, headers: paneHeaders }));
          assert.include(answer.result.content[0].text, "I will finish the adapter first.");
          const next = JSON.parse(yield* command.stdio!({ line: status, headers: paneHeaders }));
          assert.notInclude(next.result.content[0].text, "I will finish the adapter first.");
        }),
      ),
  );
  it.effect(
    "retains sessions across ordinary workspace sync and closes them after access is removed",
    () =>
      program((fixture, plugins) =>
        Effect.gen(function* () {
          const command = yield* commandOf(plugins);
          yield* command.stdio!({ line: status, headers });
          const entry = (yield* plugins.contributions).find(
            (entry) => entry.workspaceCleanup !== undefined,
          )!;
          yield* entry.workspaceCleanup!({
            kind: "synced",
            workspaces: [
              {
                slug: "acme",
                name: "Acme",
                role: "member",
                allowedDomains: [],
                manifest: null,
                lastSyncAt: null,
              },
            ],
          });
          assert.equal(fixture.broker.sessions.size, 1);
          yield* entry.workspaceCleanup!({ kind: "synced", workspaces: [] });
          assert.equal(fixture.broker.sessions.size, 0);
        }),
      ),
  );
  it.effect(
    "publishes team findings and a keeper's edits before checking stale review inputs",
    () =>
      program((fixture, plugins) =>
        Effect.gen(function* () {
          let stale = true;
          const order: string[] = [];
          const override: Partial<PeerBrokerHost> = {
            keepContext: async (_workspace, project, scope, session) => ({
              project,
              scope,
              version: 1,
              text: "Shared overview",
              updatedAt: "2026-10-09T10:00:00Z",
              keeper: {
                session,
                email: "ana@acme.test",
                environment: "test",
                since: "2026-10-09T10:00:00Z",
              },
            }),
            writeContext: async (_workspace, project, scope, _session, baseVersion, text) => {
              order.push("published");
              return {
                project,
                scope,
                version: baseVersion + 1,
                text,
                updatedAt: "2026-10-09T10:00:00Z",
              };
            },
            staleReads: async () => ({
              fresh: !stale,
              stale: stale
                ? [
                    {
                      project: "app",
                      scope: "task:prices",
                      readVersion: 1,
                      currentVersion: 2,
                      at: "2026-10-09",
                      updatedAt: "2026-10-09",
                    },
                  ]
                : [],
            }),
            finishTask: async (_workspace, _project, _task, _session, status) => {
              order.push(status);
            },
          };
          Object.assign(fixture.broker.host, override);
          const command = yield* commandOf(plugins);
          yield* command.stdio!({ line: status, headers });
          const session = fixture.broker.sessions.get("cursor:native-1")!;
          assert.isTrue(session.keeps);
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              session.ownContextPath,
              "Private notes\n## For the team\n- Prices are stored in cents\n",
            ),
          );
          yield* Effect.promise(() =>
            NodeFSP.writeFile(fixture.broker.mirrorOf(session)!.path, "Verified shared result"),
          );
          const review =
            '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"peer_review"}}';
          const refused = JSON.parse(yield* command.stdio!({ line: review, headers }));
          assert.isTrue(refused.result.isError);
          assert.include(refused.result.content[0].text, "peer: refused: shared inputs changed");
          assert.deepEqual(order, ["published"]);
          assert.deepEqual(fixture.broker.reportFor("acme")[0]?.findings, [
            "Prices are stored in cents",
          ]);
          stale = false;
          const accepted = JSON.parse(yield* command.stdio!({ line: review, headers }));
          assert.isUndefined(accepted.result.isError);
          assert.deepEqual(order, ["published", "review"]);
          Object.assign(fixture.broker.host, {
            writeContext: async () => {
              throw new Error("lost upload");
            },
          });
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              fixture.broker.mirrorOf(session)!.path,
              "A handoff still waiting to publish",
            ),
          );
          const unpublished = JSON.parse(yield* command.stdio!({ line: review, headers }));
          assert.isTrue(unpublished.result.isError);
          assert.include(
            unpublished.result.content[0].text,
            "shared handoff context has not reached the Hub",
          );
          assert.deepEqual(order, ["published", "review"]);
          yield* Effect.promise(() => fixture.broker.logQueue);
          const log = yield* Effect.promise(() =>
            NodeFSP.readFile(fixture.broker.host.logPath, "utf8"),
          );
          assert.include(log, '"event":"mcp.session"');
          assert.include(log, '"event":"mcp.call"');
          assert.isAbove(session.injected.get("mcp")!, 0);
          assert.notInclude(log, '"event":"delivery.verified"');
        }),
      ),
  );
  it.effect(
    "binds unknown native ids by one stable pane and follows a later real hook session",
    () =>
      program((fixture, plugins) =>
        Effect.gen(function* () {
          let known = false;
          fixture.broker.localRuntimeAgents = async () => [
            {
              id: known ? "herdr:claude:native" : "herdr:42",
              paneId: "pane",
              title: "agent",
              status: "idle",
              cwd: fixture.root,
              ...(known ? { agent: "claude" } : {}),
            },
          ];
          const command = yield* commandOf(plugins);
          const paneHeaders = { "x-peer-mcp": "pane-one", "x-herdr-pane": "pane" };
          yield* command.stdio!({ line: status, headers: paneHeaders });
          yield* command.stdio!({
            line: status,
            headers: { ...paneHeaders, "x-peer-mcp": "pane-two" },
          });
          assert.equal(fixture.broker.sessions.size, 1);
          assert.isTrue(fixture.broker.sessions.has("unknown:mcp-42"));
          yield* Effect.promise(() => fixture.register("native"));
          fixture.broker.sessions.get("claude:native")!.pane = "pane";
          known = true;
          yield* command.stdio!({ line: status, headers: paneHeaders });
          assert.deepEqual([...fixture.broker.sessions.keys()], ["claude:native"]);
          yield* command.stdio!({ line: "--end", headers: paneHeaders });
          assert.equal(fixture.broker.coordinationLevel("claude:native"), "B");
        }),
      ),
  );
  it.effect(
    "returns complete plugin text as offered, never as modelInput, before session-ending",
    () => {
      const states: string[] = [];
      const extra = bindPlugin({
        id: "knowledge",
        title: "fixture",
        summary: "test",
        defaultEnabled: true,
        layer: Layer.empty,
        make: Effect.succeed({
          hooks: {
            notices: [
              {
                wakes: false,
                read: () =>
                  Effect.succeed({
                    text: "A complete offered announcement.",
                    refs: ["announcement-1"],
                  }),
              },
            ],
            delivery: ({ state }) =>
              Effect.sync(() => {
                states.push(state);
              }),
            sessionEnding: () =>
              Effect.sync(() => {
                states.push("session-ending");
              }),
          },
        }),
      });
      return program(
        (_fixture, plugins) =>
          Effect.gen(function* () {
            const command = yield* commandOf(plugins);
            const answer = JSON.parse(yield* command.stdio!({ line: status, headers }));
            assert.include(answer.result.content[0].text, "A complete offered announcement.");
            assert.deepEqual(states, ["offered"]);
            yield* command.stdio!({ line: "--end", headers });
            assert.deepEqual(states, ["offered", "session-ending"]);
          }),
        [extra],
      );
    },
  );
  it.effect(
    "binds a thread once, carries pending notices once, and ends after the last server",
    () =>
      program((fixture, plugins) =>
        Effect.gen(function* () {
          const command = yield* commandOf(plugins);
          const first = JSON.parse(yield* command.stdio!({ line: status, headers }));
          assert.isUndefined(first.result.isError);
          assert.include(first.result.content[0].text, "Use your peer_* tools");
          assert.equal(fixture.broker.sessions.size, 1);
          const session = fixture.broker.sessions.get("cursor:native-1")!;
          assert.equal(session.task, "task-1");
          assert.equal(fixture.broker.coordinationLevel(session.id), "C");
          session.pending.push("A teammate left a coordination note.");
          const second = JSON.parse(
            yield* command.stdio!({
              line: status,
              headers: { ...headers, "x-peer-mcp": "mcp-test-2" },
            }),
          );
          assert.include(second.result.content[0].text, "A teammate left a coordination note.");
          const third = JSON.parse(yield* command.stdio!({ line: status, headers }));
          assert.notInclude(third.result.content[0].text, "A teammate left a coordination note.");
          assert.notInclude(third.result.content[0].text, "Use your peer_* tools");
          yield* command.stdio!({ line: "--end", headers });
          assert.equal(fixture.broker.sessions.size, 1);
          yield* command.stdio!({
            line: "--end",
            headers: { ...headers, "x-peer-mcp": "mcp-test-2" },
          });
          assert.equal(fixture.broker.sessions.size, 0);
        }),
      ),
  );
  it.effect("never guesses an agent by cwd and preserves a hook session on close", () =>
    program((fixture, plugins) =>
      Effect.gen(function* () {
        const command = yield* commandOf(plugins);
        yield* Effect.promise(() => fixture.register("hook"));
        const unnamed = JSON.parse(
          yield* command.stdio!({
            line: status,
            headers: { "x-peer-mcp": "mcp-unbound", "x-peer-cwd": fixture.root },
          }),
        );
        assert.isTrue(unnamed.result.isError);
        assert.include(unnamed.result.content[0].text, "HERDR_PANE_ID");
        const hookHeaders = { "x-peer-mcp": "mcp-hook", "x-peer-session": "claude:hook" };
        yield* command.stdio!({ line: status, headers: hookHeaders });
        assert.equal(fixture.broker.coordinationLevel("claude:hook"), "B");
        yield* command.stdio!({ line: "--end", headers: hookHeaders });
        assert.isTrue(fixture.broker.sessions.has("claude:hook"));
      }),
    ),
  );
  it.effect("upgrades a tools session when real hooks or Mod handshakes arrive", () =>
    program((fixture, plugins) =>
      Effect.gen(function* () {
        const command = yield* commandOf(plugins);
        yield* command.stdio!({ line: status, headers });
        const session = fixture.broker.sessions.get("cursor:native-1")!;
        yield* Effect.promise(() =>
          fixture.broker.answerHook("UserPromptSubmit", session, { prompt: "continue" }),
        );
        assert.equal(fixture.broker.coordinationLevel(session.id), "B");
        yield* Effect.promise(() =>
          fixture.broker.answerHook(
            "SessionStart",
            session,
            { source: "startup" },
            { mod: true, signature: "mod-start" },
          ),
        );
        assert.equal(fixture.broker.coordinationLevel(session.id), "A");
        yield* command.stdio!({ line: "--end", headers });
        assert.isTrue(fixture.broker.sessions.has(session.id));
      }),
    ),
  );
  it.effect("ends advisory sessions on disable and accepts a fresh session after re-enable", () =>
    program((fixture, plugins) =>
      Effect.gen(function* () {
        const command = yield* commandOf(plugins);
        yield* command.stdio!({ line: status, headers });
        yield* plugins.setPlugin({ id: "mcp", enabled: false });
        assert.equal(fixture.broker.sessions.size, 0);
        assert.isFalse(yield* plugins.isActive("mcp"));
        yield* plugins.setPlugin({ id: "mcp", enabled: true });
        yield* command.stdio!({ line: status, headers });
        assert.equal(fixture.broker.sessions.size, 1);
      }),
    ),
  );
  it.effect(
    "refreshes plugin prompts at the next message and removes disabled contributed tools",
    () => {
      let revision = 1;
      const extra = bindPlugin({
        id: "knowledge",
        layer: Layer.empty,
        title: "Recipes",
        summary: "test",
        defaultEnabled: true,
        make: Effect.succeed({
          agentTools: [
            {
              name: "peer_recipe",
              description: "Read",
              command: "recipe",
              inputSchema: { type: "object" },
              arguments: () => [],
            },
          ],
          agentPrompts: {
            list: () => Effect.succeed([{ name: `recipe-${revision}` }]),
            get: () => Effect.succeed({ text: "Keep this exact CLI body.\nMCP: peer_status." }),
          },
        }),
      });
      return program(
        (_fixture, plugins) =>
          Effect.gen(function* () {
            const command = yield* commandOf(plugins);
            const prompt = JSON.parse(
              yield* command.stdio!({
                line: '{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"recipe-1"}}',
                headers,
              }),
            );
            assert.equal(
              prompt.result.messages[0].content.text,
              "Keep this exact CLI body.\nMCP: peer_status.",
            );
            revision = 2;
            const changed = (yield* command.stdio!({
              line: '{"jsonrpc":"2.0","id":2,"method":"ping"}',
              headers,
            }))
              .split("\n")
              .map((line) => JSON.parse(line));
            assert.equal(changed[0].method, "notifications/prompts/list_changed");
            assert.equal(changed[1].id, 2);
            yield* plugins.setPlugin({ id: "knowledge", enabled: false });
            const removed = (yield* command.stdio!({
              line: '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
              headers,
            }))
              .split("\n")
              .map((line) => JSON.parse(line));
            assert.equal(removed[0].method, "notifications/prompts/list_changed");
            const catalog = removed[1];
            assert.lengthOf(catalog.result.tools, 12);
          }),
        [extra],
      );
    },
  );
  it.effect("generated stdio shim answers three lines in order and closes its session", () =>
    program((fixture) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fixture.broker.start());
        const input = [
          '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
          '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
          status.replace('"id":1', '"id":3'),
          '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        ].join("\n");
        const output = yield* Effect.promise(
          () =>
            new Promise<{ code: number | null; stdout: string; stderr: string }>(
              (resolve, reject) => {
                const child = NodeChildProcess.spawn("sh", [fixture.broker.scripts.peer, "mcp"], {
                  env: {
                    ...process.env,
                    PEER_SESSION: "",
                    PEER_SESSION_TOKEN: "",
                    CODEX_THREAD_ID: "",
                    PEER_THREAD: "thread-1",
                  },
                });
                let stdout = "";
                let stderr = "";
                child.stdout.on("data", (chunk) => (stdout += String(chunk)));
                child.stderr.on("data", (chunk) => (stderr += String(chunk)));
                child.on("error", reject);
                child.on("close", (code) => resolve({ code, stdout, stderr }));
                child.stdin.end(input);
              },
            ),
        );
        assert.equal(output.code, 0);
        assert.equal(output.stderr, "");
        const answers = output.stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.deepStrictEqual(
          answers.map((answer) => answer.id),
          [1, 2, 3],
        );
        assert.lengthOf(answers[1].result.tools, 12);
        assert.isUndefined(answers[2].result.isError);
        assert.equal(fixture.broker.sessions.size, 0);
      }),
    ),
  );
});
