import { describe, expect, it } from "@effect/vitest";
import type { PeerSlackAdminResult } from "@t3tools/contracts";
import { slackManifest } from "@t3tools/client-runtime/peer/slack";

import {
  EMPTY_SLACK_HINTS,
  SLACK_OVERVIEW,
  SLACK_SCOPE_GROUPS,
  hintConfirmed,
  hintCreated,
  hintOpened,
  hintTicked,
  slackCreateFacts,
  slackDoneText,
  slackExistingFacts,
  slackFlow,
  slackHintsKey,
  slackPlaceSentence,
  slackSecretsLabel,
  slackStartingFlow,
  slackStepAfter,
  slackStepBefore,
  slackSteps,
  slackTeamLooksRight,
  slackVerifyPlan,
  slackVerifyResult,
  type SlackHints,
} from "./slackSteps.logic";
import { SLACK_STEP_ORDER } from "./slack.logic";

const workspace = { name: "Acme", slug: "acme" };
const channel = { id: "C1", name: "peer-agents", private: false };
const missing = { botToken: "missing", signingSecret: "missing" } as const;
const stored = { botToken: "stored", signingSecret: "stored" } as const;
const unverified = {
  state: "off",
  team: null,
  bot: null,
  verifiedAt: null,
  default: null,
} as const;

const admin = (changes: Partial<PeerSlackAdminResult> = {}): PeerSlackAdminResult => ({
  state: "connected",
  secrets: stored,
  team: { id: "T1", name: "Acme" },
  bot: { name: "peer", user: "U9", app: "A1" },
  verifiedAt: "2026-10-10T08:00:00Z",
  auth: null,
  default: channel,
  projects: [],
  lastPostAt: null,
  lastFailure: null,
  linkedMembers: 0,
  openAsks: 0,
  hubUrl: "https://hub.example.com",
  manifest: {
    eventsUrl: "https://hub.example.com/v1/workspaces/acme/slack/events",
    actionsUrl: "https://hub.example.com/v1/workspaces/acme/slack/actions",
  },
  ...changes,
});
const project = (changes: Partial<PeerSlackAdminResult["projects"][number]> = {}) => ({
  id: "webshop",
  name: "Webshop",
  restricted: false,
  channel: null,
  mode: "thread",
  problem: null,
  ...changes,
});

const ago = (iso: string) => (iso === "2026-10-10T08:56:00Z" ? "4 min ago" : "a while ago");
const hints = (changes: Partial<SlackHints> = {}): SlackHints => ({
  ...EMPTY_SLACK_HINTS,
  ...changes,
});
const stepsOf = (view: PeerSlackAdminResult, kept: SlackHints = EMPTY_SLACK_HINTS) =>
  slackSteps({ admin: view, hints: kept, workspace, ago });
const states = (view: ReturnType<typeof stepsOf>) => view.rows.map((row) => row.state);

describe("what the admin did in Slack, kept in this browser", () => {
  it("starts with nothing and keeps one record per workspace", () => {
    expect(EMPTY_SLACK_HINTS).toEqual({
      openedAt: null,
      created: false,
      ticks: [],
      confirmedTeam: null,
    });
    expect(slackHintsKey("acme")).toBe("peer:slack-setup:acme");
    expect(slackHintsKey("globex")).not.toBe(slackHintsKey("acme"));
  });

  it("remembers that Slack was opened, that the app is created and which workspace was accepted", () => {
    expect(hintOpened(EMPTY_SLACK_HINTS, "2026-10-10T08:56:00Z").openedAt).toBe(
      "2026-10-10T08:56:00Z",
    );
    expect(hintCreated(EMPTY_SLACK_HINTS, true).created).toBe(true);
    expect(hintCreated(hintCreated(EMPTY_SLACK_HINTS, true), false).created).toBe(false);
    expect(hintConfirmed(EMPTY_SLACK_HINTS, "T1").confirmedTeam).toBe("T1");
    expect(hintConfirmed(hintConfirmed(EMPTY_SLACK_HINTS, "T1"), null).confirmedTeam).toBeNull();
  });

  it("ticks and unticks a check once, whatever the order", () => {
    const one = hintTicked(EMPTY_SLACK_HINTS, "workspace", true);
    expect(hintTicked(one, "workspace", true).ticks).toEqual(["workspace"]);
    const both = hintTicked(one, "permissions", true);
    expect(both.ticks).toEqual(["workspace", "permissions"]);
    expect(hintTicked(both, "workspace", false).ticks).toEqual(["permissions"]);
    expect(hintTicked(EMPTY_SLACK_HINTS, "workspace", false).ticks).toEqual([]);
  });

  it("changes one thing and leaves the rest", () => {
    const kept = hintCreated(hintOpened(EMPTY_SLACK_HINTS, "2026-10-10T08:56:00Z"), true);
    expect(hintConfirmed(kept, "T1")).toEqual({
      openedAt: "2026-10-10T08:56:00Z",
      created: true,
      ticks: [],
      confirmedTeam: "T1",
    });
  });
});

