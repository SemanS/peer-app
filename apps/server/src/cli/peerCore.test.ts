// @effect-diagnostics nodeBuiltinImport:off - clones and peer-hub.json in temporary directories.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as PeerAdapters from "../peerHub/core/coordination/PeerAdapters.ts";
import * as PeerPlugins from "../peerHub/core/plugins/PeerPlugins.ts";
import * as PeerState from "../peerHub/core/state/PeerState.ts";
import * as PeerStatus from "../peerHub/core/status/PeerStatus.ts";
import {
  coreLayer,
  type HubAnswer,
  type HubCall,
  seedState,
  signedInSeed,
  standInHub,
} from "../peerHub/core/testkit.ts";
import * as McpConnect from "../peerHub/plugins/mcp/connect.ts";
import * as PeerCoreJoin from "./peerCoreJoin.ts";
import type { OneShotIo } from "./peerCoreIo.ts";

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
  (me: { email: string; joined: boolean }): HubAnswer =>
  (url) => {
    const path = url.split("?")[0] ?? url;
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
      const joined = yield* PeerCoreJoin.join({ target: LINK(hub.url) }, io).pipe(
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
        { target: LINK(hub.url) },
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
        { target: LINK(hub.url) },
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

  it("join refuses an editor it cannot connect before joining", () => {
    const refused = PeerCoreJoin.checkEditor("notepad");
    assert.isDefined(refused);
    assert.include(String(refused?.message), "--editor notepad is not one of: claude, codex,");
    assert.isUndefined(PeerCoreJoin.checkEditor("zed"));
  });
});
