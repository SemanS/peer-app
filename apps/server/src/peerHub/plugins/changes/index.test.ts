// @effect-diagnostics nodeBuiltinImport:off - a plain Git checkout in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_CHANGES_PLUGIN, PEER_PLUGIN_IDS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { peerPlugins } from "../../core/registry.ts";
import {
  bobOnAna,
  changesPeer,
  eventually,
  git,
  hooks,
  jjHome,
  peerChanges,
  puts,
  refusedWith,
  rpcOver,
  team,
  write,
} from "./fixtures.test.ts";
import { ChangesPlugin } from "./index.ts";

const home = jjHome();
const place = { workspace: "acme", project: "app" };
const stateOf = (peer: {
  readonly plugins: {
    readonly states: Effect.Effect<
      ReadonlyArray<{ id: string; active: boolean; reason?: string | undefined }>
    >;
  };
}) => peer.plugins.states.pipe(Effect.map((states) => states.find(({ id }) => id === "changes")));

describe("the changes plugin", () => {
  it("is defined as the contracts say, and needs the Hub's changes feature", () => {
    assert.strictEqual(ChangesPlugin.id, "changes");
    assert.strictEqual(ChangesPlugin.title, "Changes");
    assert.strictEqual(ChangesPlugin.summary, PEER_CHANGES_PLUGIN.summary);
    assert.deepStrictEqual(ChangesPlugin.hubFeature, { id: "changes", revision: 1 });
    assert.deepStrictEqual(ChangesPlugin.commandNames, ["changes"]);
  });

  it("is listed once, in the contracts' order, right after agreements", () => {
    const listed = peerPlugins().map((entry) => entry.id);
    // The plugins built so far, in the contracts' order (the jujutsu plugin is another change's).
    assert.deepStrictEqual(
      listed,
      PEER_PLUGIN_IDS.filter((id) => listed.includes(id)),
    );
    assert.strictEqual(listed.indexOf("changes"), listed.indexOf("agreements") + 1);
  });

  it.live(
    "is inactive on a Hub without the feature: nothing is reported and the methods refuse",
    () =>
      Effect.gen(function* () {
        const t = team(home);
        bobOnAna(t);
        const { hub, peer, fixture } = yield* changesPeer(
          { rows: [], features: { requests: 1 } },
          t.bob,
        );
        assert.deepStrictEqual(
          { active: (yield* stateOf(peer))?.active, reason: (yield* stateOf(peer))?.reason },
          { active: false, reason: "hub" },
        );
        yield* Effect.promise(() => hooks(fixture, t.bob).stop());
        yield* Effect.sleep("1500 millis");
        assert.strictEqual(puts(hub).length, 0);
        assert.isUndefined((yield* peer.status.publish).changes);

        const rpc = yield* rpcOver(peer.plugins);
        const refused = yield* refusedWith(
          rpc["peer.changes.reviewDiff"]({ ...place, changeId: "l".repeat(32), mode: "since" }),
        );
        assert.strictEqual(refused.detail, "Changes needs a newer Peer Hub.");
        const subscribed = yield* refusedWith(
          rpc["peer.changes.markReviewed"]({
            ...place,
            changeId: "l".repeat(32),
            commit: "a".repeat(40),
            version: 1,
          }),
        );
        assert.strictEqual(subscribed.detail, "Changes needs a newer Peer Hub.");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("is turned off by its owner: nothing is reported, its command and methods refuse", () =>
    Effect.gen(function* () {
      const t = team(home);
      bobOnAna(t);
      const { hub, peer, fixture } = yield* changesPeer(
        { rows: [], features: { changes: 1 } },
        t.bob,
      );
      const agent = hooks(fixture, t.bob);
      yield* Effect.promise(() => agent.stop());
      yield* eventually(
        () => puts(hub),
        (sent) => sent.length === 1,
      );
      assert.strictEqual(puts(hub).length, 1);

      yield* peer.plugins.setPlugin({ id: "changes", enabled: false });
      assert.isUndefined((yield* peer.status.publish).changes);
      write(t.bob, "loyalty.js", "export const points = 2;\n");
      yield* Effect.promise(() => agent.stop());
      yield* Effect.sleep("1500 millis");
      assert.strictEqual(puts(hub).length, 1);

      const failed = yield* Effect.promise(() =>
        peerChanges(fixture).then(
          () => "",
          (error: Error) => error.message,
        ),
      );
      assert.match(failed, /turned off/);
      const rpc = yield* rpcOver(peer.plugins);
      const refused = yield* refusedWith(
        rpc["peer.changes.reviewDiff"]({ ...place, changeId: "l".repeat(32), mode: "since" }),
      );
      assert.match(refused.detail, /turned off/);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("reports nothing from a Git checkout", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(home, "plain-"));
      git(directory, "init", "--quiet", "--initial-branch=main");
      write(directory, "a.js", "x\n");
      git(directory, "add", ".");
      git(directory, "commit", "--quiet", "-m", "start");
      const { hub, fixture } = yield* changesPeer(
        { rows: [], features: { changes: 1 } },
        directory,
      );
      const agent = hooks(fixture, directory);
      yield* Effect.promise(() => agent.stop());
      yield* Effect.promise(() => agent.step());
      yield* Effect.sleep("1500 millis");
      assert.strictEqual(puts(hub).length, 0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
