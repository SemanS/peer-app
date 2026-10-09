import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import { RequestsRpcGroup, type PeerAgentRequest, type PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "../../core/hub/PeerHubEvents.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  type HubAnswer,
  seedState,
  signedInSeed,
  standInHub,
} from "../../core/testkit.ts";
import * as PeerHub from "../../PeerHub.ts";
import { requestsHub } from "./hub.ts";
import { RequestsPlugin } from "./index.ts";

/** Bob asks Ana, in acme's app project, to pull the flows. */
const REQUEST: PeerAgentRequest = {
  id: "request-one",
  project: "app",
  task: "task-one",
  sender: "bob@acme.test",
  recipient: "ana@acme.test",
  title: "Download flows",
  prompt: "Pull the flows",
  status: "pending",
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
};

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

const EVENTS = "/v1/workspaces/acme/events";
const INBOX = "/v1/workspaces/acme/requests";

/**
 * A Hub where Ana's inbox in acme holds `inbox.current`, any request sent or answered there
 * comes back as `REQUEST`, and acme's event stream stays open. Each call's path goes to `asked`.
 */
const acmeHub =
  (inbox: { current: ReadonlyArray<PeerAgentRequest> }, asked?: Queue.Queue<string>): HubAnswer =>
  (url) => {
    if (asked !== undefined) Queue.offerUnsafe(asked, url);
    return url === EVENTS
      ? { events: ":\n\n", open: true }
      : url === INBOX
        ? [200, { requests: inbox.current }]
        : url.startsWith("/v1/workspaces/acme/projects/app/requests")
          ? [200, REQUEST]
          : [404, { error: { code: "not_found", message: "Not here." } }];
  };

/** Ana's Peer, signed in to `hub` in acme, with the requests plugin started. */
const anaWithRequests = (hub: { readonly url: string }, extraWorkspace = false) =>
  Effect.gen(function* () {
    const pings = yield* Queue.unbounded<string>();
    const observed = {
      ...RequestsPlugin,
      contributions: RequestsPlugin.contributions.pipe(
        Effect.map((contribution) => ({
          ...contribution,
          hubChanges: {
            ...contribution.hubChanges!,
            onPing: (ping: Parameters<NonNullable<typeof contribution.hubChanges>["onPing"]>[0]) =>
              contribution
                .hubChanges!.onPing(ping)
                .pipe(Effect.andThen(Queue.offer(pings, ping.change)), Effect.asVoid),
          },
        })),
      ),
    };
    const seed = signedInSeed(hub.url);
    const core = yield* Layer.build(
      coreLayer(
        yield* seedState(
          extraWorkspace
            ? seed.replace(
                '],"joinable"',
                ',{"slug":"beta","name":"Beta","role":"member","allowedDomains":[],"manifest":null,"lastSyncAt":null}],"joinable"',
              )
            : seed,
        ),
        {
          session: "phs_test",
          plugins: [observed],
        },
      ),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return {
        status,
        plugins: yield* PeerPlugins.PeerPlugins,
        events: yield* PeerHubEvents.PeerHubEvents,
        pings,
      };
    }).pipe(Effect.provide(core));
  });

/** The first status, now or later, whose requests satisfy `seen`. */
const requestsWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (requests: ReadonlyArray<PeerAgentRequest>) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => (next.requests ?? []).map((entry) => entry.request)),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/** A broker in acme's app checkout, running the commands `plugins` has now. */
const brokerOver = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  Effect.acquireRelease(
    Effect.promise(() => brokerFixture(() => pluginsOf(plugins))),
    (fixture) => Effect.promise(() => fixture.dispose()),
  );

const refusal = <A>(effect: Effect.Effect<A, { readonly message: string }>) =>
  effect.pipe(
    Effect.result,
    Effect.map((result) => (Result.isFailure(result) ? result.failure.message : null)),
  );

