// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - an edit in the broker's checkout, and the bodies the Hub was sent.
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CliError, render } from "../../core/plugin.ts";
import { RunBook } from "../../core/work/runs.ts";
import { roleTools } from "./client/transport.ts";
import { acmeHubOf, logged, ready, ROLES } from "./fixtures.test.ts";
import { tookText } from "./text.ts";

type Ready = Effect.Success<ReturnType<typeof ready>>;

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

/** `peer role` with `args`, run by Bob's agent `one`: what it printed, or the refusal it ended with. */
const role = (peer: Ready, args: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    await peer.fixture.register("one");
    try {
      return {
        printed: await peer.fixture.broker["runCli"]("role", args, {
          "x-peer-cwd": peer.fixture.root,
          "x-peer-session": "claude:one",
        }),
      };
    } catch (error) {
      if (error instanceof CliError) return { error, printed: render(error) };
      throw error;
    }
  });
const puts = (peer: Ready) =>
  peer.server.calls.filter((call) => call.method === "PUT" && call.url?.startsWith(ROLES));

describe("peer role", () => {
  it.effect.each([2, 1])(
    "names the session's run with the role where roles revision %s takes one",
    (revision) =>
      run(
        Effect.gen(function* () {
          const runs = new RunBook(
            {},
            {
              environment: "ana-laptop",
              email: () => "bob@acme.test",
              now: () => Date.parse("2026-10-30T10:00:00Z"),
              save: async () => undefined,
            },
          );
          const peer = yield* ready({ ...acmeHubOf(), features: { roles: revision } }, () => ({
            runs,
            taskOf: () => "t-1",
          }));
          yield* role(peer, ["review"]);
          const sent = JSON.parse(puts(peer)[0]!.body) as { run?: string };
          const session = peer.fixture.broker.sessions.get("claude:one");
          assert.isDefined(session?.run);
          assert.strictEqual(sent.run, revision >= 2 ? session?.run : undefined);
        }),
      ),
  );
  it.effect("makes a fresh session a review session, on the Hub and in its deny", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready();
        assert.include((yield* role(peer, [])).printed, "has no role");
        const took = yield* role(peer, ["review"]);
        assert.strictEqual(took.printed, tookText);
        assert.deepStrictEqual(JSON.parse(puts(peer)[0]!.body), {
          role: "review",
          environment: "ana-laptop",
          setBy: "agent",
        });
        assert.deepStrictEqual(
          peer.current.rows.map((row) => row.session),
          ["claude:one"],
        );
        assert.include((yield* role(peer, [])).printed, "This session reviews");
        const out = (yield* Effect.promise(() =>
          peer.fixture.broker["hook"](
            {
              hook_event_name: "PreToolUse",
              session_id: "one",
              cwd: peer.fixture.root,
              tool_name: "Edit",
              tool_input: {
                file_path: NodePath.join(peer.fixture.root, "src/order.js"),
                old_string: "a",
                new_string: "b",
              },
            },
            { "x-peer-agent": "claude" },
          ),
        )) as { hookSpecificOutput?: { permissionDecision?: string } } | null;
        assert.strictEqual(out?.hookSpecificOutput?.permissionDecision, "deny");
        const log = yield* Effect.promise(() => logged(peer.fixture));
        assert.deepStrictEqual(
          log.filter((line) => line.event === "roles.set").map((line) => line.outcome),
          ["done"],
        );
      }),
    ),
  );

  it.effect("refuses a session that already changed a file, naming it", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready();
        yield* Effect.promise(() => peer.fixture.register("one"));
        peer.fixture.broker["sessions"].get("claude:one")!.files = ["src/order.js"];
        const refused = yield* role(peer, ["review"]);
        assert.strictEqual(refused.error?.outcome, "refused");
        assert.include(refused.printed, "src/order.js");
        assert.include(refused.printed, "start a new session for the review");
        assert.deepStrictEqual(puts(peer), []);
      }),
    ),
  );

  it.effect("refuses to drop the role, naming the person who can", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready();
        yield* role(peer, ["review"]);
        const refused = yield* role(peer, ["none"]);
        assert.strictEqual(refused.error?.outcome, "refused");
        assert.include(refused.printed, "ask Bob to clear it in Peer");
        assert.include((yield* role(peer, [])).printed, "This session reviews");
      }),
    ),
  );

  it.effect("ends uncertain when the Hub does not answer, and denies meanwhile", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready();
        peer.current.route = (method) =>
          method === "PUT"
            ? [503, { error: { code: "unavailable", message: "Down." } }]
            : undefined;
        const late = yield* role(peer, ["review"]);
        assert.strictEqual(late.error?.outcome, "uncertain");
        assert.include((yield* role(peer, [])).printed, "This session reviews");
      }),
    ),
  );

  it.effect("is refused by the Hub for a session that is not clean there, and leaves no role", () =>
    run(
      Effect.gen(function* () {
        const peer = yield* ready();
        peer.current.route = (method) =>
          method === "PUT"
            ? [409, { error: { code: "session_not_clean", message: "The session changed files." } }]
            : undefined;
        const refused = yield* role(peer, ["review"]);
        assert.strictEqual(refused.error?.outcome, "refused");
        assert.include((yield* role(peer, [])).printed, "has no role");
      }),
    ),
  );

  it("reaches agents without a shell as peer_role", () => {
    const tool = roleTools[0]!;
    assert.deepStrictEqual(tool.arguments({}), []);
    assert.deepStrictEqual(tool.arguments({ action: "review" }), ["review"]);
    assert.throws(() => tool.arguments({ action: "none" }));
  });
});
