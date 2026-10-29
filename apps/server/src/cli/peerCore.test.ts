// @effect-diagnostics nodeBuiltinImport:off - clones and peer-hub.json in temporary directories.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Runtime from "effect/Runtime";

import * as PeerAdapters from "../peerHub/core/coordination/PeerAdapters.ts";
import * as PeerHubClient from "../peerHub/core/hub/PeerHubClient.ts";
import * as PeerPlugins from "../peerHub/core/plugins/PeerPlugins.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import * as PeerStatus from "../peerHub/core/status/PeerStatus.ts";
import {
  coreLayer,
  type HubAnswer,
  meAnswer,
  type HubCall,
  seedState,
  paymentsSeed,
  signedInSeed,
  standInHub,
} from "../peerHub/core/testkit.ts";
import * as McpConnect from "../peerHub/plugins/mcp/connect.ts";
import * as PeerCoreBind from "./peerCoreBind.ts";
import * as PeerCoreJoin from "./peerCoreJoin.ts";
import * as PeerCoreMenu from "./peerCoreMenu.ts";
import * as PeerCoreShare from "./peerCoreShare.ts";
import * as PeerCoreTasks from "./peerCoreTasks.ts";
import { fail, type OneShotIo } from "./peerCoreIo.ts";

const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

const project = (id: string, url: string) => ({
  id,
  name: id,
  role: "member",
  members: [],
  repositories: [{ id: "app", url, branch: "main" }],
  knowledge: { kontext: false, company: false },
  tools: [],
  capacity: { personal: "any", personalHarnesses: [] },
});

const MANIFEST = {
  version: 2,
  workspace: { slug: "example", name: "Example", currency: "EUR" },
  member: { email: "cyril@freelance.example", name: "Cyril", role: "member" },
  knowledge: {},
  projects: [
    project("webshop", "https://github.com/example/webshop.git"),
    project("billing", "https://github.com/example/billing.git"),
  ],
};

const task = (id: string, key: string, title: string, status: string, area?: string) => ({
  id,
  key,
  title,
  status,
  ...(area === undefined ? {} : { area }),
  createdBy: "ana@example.com",
  createdAt: "2026-10-28T09:00:00Z",
  updatedAt: "2026-10-28T09:00:00Z",
});

/**
 * The example Hub: Cyril is invited to webshop with task VL7 until he joins; `me` is whoever its
 * sessions belong to.
 */
const exampleHub =
  (me: { email: string; joined: boolean; older?: boolean }): HubAnswer =>
  (url) => {
    const path = url.split("?")[0] ?? url;
    if (path === "/v1/workspaces/example/ownership")
      return me.older === true
        ? [404, { error: { code: "not_found", message: "Not found." } }]
        : [
            200,
            {
              at: "2026-10-28T10:00:00Z",
              projects: {
                webshop: {
                  leads: ["ana@example.com"],
                  map: { version: 0, areas: {}, paths: {}, decide: [] },
                  tasks: {
                    vl8: {
                      project: "webshop",
                      task: "vl8",
                      owner: "bob@example.com",
                      since: "2026-10-27T10:00:00Z",
                      reason: "named",
                    },
                  },
                  calls: [],
                },
              },
            },
          ];
    if (path === "/v1/workspaces/example/projects/webshop/tasks/vl7/owner")
      return me.older === true
        ? [
            403,
            {
              error: {
                code: "forbidden",
                message:
                  "only a lead of the project, an admin or the task's owner changes its owner",
              },
            },
          ]
        : [
            200,
            {
              task: "vl7",
              owner: {
                project: "webshop",
                task: "vl7",
                owner: me.email,
                since: "2026-10-28T10:01:00Z",
                reason: "taken",
              },
              changed: true,
            },
          ];
    if (path === "/v1/auth/email/start")
      return [200, { email: me.email, sent: false, code: "424242" }];
    if (path === "/v1/auth/email/verify")
      return [200, { session: "phs_cyril", email: me.email, expiresAt: "2026-11-28T09:00:00Z" }];
    if (path === "/v1/me")
      return [
        200,
        {
          email: me.email,
          workspaces: me.joined
            ? [{ slug: "example", name: "Example", allowedDomains: [], role: "member" }]
            : [],
          joinable: me.joined
            ? []
            : [
                {
                  slug: "example",
                  name: "Example",
                  allowedDomains: [],
                  joinReason: "invite",
                  projects: ["webshop"],
                  task: "vl7",
                },
              ],
        },
      ];
    if (path === "/v1/workspaces/example/join") {
      me.joined = true;
      return [200, {}];
    }
    if (path === "/v1/workspaces/example/manifest") return [200, MANIFEST];
    if (path === "/v1/workspaces/example/work")
      return [
        200,
        {
          projects: {
            webshop: {
              areas: ["Checkout"],
              tasks: [
                task("vl6", "VL6", "Cart totals", "open", "Checkout"),
                task("vl7", "VL7", "Split payments", "review", "Checkout"),
                task("vl8", "VL8", "Refunds", "open"),
                task("vl5", "VL5", "Old checkout", "done", "Checkout"),
              ],
              threads: [],
            },
            billing: { areas: [], tasks: [], threads: [] },
          },
        },
      ];
    return [404, { error: { code: "not_found", message: "Not found." } }];
  };

