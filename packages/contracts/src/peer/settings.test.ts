import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { PeerHubInviteInput } from "../peerHub.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import {
  PeerDomainRecord,
  PeerSettingsChangeInput,
  PeerSettingsChangeResult,
  PeerSettingsDeleteSecretResult,
  PeerSettingsExport,
  PeerSettingsGatewayTest,
  PeerSettingsGatewayView,
  PeerSettingsGitHubSetup,
  PeerSettingsHistoryPage,
  PeerSettingsPersonEntry,
  PeerSettingsPool,
  PeerSettingsPreview,
  PeerSettingsProject,
  PeerSettingsProposal,
  PeerSettingsProposalsInput,
  PeerSettingsProposeInput,
  PeerSettingsProposeResult,
  PeerSettingsPutSecretInput,
  PeerSettingsRevisionDetail,
  PeerSettingsSaved,
  PeerSettingsSecretsView,
  PeerSettingsStatus,
  settingsLineChange,
  PeerSettingsTool,
  PeerSettingsView,
  PeerSettingsWebhook,
  PeerSettingsWorkspaceUpdate,
} from "./settings.ts";

const view = Schema.decodeUnknownExit(PeerSettingsView);
const preview = Schema.decodeUnknownExit(PeerSettingsPreview);
const saved = Schema.decodeUnknownExit(PeerSettingsSaved);
const result = Schema.decodeUnknownExit(PeerSettingsChangeResult);
const history = Schema.decodeUnknownExit(PeerSettingsHistoryPage);
const detail = Schema.decodeUnknownExit(PeerSettingsRevisionDetail);
const proposal = Schema.decodeUnknownExit(PeerSettingsProposal);
const secrets = Schema.decodeUnknownExit(PeerSettingsSecretsView);
const gateway = Schema.decodeUnknownExit(PeerSettingsGatewayView);
const changeInput = Schema.decodeUnknownExit(PeerSettingsChangeInput);
const proposeInput = Schema.decodeUnknownExit(PeerSettingsProposeInput);
const proposalsInput = Schema.decodeUnknownExit(PeerSettingsProposalsInput);
const proposeResult = Schema.decodeUnknownExit(PeerSettingsProposeResult);
const deleteResult = Schema.decodeUnknownExit(PeerSettingsDeleteSecretResult);
const gatewayTest = Schema.decodeUnknownExit(PeerSettingsGatewayTest);
const gitHubSetup = Schema.decodeUnknownExit(PeerSettingsGitHubSetup);
const domainRecord = Schema.decodeUnknownExit(PeerDomainRecord);
const exported = Schema.decodeUnknownExit(PeerSettingsExport);
const workspaceUpdate = Schema.decodeUnknownExit(PeerSettingsWorkspaceUpdate);
const status = Schema.decodeUnknownExit(PeerSettingsStatus);
const project = Schema.decodeUnknownSync(PeerSettingsProject);
const personEntry = Schema.decodeUnknownSync(PeerSettingsPersonEntry);
const tool = Schema.decodeUnknownSync(PeerSettingsTool);
const pool = Schema.decodeUnknownSync(PeerSettingsPool);
const webhook = Schema.decodeUnknownSync(PeerSettingsWebhook);
const putSecretInput = Schema.decodeUnknownExit(PeerSettingsPutSecretInput);
const invite = Schema.decodeUnknownExit(PeerHubInviteInput);