describe("member request CLI", () => {
  it.effect.each([
    [404, "Unknown recipient.", "refused"],
    [409, "Recipient inbox is full.", "refused"],
    [429, "Wait before asking again.", "refused"],
    [503, "Try later.", "uncertain"],
    [200, "Unreadable row.", "uncertain"],
  ] as const)(
    "maps a real Hub answer %s through the service and CLI contract",
    ([statusCode, reason, outcome]) =>
      Effect.gen(function* () {
        const hub = yield* standInHub({
          current: (url) =>
            url === INBOX
              ? [200, { requests: [] }]
              : [statusCode, { error: { code: "response", message: reason } }],
        });
        const { plugins } = yield* anaWithRequests(hub);
        const fixture = yield* brokerOver(plugins);
        yield* Effect.promise(() => fixture.register("requests"));
        yield* Effect.promise(() =>
          expect(
            fixture.broker.runCli("request", ["bob@acme.test", "Review it", "--op", "retry-one"], {
              "x-peer-session": "claude:requests",
            }),
          ).rejects.toMatchObject({
            outcome,
            next: expect.stringContaining(
              outcome === "uncertain" ? "--op retry-one" : "Tell your person",
            ),
          }),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "addresses the confirmed project and preserves a replay id and full multiline prompt",
    () =>
      Effect.gen(function* () {
        const hub = yield* standInHub({ current: acmeHub({ current: [] }) });
        const { plugins } = yield* anaWithRequests(hub);
        const fixture = yield* brokerOver(plugins);
        yield* Effect.promise(() => fixture.register("requests"));
        const headers = { "x-peer-session": "claude:requests" };
        const recipient = "bob@acme.test";
        const prompt = "Pull the camp workflows.\nUse the README and retain local data.";
        const run = (more: ReadonlyArray<string> = []) =>
          Effect.promise(() =>
            fixture.broker["runCli"]("request", [recipient, prompt, ...more], headers),
          );
        assert.include(yield* run(), "Needs you");
        yield* run();
        yield* run(["--op", "another-request"]);
        const posted = hub.calls.filter((call) => call.method === "POST");
        // Sent for the session's own workspace and project.
        assert.deepStrictEqual(
          posted.map((call) => call.url),
          Array.from({ length: 3 }, () => "/v1/workspaces/acme/projects/app/requests"),
        );
        const sent = posted.map(
          (call) =>
            JSON.parse(call.body) as {
              readonly op: string;
              readonly recipient: string;
              readonly prompt: string;
            },
        );
        assert.strictEqual(sent[0]?.recipient, recipient);
        assert.strictEqual(sent[0]?.prompt, prompt);
        assert.deepStrictEqual(sent[0], sent[1]);
        assert.strictEqual(sent[2]?.op, "another-request");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("is refused in one line, asks the Hub nothing and leaves help while off", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ current: [] }) });
      const { plugins } = yield* anaWithRequests(hub);
      const fixture = yield* brokerOver(plugins);
      yield* Effect.promise(() => fixture.register("requests"));
      const help = () => Effect.promise(() => fixture.broker["runCli"]("help", [], {}));
      assert.strictEqual(
        (yield* help()).split("\n").find((line) => line.startsWith("  peer request ")),
        '  peer request <email> "<prompt>" [--title "<title>"] [--op <stable-id>] | request list | request withdraw <id>  a durable request in a teammate\'s Needs you; they choose whether to start their agent',
      );

      yield* plugins.setPlugin({ id: "requests", enabled: false });
      yield* Effect.promise(() =>
        expect(
          fixture.broker["runCli"]("request", ["bob@acme.test", "Review the parser"], {
            "x-peer-session": "claude:requests",
          }),
        ).rejects.toMatchObject({
          status: 409,
          message: "request is turned off on this environment.",
        }),
      );
      assert.notInclude(yield* help(), "peer request");
      assert.isFalse(hub.calls.some((call) => call.method === "POST"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("durable member requests", () => {
  it.effect("sends the operation id and reads the recipient inbox", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ current: [REQUEST] }) });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), { session: "bob-session" }),
      );
      const api = requestsHub(yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core)));
      const body = {
        op: "send-one",
        recipient: REQUEST.recipient,
        title: REQUEST.title,
        prompt: REQUEST.prompt,
      };
      yield* api.send({ workspace: "acme", projectId: "app", ...body });
      assert.deepStrictEqual(yield* api.inbox("acme"), [REQUEST]);
      assert.deepStrictEqual(
        hub.calls.map((call) => [call.method, call.url, call.authorization]),
        [
          ["POST", "/v1/workspaces/acme/projects/app/requests", "Bearer bob-session"],
          ["GET", INBOX, "Bearer bob-session"],
        ],
      );
      // The body as the Hub has always read it.
      assert.strictEqual(
        hub.calls[0]?.body,
        '{"op":"send-one","recipient":"ana@acme.test","title":"Download flows","prompt":"Pull the flows"}',
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads the inbox again when the Hub pings requests", () =>
    Effect.gen(function* () {
      const inbox: { current: ReadonlyArray<PeerAgentRequest> } = { current: [] };
      const asked = yield* Queue.unbounded<string>();
      const hub = yield* standInHub({ current: acmeHub(inbox, asked) });
      const { status, events, pings } = yield* anaWithRequests(hub);
      yield* events
        .follow({
          readWork: () => Effect.void,
          coordinationChanged: Effect.void,
          projectsChanged: Effect.void,
        })
        .pipe(Effect.forkScoped);
      // Subscribed, and the inbox read after it.
      while ((yield* Queue.take(asked)) !== EVENTS);
      yield* Queue.take(pings);
      yield* TestClock.adjust("300 millis");
      while ((yield* Queue.take(asked)) !== INBOX);
      yield* requestsWhen(status, (requests) => requests.length === 0);

      inbox.current = [REQUEST];
      const before = hub.calls.filter((call) => call.url === INBOX).length;
      for (let i = 0; i < 3; i++)
        hub.push(EVENTS, 'event: requests\ndata: {"origin":"bob-laptop"}\n\n');
      for (let i = 0; i < 3; i++) yield* Queue.take(pings);
      yield* TestClock.adjust("300 millis");
      assert.deepStrictEqual(yield* requestsWhen(status, (requests) => requests.length > 0), [
        REQUEST,
      ]);
      assert.strictEqual(hub.calls.filter((call) => call.url === INBOX).length, before + 1);
      assert.isFalse(hub.calls.some((call) => call.url.endsWith("/work")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("request reconnect", () => {
  it.effect("resync rereads its workspace and another workspace's ping reads only that inbox", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<string>();
      const hub = yield* standInHub({
        current: (url) => {
          Queue.offerUnsafe(asked, url);
          return [200, { requests: [REQUEST] }];
        },
      });
      const { plugins, status } = yield* anaWithRequests(hub, true);
      yield* requestsWhen(status, (rows) => rows.length === 2);
      yield* Queue.clear(asked);
      const contribution = (yield* plugins.active).find(
        (entry) => entry.id === "requests",
      )!.contributions;
      for (const [workspace, change] of [
        ["acme", "resync"],
        ["beta", "requests"],
      ] as const) {
        yield* contribution.hubChanges!.onPing({ workspace, change, origin: null, data: {} });
        yield* TestClock.adjust("300 millis");
        assert.strictEqual(yield* Queue.take(asked), `/v1/workspaces/${workspace}/requests`);
      }
      assert.isFalse(hub.calls.some((call) => call.url.endsWith("/work")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("reads after an authenticated event subscription is established", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<string>();
      const hub = yield* standInHub({ current: acmeHub({ current: [REQUEST] }, asked) });
      const { status, events, pings } = yield* anaWithRequests(hub);
      // Peer read the inbox as the plugin started; the stream is not followed yet.
      assert.strictEqual(yield* Queue.take(asked), INBOX);
      yield* requestsWhen(status, (requests) => requests.length > 0);

      yield* events
        .follow({
          readWork: () => Effect.void,
          coordinationChanged: Effect.void,
          projectsChanged: Effect.void,
        })
        .pipe(Effect.forkScoped);
      assert.strictEqual(yield* Queue.take(asked), EVENTS);
      yield* Queue.take(pings);
      yield* TestClock.adjust("300 millis");
      assert.strictEqual(yield* Queue.take(asked), INBOX);
      const subscribed = hub.calls.find((call) => call.url === EVENTS);
      assert.strictEqual(subscribed?.authorization, "Bearer phs_test");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("team requests while off", () => {
  it.effect("leave the status empty, and show the inbox again once on", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ current: [REQUEST] }) });
      const { status, plugins } = yield* anaWithRequests(hub);
      assert.deepStrictEqual(yield* requestsWhen(status, (requests) => requests.length > 0), [
        REQUEST,
      ]);

      yield* plugins.setPlugin({ id: "requests", enabled: false });
      const off = yield* status.publish;
      assert.deepStrictEqual(off.requests, []);
      assert.deepStrictEqual(
        off.plugins?.find((plugin) => plugin.id === "requests"),
        { id: "requests", title: "Team requests", enabled: false, active: false, reason: "off" },
      );

      yield* plugins.setPlugin({ id: "requests", enabled: true });
      assert.deepStrictEqual(yield* requestsWhen(status, (requests) => requests.length > 0), [
        REQUEST,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuse sending and dismissing without asking the Hub", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ current: [REQUEST] }) });
      const { plugins } = yield* anaWithRequests(hub);
      const wrap: PeerRpcWrap = {
        effect: (_method, effect) => effect,
        stream: (_method, stream) => stream,
      };
      const handlers = PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      );
      yield* Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(RequestsRpcGroup);
        const send = client["peerHub.sendRequest"]({
          workspace: "acme",
          projectId: "app",
          op: "send-one",
          recipient: "bob@acme.test",
          title: "Review the parser",
          prompt: "Please review the parser.",
        });
        const dismiss = client["peerHub.dismissRequest"]({
          workspace: "acme",
          projectId: "app",
          requestId: REQUEST.id,
        });
        assert.isNull(yield* refusal(dismiss));
        assert.strictEqual(
          hub.calls.filter((call) => call.method === "PATCH").length,
          1,
          "dismissed while on",
        );

        yield* plugins.setPlugin({ id: "requests", enabled: false });
        const changes = () => hub.calls.filter((call) => call.method !== "GET").length;
        const before = changes();
        for (const refused of [send, dismiss]) {
          assert.strictEqual(
            yield* refusal(refused),
            "Team requests is turned off on this environment.",
          );
        }
        assert.strictEqual(changes(), before);
      }).pipe(Effect.provide(handlers));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("accepting a request", () => {
  it.effect("takes a pending request for its task once, and says why it cannot", () =>
    Effect.gen(function* () {
      const inbox: { current: ReadonlyArray<PeerAgentRequest> } = { current: [REQUEST] };
      const hub = yield* standInHub({ current: acmeHub(inbox) });
      const { plugins } = yield* anaWithRequests(hub);
      const acceptor = yield* plugins.require("requestAcceptor");
      const input = {
        workspace: "acme",
        project: "app",
        task: "task-one",
        requestId: "request-one",
        fallback: "KRK-1: Pull flows",
      };
      const acceptedPrompt = (yield* acceptor.accept({
        ...input,
        instruction: "Check the changes carefully",
      })).prompt;
      assert.isTrue(acceptedPrompt.startsWith("Check the changes carefully\n"));
      assert.include(acceptedPrompt, "<shared-context>");
      assert.include(acceptedPrompt, "Pull the flows");
      const accepted = hub.calls.filter((call) => call.method === "PATCH");
      assert.deepStrictEqual(
        accepted.map((call) => [call.url, call.body]),
        [["/v1/workspaces/acme/projects/app/requests/request-one", '{"status":"accepted"}']],
      );

      inbox.current = [{ ...REQUEST, status: "accepted" }];
      assert.strictEqual(
        yield* refusal(acceptor.accept(input)),
        "You already accepted this request on this or another computer. Inspect the task and herdr before starting another agent.",
      );
      inbox.current = [REQUEST];
      assert.isNotNull(yield* refusal(acceptor.accept({ ...input, task: "another-task" })));

      // Without team requests, starting from a request says why.
      yield* plugins.setPlugin({ id: "requests", enabled: false });
      assert.strictEqual(
        yield* refusal(plugins.require("requestAcceptor")),
        "Team requests is turned off on this environment.",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("request acceptance is authoritative", () => {
  it.effect("fences the PATCH row and refuses every already closed outcome", () =>
    Effect.gen(function* () {
      const inbox: { current: ReadonlyArray<PeerAgentRequest> } = {
        current: [{ ...REQUEST, prompt: "Stale list text" }],
      };
      const hub = yield* standInHub({
        current: (url) =>
          url === INBOX
            ? [200, { requests: inbox.current }]
            : [200, { ...REQUEST, status: "accepted", prompt: "Authoritative PATCH text" }],
      });
      const { plugins } = yield* anaWithRequests(hub);
      const acceptor = yield* plugins.require("requestAcceptor");
      const input = {
        workspace: "acme",
        project: "app",
        task: REQUEST.task,
        requestId: REQUEST.id,
        fallback: "Own fallback",
      };
      const answer = yield* acceptor.accept(input);
      assert.include(answer.prompt, "Authoritative PATCH text");
      assert.notInclude(answer.prompt, "Stale list text");
      assert.isTrue(answer.prompt.startsWith("Own fallback"));
      const before = hub.calls.filter((c) => c.method === "PATCH").length;
      for (const [status, closedBy, words] of [
        ["dismissed", "sender", "withdrew"],
        ["dismissed", "expiry", "expired"],
        ["dismissed", "recipient", "dismissed"],
        ["accepted", undefined, "already accepted"],
      ] as const) {
        inbox.current = [{ ...REQUEST, status, ...(closedBy === undefined ? {} : { closedBy }) }];
        assert.include((yield* refusal(acceptor.accept(input)))!, words);
      }
      assert.equal(hub.calls.filter((c) => c.method === "PATCH").length, before);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("returns no prompt when the Hub rejects a stale acceptance", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({
        current: (url) =>
          url === INBOX
            ? [200, { requests: [REQUEST] }]
            : [409, { error: { code: "withdrawn", message: "The sender withdrew this request." } }],
      });
      const { plugins } = yield* anaWithRequests(hub);
      const acceptor = yield* plugins.require("requestAcceptor");
      assert.include(
        (yield* refusal(
          acceptor.accept({
            workspace: "acme",
            project: "app",
            task: REQUEST.task,
            requestId: REQUEST.id,
            fallback: "Own fallback",
          }),
        ))!,
        "sender withdrew",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect("send, dismiss and withdrawal refresh only their requests", () =>
    Effect.gen(function* () {
      const hub = yield* standInHub({ current: acmeHub({ current: [REQUEST] }) });
      const { plugins, status } = yield* anaWithRequests(hub);
      yield* requestsWhen(status, (rows) => rows.length > 0);
      const wrap: PeerRpcWrap = {
        effect: (_method, effect) => effect,
        stream: (_method, stream) => stream,
      };
      const handlers = PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      );
      yield* Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(RequestsRpcGroup);
        const before = hub.calls.length;
        yield* client["peerHub.sendRequest"]({
          workspace: "acme",
          projectId: "app",
          op: "one",
          recipient: REQUEST.recipient,
          title: REQUEST.title,
          prompt: REQUEST.prompt,
        });
        yield* client["peerHub.dismissRequest"]({
          workspace: "acme",
          projectId: "app",
          requestId: REQUEST.id,
        });
        yield* client["peerHub.withdrawRequest"]({
          workspace: "acme",
          projectId: "app",
          requestId: REQUEST.id,
        });
        const calls = hub.calls.slice(before);
        assert.equal(calls.filter((c) => c.method === "GET" && c.url === INBOX).length, 3);
        assert.isFalse(calls.some((c) => c.url?.endsWith("/work")));
      }).pipe(Effect.provide(handlers));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
