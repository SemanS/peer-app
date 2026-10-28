// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - the edited file is in the broker's checkout, and the bodies the Hub was sent.
/**
 * A review session end to end through the broker test kit (task 10.1): Bob's agent takes the role
 * with `peer role review`, is denied an Edit and a `git push` from memory, has its `peer review`
 * refused before the Hub hears of it, and its `peer done` meets the Hub's `409 review_session` (the
 * body of `api/work.rs`); once Bob clears the role, the session is judged as any. Then the version
 * mix of task 10.2: against a Hub that serves no roles the plugin is inactive, `peer role` is refused
 * in one line, a role row denies nothing and `peer done` is not gated.
 */
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_ROLES_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { PeerBrokerHost } from "../../core/broker/host.ts";
import type * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import { CliError, render } from "../../core/plugin.ts";
import { TEST_ENVIRONMENT, type HubCall } from "../../core/testkit.ts";
import {
  ACME,
  acmeHub,
  acmeHubOf,
  BOB,
  brokerOver,
  logged,
  NOW,
  rolesPeer,
  rolesWhen,
  rpcOver,
  type AcmeHub,
} from "./fixtures.test.ts";
import { editStop, landingStop, tookText } from "./text.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const TASK = `${ACME}/projects/app/tasks/vl-7`;
const ORDER = "src/order.js";

/** An agent's move as Peer makes it (`PeerCoordination` `finishTask`): a PATCH naming its session. */
const movesThrough = (
  client: PeerHubClient.PeerHubClient["Service"],
  host: PeerBrokerHost,
): Partial<PeerBrokerHost> => ({
  finishTask: (workspace, project, task, session, status, op) =>
    host.run(
      client.session.pipe(
        Effect.flatMap((signedIn) =>
          client.api.updateTask(signedIn.hubUrl, signedIn.session, workspace, project, task, {
            status,
            session,
            environment: TEST_ENVIRONMENT,
            op,
          }),
        ),
      ),
    ),
});

/**
 * VL-7 on a Hub keeping `current`'s rows: an agent's move is refused while its session reviews, and
 * only while the Hub serves roles (api/work.rs, `roles::Gate`); otherwise the task moves.
 */
const vl7 = (current: AcmeHub, task: { status: string }) => {
  const hub: { calls?: ReadonlyArray<HubCall> } = {};
  current.route = (method, url) => {
    if (url !== TASK || method !== "PATCH") return undefined;
    const sent = JSON.parse(hub.calls?.at(-1)?.body ?? "{}") as Record<string, string>;
    const reviews = current.rows.some(
      (row) => row.session === sent.session && row.role === "review",
    );
    if ("roles" in current.features && sent.session !== undefined && reviews)
      return [
        409,
        {
          error: {
            code: "review_session",
            message:
              "a review session hands nothing over: file what it found with `peer tests`, and its person moves the task",
          },
        },
      ];
    task.status = sent.status!;
    const at = NOW;
    return [
      200,
      {
        id: "vl-7",
        key: "VL-7",
        title: "Order totals",
        status: task.status,
        createdBy: BOB,
        createdAt: at,
        updatedAt: at,
      },
    ];
  };
  return hub;
};

/** Peer as Bob over a Hub keeping `current`, and a broker whose agent `one` works on VL-7. */
const reviewFixture = (current: AcmeHub, task: { status: string }) =>
  Effect.gen(function* () {
    const hub = vl7(current, task);
    const server = yield* acmeHub(current);
    hub.calls = server.calls;
    const peer = yield* rolesPeer(server);
    if ("roles" in current.features)
      yield* rolesWhen(peer.status, (roles) => (roles?.projects.length ?? 0) > 0);
    const fixture = yield* brokerOver(peer, (host) => movesThrough(peer.client, host));
    yield* Effect.promise(() => fixture.register("one"));
    const as = { "x-peer-cwd": fixture.root, "x-peer-session": "claude:one" };
    /** `peer <command> <args>` as agent `one`: what it printed, or what its refusal prints. */
    const cli = (command: string, args: ReadonlyArray<string> = []) =>
      Effect.promise(() =>
        fixture.broker["runCli"](command, args, as).then(
          (out: string) => out,
          (error: unknown) => {
            if (error instanceof CliError) return render(error);
            throw error;
          },
        ),
      );
    /** What the PreToolUse hook answers for `tool` with `input`: the decision, if any. */
    const pre = (tool: string, input: Record<string, unknown>) =>
      Effect.promise(async () => {
        const out = (await fixture.broker["hook"](
          {
            hook_event_name: "PreToolUse",
            session_id: "one",
            cwd: fixture.root,
            tool_name: tool,
            tool_input: input,
          },
          { "x-peer-agent": "claude" },
        )) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
        } | null;
        return out?.hookSpecificOutput ?? {};
      });
    const edit = pre("Edit", {
      file_path: NodePath.join(fixture.root, ORDER),
      old_string: "a",
      new_string: "b",
    });
    const moves = () => server.calls.filter((call) => call.url === TASK && call.method === "PATCH");
    return { server, peer, fixture, cli, pre, edit, moves };
  });