/** Lines a command said; asking for a code fails the test (the Hub echoes it). */
const recorder = () => {
  const lines: Array<string> = [];
  const io: OneShotIo = {
    say: (line) => Effect.sync(() => void lines.push(line)),
    askCode: Effect.die(new Error("asked for a code")),
  };
  return { lines, io };
};

const LINK = (hubUrl: string) => `${hubUrl}/join/example?email=cyril%40freelance.example`;

/** Cyril joined from his link, against the example Hub (an older one when `older`). */
const joinedCyril = (older = false) =>
  Effect.gen(function* () {
    const me = { email: "cyril@freelance.example", joined: false, older };
    const started_ = yield* started(me);
    yield* PeerCoreJoin.join(
      { target: LINK(started_.hub.url), hub: started_.hub.url },
      recorder().io,
    ).pipe(Effect.provide(started_.core));
    return started_;
  });

/** Core on `seed(hubUrl)` (signed out when it gives none), against the example Hub. */
const started = (
  me: { email: string; joined: boolean },
  seed?: (hubUrl: string) => string,
  session?: string,
) =>
  Effect.gen(function* () {
    const hub = yield* standInHub({ current: exampleHub(me) });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(seed?.(hub.url)), session === undefined ? {} : { session }),
    );
    yield* Effect.gen(function* () {
      yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
    }).pipe(Effect.provide(core));
    return { hub, core };
  });

const paths = (calls: ReadonlyArray<HubCall>) => calls.map((call) => `${call.method} ${call.url}`);

