// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - a stand-in Hub on a local port, and the bodies it was sent.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PEER_PLUGIN_IDS, SettingsRpcGroup, type PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as RpcTest from "effect/unstable/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import { PeerHubEvents } from "../../core/hub/PeerHubEvents.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import type { PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  coreLayer,
  coreRpcStandIns,
  meAnswer,
  seedState,
  signedInSeed,
  standInHub,
  type HubAnswer,
} from "../../core/testkit.ts";
import { SettingsPlugin } from "./index.ts";
import { PeerSettings, layer } from "./service.ts";

const wrap: PeerRpcWrap = {
  effect: (_method, effect) => effect,
  stream: (_method, stream) => stream,
};
const coordination: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/settings-test",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

const WS = "/v1/workspaces/acme";
const eva = { email: "eva@acme.dev", name: "Eva" };
const settingsView = (seq: number) => ({
  revision: {
    seq,
    commit: "3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4",
    at: "2026-10-11T12:00:00Z",
    by: eva,
    message: "Two agents broke the schema",
  },
  rights: { admin: false, owner: false, leads: ["booking"] },
  document: { currency: "EUR", projects: { booking: { name: "Booking" } } },
  features: { pathRules: true, webhooks: true, github: true },
  people: [{ ...eva, role: "member" }],
});
const line = {
  path: ["projects", "booking", "coordination", "policy"],
  scope: { kind: "project", id: "booking", name: "Booking" },
  label: "Coordination",
  from: "notify",
  to: "coordinate",
};
const dryRun = {
  base: 41,
  head: { seq: 42, by: eva, at: "2026-10-11T12:02:00Z" },
  lines: [line],
  conflicts: [],
  diagnostics: [],
  applies: [{ kind: "next-edit", text: "Policy and path rules: from the next file edit" }],
  noop: false,
};
const proposal = (id: string, canDecide: boolean) => ({
  id,
  by: eva,
  via: { kind: "agent", agent: "codex" },
  at: "2026-10-11T12:00:00Z",
  base: 42,
  message: "Migrations must not run twice",
  instruction: null,
  lines: [line],
  scopes: ["project:booking"],
  owners: "Booking's leads and admins",
  state: "pending",
  decidedBy: null,
  decidedAt: null,
  reason: null,
  revision: null,
  mine: !canDecide,
  canDecide,
});
const set = [{ path: ["projects", "booking", "coordination", "policy"], value: "coordinate" }];
const refusal = (code: string, details: unknown) => ({
  error: { code, message: "Refused.", details },
});

/** Core signed in to a stand-in Hub, with the settings plugin and its RPC methods on top. */
const settingsOn = (answer: { current: HubAnswer }) =>
  Effect.gen(function* () {
    const hub = yield* standInHub(answer);
    const core = yield* Layer.build(
      coreLayer(yield* seedState(signedInSeed(hub.url)), {
        session: "phs_test",
        plugins: [SettingsPlugin],
      }),
    );
    const { plugins, status } = yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(coordination));
      yield* PeerPlugins.startPlugins;
      return { plugins: yield* PeerPlugins.PeerPlugins, status };
    }).pipe(Effect.provide(core));
    const client = yield* RpcTest.makeClient(SettingsRpcGroup).pipe(
      Effect.provide(
        PeerHub.rpcLayer(wrap).pipe(
          Layer.provide(
            Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
          ),
        ),
      ),
    );
    /** Asks the Hub which features it serves, as every sync does. */
    const learn = Effect.flatMap(PeerHubClient, (hubClient) => hubClient.me).pipe(
      Effect.provide(core),
      Effect.ignore,
    );
    return { hub, plugins, status, client, core, learn };
  });

/** Answers `/v1/me` with the settings feature, and every other path with `body` and `code`. */
const serving =
  (answer: { current: HubAnswer }) =>
  (body: unknown, code = 200) => {
    answer.current = (url) => (url === "/v1/me" ? [200, meAnswer({ settings: 1 })] : [code, body]);
  };