describe("whether a Slack workspace is the Peer workspace", () => {
  it("accepts a name that holds the workspace's name or address, in any case and spelling", () => {
    expect(slackTeamLooksRight("Acme", workspace)).toBe(true);
    expect(slackTeamLooksRight("ACME HQ", workspace)).toBe(true);
    expect(slackTeamLooksRight("acme-labs", workspace)).toBe(true);
    expect(slackTeamLooksRight("Web Inson", { name: "Webinson", slug: "webinson" })).toBe(true);
    expect(slackTeamLooksRight("Café", { name: "Cafe Bar", slug: "cafe-bar" })).toBe(true);
    expect(slackTeamLooksRight("Globex", { name: "Globex Corporation", slug: "globex" })).toBe(
      true,
    );
  });

  it("rejects a name that has nothing to do with it", () => {
    expect(slackTeamLooksRight("Acme Sandbox", { name: "Webinson", slug: "webinson" })).toBe(false);
    expect(slackTeamLooksRight("Initech", workspace)).toBe(false);
  });

  it("does not hold a name too short to say anything against the admin", () => {
    expect(slackTeamLooksRight("AB", workspace)).toBe(true);
    expect(slackTeamLooksRight("", workspace)).toBe(true);
  });
});

describe("the steps and where setup opens", () => {
  it("opens at step 1 before anything was done, with nothing to resume", () => {
    const view = stepsOf(admin({ ...unverified, secrets: missing }));
    expect(view.current).toBe("create");
    expect(view.progress).toBe("Step 1 of 4");
    expect(view.resume).toBeNull();
    expect(states(view)).toEqual(["current", "later", "later", "later"]);
    expect(view.rows.map((row) => row.summary)).toEqual(["Now", "Later", "Later", "Later"]);
    expect(view.rows.map((row) => row.n)).toEqual([1, 2, 3, 4]);
    expect(view.rows.map((row) => row.where)).toEqual(["In Slack", "In Slack, then here", "", ""]);
  });

  it("opens at step 2 when the admin opened Slack, left and came back, and says what is next", () => {
    const view = stepsOf(
      admin({ ...unverified, secrets: missing }),
      hints({ openedAt: "2026-10-10T08:56:00Z" }),
    );
    expect(view.current).toBe("secrets");
    expect(view.progress).toBe("Step 2 of 4");
    expect(view.resume).toBe(
      "You opened Slack 4 min ago. Next: install the app and copy two values.",
    );
    expect(states(view)).toEqual(["done", "current", "later", "later"]);
    expect(view.rows[0]?.summary).toBe("Opened Slack 4 min ago");
  });

  it("keeps the admin's own tick: the app is created, so install it and copy two values", () => {
    const view = stepsOf(admin({ ...unverified, secrets: missing }), hints({ created: true }));
    expect(view.current).toBe("secrets");
    expect(view.resume).toBe("The app is created. Next: install it and copy two values.");
    expect(view.rows[0]?.summary).toBe("Created in Slack");
  });

  it("trusts the Hub over the hints: a stored value means the app exists", () => {
    const view = stepsOf(
      admin({ ...unverified, state: "needs-setup", secrets: { ...missing, botToken: "stored" } }),
    );
    expect(view.current).toBe("secrets");
    expect(states(view)).toEqual(["done", "current", "later", "later"]);
    expect(view.resume).toBe("The bot token is stored. Next: copy the signing secret.");
    const other = stepsOf(
      admin({
        ...unverified,
        state: "needs-setup",
        secrets: { ...missing, signingSecret: "stored" },
      }),
    );
    expect(other.resume).toBe("The signing secret is stored. Next: copy the bot token.");
  });

  it("opens at step 3 once both values are stored, never at the start, whatever the hints say", () => {
    for (const state of ["off", "needs-setup"]) {
      const view = stepsOf(admin({ ...unverified, state }));
      expect(view.current).toBe("verify");
      expect(view.progress).toBe("Step 3 of 4");
      expect(view.resume).toBe("Both values are stored. Next: let Slack confirm them.");
      expect(states(view)).toEqual(["done", "done", "current", "later"]);
      expect(view.rows[1]?.summary).toBe("Bot token and signing secret stored");
    }
  });

  it("stays at verify when Slack refused the token, and says to fix the values", () => {
    const view = stepsOf(
      admin({
        ...unverified,
        state: "needs-setup",
        auth: { code: "invalid_auth", at: "2026-10-10T09:00:00Z" },
      }),
    );
    expect(view.current).toBe("verify");
    expect(view.resume).toBe("Slack did not accept the values. Fix them, then verify again.");
  });

  it("holds step 3 open once Slack found the app, until the admin says it is theirs", () => {
    const noPlace = { default: null, projects: [project({ mode: "unset" })] };
    const view = stepsOf(admin(noPlace));
    expect(view.current).toBe("verify");
    expect(view.resume).toBe(
      "Slack says these values belong to Acme. Next: check that this is the workspace you mean.",
    );
    const other = slackSteps({
      admin: admin({ ...noPlace, team: { id: "T9", name: "Acme Sandbox" } }),
      hints: EMPTY_SLACK_HINTS,
      workspace: { name: "Webinson", slug: "webinson" },
      ago,
    });
    expect(other.current).toBe("verify");
    expect(other.resume).toBe(
      "Slack says these values belong to Acme Sandbox, which does not look like Webinson. Check it before going on.",
    );
  });

  it("goes on to the channels once the admin confirmed the Slack workspace", () => {
    const view = stepsOf(
      admin({ default: null, projects: [project({ mode: "unset" })] }),
      hints({ confirmedTeam: "T1" }),
    );
    expect(view.current).toBe("channels");
    expect(view.progress).toBe("Step 4 of 4");
    expect(view.resume).toBe("Verified. Last step: where agents post.");
    expect(states(view)).toEqual(["done", "done", "done", "current"]);
    expect(view.rows[2]?.summary).toBe("Acme · @peer");
  });

  it("asks again when the app is another Slack workspace than the one confirmed", () => {
    const view = stepsOf(
      admin({ default: null, team: { id: "T2", name: "Globex" }, projects: [] }),
      hints({ confirmedTeam: "T1" }),
    );
    expect(view.current).toBe("verify");
  });

  it("is done when agents have somewhere to post, whatever the hints hold", () => {
    const view = stepsOf(admin());
    expect(view.current).toBeNull();
    expect(view.progress).toBe("Done");
    expect(view.resume).toBeNull();
    expect(states(view)).toEqual(["done", "done", "done", "done"]);
    expect(view.rows.map((row) => row.summary)).toEqual([
      "Created in Acme",
      "Bot token and signing secret stored",
      "Acme · @peer",
      "#peer-agents",
    ]);
  });

  it("starts at verify again after Disconnect, since the values stay stored", () => {
    const view = stepsOf(admin({ state: "off", team: null, bot: null, verifiedAt: null }));
    expect(view.current).toBe("verify");
    expect(view.rows[3]?.summary).toBe("Later");
  });

  it("opens at the stepper once anything was done, else at the two ways in", () => {
    expect(slackStartingFlow(admin({ ...unverified, secrets: missing }), EMPTY_SLACK_HINTS)).toBe(
      "choose",
    );
    expect(
      slackStartingFlow(
        admin({ ...unverified, secrets: missing }),
        hints({ openedAt: "2026-10-10T08:56:00Z" }),
      ),
    ).toBe("create");
    expect(
      slackStartingFlow(admin({ ...unverified, secrets: missing }), hints({ created: true })),
    ).toBe("create");
    expect(slackStartingFlow(admin({ ...unverified }), EMPTY_SLACK_HINTS)).toBe("create");
    expect(slackStartingFlow(admin(), EMPTY_SLACK_HINTS)).toBe("create");
  });

  it("shows what the admin picked, and the stepper at its end once the setup is done", () => {
    const fresh = admin({ ...unverified, secrets: missing });
    const flow = (
      chosen: Parameters<typeof slackFlow>[0]["chosen"],
      view: PeerSlackAdminResult,
      kept: SlackHints = EMPTY_SLACK_HINTS,
    ) =>
      slackFlow({ chosen, admin: view, hints: kept, done: stepsOf(view, kept).current === null });
    expect(flow(null, fresh)).toBe("choose");
    expect(flow("existing", fresh)).toBe("existing");
    expect(flow("create", fresh)).toBe("create");
    expect(flow("existing", admin())).toBe("create");
    expect(flow(null, admin())).toBe("create");
  });

  it("keeps the two ways in for a setup nothing has started, and drops them once it has", () => {
    const fresh = admin({ ...unverified, secrets: missing });
    const left = hints({ openedAt: "2026-10-10T08:56:00Z" });
    const flow = (view: PeerSlackAdminResult, kept: SlackHints) =>
      slackFlow({ chosen: "choose", admin: view, hints: kept, done: false });
    expect(flow(fresh, EMPTY_SLACK_HINTS)).toBe("choose");
    // Slack was opened, or another admin stored a value: the stepper goes on from there.
    expect(flow(fresh, left)).toBe("create");
    expect(flow(admin({ ...unverified }), EMPTY_SLACK_HINTS)).toBe("create");
  });

  it("walks back and forward through the steps, and stops at the ends", () => {
    expect(slackStepBefore("create")).toBeNull();
    expect(SLACK_STEP_ORDER.map(slackStepBefore)).toEqual([null, "create", "secrets", "verify"]);
    expect(SLACK_STEP_ORDER.map(slackStepAfter)).toEqual(["secrets", "verify", "channels", null]);
  });

  it("names the four steps once, short, for the overview before setup starts", () => {
    expect(SLACK_OVERVIEW.map((step) => step.id)).toEqual(SLACK_STEP_ORDER);
    expect(SLACK_OVERVIEW.map((step) => step.title)).toEqual([
      "Create the app",
      "Store two values",
      "Verify",
      "Choose where agents post",
    ]);
  });
});

