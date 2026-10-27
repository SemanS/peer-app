import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_ROLES_METHODS, type PeerRoleRow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PeerSessionView, PeerToolContext } from "../../core/plugin.ts";
import { acmeHubOf, BOB, NOW, ready, rolesWhen } from "./fixtures.test.ts";
import type { Roles } from "./Roles.ts";
import { tellings, type StillChanged } from "./tell.ts";
import { changedText, startBlock } from "./text.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const ORDER = "src/order.js";
const reviewRow: PeerRoleRow = {
  session: "claude:one",
  role: "review",
  email: BOB,
  environment: "ana-laptop",
  setBy: "person",
  at: NOW,
};
const rowOf = (roles: Parameters<Parameters<typeof rolesWhen>[1]>[0]) =>
  roles?.projects.find((p) => p.project === "app")?.roles.find((r) => r.session === "claude:one");

type Fixture = Effect.Success<ReturnType<typeof ready>>["fixture"];
const context = (out: unknown) =>
  (out as { hookSpecificOutput?: { additionalContext?: string } } | null)?.hookSpecificOutput
    ?.additionalContext ?? "";
const shellDone = (fixture: Fixture, command: string) =>
  Effect.promise(async () =>
    context(
      await fixture.broker["hook"](
        {
          hook_event_name: "PostToolUse",
          session_id: "one",
          cwd: fixture.root,
          tool_name: "Bash",
          tool_input: { command },
          tool_response: { stdout: "" },
        },
        { "x-peer-agent": "claude" },
      ),
    ),
  );

describe("a review session's shell changes", () => {
  it.effect("are told once at the next step, and the Team page's row is marked", () =>
    run(
      Effect.gen(function* () {
        const status = { porcelain: "" };
        const peer = yield* ready({ ...acmeHubOf(), rows: [reviewRow] }, () => ({
          gitStatus: async () => status.porcelain,
        }));
        yield* Effect.promise(() => peer.fixture.register("one"));
        // The first look at git only learns what was there before the agent.
        yield* shellDone(peer.fixture, "git status");
        status.porcelain = ` M ${ORDER}\0`;
        assert.include(
          yield* shellDone(peer.fixture, `sed -i s/a/b/ ${ORDER}`),
          changedText([ORDER]),
        );
        assert.notInclude(yield* shellDone(peer.fixture, "npm test"), ORDER);
        yield* rolesWhen(peer.peer.status, (roles) => rowOf(roles)?.changedFiles === true);
        assert.isTrue(
          peer.server.calls.some(
            (call) => call.method === "PATCH" && call.body === JSON.stringify({ changed: true }),
          ),
        );
      }),
    ),
  );
});

/** Roles as the telling sees them: a review session, its marks recorded. */
const fakeRoles = (marks: Array<boolean>, role: string | null = "review") =>
  ({
    roleOf: () => role ?? undefined,
    started: () => Effect.void,
    markChanged: (_session: PeerSessionView, changed: boolean) =>
      Effect.sync(() => void marks.push(changed)),
  }) as unknown as Roles["Service"];
const agents = { log: () => Effect.void } as never;

/** A session view with its own plugin state and told set. */
const sessionOf = () => {
  const local = new Map<string, unknown>();
  const told = new Set<string>();
  return {
    id: "claude:one",
    root: "/repo",
    local: <S>(plugin: string, init: () => S) => {
      if (!local.has(plugin)) local.set(plugin, init());
      return local.get(plugin) as S;
    },
    told: () => told,
  } as unknown as PeerSessionView;
};
const bash = (session: PeerSessionView, paths: ReadonlyArray<string>) =>
  ({ session, tool: "Bash", paths, event: "post-tool", remainingMs: 1000 }) as PeerToolContext;

describe("the telling", () => {
  it.effect("drops the mark when the session reverts, and says nothing more", () =>
    Effect.gen(function* () {
      const marks: Array<boolean> = [];
      const git = { changed: [ORDER] };
      const still: StillChanged = () => Effect.succeed(git.changed);
      const tell = tellings(fakeRoles(marks), agents, still);
      const session = sessionOf();
      assert.strictEqual(yield* tell.postTool(bash(session, [ORDER])), changedText([ORDER]));
      git.changed = [];
      assert.isNull(yield* tell.postTool(bash(session, [ORDER])));
      assert.isNull(yield* tell.postTool(bash(session, [])));
      assert.deepStrictEqual(marks, [true, false]);
    }),
  );

  it.effect("repeats the role after a compaction, and no change it already told", () =>
    Effect.gen(function* () {
      const tell = tellings(fakeRoles([]), agents, () => Effect.succeed([ORDER]));
      const session = sessionOf();
      yield* tell.postTool(bash(session, [ORDER]));
      const ctx = {
        session,
        event: "session-start",
        source: "compact",
        remainingMs: 1000,
      } as const;
      assert.strictEqual(yield* tell.start(ctx), startBlock());
      assert.isNull(yield* tell.postTool(bash(session, [])));
    }),
  );

  it.effect("says nothing to a session without the role", () =>
    Effect.gen(function* () {
      const tell = tellings(fakeRoles([], null), agents, () => Effect.succeed([ORDER]));
      assert.isNull(yield* tell.postTool(bash(sessionOf(), [ORDER])));
    }),
  );
});

describe("a thread started as a review", () => {
  it.effect("gives its session the role when it starts, on the Hub too", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready(acmeHubOf(), () => ({ threadOf: async () => "peer:t1" }));
        const set = yield* peer.rpc[PEER_ROLES_METHODS.peerRolesSet]({
          workspace: "acme",
          project: "app",
          role: "review",
          thread: "peer:t1",
        });
        assert.deepStrictEqual(set.roles, []);
        const started = yield* Effect.promise(() =>
          peer.fixture.broker["hook"](
            {
              hook_event_name: "SessionStart",
              session_id: "one",
              cwd: peer.fixture.root,
              source: "startup",
            },
            { "x-peer-agent": "claude" },
          ),
        );
        assert.include(context(started), startBlock());
        const row = rowOf(
          yield* rolesWhen(peer.peer.status, (roles) => rowOf(roles) !== undefined),
        );
        assert.strictEqual(row?.setBy, "person");

        // Its person clears it: the row goes and the next edit is any session's.
        const cleared = yield* peer.rpc[PEER_ROLES_METHODS.peerRolesClear]({
          workspace: "acme",
          project: "app",
          thread: "peer:t1",
        });
        assert.deepStrictEqual(cleared.roles, []);
        assert.deepStrictEqual(peer.current.rows, []);
      }),
    ),
  );
});