const eva = { email: "eva@acme.dev", name: "Eva" };
const line: unknown = {
  path: ["projects", "booking", "coordination", "policy"],
  scope: { kind: "project", id: "booking", name: "Booking" },
  label: "Coordination",
  from: "notify",
  to: "coordinate",
};
const conflict: unknown = {
  path: ["projects", "booking", "coordination", "paths", "migrations/**"],
  label: "Path rule · migrations/**",
  base: null,
  mine: "exclusive",
  theirs: "coordinate",
  baseText: "none",
  mineText: "exclusive",
  theirsText: "coordinate",
  theirsBy: eva,
  theirsAt: "2026-10-11T12:02:00Z",
  theirsSeq: 42,
};
const dryRun = {
  base: 41,
  head: { seq: 42, by: eva, at: "2026-10-11T12:02:00Z" },
  lines: [line],
  conflicts: [],
  diagnostics: [
    {
      severity: "warning",
      at: "projects.booking.capacity.shared.allocations",
      message: "allocations commit 650 but the budget is 600",
    },
  ],
  applies: [{ kind: "next-edit", text: "Policy and path rules: from the next file edit" }],
  noop: false,
};
const revision = {
  seq: 42,
  commit: "3f2a9c1e5b7d4e8a9c217d4e5f6a8b90c1d2e3f4",
  at: "2026-10-11T12:00:00Z",
  by: { email: "slavo@acme.dev", name: "Slavo" },
  message: "Two agents broke the schema",
};

describe("GET /settings", () => {
  it("reads the document open, with rights, features and the workspace's people", () => {
    const answer = view({
      revision,
      rights: { admin: false, owner: false, leads: ["booking"] },
      document: {
        currency: "EUR",
        projects: { booking: { name: "Booking" } },
        futureSection: { kept: true },
      },
      features: { pathRules: true, webhooks: true, github: true, future: true },
      people: [{ ...eva, role: "member" }],
    });
    expect(Exit.isSuccess(answer)).toBe(true);
    if (Exit.isSuccess(answer)) {
      expect(answer.value.document.futureSection).toEqual({ kept: true });
      expect(answer.value.rights.leads).toEqual(["booking"]);
    }
  });

  it("reads a head saved without a reason, whose message is null", () => {
    const answer = view({
      revision: { ...revision, message: null },
      rights: { admin: true, owner: true, leads: [] },
      document: {},
      features: { pathRules: true, webhooks: true, github: true },
      people: [],
    });
    expect(Exit.isSuccess(answer) && answer.value.revision.message).toBeNull();
  });

  it("refuses a role no Hub has", () => {
    expect(
      Exit.isFailure(
        view({
          revision,
          rights: { admin: true, owner: true, leads: [] },
          document: {},
          features: { pathRules: false, webhooks: false, github: false },
          people: [{ ...eva, role: "emperor" }],
        }),
      ),
    ).toBe(true);
  });
});