describe("what Verify found out", () => {
  const noPlace = { default: null, projects: [project({ mode: "unset" })] };

  it("has nothing to say before Slack was asked", () => {
    expect(slackVerifyResult(admin({ ...unverified }), workspace, EMPTY_SLACK_HINTS)).toEqual({
      kind: "pending",
    });
    expect(
      slackVerifyResult(admin({ ...unverified, secrets: missing }), workspace, EMPTY_SLACK_HINTS),
    ).toEqual({ kind: "pending" });
  });

  it("says Slack rejected the token, in words for the codes a token fails with", () => {
    for (const code of ["invalid_auth", "token_revoked"]) {
      const result = slackVerifyResult(
        admin({ ...unverified, state: "needs-setup", auth: { code, at: "2026-10-10T09:00:00Z" } }),
        workspace,
        EMPTY_SLACK_HINTS,
      );
      expect(result).toMatchObject({ kind: "rejected", code });
      expect(result.kind === "rejected" ? result.text : "").toContain(
        "Copy it again from OAuth & Permissions",
      );
    }
    const other = slackVerifyResult(
      admin({
        ...unverified,
        state: "needs-setup",
        auth: { code: "account_inactive", at: "2026-10-10T09:00:00Z" },
      }),
      workspace,
      EMPTY_SLACK_HINTS,
    );
    expect(other).toMatchObject({
      kind: "rejected",
      code: "account_inactive",
      text: "The Slack workspace or the bot's user was deleted or deactivated.",
    });
  });

  it("names the Slack workspace and bot the values belong to, before any channel is chosen", () => {
    expect(slackVerifyResult(admin(noPlace), workspace, EMPTY_SLACK_HINTS)).toEqual({
      kind: "verified",
      team: { id: "T1", name: "Acme" },
      bot: "@peer",
      looksRight: true,
      confirmed: false,
    });
  });

  it("says when the Slack workspace does not look like the Peer workspace", () => {
    const result = slackVerifyResult(
      admin({ ...noPlace, team: { id: "T9", name: "Acme Sandbox" } }),
      { name: "Webinson", slug: "webinson" },
      EMPTY_SLACK_HINTS,
    );
    expect(result).toMatchObject({ kind: "verified", looksRight: false, confirmed: false });
  });

  it("counts a Slack workspace as confirmed once the admin accepted it, or posting works", () => {
    const accepted = slackVerifyResult(
      admin({ ...noPlace, team: { id: "T9", name: "Acme Sandbox" } }),
      { name: "Webinson", slug: "webinson" },
      hints({ confirmedTeam: "T9" }),
    );
    expect(accepted).toMatchObject({ kind: "verified", looksRight: false, confirmed: true });
    expect(slackVerifyResult(admin(), workspace, EMPTY_SLACK_HINTS)).toMatchObject({
      kind: "verified",
      confirmed: true,
    });
  });

  it("names no bot when the Hub sent none", () => {
    expect(
      slackVerifyResult(admin({ ...noPlace, bot: null }), workspace, EMPTY_SLACK_HINTS),
    ).toMatchObject({ kind: "verified", bot: null });
  });
});

