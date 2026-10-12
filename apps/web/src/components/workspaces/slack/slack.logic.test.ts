import { describe, expect, it } from "@effect/vitest";
import type { PeerSlackAdminResult, PeerSlackMe } from "@t3tools/contracts";
import { SLACK_LINK_FIRST, type SlackFormat } from "@t3tools/client-runtime/peer/slack";

import {
  DIRECT_ONLY,
  NO_CHANNEL,
  SLACK_DISCONNECTED,
  SLACK_STEPS,
  SLACK_STEP_COUNT,
  SLACK_STEP_ORDER,
  slackBotHandle,
  slackChannelFromValue,
  slackChannelItems,
  slackDefaultChange,
  slackDefaultItems,
  slackDefaultValue,
  slackDelayFromValue,
  slackDisconnectConfirmation,
  slackModeFromValue,
  slackOlderHubStatus,
  slackPlaceRows,
  slackProjectRows,
  slackReadingStatus,
  slackSecretsInput,
  slackSectionView,
  slackStatus,
  slackStepNumber,
  slackTestBlocker,
  slackTestQueued,
  slackUnreadableStatus,
} from "./slack.logic";

const channel = { id: "C1", name: "peer", private: false };
const admin = (changes: Partial<PeerSlackAdminResult> = {}): PeerSlackAdminResult => ({
  state: "connected",
  secrets: { botToken: "stored", signingSecret: "stored" },
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer", user: "U9", app: "A1" },
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
const me = (changes: Partial<PeerSlackMe> = {}): PeerSlackMe => ({
  connected: true,
  team: { id: "T1", name: "Acme" },
  bot: { name: "Peer" },
  link: null,
  pending: null,
  settings: {
    enabled: false,
    delayMinutes: 5,
    place: "thread",
    kinds: ["approval", "question", "finished", "blocked"],
  },
  projects: [],
  ...changes,
});
const ready = <A>(data: A) => ({ data, error: null });
const nothing = { data: null, error: null };
const format: SlackFormat = { time: (iso) => iso.slice(11, 16), dateTime: (iso) => iso };

describe("which parts of the Slack section show", () => {
  it("gives a member their own options and never the setup", () => {
    const view = slackSectionView("member", { me: ready(me()), admin: nothing }, format);
    expect(view).toMatchObject({ kind: "ready", member: { kind: "options" } });
  });

  it("gives an owner or admin their own options once Slack is connected", () => {
    for (const role of ["owner", "admin"] as const) {
      const view = slackSectionView(role, { me: ready(me()), admin: ready(admin()) }, format);
      expect(view).toMatchObject({ kind: "ready", member: { kind: "options" } });
    }
  });

  it("leaves an owner or admin to the setup under Integrations while Slack is not connected", () => {
    const off = admin({ state: "off", secrets: { botToken: "missing", signingSecret: "missing" } });
    const view = slackSectionView(
      "owner",
      { me: ready(me({ connected: false, team: null, bot: null })), admin: ready(off) },
      format,
    );
    expect(view).toEqual({ kind: "ready", member: null });
  });

  it("tells a member of an unconnected workspace to ask an admin, without any setup", () => {
    const view = slackSectionView(
      "member",
      { me: ready(me({ connected: false })), admin: nothing },
      format,
    );
    expect(view).toEqual({ kind: "ready", member: { kind: "unconnected" } });
  });

  it("carries the member's switch, which waits for a link", () => {
    const view = slackSectionView("member", { me: ready(me()), admin: nothing }, format);
    expect(
      view.kind === "ready" && view.member?.kind === "options" && view.member.view,
    ).toMatchObject({ on: false, switchReason: SLACK_LINK_FIRST });
  });

  it("tells a member with a link in flight what to do next", () => {
    const code = { kind: "code", code: "123456", expiresAt: "2026-10-10T12:15:00Z" };
    const dm = { kind: "dm", name: "Ana", expiresAt: "2026-10-10T12:15:00Z" };
    const text = (pending: PeerSlackMe["pending"]) => {
      const view = slackSectionView(
        "member",
        { me: ready(me({ pending })), admin: nothing },
        format,
      );
      return view.kind === "ready" && view.member?.kind === "options"
        ? view.member.view.link.text
        : null;
    };
    expect(text(code)).toBe("Send 123456 to @Peer in a direct message in Slack, before 12:15.");
    expect(text(dm)).toBe("Confirm in the direct message Peer sent to Ana in Slack, before 12:15.");
  });

  it("loads until everything the role reads has arrived", () => {
    expect(slackSectionView("member", { me: nothing, admin: nothing }, format)).toEqual({
      kind: "loading",
    });
    expect(slackSectionView("admin", { me: ready(me()), admin: nothing }, format)).toEqual({
      kind: "loading",
    });
  });

  it("shows a failure with its text so Retry can be offered", () => {
    const failed = { data: null, error: "Could not reach the hub at https://hub.example.com." };
    expect(slackSectionView("member", { me: failed, admin: nothing }, format)).toEqual({
      kind: "error",
      message: "Could not reach the hub at https://hub.example.com.",
    });
    expect(slackSectionView("admin", { me: ready(me()), admin: failed }, format).kind).toBe(
      "error",
    );
  });

  it("says the Hub must be updated, whichever call found out", () => {
    const old = { data: null, error: "Slack needs a newer Peer Hub." };
    expect(slackSectionView("member", { me: old, admin: nothing }, format)).toEqual({
      kind: "older-hub",
    });
    expect(slackSectionView("owner", { me: ready(me()), admin: old }, format)).toEqual({
      kind: "older-hub",
    });
  });

  it("does not let the connection a member cannot read fail their section", () => {
    const refused = { data: null, error: "Only owners and admins can change Slack." };
    expect(slackSectionView("member", { me: ready(me()), admin: refused }, format).kind).toBe(
      "ready",
    );
  });
});

describe("storing the app's secrets", () => {
  it("has nothing to send while both fields are empty", () => {
    expect(slackSecretsInput("acme", { botToken: "", signingSecret: "" })).toEqual({
      kind: "empty",
    });
    expect(slackSecretsInput("acme", { botToken: "  ", signingSecret: "\n" })).toEqual({
      kind: "empty",
    });
  });

  it("sends only the fields that were filled, trimmed", () => {
    expect(slackSecretsInput("acme", { botToken: " xoxb-1-abc \n", signingSecret: "" })).toEqual({
      kind: "ready",
      input: { workspace: "acme", botToken: "xoxb-1-abc" },
    });
    expect(slackSecretsInput("acme", { botToken: "", signingSecret: " 0f1e2d " })).toEqual({
      kind: "ready",
      input: { workspace: "acme", signingSecret: "0f1e2d" },
    });
    expect(slackSecretsInput("acme", { botToken: "xoxb-1-abc", signingSecret: "0f1e2d" })).toEqual({
      kind: "ready",
      input: { workspace: "acme", botToken: "xoxb-1-abc", signingSecret: "0f1e2d" },
    });
  });

  it("refuses a token that is not a bot token, without repeating it", () => {
    for (const botToken of ["xoxp-1-user", "xapp-1-app", "not a token"]) {
      const parsed = slackSecretsInput("acme", { botToken, signingSecret: "0f1e2d" });
      expect(parsed.kind).toBe("invalid");
      expect(JSON.stringify(parsed)).not.toContain(botToken);
    }
  });

  it("accepts the form a rotating token takes", () => {
    expect(slackSecretsInput("acme", { botToken: "xoxe.xoxb-1-abc", signingSecret: "" }).kind).toBe(
      "ready",
    );
  });
});

describe("Slack channels", () => {
  const listed = [
    { id: "C3", name: "random", private: false, member: false },
    { id: "C1", name: "peer", private: false, member: true },
    { id: "G2", name: "client-x", private: true, member: true },
  ];

  it("offers no channel first, then Slack's channels by name with private ones marked", () => {
    expect(slackChannelItems(listed, null, "No default channel")).toEqual([
      { value: NO_CHANNEL, label: "No default channel" },
      { value: "G2", label: "#client-x (private)" },
      { value: "C1", label: "#peer" },
      { value: "C3", label: "#random" },
    ]);
  });

  it("keeps showing the channel that is set when Slack no longer lists it", () => {
    const items = slackChannelItems(
      listed,
      { id: "G9", name: "gone", private: true },
      "No default channel",
    );
    expect(items.at(-1)).toEqual({ value: "G9", label: "#gone (private)" });
    expect(slackChannelItems(listed, { id: "C1", name: "peer", private: false }, "x")).toHaveLength(
      4,
    );
  });

  it("shows only the one that is set while Slack's list has not arrived", () => {
    expect(slackChannelItems([], channel, "No default channel")).toEqual([
      { value: NO_CHANNEL, label: "No default channel" },
      { value: "C1", label: "#peer" },
    ]);
  });

  it("reads a picker's value back as a channel id, or none", () => {
    expect(slackChannelFromValue(NO_CHANNEL)).toBeNull();
    expect(slackChannelFromValue("C1")).toBe("C1");
  });

  it("reads a picker's value back only when this build offers it", () => {
    expect(slackModeFromValue("direct")).toBe("direct");
    expect(slackModeFromValue("unset")).toBeNull();
    expect(slackDelayFromValue("0")).toBe(0);
    expect(slackDelayFromValue("15")).toBe(15);
    expect(slackDelayFromValue("30")).toBeNull();
    expect(slackDelayFromValue("")).toBeNull();
  });
});

describe("a project's channel and mode", () => {
  const rows = (...projects: Array<ReturnType<typeof project>>) =>
    slackProjectRows(admin({ projects }));

  it("shows a project open to every member as a thread in the default channel", () => {
    const [row] = rows(project({ mode: "unset" }));
    expect(row).toMatchObject({
      mode: "thread",
      channel: NO_CHANNEL,
      channelDisabled: false,
      restricted: false,
      note: null,
    });
    expect(row?.modes.map((mode) => mode.value)).toEqual(["thread", "direct", "off"]);
    expect(row?.modes.some((mode) => mode.disabled)).toBe(false);
  });

  it("asks for a choice before anything is posted for a project with named members", () => {
    const [row] = rows(project({ id: "client-x", restricted: true, mode: "unset" }));
    expect(row).toMatchObject({ mode: "unset", restricted: true });
    expect(row?.note).toContain("nothing is posted until you choose a mode");
    expect(row?.modes.at(-1)).toEqual({ value: "unset", label: "Not set", disabled: true });
    expect(row?.modes.filter((mode) => !mode.disabled).map((mode) => mode.value)).toEqual([
      "thread",
      "direct",
      "off",
    ]);
  });

  it("needs no channel where nothing goes to a channel", () => {
    const [direct, off, thread] = rows(
      project({ id: "a", mode: "direct" }),
      project({ id: "b", mode: "off" }),
      project({ id: "c", mode: "thread" }),
    );
    expect(direct?.channelDisabled).toBe(true);
    expect(off?.channelDisabled).toBe(true);
    expect(thread?.channelDisabled).toBe(false);
  });

  it("points out a project that has no place to post", () => {
    const own = project({ channel: { id: "C7", name: "webshop", private: false } });
    expect(rows(own)[0]).toMatchObject({ channel: "C7", note: null });
    const withoutDefault = slackProjectRows(admin({ default: null, projects: [project()] }));
    expect(withoutDefault[0]?.note).toBe(
      "No channel yet: choose one here, or set a default channel.",
    );
    // Direct messages need no channel, so there is nothing to point out.
    const direct = slackProjectRows(
      admin({ default: null, projects: [project({ mode: "direct" })] }),
    );
    expect(direct[0]?.note).toBeNull();
  });

  it("puts what Slack reported about the channel on the project's row", () => {
    const [row, other] = rows(
      project({
        id: "client-x",
        restricted: true,
        mode: "thread",
        channel: { id: "G1", name: "client-x", private: true },
        problem: { code: "not_in_channel", at: "2026-10-10T09:05:00Z" },
      }),
      project({ id: "ok" }),
    );
    expect(row?.problem).toBe("Invite @Peer to the channel.");
    expect(other?.problem).toBeNull();
  });

  it("shows a mode only a newer Hub knows as it is, and not as a choice", () => {
    const [row] = rows(project({ mode: "quiet" }));
    expect(row?.mode).toBe("quiet");
    expect(row?.modes.at(-1)).toEqual({ value: "quiet", label: "quiet", disabled: true });
  });
});

describe("Test and Disconnect", () => {
  it("cannot test without a default channel, since the Hub posts the test there", () => {
    expect(slackTestBlocker(admin({ default: null }))).toBe(
      "Choose a default channel to send a test message.",
    );
    expect(slackTestBlocker(admin())).toBeNull();
  });

  it("says where the test message goes", () => {
    expect(slackTestQueued(admin())).toBe(
      "Test message queued for #peer. Choose Refresh to see how it went.",
    );
  });

  it("asks before disconnecting and says to remove the app in Slack too", () => {
    expect(slackDisconnectConfirmation("Acme")).toContain("Disconnect Slack from Acme?");
    expect(slackDisconnectConfirmation("Acme")).toContain("Remove the Peer app in Slack as well");
    expect(SLACK_DISCONNECTED).toContain("Remove the Peer app in Slack as well");
  });
});

describe("the four numbered steps", () => {
  it("number create, install, verify and choose where agents post from one to four", () => {
    expect(SLACK_STEP_COUNT).toBe(4);
    expect(SLACK_STEP_ORDER.map((id) => SLACK_STEPS[id].n)).toEqual([1, 2, 3, 4]);
    expect(SLACK_STEP_ORDER.map((id) => SLACK_STEPS[id].title)).toEqual([
      "Create the app in Slack",
      "Install it and copy two values",
      "Verify with Slack",
      "Choose where agents post",
    ]);
  });

  it("number the step the Hub's view is at, and none once connected", () => {
    expect(slackStepNumber("create")).toBe(1);
    expect(slackStepNumber("secrets")).toBe(2);
    expect(slackStepNumber("verify")).toBe(3);
    expect(slackStepNumber("channels")).toBe(4);
    expect(slackStepNumber("connected")).toBeNull();
  });

  it("write a bot the way people do in Slack", () => {
    expect(slackBotHandle("peer")).toBe("@peer");
    expect(slackBotHandle("@peer")).toBe("@peer");
  });
});

describe("Slack's status for the workspace", () => {
  const missing = { botToken: "missing", signingSecret: "missing" } as const;
  const none = { team: null, bot: null, verifiedAt: null, default: null } as const;

  it("needs setup at step 1 before anything is stored", () => {
    expect(slackStatus(admin({ ...none, state: "off", secrets: missing }))).toEqual({
      state: "setup",
      step: { n: 1, of: 4, title: "create the app" },
    });
  });

  it("moves on to step 2 when the admin said they left for Slack, which the Hub cannot see", () => {
    const view = admin({ ...none, state: "off", secrets: missing });
    expect(slackStatus(view, { leftForSlack: true })).toEqual({
      state: "setup",
      step: { n: 2, of: 4, title: "install it and copy two values" },
    });
    // The Overview has no such hint and names the step the Hub can see.
    expect(slackStatus(view)).toMatchObject({ step: { n: 1 } });
    // Nothing the admin said moves a step the Hub has an opinion on.
    expect(slackStatus(admin({ ...none, state: "off" }), { leftForSlack: true })).toMatchObject({
      step: { n: 3, title: "verify" },
    });
    expect(slackStatus(admin(), { leftForSlack: true }).state).toBe("connected");
  });

  it("needs setup at step 2 while one of the two values is missing", () => {
    for (const secrets of [
      { botToken: "stored", signingSecret: "missing" },
      { botToken: "missing", signingSecret: "stored" },
    ]) {
      expect(slackStatus(admin({ ...none, state: "needs-setup", secrets }))).toMatchObject({
        state: "setup",
        step: { n: 2, of: 4 },
      });
    }
  });

  it("never reads Off once both values are saved: it is step 3, verify, whatever the Hub says", () => {
    for (const state of ["off", "needs-setup", "something-newer"]) {
      expect(slackStatus(admin({ ...none, state }))).toEqual({
        state: "setup",
        step: { n: 3, of: 4, title: "verify" },
      });
    }
  });

  it("needs setup at step 4 once Slack knows the values and there is nowhere to post yet", () => {
    expect(slackStatus(admin({ default: null, projects: [project({ mode: "unset" })] }))).toEqual({
      state: "setup",
      step: { n: 4, of: 4, title: "choose where agents post" },
    });
  });

  it("is connected to the Slack workspace as the bot, and says when Slack last confirmed it", () => {
    expect(slackStatus(admin({ bot: { name: "peer", user: "U9", app: "A1" } }))).toEqual({
      state: "connected",
      detail: "Acme as @peer",
      checkedAt: "2026-10-10T08:00:00Z",
    });
  });

  it("is connected without a bot when the Hub named none", () => {
    expect(slackStatus(admin({ bot: null }))).toMatchObject({ state: "connected", detail: "Acme" });
  });

  it("is a problem when Slack no longer accepts the token, saying what to do", () => {
    const status = slackStatus(
      admin({ state: "needs-setup", auth: { code: "token_revoked", at: "2026-10-10T09:00:00Z" } }),
    );
    expect(status.state).toBe("problem");
    expect(status.detail).toContain("store the new token and choose Verify");
    expect(status.step).toBeUndefined();
  });

  it("is a problem when a project's channel fails, naming the project", () => {
    const status = slackStatus(
      admin({
        projects: [
          project({ id: "ok", name: "Webshop", channel }),
          project({
            id: "client-x",
            name: "Client X",
            problem: { code: "not_in_channel", at: "2026-10-10T09:05:00Z" },
          }),
        ],
      }),
    );
    expect(status).toEqual({ state: "problem", detail: "Client X: Invite @Peer to the channel." });
  });

  it("names the first problem and counts the rest", () => {
    const status = slackStatus(
      admin({
        state: "needs-setup",
        auth: { code: "invalid_auth", at: "2026-10-10T09:00:00Z" },
        projects: [
          project({
            id: "a",
            name: "A",
            problem: { code: "not_in_channel", at: "2026-10-10T09:05:00Z" },
          }),
          project({
            id: "b",
            name: "B",
            problem: { code: "is_archived", at: "2026-10-10T09:05:00Z" },
          }),
        ],
      }),
    );
    expect(status.state).toBe("problem");
    expect(status.detail).toMatch(/^Slack does not accept the bot token.* \(and 2 more\)$/);
  });

  it("is not available on a Hub without Slack, and checking while nothing has been read", () => {
    expect(slackOlderHubStatus).toEqual({
      state: "unavailable",
      detail: "This Peer Hub has no Slack support yet; it must be updated.",
    });
    expect(slackReadingStatus).toEqual({ state: "off", label: "Checking…" });
  });

  it("is a problem, not Off, when the connection could not be read", () => {
    expect(slackUnreadableStatus("boom")).toEqual({
      state: "problem",
      detail: "Could not read Slack: boom",
    });
  });
});

describe("the default channel in the last step", () => {
  const listed = [
    { id: "C1", name: "peer-agents", private: false, member: true },
    { id: "C3", name: "random", private: false, member: false },
  ];
  const direct = (id: string) => project({ id, name: id, mode: "direct" });

  it("shows the channel that is set, direct messages only, or none", () => {
    expect(slackDefaultValue(admin())).toBe("C1");
    expect(slackDefaultValue(admin({ default: null, projects: [direct("a"), direct("b")] }))).toBe(
      DIRECT_ONLY,
    );
    expect(slackDefaultValue(admin({ default: null, projects: [] }))).toBe(NO_CHANNEL);
    expect(
      slackDefaultValue(admin({ default: null, projects: [direct("a"), project({ id: "b" })] })),
    ).toBe(NO_CHANNEL);
  });

  it("offers direct messages only after the channels, when a project exists to post them", () => {
    const withProject = slackDefaultItems(listed, admin({ projects: [project()] }));
    expect(withProject.map((item) => item.label)).toEqual([
      "No default channel",
      "#peer-agents",
      "#random",
      "Direct messages only",
    ]);
    expect(withProject.at(-1)?.value).toBe(DIRECT_ONLY);
    expect(slackDefaultItems(listed, admin({ projects: [] })).map((item) => item.value)).toEqual([
      NO_CHANNEL,
      "C1",
      "C3",
    ]);
  });

  it("saves a channel as the default and nothing else", () => {
    expect(slackDefaultChange(admin({ projects: [project()] }), "C3")).toEqual({ default: "C3" });
    expect(slackDefaultChange(admin({ projects: [project()] }), NO_CHANNEL)).toEqual({
      default: null,
    });
  });

  it("saves direct messages only as every project's mode, with no default channel", () => {
    const view = admin({ projects: [project({ id: "a" }), project({ id: "b" })] });
    expect(slackDefaultChange(view, DIRECT_ONLY)).toEqual({
      default: null,
      projects: { a: { mode: "direct" }, b: { mode: "direct" } },
    });
  });

  it("puts the projects back to threads when direct messages only is left for a channel", () => {
    const view = admin({ default: null, projects: [direct("a"), direct("b")] });
    expect(slackDefaultChange(view, "C1")).toEqual({
      default: "C1",
      projects: { a: { mode: "thread" }, b: { mode: "thread" } },
    });
    expect(slackDefaultChange(view, NO_CHANNEL)).toEqual({
      default: null,
      projects: { a: { mode: "thread" }, b: { mode: "thread" } },
    });
  });
});

describe("where agents post, as the connected card lists it", () => {
  const direct = (id: string) => project({ id, name: id, mode: "direct" });

  it("lists the default channel first, with private channels marked", () => {
    expect(slackPlaceRows(admin()).map((row) => [row.key, row.label, row.value])).toEqual([
      ["default", "Default channel", "#peer"],
    ]);
    expect(slackPlaceRows(admin({ default: { ...channel, private: true } }))[0]?.value).toBe(
      "#peer (private)",
    );
  });

  it("lists a project only when its posting differs from the default", () => {
    const rows = slackPlaceRows(
      admin({
        projects: [
          project({ id: "follows", name: "Follows" }),
          project({
            id: "own",
            name: "Ordering demo",
            channel: { id: "C7", name: "ordering", private: false },
          }),
          project({ id: "dm", name: "Support", mode: "direct" }),
          project({ id: "quiet", name: "Archive", mode: "off" }),
          project({ id: "named", name: "Client X", restricted: true, mode: "unset" }),
        ],
      }),
    );
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Default channel", "#peer"],
      ["Ordering demo", "Its own thread in #ordering"],
      ["Support", "Direct messages only"],
      ["Archive", "Off"],
      ["Client X", "Not set"],
    ]);
  });

  it("says direct messages only once, for the default, when every project posts that way", () => {
    const rows = slackPlaceRows(admin({ default: null, projects: [direct("a"), direct("b")] }));
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Default channel", "Direct messages only"],
    ]);
  });

  it("says there is no default channel when none is set", () => {
    expect(slackPlaceRows(admin({ default: null, projects: [] }))[0]?.value).toBe("None");
  });

  it("keeps a project whose channel Slack reported a problem with, though it follows the default", () => {
    const rows = slackPlaceRows(
      admin({
        projects: [
          project({
            id: "client-x",
            name: "Client X",
            problem: { code: "not_in_channel", at: "2026-10-10T09:05:00Z" },
          }),
        ],
      }),
    );
    expect(rows[1]).toEqual({
      key: "client-x",
      label: "Client X",
      value: "Thread in the default channel",
      problem: "Invite @Peer to the channel.",
    });
  });
});
