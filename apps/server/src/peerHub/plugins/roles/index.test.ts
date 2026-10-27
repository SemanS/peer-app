// @effect-diagnostics nodeBuiltinImport:off - the edited file is in the broker's temporary checkout.
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { CliError, render } from "../../core/plugin.ts";
import { acmeHub, acmeHubOf, BOB, brokerOver, NOW, rolesPeer } from "./fixtures.test.ts";
import { RolesPlugin } from "./index.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const stateOf = (peer: Effect.Success<ReturnType<typeof rolesPeer>>) =>
  peer.plugins.states.pipe(Effect.map((states) => states.find(({ id }) => id === "roles")));

describe("the roles plugin", () => {
  it("is defined as its Settings row says, and needs the Hub's roles feature", () => {
    assert.strictEqual(RolesPlugin.id, "roles");
    assert.strictEqual(RolesPlugin.title, "Review sessions");
    assert.isTrue(RolesPlugin.defaultEnabled);
    assert.deepStrictEqual(RolesPlugin.hubFeature, { id: "roles", revision: 1 });
    assert.deepStrictEqual(RolesPlugin.commandNames, ["role"]);
  });

  it.effect(
    "is active where the Hub serves roles, and inactive with the reason where it does not",
    () =>
      run(
        Effect.gen(function* () {
          const current = acmeHubOf();
          const server = yield* acmeHub(current);
          const peer = yield* rolesPeer(server);
          assert.isTrue(yield* peer.plugins.isActive("roles"));

          current.features = { ownership: 1 };
          yield* peer.client.me;
          assert.deepStrictEqual(yield* stateOf(peer), {
            id: "roles",
            title: "Review sessions",
            enabled: true,
            active: false,
            reason: "hub",
          });
        }),
      ),
  );

  it.effect("turned off, refuses peer role in one line and denies nothing for a role", () =>
    run(
      Effect.gen(function* () {
        const current = {
          ...acmeHubOf(),
          rows: [
            {
              session: "claude:one",
              role: "review",
              email: BOB,
              environment: "ana-laptop",
              setBy: "person",
              at: NOW,
            },
          ],
        };
        const server = yield* acmeHub(current);
        const peer = yield* rolesPeer(server);
        yield* peer.plugins.setPlugin({ id: "roles", enabled: false });
        const fixture = yield* brokerOver(peer);
        yield* Effect.promise(() => fixture.register("one"));
        const printed = yield* Effect.promise(() =>
          fixture.broker["runCli"]("role", ["review"], {
            "x-peer-cwd": fixture.root,
            "x-peer-session": "claude:one",
          }).then(
            () => "done",
            (error: unknown) => (error instanceof CliError ? render(error) : String(error)),
          ),
        );
        assert.strictEqual(
          printed.split("\n")[0],
          "peer: refused: role is turned off on this environment.",
        );
        const out = (yield* Effect.promise(() =>
          fixture.broker["hook"](
            {
              hook_event_name: "PreToolUse",
              session_id: "one",
              cwd: fixture.root,
              tool_name: "Write",
              tool_input: { file_path: NodePath.join(fixture.root, "src/order.js"), content: "" },
            },
            { "x-peer-agent": "claude" },
          ),
        )) as { hookSpecificOutput?: { permissionDecision?: string } } | null;
        assert.notStrictEqual(out?.hookSpecificOutput?.permissionDecision, "deny");
        assert.isFalse(current.rows.length === 0);
      }),
    ),
  );
});