describe("the scopes in words", () => {
  it("explain each group by what Peer does with it, with Slack's names in small type", () => {
    expect(SLACK_SCOPE_GROUPS.map((group) => group.what)).toEqual([
      "Post and ask",
      "Read the answers",
      "Find people by email",
      "See and join channels",
    ]);
    for (const group of SLACK_SCOPE_GROUPS) {
      expect(group.why).not.toBe("");
      expect(group.ids.length).toBeGreaterThan(0);
    }
  });

  it("add up to exactly the scopes the manifest asks for, each once", () => {
    const listed = SLACK_SCOPE_GROUPS.flatMap((group) => group.ids);
    const manifest = slackManifest("https://hub.example.com", "acme").oauth_config.scopes.bot;
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].toSorted()).toEqual([...manifest].toSorted());
  });
});

describe("an app that already exists", () => {
  it("shows the two addresses the Hub answers on and where each goes in Slack", () => {
    const facts = slackExistingFacts(admin(), "acme");
    expect(facts.urls).toEqual([
      {
        id: "events",
        where: "Event Subscriptions › Request URL",
        url: "https://hub.example.com/v1/workspaces/acme/slack/events",
      },
      {
        id: "actions",
        where: "Interactivity & Shortcuts › Request URL",
        url: "https://hub.example.com/v1/workspaces/acme/slack/actions",
      },
    ]);
  });

  it("names the bot events and counts the scopes a new app gets", () => {
    const facts = slackExistingFacts(admin(), "acme");
    expect(facts.botEvents).toEqual(["message.channels", "message.groups", "message.im"]);
    expect(facts.scopeCount).toBe(11);
    expect(facts.scopeCount).toBe(SLACK_SCOPE_GROUPS.flatMap((group) => group.ids).length);
  });

  it("builds Slack's page for a new app with this Hub's manifest, and names the Hub", () => {
    const facts = slackCreateFacts(admin(), "acme");
    expect(facts.host).toBe("hub.example.com");
    const link = new URL(facts.url);
    expect(`${link.origin}${link.pathname}`).toBe("https://api.slack.com/apps");
    expect(JSON.parse(link.searchParams.get("manifest_json") ?? "")).toEqual(
      slackManifest("https://hub.example.com", "acme"),
    );
    expect(slackCreateFacts(admin({ hubUrl: "not a url" }), "acme").host).toBe("not a url");
  });
});

