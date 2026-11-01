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
  PeerSettingsPersonEntry,
  PeerSettingsPreview,
  PeerSettingsProject,
  PeerSettingsPutSecretInput,
  PeerSettingsSaved,
  PeerSettingsSecretsView,
  PeerSettingsStatus,
  settingsLineChange,
  PeerSettingsTool,
  PeerSettingsView,
  PeerSettingsWorkspaceUpdate,
} from "./settings.ts";

const view = Schema.decodeUnknownExit(PeerSettingsView);
const preview = Schema.decodeUnknownExit(PeerSettingsPreview);
const saved = Schema.decodeUnknownExit(PeerSettingsSaved);
const result = Schema.decodeUnknownExit(PeerSettingsChangeResult);
const secrets = Schema.decodeUnknownExit(PeerSettingsSecretsView);
const changeInput = Schema.decodeUnknownExit(PeerSettingsChangeInput);
const domainRecord = Schema.decodeUnknownExit(PeerDomainRecord);
const workspaceUpdate = Schema.decodeUnknownExit(PeerSettingsWorkspaceUpdate);
const status = Schema.decodeUnknownExit(PeerSettingsStatus);
const project = Schema.decodeUnknownSync(PeerSettingsProject);
const personEntry = Schema.decodeUnknownSync(PeerSettingsPersonEntry);
const tool = Schema.decodeUnknownSync(PeerSettingsTool);
const putSecretInput = Schema.decodeUnknownExit(PeerSettingsPutSecretInput);
const invite = Schema.decodeUnknownExit(PeerHubInviteInput);

const eva = { email: "eva@acme.dev", name: "Eva" };
const line: unknown = {
  path: ["projects", "booking", "name"],
  scope: { kind: "project", id: "booking", name: "Booking" },
  label: "Name",
  from: "Booking",
  to: "Bookings",
};
const conflict: unknown = {
  path: ["projects", "booking", "name"],
  label: "Name",
  base: null,
  mine: "Bookings",
  theirs: "Reservations",
  baseText: "none",
  mineText: "Bookings",
  theirsText: "Reservations",
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
      at: "projects.booking.leads",
      message: "lead eva is not a member",
    },
  ],
  applies: [{ kind: "now", text: "At once" }],
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
      audit: "12:04 · Slavo · Booking · policy notify → coordinate, Eva → lead",
    });
    expect(Exit.isSuccess(done)).toBe(true);
    // A save with nothing to save has no revision.
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

describe("supporting routes", () => {
  it("reads lines as the Hub writes them: one thing said, a workspace's without an id", () => {
    const created = {
      path: ["projects", "camp-bot"],
      scope: { kind: "project", id: "camp-bot", name: "Camp-bot" },
      label: "Project",
      to: "created",
      text: "Camp-bot · Project: created",
    };
    const secondLine = {
      path: ["currency"],
      scope: { kind: "workspace", name: "Workspace" },
      label: "Currency",
      from: "none",
      to: "EUR",
      text: "Workspace · Currency: none → EUR",
    };
    const read = preview({ ...dryRun, lines: [created, secondLine] });
    expect(Exit.isSuccess(read)).toBe(true);
    const [one, two] = Exit.isSuccess(read) ? read.value.lines : [];
    expect(one && settingsLineChange(one)).toBe("created");
    expect(two && settingsLineChange(two)).toBe("none → EUR");
    expect(two?.scope.id).toBeUndefined();
  });

  it("reads secrets as the Hub sends them, with what it keeps for one release", () => {
    const read = secrets({
      secrets: [
        { name: "litellm-master-key", at: "2026-10-11T08:00:00Z", by: eva, usedBy: [] },
        { name: "unused", at: null, by: null },
      ],
      missing: [],
    });
    expect(Exit.isSuccess(read) && read.value.secrets.map(({ name }) => name)).toEqual([
      "litellm-master-key",
      "unused",
    ]);
    const name = (value: string) => putSecretInput({ workspace: "acme", name: value, value: "s" });
    expect(Exit.isSuccess(name("litellm-master-key"))).toBe(true);
    expect(Exit.isSuccess(name("TEAMS_ALERTS_URL"))).toBe(true);
    expect(Exit.isFailure(name("has space"))).toBe(true);
    expect(Exit.isFailure(name("a".repeat(65)))).toBe(true);
  });

  it("reads the domain record", () => {
    expect(
      Exit.isSuccess(
        domainRecord({
          domain: "acme-studio.com",
          record: "peer-hub-verify=7f3c",
          state: "listed",
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
      futureField: { deep: [1, 2] },
    });
    expect(read.futureField).toEqual({ deep: [1, 2] });
    expect(read.repositories[0]?.futureRepo).toBe(1);
    expect(read.tools).toHaveLength(2);
  });

  it("reads people and tools", () => {
    expect(personEntry({ name: "Ana", seat: "x" }).seat).toBe("x");
    expect(
      tool({
        name: "Postgres staging",
        mcp: { transport: "stdio", command: "npx", args: ["pg"], env: { URL: "${secret:PG}" } },
        requires: [{ command: "npx", install: "brew install node" }],
        future: 1,
      }).future,
    ).toBe(1);
  });
});

describe("wiring", () => {
  it("lists the plugin last, so it adds nothing before another plugin's text", () => {
    expect(PEER_PLUGIN_IDS.at(-1)).toBe("settings");
  });

  it("places the status slice in its own optional field", () => {
    const is = Schema.is(Schema.Struct(peerPluginStatusFields));
    expect(is({})).toBe(true);
    expect(is({ settings: { workspaces: [{ workspace: "acme", revision: 42 }] } })).toBe(true);
    expect(is({ settings: { workspaces: [{ workspace: "acme" }] } })).toBe(false);
    expect(Exit.isFailure(status({ workspaces: [{ workspace: "acme", revision: -1 }] }))).toBe(
      true,
    );
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