describe("POST /settings/changes", () => {
  it("reads a dry run, a save and an answer from a Hub that adds fields", () => {
    expect(Exit.isSuccess(preview(dryRun))).toBe(true);
    expect(Exit.isSuccess(preview({ ...dryRun, futureField: 1 }))).toBe(true);
    const done = saved({
      ...dryRun,
      revision: { seq: 43, commit: revision.commit, at: "2026-10-11T12:04:00Z" },
      gateway: { ok: true },
      audit: "12:04 · Slavo · Booking · policy notify → coordinate, Eva → lead",
    });
    expect(Exit.isSuccess(done) && done.value.gateway).toEqual({ ok: true });
    const failedGateway = saved({
      ...dryRun,
      revision: { seq: 43, commit: revision.commit, at: "2026-10-11T12:04:00Z" },
      gateway: { error: "the gateway answered 401" },
    });
    expect(Exit.isSuccess(failedGateway) && failedGateway.value.gateway).toEqual({
      error: "the gateway answered 401",
    });
    // A save with nothing to save, and a gateway nothing touched, have neither.
    expect(Exit.isSuccess(saved({ ...dryRun, noop: true, lines: [] }))).toBe(true);
  });

  it("reads a conflict with its raw values, null for absent", () => {
    const answer = preview({ ...dryRun, conflicts: [conflict] });
    expect(Exit.isSuccess(answer)).toBe(true);
    if (Exit.isSuccess(answer)) {
      expect(answer.value.conflicts[0]?.base).toBeNull();
      expect(answer.value.conflicts[0]?.theirsBy.name).toBe("Eva");
    }
    expect(
      Exit.isFailure(
        preview({ ...dryRun, conflicts: [{ ...(conflict as object), theirsSeq: undefined }] }),
      ),
    ).toBe(true);
  });

  it("tells the five ways a change goes, each by its kind", () => {
    const refusal = {
      path: ["projects", "booking", "capacity", "shared", "budget"],
      label: "Budget",
      owners: "admins",
    };
    for (const answer of [
      { kind: "preview", ...dryRun },
      { kind: "saved", ...dryRun, revision: { seq: 43, commit: revision.commit, at: "x" } },
      { kind: "conflict", ...dryRun, conflicts: [conflict] },
      { kind: "forbidden", refused: [refusal] },
      {
        kind: "invalid",
        diagnostics: [
          { severity: "error", at: "projects.booking.leads", message: "lead eva is not a member" },
        ],
      },
    ])
      expect(Exit.isSuccess(result(answer)), answer.kind).toBe(true);
    expect(Exit.isFailure(result({ kind: "forbidden" }))).toBe(true);
    expect(Exit.isFailure(result({ kind: "future-outcome" }))).toBe(true);
  });

  it("sends a set with null to remove a node, and never without a value", () => {
    const base = { workspace: "acme", base: 41 };
    expect(
      Exit.isSuccess(
        changeInput({
          ...base,
          set: [
            { path: ["projects", "booking", "coordination", "policy"], value: "coordinate" },
            { path: ["projects", "booking", "coordination", "paths", "docs/**"], value: null },
          ],
          message: "Two agents broke the schema yesterday",
          force: [["projects", "booking", "coordination", "paths", "migrations/**"]],
          drop: [],
        }),
      ),
    ).toBe(true);
    expect(Exit.isFailure(changeInput({ ...base, set: [{ path: ["projects"] }] }))).toBe(true);
    expect(Exit.isFailure(changeInput({ ...base, set: [], message: "x".repeat(301) }))).toBe(true);
    expect(
      Exit.isFailure(
        changeInput({
          ...base,
          set: Array.from({ length: 201 }, () => ({ path: ["a"], value: 1 })),
        }),
      ),
    ).toBe(true);
    expect(Exit.isFailure(changeInput({ workspace: "acme", set: [] }))).toBe(true);
    expect(Exit.isFailure(changeInput({ workspace: "", base: 1, set: [] }))).toBe(true);
  });
});