describe("saving the values and verifying them", () => {
  const view = (changes: Partial<PeerSlackAdminResult> = {}) => admin(changes);
  const none = { botToken: "", signingSecret: "" };

  it("is blocked, saying which value is missing, while a value is neither stored nor pasted", () => {
    expect(slackVerifyPlan(view({ secrets: missing }), "acme", none)).toEqual({
      kind: "blocked",
      reason: "Paste the bot token and the signing secret.",
    });
    expect(
      slackVerifyPlan(view({ secrets: missing }), "acme", { ...none, botToken: "xoxb-1-a" }),
    ).toEqual({ kind: "blocked", reason: "Paste the signing secret." });
    expect(
      slackVerifyPlan(view({ secrets: missing }), "acme", { ...none, signingSecret: "0f1e" }),
    ).toEqual({ kind: "blocked", reason: "Paste the bot token." });
  });

  it("saves what is pasted, then verifies", () => {
    expect(
      slackVerifyPlan(view({ secrets: missing }), "acme", {
        botToken: " xoxb-1-a ",
        signingSecret: "0f1e",
      }),
    ).toEqual({
      kind: "run",
      label: "Save and verify",
      save: { workspace: "acme", botToken: "xoxb-1-a", signingSecret: "0f1e" },
    });
  });

  it("saves one pasted value beside the one that is stored", () => {
    expect(
      slackVerifyPlan(view({ secrets: { botToken: "stored", signingSecret: "missing" } }), "acme", {
        ...none,
        signingSecret: "0f1e",
      }),
    ).toEqual({
      kind: "run",
      label: "Save and verify",
      save: { workspace: "acme", signingSecret: "0f1e" },
    });
  });

  it("only verifies when both are stored and nothing is pasted, and says again after a verify", () => {
    expect(slackVerifyPlan(view({ ...unverified }), "acme", none)).toEqual({
      kind: "run",
      label: "Verify",
      save: null,
    });
    expect(slackVerifyPlan(view(), "acme", none)).toEqual({
      kind: "run",
      label: "Verify again",
      save: null,
    });
  });

  it("refuses a token that is not a bot token, without repeating it", () => {
    const plan = slackVerifyPlan(view(), "acme", { ...none, botToken: "xoxp-1-user" });
    expect(plan.kind).toBe("blocked");
    expect(JSON.stringify(plan)).not.toContain("xoxp-1-user");
  });

  it("offers Save both for two pasted values (or none yet), and Save for one", () => {
    expect(slackSecretsLabel({ botToken: "", signingSecret: "" })).toBe("Save both");
    expect(slackSecretsLabel({ botToken: "xoxb-1-a", signingSecret: "0f1e" })).toBe("Save both");
    expect(slackSecretsLabel({ botToken: "xoxb-1-a", signingSecret: " " })).toBe("Save");
    expect(slackSecretsLabel({ botToken: "", signingSecret: "0f1e" })).toBe("Save");
  });
});

describe("where agents post, in a sentence", () => {
  it("names the default channel, marking a private one", () => {
    expect(slackPlaceSentence(admin())).toBe("#peer-agents");
    expect(slackPlaceSentence(admin({ default: { ...channel, private: true } }))).toBe(
      "#peer-agents (private)",
    );
  });

  it("falls back to a project's own channel, then to direct messages, then to nothing", () => {
    expect(
      slackPlaceSentence(
        admin({
          default: null,
          projects: [project({ channel: { id: "C7", name: "ordering", private: false } })],
        }),
      ),
    ).toBe("#ordering");
    expect(
      slackPlaceSentence(admin({ default: null, projects: [project({ mode: "direct" })] })),
    ).toBe("direct messages");
    expect(slackPlaceSentence(admin({ default: null, projects: [project()] }))).toBeNull();
  });

  it("ends the setup by telling the team where to look", () => {
    expect(slackDoneText(admin(), "Acme")).toBe(
      "Connected. Agents in Acme can now ask people in #peer-agents. Tell the team to check Me › Slack.",
    );
    expect(slackDoneText(admin({ default: null, projects: [] }), "Acme")).toBe(
      "Connected. Agents in Acme can now ask people. Tell the team to check Me › Slack.",
    );
  });
});