describe("Settings through core", () => {
  it.effect("is the last plugin, needs the Hub's feature, and is refused while off", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = {
        current: (url) => (url === "/v1/me" ? [200, meAnswer({ requests: 1 })] : [200, {}]),
      };
      const { hub, plugins, client, learn } = yield* settingsOn(answer);
      yield* learn;
      assert.strictEqual(PEER_PLUGIN_IDS.at(-1), "settings");
      // A Hub without the feature: inactive, and its methods refuse before reaching the Hub.
      const state = (yield* plugins.states).find((plugin) => plugin.id === "settings");
      assert.deepStrictEqual([state?.active, state?.reason], [false, "hub"]);
      const unserved = yield* client["peer.settings.get"]({ workspace: "acme" }).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(unserved));
      assert.isFalse(hub.calls.some((call) => call.url?.includes("/settings")));
      // A Hub that serves it: active, and answering.
      serving(answer)(settingsView(42));
      yield* learn;
      assert.isTrue(yield* plugins.isActive("settings"));
      const got = yield* client["peer.settings.get"]({ workspace: "acme" });
      assert.strictEqual(got.revision.seq, 42);
      // Turned off by its owner: refused again, and nothing reaches the Hub.
      yield* plugins.setPlugin({ id: "settings", enabled: false });
      const calls = hub.calls.length;
      const off = yield* client["peer.settings.get"]({ workspace: "acme" }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(off));
      assert.strictEqual(hub.calls.length, calls);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sends each route its own request and reads each answer", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = { current: () => [200, {}] };
      const { hub, client, learn } = yield* settingsOn(answer);
      const on = serving(answer);
      on({});
      yield* learn;
      // The plugin reads the settings and the pending proposals in the background too, and after
      // each write; `last` is the last call that is none of those.
      const refresh = (call?: {
        readonly method?: string | undefined;
        readonly url?: string | undefined;
      }) =>
        call?.method === "GET" &&
        (call.url === `${WS}/settings` || call.url === `${WS}/settings/proposals?state=pending`);
      const last = () => {
        const call = hub.calls.findLast((c) => !refresh(c));
        return [call?.method, call?.url?.replace(WS, "") || "/", call?.body ?? ""].join(" ").trim();
      };
      const reads = (path: string) =>
        hub.calls.filter((call) => call.method === "GET" && call.url === `${WS}${path}`).length;

      on(settingsView(42));
      const viewReads = reads("/settings");
      const got = yield* client["peer.settings.get"]({ workspace: "acme", revision: 42 });
      assert.deepStrictEqual(got.rights.leads, ["booking"]);
      assert.isAbove(reads("/settings"), viewReads);

      on(dryRun);
      const forced = [["projects", "booking", "coordination", "paths", "migrations/**"]];
      const previewed = yield* client["peer.settings.preview"]({
        workspace: "acme",
        base: 41,
        set,
        message: "  Why  ",
        force: forced,
      });
      assert.strictEqual(previewed.kind, "preview");
      assert.strictEqual(
        last(),
        `POST /settings/changes ${JSON.stringify({ base: 41, set, message: "Why", dryRun: true, force: forced })}`,
      );
      const saved = yield* client["peer.settings.save"]({ workspace: "acme", base: 41, set });
      assert.strictEqual(saved.kind, "saved");
      assert.strictEqual(last(), `POST /settings/changes ${JSON.stringify({ base: 41, set })}`);

      on({ revisions: [], next: null });
      yield* client["peer.settings.history"]({
        workspace: "acme",
        scope: "project:booking",
        before: 40,
        limit: 50,
      });
      assert.strictEqual(
        last(),
        "GET /settings/history?scope=project%3Abooking&before=40&limit=50",
      );
      on({ ...settingsView(43).revision, source: "app", proposal: null, lines: [line] });
      yield* client["peer.settings.historyEntry"]({ workspace: "acme", seq: 43 });
      assert.strictEqual(last(), "GET /settings/history/43");

      on(dryRun);
      const reverting = { workspace: "acme", seq: 43 } as const;
      assert.strictEqual(
        (yield* client["peer.settings.revert"]({ ...reverting, dryRun: true })).kind,
        "preview",
      );
      assert.strictEqual(
        last(),
        `POST /settings/revert ${JSON.stringify({ seq: 43, dryRun: true })}`,
      );
      assert.strictEqual(
        (yield* client["peer.settings.revert"]({ ...reverting, message: "Undo" })).kind,
        "saved",
      );
      assert.strictEqual(
        last(),
        `POST /settings/revert ${JSON.stringify({ seq: 43, message: "Undo" })}`,
      );

      // YAML files become the bundle the Hub imports, and `.peer-revision` names its base.
      yield* client["peer.settings.importYaml"]({
        workspace: "acme",
        files: {
          "workspace.yaml": "currency: EUR\n",
          "projects/booking.yaml": "name: Booking\n",
          ".peer-revision": "42 3f2a\n",
        },
        dryRun: true,
      });
      assert.strictEqual(
        last(),
        `POST /settings/import ${JSON.stringify({
          base: 42,
          bundle: {
            settings: {},
            config: {
              currency: "EUR",
              projects: { booking: { name: "Booking" } },
              tools: {},
              capacity: {},
            },
          },
          dryRun: true,
        })}`,
      );
      const calls = hub.calls.length;
      const incomplete = yield* client["peer.settings.importYaml"]({
        workspace: "acme",
        files: { "projects/booking.yaml": "name: Booking\n" },
      }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(incomplete));
      assert.strictEqual(hub.calls.length, calls);

      on({ revision: { seq: 42, commit: "3f2a" }, files: { "workspace.yaml": "currency: EUR\n" } });
      const exported = yield* client["peer.settings.exportYaml"]({ workspace: "acme" });
      assert.strictEqual(exported.revision.seq, 42);
      assert.strictEqual(last(), "GET /settings/export");

      on({ proposals: [proposal("p_1", true)] });
      const proposalReads = reads("/settings/proposals?state=pending");
      yield* client["peer.settings.proposals"]({ workspace: "acme", state: "pending", waiting: 1 });
      assert.isAbove(reads("/settings/proposals?state=pending"), proposalReads);
      on(proposal("p_1", false), 201);
      const proposed = yield* client["peer.settings.propose"]({
        workspace: "acme",
        base: 42,
        set,
        message: "Migrations must not run twice",
        instruction: "make migrations exclusive",
        via: { kind: "agent", agent: "codex" },
      });
      assert.strictEqual(proposed.kind, "proposed");
      assert.strictEqual(
        last(),
        `POST /settings/proposals ${JSON.stringify({
          base: 42,
          set,
          message: "Migrations must not run twice",
          instruction: "make migrations exclusive",
          via: { kind: "agent", agent: "codex" },
        })}`,
      );
      on(dryRun);
      const applied = yield* client["peer.settings.applyProposal"]({
        workspace: "acme",
        id: "p/1",
        dryRun: true,
      });
      assert.strictEqual(applied.kind, "preview");
      assert.strictEqual(
        last(),
        `POST /settings/proposals/p%2F1/apply ${JSON.stringify({ dryRun: true })}`,
      );
      on({ ...proposal("p_1", true), state: "declined", reason: "No" });
      yield* client["peer.settings.declineProposal"]({
        workspace: "acme",
        id: "p_1",
        reason: "No",
      });
      assert.strictEqual(
        last(),
        `POST /settings/proposals/p_1/decline ${JSON.stringify({ reason: "No" })}`,
      );
      on(null, 204);
      const withdrawn = yield* client["peer.settings.withdrawProposal"]({
        workspace: "acme",
        id: "p_1",
      });
      assert.deepStrictEqual(withdrawn, {});
      assert.strictEqual(last(), "DELETE /settings/proposals/p_1");

      on({
        secrets: [{ name: "litellm-master-key", at: null, by: null, usedBy: [] }],
        missing: [],
      });
      const secrets = yield* client["peer.settings.secrets"]({ workspace: "acme" });
      assert.strictEqual(secrets.secrets.length, 1);
      assert.strictEqual(last(), "GET /settings/secrets");
      on({ ok: true });
      const stored = yield* client["peer.settings.putSecret"]({
        workspace: "acme",
        name: "TEAMS_ALERTS_URL",
        value: "https://x.test/hook",
      });
      assert.deepStrictEqual(stored, {});
      assert.strictEqual(
        last(),
        `PUT /secrets/TEAMS_ALERTS_URL ${JSON.stringify({ value: "https://x.test/hook" })}`,
      );
      on(null, 204);
      const deleted = yield* client["peer.settings.deleteSecret"]({
        workspace: "acme",
        name: "TEAMS_ALERTS_URL",
        force: true,
      });
      assert.deepStrictEqual(deleted, { kind: "deleted" });
      assert.strictEqual(last(), "DELETE /secrets/TEAMS_ALERTS_URL?force=true");

      on({ configured: false, masterKey: { stored: false } });
      assert.isFalse((yield* client["peer.settings.gateway"]({ workspace: "acme" })).configured);
      assert.strictEqual(last(), "GET /settings/gateway");
      on({ ok: true, models: ["claude-sonnet-5-5"] });
      const tested = yield* client["peer.settings.gatewayTest"]({ workspace: "acme" });
      assert.deepStrictEqual(tested.models, ["claude-sonnet-5-5"]);
      assert.strictEqual(last(), "POST /settings/gateway/test {}");
      on({ at: "2026-10-11T09:00:00Z", ok: true });
      assert.isTrue((yield* client["peer.settings.gatewaySync"]({ workspace: "acme" })).ok);
      assert.strictEqual(last(), "POST /settings/gateway/sync {}");
      on({
        payloadUrl: "https://hub.acme.dev/v1/github/acme",
        secret: "s",
        secretName: "github-webhook",
        events: "pull_request",
        revision: null,
      });
      const enabled = yield* client["peer.settings.githubEnable"]({
        workspace: "acme",
        rotate: true,
      });
      assert.strictEqual(enabled.secret, "s");
      assert.strictEqual(
        last(),
        `POST /settings/github/enable ${JSON.stringify({ rotate: true })}`,
      );
      on(dryRun);
      const disabled = yield* client["peer.settings.githubDisable"]({
        workspace: "acme",
        dryRun: true,
      });
      assert.strictEqual(disabled.kind, "preview");
      assert.strictEqual(
        last(),
        `POST /settings/github/disable ${JSON.stringify({ dryRun: true })}`,
      );

      on({ domain: "acme-studio.com", record: "peer-hub-verify=7f3c", state: "listed" });
      const record = yield* client["peer.settings.domainRecord"]({
        workspace: "acme",
        domain: "acme-studio.com",
      });
      assert.strictEqual(record.state, "listed");
      assert.strictEqual(last(), "GET /domains/acme-studio.com/record");
      on({ domain: "acme-studio.com", state: "verified", dns: "found" });
      const checked = yield* client["peer.settings.verifyDomain"]({
        workspace: "acme",
        domain: "acme-studio.com",
      });
      assert.strictEqual(checked.dns, "found");
      assert.strictEqual(last(), "POST /domains/acme-studio.com/verify {}");
      on({ slug: "acme", name: "Acme Studio", allowedDomains: ["acme.dev"], createdBy: "x" });
      const renamed = yield* client["peer.settings.updateWorkspace"]({
        workspace: "acme",
        name: "Acme Studio",
        allowedDomains: ["acme.dev"],
      });
      assert.strictEqual(renamed.kind, "updated");
      assert.strictEqual(
        last(),
        `PATCH / ${JSON.stringify({ name: "Acme Studio", allowedDomains: ["acme.dev"] })}`,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("answers what a person settles as a result, and every other refusal as an error", () =>
    Effect.gen(function* () {
      const answer: { current: HubAnswer } = { current: () => [200, {}] };
      const { client, learn } = yield* settingsOn(answer);
      const on = serving(answer);
      on({});
      yield* learn;
      const input = { workspace: "acme", base: 41, set } as const;
      const conflict = {
        path: ["projects", "booking", "coordination", "policy"],
        label: "Coordination",
        base: "notify",
        mine: "ask",
        theirs: "coordinate",
        baseText: "notify",
        mineText: "ask",
        theirsText: "coordinate",
        theirsBy: eva,
        theirsAt: "2026-10-11T12:02:00Z",
        theirsSeq: 42,
      };

      on({ ...refusal("settings_conflict", { ...dryRun, conflicts: [conflict] }) }, 409);
      const conflicted = yield* client["peer.settings.save"](input);
      assert.strictEqual(conflicted.kind, "conflict");
      assert.strictEqual(
        conflicted.kind === "conflict" ? conflicted.conflicts[0]?.theirsBy.name : "",
        "Eva",
      );
      const refused = [{ path: ["projects", "booking"], label: "Budget", owners: "admins" }];
      on(refusal("settings_forbidden", { refused }), 403);
      const forbidden = yield* client["peer.settings.save"](input);
      assert.deepStrictEqual(forbidden.kind === "forbidden" ? forbidden.refused : [], refused);
      const diagnostics = [
        { severity: "error", at: "projects.booking.leads", message: "lead eva is not a member" },
      ];
      on(refusal("invalid_settings", { diagnostics }), 422);
      const invalid = yield* client["peer.settings.preview"](input);
      assert.deepStrictEqual(invalid.kind === "invalid" ? invalid.diagnostics : [], diagnostics);
      const proposedInvalid = yield* client["peer.settings.propose"]({ ...input, message: "Why" });
      assert.strictEqual(proposedInvalid.kind, "invalid");
      on(refusal("settings_forbidden", { refused }), 403);
      const proposedForbidden = yield* client["peer.settings.propose"]({
        ...input,
        message: "Why",
      });
      assert.strictEqual(proposedForbidden.kind, "forbidden");

      // A secret that is in use, and a domain another workspace holds.
      on(refusal("secret_in_use", { usedBy: ["Shared capacity · the gateway"] }), 409);
      const inUse = yield* client["peer.settings.deleteSecret"]({
        workspace: "acme",
        name: "litellm-master-key",
      });
      assert.deepStrictEqual(inUse, { kind: "in-use", usedBy: ["Shared capacity · the gateway"] });
      const holder = { slug: "other", name: "Other", verified: true };
      on(
        refusal("domain_claimed", {
          domain: "acme.dev",
          record: "peer-hub-verify=7f3c",
          holder,
          dns: "missing",
        }),
        409,
      );
      const claimed = yield* client["peer.settings.updateWorkspace"]({
        workspace: "acme",
        allowedDomains: ["acme.dev"],
      });
      assert.deepStrictEqual(claimed, {
        kind: "domain-claimed",
        domain: "acme.dev",
        record: "peer-hub-verify=7f3c",
        holder,
        dns: "missing",
      });

      // Any other code, details it cannot read, or another status fail as the Hub's own error.
      for (const [status, body] of [
        [403, refusal("forbidden", { refused })],
        [403, refusal("settings_forbidden", { refused: "no" })],
        [422, refusal("invalid_settings", null)],
        [409, refusal("settings_conflict", { nothing: true })],
        [500, refusal("error", null)],
      ] as const) {
        on(body, status);
        const failed = yield* client["peer.settings.save"](input).pipe(Effect.result);
        assert.isTrue(Result.isFailure(failed), `${status}`);
      }
      on(refusal("forbidden", null), 403);
      const secrets = yield* client["peer.settings.secrets"]({ workspace: "acme" }).pipe(
        Effect.result,
      );
      assert.strictEqual(
        Result.isFailure(secrets) && "code" in secrets.failure ? secrets.failure.code : "",
        "forbidden",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps the view for the status after a write, and forgets it on request", () =>
    Effect.gen(function* () {
      let seq = 42;
      const answer: { current: HubAnswer } = {
        current: (url) =>
          url === "/v1/me"
            ? [200, meAnswer({ settings: 1 })]
            : url === `${WS}/settings`
              ? [200, settingsView(seq)]
              : url === `${WS}/settings/proposals?state=pending`
                ? [200, { proposals: [proposal("p_1", true), proposal("p_2", false)] }]
                : [200, { ...dryRun, revision: { seq: 43, commit: "x", at: "x" } }],
      };
      const { status, plugins, client, learn, core } = yield* settingsOn(answer);
      yield* learn;
      const slice = Effect.map(status.publish, (published) => published.settings?.workspaces);
      seq = 43;
      // A save is read back at once: the status names the new revision and what waits for the person.
      const saved = yield* client["peer.settings.save"]({ workspace: "acme", base: 42, set });
      assert.strictEqual(saved.kind, "saved");
      assert.deepStrictEqual(yield* slice, [
        { workspace: "acme", revision: 43, pendingProposals: 1, ownProposals: 1 },
      ]);
      // The service forgets it on request, and keeps only the workspaces it is told to.
      const settings = yield* PeerSettings.pipe(Effect.provide(layer), Effect.provide(core));
      yield* settings.view("acme");
      assert.strictEqual((yield* settings.status).workspaces.length, 1);
      yield* settings.keepOnly(["other"]);
      assert.deepStrictEqual(yield* settings.status, { workspaces: [] });
      yield* settings.view("acme");
      yield* settings.forget;
      assert.deepStrictEqual(yield* settings.status, { workspaces: [] });
      // While the plugin is off, the status has no slice of it at all.
      yield* plugins.setPlugin({ id: "settings", enabled: false });
      assert.isUndefined(yield* slice);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("Settings in the status", () => {
  it.live("is read when the plugin starts and follows the Hub's pings", () =>
    Effect.gen(function* () {
      let seq = 42;
      let waiting: Array<unknown> = [proposal("p_1", true), proposal("p_2", false)];
      const hub = yield* standInHub({
        current: (url) =>
          url === "/v1/me"
            ? [200, meAnswer({ settings: 1 })]
            : url === `${WS}/events`
              ? { events: ": connected\n\n", open: true }
              : url === `${WS}/settings`
                ? [200, settingsView(seq)]
                : url === `${WS}/settings/proposals?state=pending`
                  ? [200, { proposals: waiting }]
                  : [404, {}],
      });
      const core = yield* Layer.build(
        coreLayer(yield* seedState(signedInSeed(hub.url)), {
          session: "phs_test",
          plugins: [SettingsPlugin],
        }),
      );
      yield* Effect.gen(function* () {
        const status = yield* PeerStatus.PeerStatus;
        yield* status.coordinationFrom(() => Effect.succeed(coordination));
        yield* (yield* PeerHubClient).me;
        yield* PeerPlugins.startPlugins;
        const reaches = (revision: number, pending: number, own: number) =>
          status.changes.pipe(
            Stream.filter((published) => {
              const row = published.settings?.workspaces[0];
              return (
                row?.revision === revision &&
                row.pendingProposals === pending &&
                row.ownProposals === own
              );
            }),
            Stream.take(1),
            Stream.runDrain,
            Effect.timeout("10 seconds"),
          );
        yield* (yield* PeerHubEvents)
          .follow({
            readWork: () => Effect.void,
            coordinationChanged: Effect.void,
            projectsChanged: Effect.void,
          })
          .pipe(Effect.forkScoped);
        // Read as the plugin starts: the proposal the person may decide, and the one they made.
        yield* reaches(42, 1, 1);
        // A ping of the settings brings the new revision into the status.
        seq = 43;
        hub.push(`${WS}/events`, 'event: settings\ndata: {"seq":43}\n\n');
        yield* reaches(43, 1, 1);
        // A ping of the proposals brings the new counts: the one they decide is declined...
        waiting = [proposal("p_2", false)];
        hub.push(`${WS}/events`, 'event: settings.proposal\ndata: {"id":"p_1"}\n\n');
        yield* reaches(43, 0, 1);
        // ...and the one they made is withdrawn, which no revision tells.
        waiting = [];
        hub.push(`${WS}/events`, 'event: settings.proposal\ndata: {"id":"p_2"}\n\n');
        yield* reaches(43, 0, 0);
        // The status holds counts and ids, nothing of the settings themselves.
        assert.strictEqual(
          JSON.stringify((yield* status.publish).settings),
          '{"workspaces":[{"workspace":"acme","revision":43,"pendingProposals":0,"ownProposals":0}]}',
        );
      }).pipe(Effect.provide(core));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
