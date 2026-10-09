import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import { bindPlugin } from "./plugin.ts";
import { CORE_COMMANDS, peerPlugins, validatePlugins } from "./registry.ts";
import { coreLayer, seedState } from "./testkit.ts";

describe("the plugin registry", () => {
  it("holds plugins whose ids and commands do not collide", () => {
    assert.deepStrictEqual(validatePlugins(peerPlugins()), []);
    assert.deepStrictEqual(
      validatePlugins([
        { id: "requests", commands: [{ name: "request" }] },
        { id: "find", commands: [{ name: "find" }] },
        { id: "two-words", commands: [] },
      ]),
      [],
    );
  });

  it("refuses an id that is not kebab-case", () => {
    for (const id of ["Requests", "team_requests", "1st", "-find", ""]) {
      assert.deepStrictEqual(validatePlugins([{ id }]), [
        `Plugin id "${id}" is not kebab-case ([a-z][a-z0-9-]*).`,
      ]);
    }
  });

  it("refuses a command name the peer shim cannot pass on", () => {
    for (const name of ["Deploy", "ship it", "go;rm", "-x"]) {
      assert.deepStrictEqual(validatePlugins([{ id: "ship", commands: [{ name }] }]), [
        `Command "${name}" of plugin "ship" is not kebab-case.`,
      ]);
    }
  });

  it("refuses a plugin listed twice", () => {
    assert.deepStrictEqual(validatePlugins([{ id: "find" }, { id: "ask" }, { id: "find" }]), [
      'Plugin "find" is listed twice.',
    ]);
  });

  it("refuses a command another plugin or core already has", () => {
    assert.deepStrictEqual(
      validatePlugins([
        { id: "find", commands: [{ name: "find" }] },
        { id: "search", commands: [{ name: "find" }, { name: "status" }] },
      ]),
      [
        'Command "find" of plugin "search" is already find\'s.',
        'Command "status" of plugin "search" is already core\'s.',
      ],
    );
    for (const name of CORE_COMMANDS) {
      assert.strictEqual(validatePlugins([{ id: "x", commands: [{ name }] }]).length, 1);
    }
  });
});

class Greeting extends Context.Service<Greeting, { readonly text: string }>()(
  "t3/peerHub/core/registry.test/Greeting",
) {}

describe("a bound plugin", () => {
  it.effect("builds its services in the caller's scope and hands them to its contributions", () =>
    Effect.gen(function* () {
      const released = yield* Ref.make(false);
      const entry = bindPlugin({
        id: "find",
        title: "Find",
        summary: "A model looks for what bears on a change.",
        defaultEnabled: true,
        layer: Layer.effect(
          Greeting,
          Effect.acquireRelease(Effect.succeed(Greeting.of({ text: "hello" })), () =>
            Ref.set(released, true),
          ),
        ),
        make: Effect.gen(function* () {
          const greeting = yield* Greeting;
          return {
            commands: [
              {
                name: "find",
                usage: 'find "<what you will do>"',
                summary: greeting.text,
                run: () => Effect.succeed(greeting.text),
              },
            ],
          };
        }),
      });
      assert.strictEqual(entry.id, "find");

      const scope = yield* Scope.make();
      const contributions = yield* entry.contributions.pipe(
        Scope.provide(scope),
        Effect.provide(coreLayer(yield* seedState())),
      );
      assert.strictEqual(contributions.commands?.[0]?.summary, "hello");
      assert.isFalse(yield* Ref.get(released));
      yield* Scope.close(scope, Exit.void);
      assert.isTrue(yield* Ref.get(released));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
