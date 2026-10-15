import type { PeerSettingsSecretsView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  NOTHING_USES_IT,
  deleteWords,
  deletedMessage,
  impactOf,
  secretRows,
  storedBy,
  storedDate,
  storedMessage,
  usesOf,
  valueDialogTitle,
  valueText,
} from "./secrets.logic";

const NOW = new Date("2026-10-11T12:00:00Z");
const options = { now: NOW, timeZone: "UTC" } as const;

const slavo = { email: "slavo@acme.dev", name: "Slavo" };

/** The design's table: a gateway key, GitHub's secret, a webhook's URL that nobody stored, its signing key, a leftover. */
const view: PeerSettingsSecretsView = {
  secrets: [
    {
      name: "OPS_SIGNING_KEY",
      at: "2026-10-05T09:30:00Z",
      by: slavo,
      usedBy: ["Webhook “Ops” · signature"],
    },
    {
      name: "litellm-master-key",
      at: "2026-10-02T10:00:00Z",
      by: slavo,
      usedBy: ["Shared capacity · the gateway"],
    },
    { name: "OLD_JIRA_HOOK", at: "2026-08-12T08:00:00Z", by: null, usedBy: [] },
    { name: "github-webhook", at: "2026-09-28T16:45:00Z", usedBy: ["GitHub PR checks"] },
  ],
  missing: [{ name: "TEAMS_ALERTS_URL", usedBy: ["Webhook “Teams alerts” · off until set"] }],
};

describe("the date a value was stored", () => {
  it.each([
    ["2026-10-02T10:00:00Z", "2 Oct"],
    ["2026-09-28T16:45:00Z", "28 Sep"],
    ["2026-01-01T00:00:00Z", "1 Jan"],
    ["2025-12-31T23:59:00Z", "31 Dec 2025"],
    ["2024-02-29T12:00:00Z", "29 Feb 2024"],
  ])("writes %s as %s", (at, text) => {
    expect(storedDate(at, options)).toBe(text);
  });

  it("is the day in the time zone it is read in", () => {
    const late = "2026-10-02T23:30:00Z";
    expect(storedDate(late, { now: NOW, timeZone: "UTC" })).toBe("2 Oct");
    expect(storedDate(late, { now: NOW, timeZone: "Asia/Tokyo" })).toBe("3 Oct");
  });

  it("says nothing for no time, or one that is not a time", () => {
    expect(storedDate(null, options)).toBeNull();
    expect(storedDate(undefined, options)).toBeNull();
    expect(storedDate("last week", options)).toBeNull();
  });
});

describe("the rows", () => {
  const rows = secretRows(view, options);

  it("put what needs doing first, then what is used, then what is not, each by name", () => {
    expect(rows.map((row) => row.name)).toEqual([
      "TEAMS_ALERTS_URL",
      "github-webhook",
      "litellm-master-key",
      "OPS_SIGNING_KEY",
      "OLD_JIRA_HOOK",
    ]);
  });

  it("mark what nobody stored, with what waits for it and no date", () => {
    expect(rows[0]).toEqual({
      name: "TEAMS_ALERTS_URL",
      stored: false,
      uses: ["Webhook “Teams alerts” · off until set"],
      when: null,
      by: null,
    });
  });

  it("carry the day a value was stored and who stored it", () => {
    const master = rows.find((row) => row.name === "litellm-master-key");
    expect(master).toMatchObject({ stored: true, when: "2 Oct", by: "Slavo" });
    expect(rows.find((row) => row.name === "OLD_JIRA_HOOK")).toMatchObject({
      when: "12 Aug",
      by: null,
    });
  });

  it("name the person as the page names people", () => {
    const named = secretRows(view, { ...options, nameOf: (person) => `${person.name} (admin)` });
    expect(named.find((row) => row.name === "litellm-master-key")?.by).toBe("Slavo (admin)");
  });

  it("list a name once when the Hub lists it as stored and as missing", () => {
    const both = secretRows(
      {
        secrets: [{ name: "KEY", at: null, usedBy: [] }],
        missing: [{ name: "KEY", usedBy: ["Webhook “Ops” · signature"] }],
      },
      options,
    );
    expect(both).toHaveLength(1);
    expect(both[0]?.stored).toBe(true);
  });

  it("are none for a Hub with no secrets", () => {
    expect(secretRows({ secrets: [], missing: [] }, options)).toEqual([]);
  });
});