describe("a review session from its role to its refused handover", () => {
  it.effect(
    "is denied an edit and a push, refused peer review and peer done, and freed by its person",
    () =>
      run(
        Effect.gen(function* () {
          const current = acmeHubOf();
          const task = { status: "review" };
          const s = yield* reviewFixture(current, task);
          assert.isTrue(yield* s.peer.plugins.isActive("roles"));

          assert.strictEqual(yield* s.cli("role", ["review"]), tookText);
          assert.deepStrictEqual(
            current.rows.map((row) => [row.session, row.role, row.setBy]),
            [["claude:one", "review", "agent"]],
          );

          const edit = yield* s.edit;
          assert.strictEqual(edit.permissionDecision, "deny");
          assert.strictEqual(edit.permissionDecisionReason, editStop([ORDER]));
          const push = yield* s.pre("Bash", { command: "git push origin HEAD" });
          assert.strictEqual(push.permissionDecision, "deny");
          assert.strictEqual(push.permissionDecisionReason, landingStop("push"));

          // peer review is refused by the plugin: the Hub never hears of the move.
          const review = yield* s.cli("review");
          assert.match(review, /^peer: refused: /);
          assert.include(review, "a review session hands nothing over");
          assert.lengthOf(s.moves(), 0);

          // peer done has no plugin seam: the Hub refuses it, and the task stays in review.
          const done = yield* s.cli("done");
          assert.strictEqual(
            done.split("\n")[0],
            "peer: refused: a review session hands nothing over: file what it found with `peer tests`, and its person moves the task.",
          );
          assert.lengthOf(s.moves(), 1);
          assert.strictEqual(JSON.parse(s.moves()[0]!.body).session, "claude:one");
          assert.strictEqual(task.status, "review");
          const log = yield* Effect.promise(() => logged(s.fixture));
          assert.deepStrictEqual(
            log.filter((line) => line.event === "roles.denied").map((line) => line.where),
            ["edit", "landing"],
          );
          assert.deepStrictEqual(
            log.filter((line) => line.event === "handoff.refused").map((line) => line.refusal),
            ["review_session"],
          );

          // The agent cannot drop its role; Bob clears it in Peer, and the session is judged as any.
          assert.match(yield* s.cli("role", ["none"]), /^peer: refused: /);
          const rpc = yield* rpcOver(s.peer.plugins);
          yield* rpc[PEER_ROLES_METHODS.peerRolesClear]({
            workspace: "acme",
            project: "app",
            session: "claude:one",
          });
          assert.deepStrictEqual(current.rows, []);
          assert.notStrictEqual((yield* s.edit).permissionDecision, "deny");
          assert.strictEqual(
            (yield* s.cli("done")).split("\n")[0],
            "Task moved to done with current shared input versions.",
          );
          assert.strictEqual(task.status, "done");
        }),
      ),
  );
});

describe("the version mix (task 10.2): a Hub that serves no roles", () => {
  it.effect(
    "leaves the plugin inactive, refuses peer role in one line, denies nothing, lets done through",
    () =>
      run(
        Effect.gen(function* () {
          const current: AcmeHub = {
            ...acmeHubOf(),
            features: {},
            rows: [
              {
                session: "claude:one",
                role: "review",
                email: BOB,
                environment: TEST_ENVIRONMENT,
                setBy: "person",
                at: NOW,
              },
            ],
          };
          const task = { status: "review" };
          const s = yield* reviewFixture(current, task);
          assert.isFalse(yield* s.peer.plugins.isActive("roles"));

          assert.strictEqual(
            (yield* s.cli("role", ["review"])).split("\n")[0],
            "peer: refused: role needs a newer Peer Hub.",
          );
          assert.isFalse(s.server.calls.some((call) => call.method === "PUT"));
          assert.notStrictEqual((yield* s.edit).permissionDecision, "deny");
          assert.isUndefined((yield* s.pre("Bash", { command: "git push" })).permissionDecision);
          assert.strictEqual(
            (yield* s.cli("done")).split("\n")[0],
            "Task moved to done with current shared input versions.",
          );
          assert.strictEqual(task.status, "done");
        }),
      ),
  );
});