describe("peer core join", () => {
  it.effect("join_with_a_link_signs_in_and_joins", () =>
    Effect.gen(function* () {
      const me = { email: "cyril@freelance.example", joined: false };
      const { hub, core } = yield* started(me);
      const { lines, io } = recorder();
      // The stand-in Hub runs on this computer, as a development Hub does: `--hub` names it.
      const joined = yield* PeerCoreJoin.join({ target: LINK(hub.url), hub: hub.url }, io).pipe(
        Effect.provide(core),
      );
      assert.deepStrictEqual(lines, [
        `Signed in: cyril@freelance.example at ${hub.url}`,
        "Joined: example (Example) as member.",
        "webshop · https://github.com/example/webshop.git (main)",
        "Waiting for you: VL7 · Split payments",
      ]);
      assert.deepStrictEqual(joined, {
        workspace: "example",
        clones: ["git clone --branch main https://github.com/example/webshop.git"],
      });
      assert.include(paths(hub.calls), "POST /v1/workspaces/example/join");
      const { persisted } = yield* PeerState.PeerState.pipe(
        Effect.flatMap((state) => state.read),
        Effect.provide(core),
      );
      assert.strictEqual(persisted.email, "cyril@freelance.example");
      assert.deepStrictEqual(persisted.invitedTasks, [
        { workspace: "example", project: "webshop", task: "vl7" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("join_refuses_a_link_of_another_hub_with_nobody_signed_in", () =>
    Effect.gen(function* () {
      const me = { email: "cyril@freelance.example", joined: false };
      const { hub, core } = yield* started(me);
      const { lines, io } = recorder();
      const result = yield* PeerCoreJoin.join({ target: LINK(hub.url) }, io).pipe(
        Effect.provide(core),
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result));
      const host = new URL(hub.url).host;
      if (Result.isFailure(result)) {
        assert.include(String(result.failure.message), `the invitation is from the Hub at ${host}`);
        assert.include(String(result.failure.message), `--hub ${hub.url}`);
      }
      assert.deepStrictEqual(lines, []);
      // The foreign Hub heard nothing and is not remembered.
      assert.deepStrictEqual(paths(hub.calls), []);
      const { persisted } = yield* PeerState.PeerState.pipe(
        Effect.flatMap((state) => state.read),
        Effect.provide(core),
      );
      assert.isNull(persisted.hubUrl);
      assert.isNull(persisted.pendingSignIn);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("join_accepts_a_link_of_the_hub_this_computer_uses", () =>
    Effect.gen(function* () {
      const me = { email: "cyril@freelance.example", joined: false };
      const signedOut = (hubUrl: string) =>
        JSON.stringify({
          hubUrl,
          email: null,
          pendingSignIn: null,
          workspaces: [],
          joinable: [],
          lastSyncAt: null,
          sharedInstances: {},
        });
      const { hub, core } = yield* started(me, signedOut);
      const { lines, io } = recorder();
      yield* PeerCoreJoin.join({ target: LINK(hub.url) }, io).pipe(Effect.provide(core));
      assert.strictEqual(lines[0], `Signed in: cyril@freelance.example at ${hub.url}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sign_in_remembers_a_hub_only_once_its_code_signs_in", () =>
    Effect.gen(function* () {
      const me = { email: "cyril@freelance.example", joined: false };
      const { hub, core } = yield* started(me);
      yield* Effect.gen(function* () {
        const client = yield* PeerHubClient.PeerHubClient;
        const state = yield* PeerState.PeerState;
        yield* client.startSignIn({ email: me.email, hubUrl: hub.url });
        const asked = (yield* state.read).persisted;
        assert.isNull(asked.hubUrl);
        assert.strictEqual(asked.pendingSignIn?.hubUrl, hub.url);
        yield* client.finishSignIn({ code: "424242" });
        const signedIn = (yield* state.read).persisted;
        assert.strictEqual(signedIn.hubUrl, hub.url);
        assert.strictEqual(signedIn.email, me.email);
      }).pipe(Effect.provide(core));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("join_refuses_when_another_address_is_signed_in", () =>
    Effect.gen(function* () {
      const me = { email: "ana@acme.test", joined: false };
      const { hub, core } = yield* started(me, signedInSeed, "phs_ana");
      const { lines, io } = recorder();
      const result = yield* PeerCoreJoin.join({ target: LINK(hub.url) }, io).pipe(
        Effect.provide(core),
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.include(String(result.failure.message), "signed in as ana@acme.test");
      assert.deepStrictEqual(lines, []);
      assert.deepStrictEqual(paths(hub.calls), []);
      // Nobody was signed out.
      assert.strictEqual(
        (yield* PeerState.PeerState.pipe(
          Effect.flatMap((state) => state.read),
          Effect.provide(core),
        )).persisted.email,
        "ana@acme.test",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("join_with_a_slug_is_unchanged", () =>
    Effect.gen(function* () {
      const me = { email: "ana@acme.test", joined: false };
      const { hub, core } = yield* started(me, signedInSeed, "phs_ana");
      const { lines, io } = recorder();
      yield* PeerCoreJoin.join({ target: "example" }, io).pipe(Effect.provide(core));
      assert.strictEqual(lines[0], "Joined: example (Example) as member.");
      assert.notInclude(paths(hub.calls), "POST /v1/auth/email/start");
      assert.include(paths(hub.calls), "POST /v1/workspaces/example/join");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("join_with_editor_claude_installs_hooks", () =>
    Effect.gen(function* () {
      const me = { email: "cyril@freelance.example", joined: false };
      const { hub, core } = yield* started(me);
      const { lines, io } = recorder();
      const asked: Array<unknown> = [];
      const editors = Layer.mergeAll(
        Layer.mock(PeerAdapters.PeerAdapters)({
          setCoordination: (input) =>
            Effect.sync(() => {
              asked.push(input);
              return { coordination: { ...coordination, claudeHooks: true } } as never;
            }),
        }),
        Layer.mock(McpConnect.McpClients)({}),
      );
      const joined = yield* PeerCoreJoin.joinAndConnect(
        { target: LINK(hub.url), hub: hub.url },
        {
          editor: "claude",
          interactive: true,
          choose: () => Effect.die(new Error("asked which editor")),
          detected: Effect.succeed(["claude"]),
          stateDir: "/nowhere",
        },
        io,
      ).pipe(Effect.provide(editors), Effect.provide(core));
      assert.strictEqual(joined.editor, "claude");
      assert.deepStrictEqual(asked, [{ claudeHooks: true }]);
      assert.isTrue(lines.some((line) => line.startsWith("Claude Code: hooks installed in ")));
      assert.isFalse(lines.some((line) => line.includes("peer core connect <client>")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("join_without_a_tty_prints_the_next_commands", () =>
    Effect.gen(function* () {
      const me = { email: "cyril@freelance.example", joined: false };
      const { hub, core } = yield* started(me);
      const { lines, io } = recorder();
      const joined = yield* PeerCoreJoin.joinAndConnect(
        { target: LINK(hub.url), hub: hub.url },
        {
          interactive: false,
          choose: () => Effect.die(new Error("asked which editor")),
          detected: Effect.die(new Error("looked for editors")),
          stateDir: "/nowhere",
        },
        io,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(PeerAdapters.PeerAdapters)({}),
            Layer.mock(McpConnect.McpClients)({}),
          ),
        ),
        Effect.provide(core),
      );
      assert.isNull(joined.editor);
      assert.deepStrictEqual(lines.slice(-3), [
        "Next: git clone --branch main https://github.com/example/webshop.git",
        "Peer binds the clone to its project by its remote the first time it is used.",
        "Next: connect your editor: peer core hooks install (Claude Code; --codex for Codex), or peer core connect <client>.",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("join offers the editors found here first, then the others, then none", () => {
    const choices = PeerCoreJoin.editorChoices(["codex"]).map((choice) => choice.value);
    assert.strictEqual(choices[0], "codex");
    assert.strictEqual(choices[1], "claude");
    assert.strictEqual(choices.at(-1), null);
    assert.strictEqual(choices.filter((value) => value === "codex").length, 1);
    // With nothing found, every editor is still offered.
    assert.isAbove(PeerCoreJoin.editorChoices([]).length, 2);
  });

  it("join refuses an editor it cannot connect before joining", () => {
    const refused = PeerCoreJoin.checkEditor("notepad");
    assert.isDefined(refused);
    assert.include(String(refused?.message), "--editor notepad is not one of: claude, codex,");
    assert.isUndefined(PeerCoreJoin.checkEditor("zed"));
  });
});

describe("peer core bind", () => {
  it.effect("bind_records_the_checkout", () =>
    Effect.gen(function* () {
      const dir = yield* seedState();
      const root = yield* Effect.promise(async () => {
        const made = NodePath.join(await NodeFSP.realpath(dir), "work", "api");
        await NodeFSP.mkdir(made, { recursive: true });
        NodeChildProcess.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: made });
        NodeChildProcess.execFileSync(
          "git",
          ["remote", "add", "origin", "git@github.com:acme/api.git"],
          { cwd: made },
        );
        return made;
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(paymentsSeed("http://127.0.0.1:9")), { session: "phs_ana" }),
      );
      const { lines, io } = recorder();
      yield* PeerCoreBind.bind({ folder: root, project: "acme/pay" }, io).pipe(
        Effect.provide(core),
      );
      assert.deepStrictEqual(lines, [`Bound ${root} to acme/pay.`]);
      const state = yield* PeerState.PeerState.pipe(Effect.provide(core));
      assert.strictEqual((yield* state.read).persisted.localCheckouts?.["acme/pay/api"], root);
      assert.strictEqual((yield* state.placeOf(root))?.project, "pay");

      // Status lists the bound clone beside the folders share recorded, and binds nothing.
      const shown = recorder();
      yield* PeerCoreBind.sayCheckouts([NodePath.dirname(root)], shown.io).pipe(
        Effect.provide(core),
      );
      assert.deepStrictEqual(shown.lines, [
        `Folder: ${NodePath.dirname(root)} (not shared)`,
        `Folder: ${root} (bound: acme/pay)`,
      ]);
      assert.isNull(yield* state.pendingBindingNotice(root));

      // Not a project of the person's, a folder that is no repository, an origin of no repository.
      for (const [input, words] of [
        [{ folder: root, project: "acme/site" }, 'Acme gives you no project "site".'],
        [
          { folder: NodePath.dirname(root), project: "acme/pay" },
          "is not a Git or Jujutsu repository",
        ],
        [{ folder: root, project: "acme/pay", repository: "web" }, "has no repository web"],
        [{ folder: root, project: "acme" }, "--project takes <workspace>/<project>"],
      ] as const) {
        const refused = yield* PeerCoreBind.bind(input, io).pipe(
          Effect.provide(core),
          Effect.result,
        );
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused)) assert.include(String(refused.failure.message), words);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("peer core tasks and take", () => {
  const where = { project: "example/webshop", cwd: "/", canWrite: true } as const;

  it.effect("tasks_lists_the_invited_task_first", () =>
    Effect.gen(function* () {
      const { core } = yield* joinedCyril();
      const { lines, io } = recorder();
      yield* PeerCoreTasks.listTasks({ ...where, filter: "all" }, io).pipe(Effect.provide(core));
      assert.deepStrictEqual(lines, [
        "VL7 · Split payments · review · Checkout · nobody",
        "VL6 · Cart totals · open · Checkout · nobody",
        "VL8 · Refunds · open · no area · bob@example.com",
      ]);
      const open = recorder();
      yield* PeerCoreTasks.listTasks({ ...where, filter: "open" }, open.io).pipe(
        Effect.provide(core),
      );
      assert.deepStrictEqual(
        open.lines.map((line) => line.split(" · ")[0]),
        ["VL7", "VL6"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("take_owns_an_unowned_task", () =>
    Effect.gen(function* () {
      const { hub, core } = yield* joinedCyril();
      const { lines, io } = recorder();
      yield* PeerCoreTasks.takeTask({ ...where, task: "VL7" }, io).pipe(Effect.provide(core));
      assert.deepStrictEqual(lines, ["You own VL7 · Split payments now (example/webshop)."]);
      const put = hub.calls.find((call) => call.url?.endsWith("/owner") === true);
      assert.strictEqual(put?.url, "/v1/workspaces/example/projects/webshop/tasks/vl7/owner");
      assert.deepStrictEqual(JSON.parse(put?.body ?? "null"), { owner: "cyril@freelance.example" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("take_refuses_naming_the_owner", () =>
    Effect.gen(function* () {
      const { hub, core } = yield* joinedCyril();
      const result = yield* PeerCoreTasks.takeTask({ ...where, task: "VL8" }, recorder().io).pipe(
        Effect.provide(core),
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.include(
          String(result.failure.message),
          "peer core: refused: VL8 is owned by Bob (bob@example.com).",
        );
        assert.strictEqual(Runtime.getErrorExitCode(result.failure), 3);
      }
      assert.isFalse(hub.calls.some((call) => call.url?.endsWith("/owner") === true));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("take_against_an_older_hub_is_refused_with_its_words", () =>
    Effect.gen(function* () {
      const { core } = yield* joinedCyril(true);
      const result = yield* PeerCoreTasks.takeTask({ ...where, task: "VL7" }, recorder().io).pipe(
        Effect.provide(core),
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.include(
          String(result.failure.message),
          "peer core: refused: only a lead of the project, an admin or the task's owner changes its owner.",
        );
        assert.strictEqual(Runtime.getErrorExitCode(result.failure), 3);
      }
      // Without the ownership view, owners are unknown rather than nobody.
      const { lines, io } = recorder();
      yield* PeerCoreTasks.listTasks({ ...where, filter: "all" }, io).pipe(Effect.provide(core));
      assert.strictEqual(lines[0], "VL7 · Split payments · review · Checkout · owner unknown");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("peer core share", () => {
  /** Ana's acme core and a clone of acme/pay's repository under `dir`, with a subfolder. */
  const payClone = Effect.gen(function* () {
    const dir = yield* seedState();
    const root = yield* Effect.promise(async () => {
      const made = NodePath.join(await NodeFSP.realpath(dir), "work", "api");
      await NodeFSP.mkdir(NodePath.join(made, "src"), { recursive: true });
      NodeChildProcess.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: made });
      NodeChildProcess.execFileSync(
        "git",
        ["remote", "add", "origin", "git@github.com:acme/api.git"],
        { cwd: made },
      );
      return made;
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed("http://127.0.0.1:9")), { session: "phs_ana" }),
    );
    return { root, core };
  });

  /** A terminal that answers with `answers`, recording what it was asked. */
  const terminal = (answers: { confirm?: boolean; pick?: number | null }) => {
    const asked: Array<string> = [];
    const ask: PeerCoreShare.ShareAsk = {
      interactive: true,
      confirm: (message) => Effect.sync(() => (asked.push(message), answers.confirm ?? false)),
      choose: (message, choices) =>
        Effect.sync(() => {
          asked.push(`${message}: ${choices.map((choice) => choice.title).join(" | ")}`);
          return answers.pick === null ? null : (choices[answers.pick ?? 0]?.value ?? null);
        }),
    };
    return { asked, ask };
  };
  const noTerminal: PeerCoreShare.ShareAsk = {
    interactive: false,
    confirm: () => Effect.die(new Error("asked without a terminal")),
    choose: () => Effect.die(new Error("asked without a terminal")),
  };
  const noRegister = () => Effect.die(new Error("registered a folder"));

  it.effect("share_offers_a_clone_of_a_project_as_its_checkout", () =>
    Effect.gen(function* () {
      const { root, core } = yield* payClone;
      // From a subfolder, the repository is what is shared.
      const resolved = yield* PeerCoreShare.shareFolder(undefined, NodePath.join(root, "src"));
      assert.deepStrictEqual(resolved, { folder: root, named: false });

      // Without a terminal, only --yes or --project binds it.
      const headless = yield* PeerCoreShare.share(
        { ...resolved, yes: false },
        noTerminal,
        recorder().io,
        noRegister,
      ).pipe(Effect.provide(core), Effect.result);
      assert.isTrue(Result.isFailure(headless));
      if (Result.isFailure(headless)) {
        assert.include(String(headless.failure.message), `${root} is a clone of acme/pay`);
        assert.include(String(headless.failure.message), "peer core share --yes");
      }
      const state = yield* PeerState.PeerState.pipe(Effect.provide(core));
      assert.isUndefined((yield* state.read).persisted.localCheckouts);

      // Declined on a terminal: nothing changes.
      const declined = terminal({ pick: null });
      const quiet = recorder();
      yield* PeerCoreShare.share(
        { ...resolved, yes: false },
        declined.ask,
        quiet.io,
        noRegister,
      ).pipe(Effect.provide(core));
      assert.deepStrictEqual(declined.asked, ["Use it as: the checkout of acme/pay"]);
      assert.deepStrictEqual(quiet.lines, [`${root} is a clone of acme/pay.`, "Nothing changed."]);
      assert.isUndefined((yield* state.read).persisted.localCheckouts);

      const chosen = terminal({ pick: 0 });
      const { lines, io } = recorder();
      yield* PeerCoreShare.share({ ...resolved, yes: false }, chosen.ask, io, noRegister).pipe(
        Effect.provide(core),
      );
      assert.deepStrictEqual(lines, [
        `${root} is a clone of acme/pay.`,
        `Bound ${root} to acme/pay.`,
      ]);
      assert.strictEqual((yield* state.read).persisted.localCheckouts?.["acme/pay/api"], root);

      const again = recorder();
      yield* PeerCoreShare.share(
        { ...resolved, yes: false },
        noTerminal,
        again.io,
        noRegister,
      ).pipe(Effect.provide(core));
      assert.deepStrictEqual(again.lines, [`Shared already: ${root} is project pay of acme.`]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("share_confirms_a_new_project_and_refuses_too_broad_a_folder", () =>
    Effect.gen(function* () {
      const { root, core } = yield* payClone;
      const other = NodePath.join(NodePath.dirname(root), "site");
      yield* Effect.promise(() => NodeFSP.mkdir(other));

      for (const folder of [NodeOS.homedir(), NodePath.dirname(NodeOS.homedir()), "/"]) {
        const refused = yield* PeerCoreShare.shareFolder(folder, root).pipe(Effect.result);
        assert.isTrue(Result.isFailure(refused), folder);
      }

      const declined = terminal({ confirm: false });
      const { lines, io } = recorder();
      yield* PeerCoreShare.share(
        { folder: other, named: false, yes: false },
        declined.ask,
        io,
        noRegister,
      ).pipe(Effect.provide(core));
      assert.deepStrictEqual(declined.asked, [
        `Share ${other} with acme as project "site"? Everyone in acme sees it and can clone it.`,
      ]);
      assert.deepStrictEqual(lines, ["Nothing changed."]);

      for (const [input, words] of [
        [{ folder: other, named: false, yes: false }, "add --yes"],
        [{ folder: other, named: true, yes: false, workspace: "globex" }, "no workspace globex"],
        [
          { folder: root, named: true, yes: false, project: "acme/pay", workspace: "acme" },
          "--project uses an existing project",
        ],
      ] as const) {
        const refused = yield* PeerCoreShare.share(
          input,
          noTerminal,
          recorder().io,
          noRegister,
        ).pipe(Effect.provide(core), Effect.result);
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused)) assert.include(String(refused.failure.message), words);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("peer core create, invite and the menu", () => {
  const status = (over: Partial<PeerHubStatus>): PeerHubStatus =>
    ({
      hubUrl: "https://hub.test",
      signedIn: true,
      email: "ana@acme.test",
      pendingSignIn: null,
      workspaces: [],
      joinable: [],
      ...over,
    }) as unknown as PeerHubStatus;
  const workspace = (slug: string, role: string, projects: ReadonlyArray<string> = []) => ({
    slug,
    name: slug.toUpperCase(),
    role,
    projects: projects.map((id) => ({ project: { id } })),
  });

  it("the menu offers what waits first, then sharing, inviting where one may, and creating", () => {
    const items = PeerCoreMenu.menuItems(
      status({
        workspaces: [workspace("acme", "owner"), workspace("globex", "member")] as never,
        joinable: [
          { slug: "initech", name: "Initech", allowedDomains: [], reason: "invite" },
          { slug: "umbrella", name: "Umbrella", allowedDomains: [], reason: "domain" },
        ],
        foundings: [
          { slug: "hooli", name: "Hooli" },
          { slug: "old", name: "Old", expired: true },
        ],
      }),
      "/work/api",
    );
    assert.deepStrictEqual(
      items.map((item) => item.title),
      [
        "Accept Hooli (hooli), founded for you",
        "Accept the invitation to Initech (initech)",
        "Join Umbrella (umbrella), which your email domain admits",
        "Share /work/api with a workspace",
        "Share a project from this computer…",
        "Invite someone to ACME (acme)",
        "Create a workspace",
        "Join a workspace by its name",
        "Connect an editor",
        "Done",
      ],
    );
    // In no workspace yet: nothing to share with, nobody to invite.
    assert.deepStrictEqual(
      PeerCoreMenu.menuItems(status({}), "/work/api").map((item) => item.value.kind),
      ["create", "join", "editor", "done"],
    );
  });

  it.effect("share from this computer offers the repositories in the usual folders", () =>
    Effect.gen(function* () {
      const made = yield* seedState();
      const home = yield* Effect.promise(() => NodeFSP.realpath(made));
      const found = yield* Effect.promise(async () => {
        const repo = async (path: string, touched: number) => {
          const dir = NodePath.join(home, path);
          await NodeFSP.mkdir(NodePath.join(dir, ".git"), { recursive: true });
          await NodeFSP.utimes(NodePath.join(dir, ".git"), touched, touched);
        };
        await repo("code/api", 1000);
        await repo(".superset/projects/formbricks", 3000);
        await repo("projects/team/site", 2000);
        // Too deep, inside a dependency, and outside the usual folders.
        await repo("code/a/b/c/deep", 4000);
        await repo("code/node_modules/dep", 4000);
        await repo("Music/song", 4000);
        return PeerCoreMenu.findRepositories(home);
      });
      assert.deepStrictEqual(
        found.map((dir) => NodePath.relative(home, dir)),
        [".superset/projects/formbricks", "projects/team/site", "code/api"],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("the menu asks until done, and a refused step does not end it", () =>
    Effect.gen(function* () {
      const answers: Array<string> = ["create", "invite", "browse", "type", "done"];
      const done: Array<string> = [];
      const ask: PeerCoreMenu.MenuAsk = {
        choose: (_message, choices) =>
          Effect.sync(() => {
            const kind = answers.shift();
            return (
              choices.find(
                (c) => c.value === kind || (c.value as PeerCoreMenu.MenuItem | null)?.kind === kind,
              )?.value ?? null
            );
          }),
        text: (message) =>
          Effect.succeed(
            message.startsWith("Whom")
              ? "bob@acme.test"
              : message.includes("path")
                ? "~/code/site"
                : "Team",
          ),
        folder: () => Effect.die(new Error("browsed")),
        pick: (_message, choices) => Effect.succeed(choices.slice(0, 1)),
      };
      const { lines, io } = recorder();
      yield* PeerCoreMenu.menu(
        ask,
        {
          status: Effect.succeed(
            status({ workspaces: [workspace("acme", "owner", ["pay", "web"])] as never }),
          ),
          shareable: Effect.succeed(null),
          repositories: Effect.succeed(["/home/ana/code/api"]),
          join: () => Effect.void,
          founding: () => Effect.void,
          create: (name) => Effect.sync(() => void done.push(`create ${name}`)),
          share: (folder) => Effect.sync(() => void done.push(`share ${folder}`)),
          invite: (input) =>
            Effect.sync(
              () => void done.push(`invite ${input.email} ${input.projects?.join(",")}`),
            ).pipe(Effect.andThen(Effect.fail(fail("peer core: refused: the Hub said no.")))),
          editor: Effect.void,
        },
        io,
      );
      assert.deepStrictEqual(done, [
        "create Team",
        "invite bob@acme.test pay",
        "share ~/code/site",
      ]);
      assert.deepStrictEqual(lines, ["refused: the Hub said no."]);
      assert.deepStrictEqual(answers, []);
    }),
  );

  it.effect("create_and_invite_ask_the_hub_as_the_signed_in_person", () =>
    Effect.gen(function* () {
      const answer: HubAnswer = (url, method) => {
        const path = url.split("?")[0] ?? url;
        if (path === "/v1/workspaces" && method === "POST")
          return [200, { slug: "team-one", name: "Team One", allowedDomains: [] }];
        if (path === "/v1/workspaces/acme/invites" && method === "POST")
          return [200, { delivery: { state: "sent" } }];
        if (path === "/v1/me") return [200, meAnswer()];
        return [200, {}];
      };
      const hub = yield* standInHub({ current: answer });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "phs_ana" }),
      );
      yield* Effect.gen(function* () {
        yield* (yield* PeerStatus.PeerStatus).coordinationFrom(() => Effect.succeed(coordination));
        yield* PeerPlugins.startPlugins;
      }).pipe(Effect.provide(core));
      const { lines, io } = recorder();
      yield* PeerCoreMenu.create({ name: "Team One" }, io).pipe(Effect.provide(core));
      const created = hub.calls.find((call) => call.url === "/v1/workspaces");
      assert.deepStrictEqual(JSON.parse(created?.body ?? "{}"), {
        slug: "team-one",
        name: "Team One",
        allowedDomains: [],
      });
      assert.strictEqual(lines[0], "Created: team-one (Team One). You are its owner.");

      const owner = status({ workspaces: [workspace("acme", "owner")] as never });
      const invited = recorder();
      yield* PeerCoreMenu.invite(
        { email: " Bob@Acme.test ", projects: ["pay"] },
        owner,
        invited.io,
      ).pipe(Effect.provide(core));
      const call = hub.calls.find((c) => c.url === "/v1/workspaces/acme/invites");
      assert.deepStrictEqual(JSON.parse(call?.body ?? "{}"), {
        email: "bob@acme.test",
        role: "member",
        projects: ["pay"],
      });
      assert.strictEqual(invited.lines[0], "Invited: bob@acme.test to acme (projects pay).");

      for (const [input, over, words] of [
        [
          { email: "bob@acme.test" },
          status({ workspaces: [workspace("acme", "member")] as never }),
          "own or administer no workspace",
        ],
        [
          { email: "bob@acme.test" },
          status({ workspaces: [workspace("a", "owner"), workspace("b", "admin")] as never }),
          "--workspace",
        ],
        [{ email: "bob" }, owner, "is no email address"],
      ] as const) {
        const refused = yield* PeerCoreMenu.invite(input, over, recorder().io).pipe(
          Effect.provide(core),
          Effect.result,
        );
        assert.isTrue(Result.isFailure(refused));
        if (Result.isFailure(refused)) assert.include(String(refused.failure.message), words);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