describe("what a row says", () => {
  const rows = secretRows(view, options);
  const row = (name: string) => rows.find((candidate) => candidate.name === name)!;

  it("says what uses a secret, or that nothing does", () => {
    expect(usesOf(row("github-webhook"))).toEqual(["GitHub PR checks"]);
    expect(usesOf(row("OLD_JIRA_HOOK"))).toEqual([NOTHING_USES_IT]);
  });

  it("says where the value stands, never the value", () => {
    expect(valueText(row("litellm-master-key"))).toBe("Stored · 2 Oct");
    expect(valueText(row("TEAMS_ALERTS_URL"))).toBe("Missing");
    expect(valueText({ stored: true, when: null })).toBe("Stored");
  });

  it("says who stored it only when the Hub says", () => {
    expect(storedBy(row("litellm-master-key"))).toBe("Stored by Slavo");
    expect(storedBy(row("OLD_JIRA_HOOK"))).toBeNull();
  });

  it("titles the dialog by what it does to the value", () => {
    expect(valueDialogTitle(row("litellm-master-key"))).toBe("Replace litellm-master-key");
    expect(valueDialogTitle(row("TEAMS_ALERTS_URL"))).toBe("Set TEAMS_ALERTS_URL");
  });

  it("confirms the stored and deleted secrets by name", () => {
    expect(storedMessage("OPS_SIGNING_KEY")).toBe("Stored OPS_SIGNING_KEY");
    expect(deletedMessage("OLD_JIRA_HOOK")).toBe("Deleted OLD_JIRA_HOOK");
  });
});

describe("the secrets Slack stores itself", () => {
  const slack: PeerSettingsSecretsView = {
    secrets: [
      { name: "slack-bot-token", at: "2026-10-05T09:30:00Z", by: slavo, usedBy: [] },
      { name: "slack-signing-secret", at: "2026-10-05T09:30:00Z", by: slavo, usedBy: [] },
      { name: "OLD_JIRA_HOOK", at: "2026-08-12T08:00:00Z", by: null, usedBy: [] },
    ],
    missing: [],
  };

  it("are used by Slack although the Hub, which lists only what the settings name, says nothing", () => {
    const rows = secretRows(slack, options);
    expect(rows.map((row) => [row.name, row.uses])).toEqual([
      ["slack-bot-token", ["Slack · bot token"]],
      ["slack-signing-secret", ["Slack · signing secret"]],
      ["OLD_JIRA_HOOK", []],
    ]);
  });

  it("say that Slack stops when one goes, and ask for Delete anyway", () => {
    const [token] = secretRows(slack, options);
    expect(deleteWords({ name: token?.name ?? "", uses: token?.uses ?? [] }, "Acme")).toMatchObject(
      {
        nothing: null,
        confirm: "Delete anyway",
        impacts: [
          { use: "Slack · bot token", impact: "Slack stops until its tokens are stored again." },
        ],
      },
    );
  });

  it("keep what the Hub says when it names a use", () => {
    const told: PeerSettingsSecretsView = {
      secrets: [{ name: "slack-bot-token", at: null, usedBy: ["Slack conversations of Acme"] }],
      missing: [],
    };
    expect(secretRows(told, options)[0]?.uses).toEqual(["Slack conversations of Acme"]);
  });
});

describe("what stops when a secret goes", () => {
  it.each([
    [
      "Shared capacity · the gateway",
      "Shared capacity turns off for all of Acme until a new key is set.",
    ],
    ["GitHub PR checks", "GitHub’s deliveries will fail, so PR checks stop."],
    ["Webhook “Ops” · signature", "Webhook “Ops” pauses until it has a signing key again."],
    [
      "Webhook “Teams alerts” · off until set",
      "Webhook “Teams alerts” stops delivering until its URL is set again.",
    ],
    ["Slack · bot token", "Slack stops until its tokens are stored again."],
    ["The nightly export", "The nightly export stops working until the secret is set again."],
  ])("says of %j: %s", (use, impact) => {
    expect(impactOf(use, "Acme")).toBe(impact);
  });

  it("deletes a secret nothing uses with a plain Delete", () => {
    expect(deleteWords({ name: "OLD_JIRA_HOOK", uses: [] }, "Acme")).toEqual({
      title: "Delete OLD_JIRA_HOOK?",
      impacts: [],
      nothing: "Nothing uses it, so nothing stops.",
      confirm: "Delete",
    });
  });

  it("lists every use of one that is used, and asks for Delete anyway", () => {
    const words = deleteWords(
      {
        name: "ops-url",
        uses: ["Webhook “Ops” · signature", "Webhook “Team Slack”"],
      },
      "Acme",
    );
    expect(words.title).toBe("Delete ops-url?");
    expect(words.nothing).toBeNull();
    expect(words.confirm).toBe("Delete anyway");
    expect(words.impacts).toEqual([
      {
        use: "Webhook “Ops” · signature",
        impact: "Webhook “Ops” pauses until it has a signing key again.",
      },
      {
        use: "Webhook “Team Slack”",
        impact: "Webhook “Team Slack” stops delivering until its URL is set again.",
      },
    ]);
  });
});