describe("history, proposals and supporting routes", () => {
  const entry = {
    ...revision,
    seq: 43,
    source: "app",
    proposal: null,
    lines: [line],
  };

  it("reads the history page and one revision, files for admins only", () => {
    expect(Exit.isSuccess(history({ revisions: [entry], next: 39 }))).toBe(true);
    expect(Exit.isSuccess(history({ revisions: [], next: null }))).toBe(true);
    expect(
      Exit.isSuccess(history({ revisions: [{ ...entry, source: "future", proposal: "p_1" }] })),
    ).toBe(true);
    const admin = detail({
      ...entry,
      files: [{ path: "projects/booking.yaml", diff: "@@ -1 +1 @@\n-notify\n+coordinate\n" }],
    });
    expect(Exit.isSuccess(admin) && admin.value.files?.[0]?.path).toBe("projects/booking.yaml");
    const member = detail(entry);
    expect(Exit.isSuccess(member) && member.value.files).toBeUndefined();
  });

  it("reads lines as the Hub writes them: one thing said, a workspace's without an id", () => {
    const created = {
      path: ["projects", "camp-bot"],
      scope: { kind: "project", id: "camp-bot", name: "Camp-bot" },
      label: "Project",
      to: "created",
      text: "Camp-bot · Project: created",
    };
    const gateway = {
      path: ["gateway"],
      scope: { kind: "workspace", name: "Workspace" },
      label: "Gateway",
      from: "none",
      to: "set up",
      text: "Workspace · Gateway: none → set up",
    };
    const page = history({ revisions: [{ ...entry, lines: [created, gateway] }], next: null });
    expect(Exit.isSuccess(page)).toBe(true);
    const [one, two] = Exit.isSuccess(page) ? (page.value.revisions[0]?.lines ?? []) : [];
    expect(one && settingsLineChange(one)).toBe("created");
    expect(two && settingsLineChange(two)).toBe("none → set up");
    expect(two?.scope.id).toBeUndefined();
  });

  it("reads a proposal as the Hub sends it, nulls included", () => {
    const answer = proposal({
      id: "p_1",
      by: { email: "ana@acme.dev", name: "Ana" },
      via: { kind: "agent", agent: "codex", thread: "t1" },
      at: "2026-10-11T12:00:00Z",
      base: 42,
      message: "Migrations must not run twice",
      instruction: "make migrations exclusive in Booking",
      lines: [line],
      scopes: ["project:booking"],
      owners: "Booking's leads and admins",
      state: "pending",
      decidedBy: null,
      decidedAt: null,
      reason: null,
      revision: null,
      mine: true,
      canDecide: false,
    });
    expect(Exit.isSuccess(answer) && answer.value.via?.agent).toBe("codex");
    expect(
      Exit.isSuccess(
        proposal({
          id: "p_2",
          by: eva,
          via: null,
          at: "x",
          base: 1,
          message: "m",
          instruction: null,
          lines: [],
          scopes: [],
          owners: "admins",
          state: "applied",
          decidedBy: eva,
          decidedAt: "x",
          reason: null,
          revision: 43,
          mine: false,
          canDecide: true,
        }),
      ),
    ).toBe(true);
  });

  it("takes a proposal only with its reason, and its limits", () => {
    const base = {
      workspace: "acme",
      base: 42,
      set: [{ path: ["projects", "booking"], value: { name: "Booking" } }],
    };
    expect(
      Exit.isSuccess(
        proposeInput({ ...base, message: "Why", via: { kind: "agent", agent: "codex" } }),
      ),
    ).toBe(true);
    expect(Exit.isFailure(proposeInput(base))).toBe(true);
    expect(Exit.isFailure(proposeInput({ ...base, message: "  " }))).toBe(true);
    expect(Exit.isFailure(proposeInput({ ...base, message: "x".repeat(301) }))).toBe(true);
    expect(
      Exit.isFailure(proposeInput({ ...base, message: "Why", instruction: "x".repeat(2_001) })),
    ).toBe(true);
    expect(
      Exit.isFailure(
        proposeInput({ ...base, message: "Why", via: { kind: "person", agent: "x" } }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        proposeResult({
          kind: "proposed",
          proposal: {
            id: "p",
            by: eva,
            at: "x",
            base: 1,
            message: "m",
            lines: [],
            scopes: [],
            owners: "admins",
            state: "pending",
            mine: true,
            canDecide: false,
          },
        }),
      ),
    ).toBe(true);
  });

  it("reads secrets with what uses them, and the ones nobody stored", () => {
    expect(
      Exit.isSuccess(
        secrets({
          secrets: [
            {
              name: "litellm-master-key",
              at: "2026-10-11T08:00:00Z",
              by: eva,
              usedBy: ["Shared capacity · the gateway"],
            },
            { name: "unused", at: null, by: null, usedBy: [] },
          ],
          missing: [
            { name: "TEAMS_ALERTS_URL", usedBy: ["Webhook “Teams alerts” · off until set"] },
          ],
        }),
      ),
    ).toBe(true);
    const name = (value: string) => putSecretInput({ workspace: "acme", name: value, value: "s" });
    expect(Exit.isSuccess(name("litellm-master-key"))).toBe(true);
    expect(Exit.isSuccess(name("TEAMS_ALERTS_URL"))).toBe(true);
    expect(Exit.isFailure(name("has space"))).toBe(true);
    expect(Exit.isFailure(name("a".repeat(65)))).toBe(true);
    expect(Exit.isSuccess(deleteResult({ kind: "in-use", usedBy: ["Shared capacity"] }))).toBe(
      true,
    );
  });

  it("reads the gateway, configured or not, and its test", () => {
    const configured = gateway({
      configured: true,
      url: "https://llm.acme.dev",
      adminUrl: null,
      usdPerUnit: 1.08,
      currency: "EUR",
      masterKey: { stored: true, at: "2026-10-11T08:00:00Z", by: eva },
      sync: {
        at: "2026-10-11T09:00:00Z",
        ok: false,
        error: "the gateway answered 401",
        lastOkAt: "2026-10-10T09:00:00Z",
      },
    });
    expect(Exit.isSuccess(configured) && configured.value.sync?.error).toBe(
      "the gateway answered 401",
    );
    expect(
      Exit.isSuccess(
        gateway({
          configured: false,
          url: null,
          adminUrl: null,
          usdPerUnit: null,
          currency: null,
          masterKey: { stored: false },
          sync: null,
        }),
      ),
    ).toBe(true);
    const listed = gatewayTest({ ok: true, models: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
    expect(Exit.isSuccess(listed) && listed.value.models).toEqual([
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    expect(Exit.isSuccess(gatewayTest({ ok: false, error: "no key" }))).toBe(true);
  });

  it("reads the GitHub setup, a secret only when new, the domain record and the export", () => {
    const setup = gitHubSetup;
    expect(
      Exit.isSuccess(
        setup({
          payloadUrl: "https://hub.acme.dev/v1/github/acme",
          secret: "s3cr3t",
          secretName: "github-webhook",
          events: "pull_request",
          revision: 44,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        setup({
          payloadUrl: "https://hub.acme.dev/v1/github/acme",
          secret: null,
          secretName: "github-webhook",
          events: "pull_request",
          revision: null,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        domainRecord({
          domain: "acme-studio.com",
          record: "peer-hub-verify=7f3c",
          state: "listed",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        exported({
          revision: { seq: 42, commit: revision.commit },
          files: {
            "workspace.yaml": "currency: EUR\n",
            ".peer-revision": `42 ${revision.commit}\n`,
          },
        }),
      ),
    ).toBe(true);
  });

  it("tells a rename from a domain another workspace holds", () => {
    const update = workspaceUpdate;
    expect(
      Exit.isSuccess(
        update({
          kind: "updated",
          workspace: { slug: "acme", name: "Acme", allowedDomains: ["acme.dev"] },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        update({
          kind: "domain-claimed",
          domain: "acme.dev",
          record: "peer-hub-verify=7f3c",
          message: "Other holds @acme.dev.",
          holder: { slug: "other", name: "Other", verified: true },
          dns: "missing",
        }),
      ),
    ).toBe(true);
  });
});

describe("the parts of the document the app reads", () => {
  it("keeps every key it does not name, at every level", () => {
    const read = project({
      name: "Booking",
      client: "Northwind Hotels",
      members: ["*"],
      leads: ["eva@acme.dev"],
      repositories: [
        {
          id: "opera-bridge",
          url: "https://github.com/acme/opera.git",
          branch: "main",
          futureRepo: 1,
        },
      ],
      tools: ["postgres", { tool: "sentry", env: { DSN: "${secret:SENTRY_DSN}" } }],
      knowledge: { kontext: true, company: false },
      capacity: {
        personal: "commercial",
        shared: {
          pool: "default",
          budget: { amount: 600, period: "month", future: true },
          allocations: { "bob@acme.dev": 120 },
          defaultAllocation: 40,
          use: ["on-demand"],
        },
      },
      coordination: { policy: "coordinate", paths: { "migrations/**": "exclusive" } },
      futureField: { deep: [1, 2] },
    });
    expect(read.futureField).toEqual({ deep: [1, 2] });
    expect(read.repositories[0]?.futureRepo).toBe(1);
    expect(read.capacity.shared?.budget.future).toBe(true);
    expect(read.coordination?.paths?.["migrations/**"]).toBe("exclusive");
    expect(read.tools).toHaveLength(2);
  });

  it("reads people, tools, pools and webhooks", () => {
    expect(
      personEntry({ name: "Ana", personal: [{ harness: "codex", plan: "team", seat: "x" }] })
        .personal?.[0]?.seat,
    ).toBe("x");
    expect(personEntry({}).personal).toBeUndefined();
    expect(
      tool({
        name: "Postgres staging",
        mcp: { transport: "stdio", command: "npx", args: ["pg"], env: { URL: "${secret:PG}" } },
        requires: [{ command: "npx", install: "brew install node" }],
        future: 1,
      }).future,
    ).toBe(1);
    expect(
      pool({
        name: "Default",
        models: [
          {
            id: "claude-sonnet-5-5",
            provider: "anthropic",
            harness: ["claude"],
            upstream: "x",
            extra: 1,
          },
        ],
      }).models[0]?.extra,
    ).toBe(1);
    expect(
      webhook({
        format: "teams",
        url: "${secret:TEAMS_ALERTS_URL}",
        events: ["overlap.ask"],
        signingSecret: ["${secret:TEAMS_SIGN}"],
        enabled: true,
      }).signingSecret,
    ).toEqual(["${secret:TEAMS_SIGN}"]);
  });
});

describe("wiring", () => {
  it("lists the plugin last, so it adds nothing before another plugin's text", () => {
    expect(PEER_PLUGIN_IDS.at(-1)).toBe("settings");
  });

  it("places the status slice in its own optional field", () => {
    const is = Schema.is(Schema.Struct(peerPluginStatusFields));
    expect(is({})).toBe(true);
    expect(
      is({ settings: { workspaces: [{ workspace: "acme", revision: 42, pendingProposals: 1 }] } }),
    ).toBe(true);
    expect(is({ settings: { workspaces: [{ workspace: "acme", revision: 42 }] } })).toBe(false);
    expect(
      Exit.isFailure(
        status({ workspaces: [{ workspace: "acme", revision: -1, pendingProposals: 0 }] }),
      ),
    ).toBe(true);
  });

  it("counts the person's own pending proposals beside those they decide, as an environment may not", () => {
    const own = status({
      workspaces: [{ workspace: "acme", revision: 42, pendingProposals: 1, ownProposals: 2 }],
    });
    expect(Exit.isSuccess(own) && own.value.workspaces[0]?.ownProposals).toBe(2);
    const before = status({
      workspaces: [{ workspace: "acme", revision: 42, pendingProposals: 1 }],
    });
    expect(Exit.isSuccess(before) && before.value.workspaces[0]?.ownProposals).toBeUndefined();
    expect(
      Exit.isFailure(
        status({
          workspaces: [{ workspace: "acme", revision: 42, pendingProposals: 0, ownProposals: -1 }],
        }),
      ),
    ).toBe(true);
  });

  it("keys the proposals query by what the status says, all of it optional", () => {
    expect(Exit.isSuccess(proposalsInput({ workspace: "acme", state: "pending" }))).toBe(true);
    const keyed = proposalsInput({
      workspace: "acme",
      state: "pending",
      waiting: 1,
      own: 2,
      revision: 43,
    });
    expect(
      Exit.isSuccess(keyed) && [keyed.value.waiting, keyed.value.own, keyed.value.revision],
    ).toEqual([1, 2, 43]);
    expect(Exit.isFailure(proposalsInput({ workspace: "acme", own: -1 }))).toBe(true);
    expect(Exit.isFailure(proposalsInput({ workspace: "acme", revision: 1.5 }))).toBe(true);
  });

  it("invites with a role of member or admin, member when none is given", () => {
    expect(Exit.isSuccess(invite({ workspace: "acme", email: "bob@acme.dev" }))).toBe(true);
    expect(
      Exit.isSuccess(invite({ workspace: "acme", email: "bob@acme.dev", role: "admin" })),
    ).toBe(true);
    expect(
      Exit.isSuccess(invite({ workspace: "acme", email: "bob@acme.dev", role: "member" })),
    ).toBe(true);
    expect(
      Exit.isFailure(invite({ workspace: "acme", email: "bob@acme.dev", role: "owner" })),
    ).toBe(true);
  });
});
