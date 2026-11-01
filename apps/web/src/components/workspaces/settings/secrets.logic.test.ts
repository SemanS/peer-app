import type { PeerSettingsSecretsView } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deletedMessage,
  secretRows,
  storedBy,
  storedDate,
  storedMessage,
  valueText,
} from "./secrets.logic";

const NOW = new Date("2026-10-11T12:00:00Z");
const options = { now: NOW, timeZone: "UTC" } as const;

const slavo = { email: "slavo@acme.dev", name: "Slavo" };

const view: PeerSettingsSecretsView = {
  secrets: [
    { name: "OPS_SIGNING_KEY", at: "2026-10-05T09:30:00Z", by: slavo },
    { name: "litellm-master-key", at: "2026-10-02T10:00:00Z", by: slavo },
    { name: "OLD_JIRA_HOOK", at: "2026-08-12T08:00:00Z", by: null },
    { name: "POSTGRES_URL", at: "2026-09-28T16:45:00Z" },
  ],
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

  it("list the secrets by name", () => {
    expect(rows.map((row) => row.name)).toEqual([
      "litellm-master-key",
      "OLD_JIRA_HOOK",
      "OPS_SIGNING_KEY",
      "POSTGRES_URL",
    ]);
  });

  it("carry the day a value was stored and who stored it", () => {
    const master = rows.find((row) => row.name === "litellm-master-key");
    expect(master).toMatchObject({ when: "2 Oct", by: "Slavo" });
    expect(rows.find((row) => row.name === "OLD_JIRA_HOOK")).toMatchObject({
      when: "12 Aug",
      by: null,
    });
  });

  it("name the person as the page names people", () => {
    const named = secretRows(view, { ...options, nameOf: (person) => `${person.name} (admin)` });
    expect(named.find((row) => row.name === "litellm-master-key")?.by).toBe("Slavo (admin)");
  });

  it("are none for a Hub with no secrets", () => {
    expect(secretRows({ secrets: [] }, options)).toEqual([]);
  });
});

describe("what a row says", () => {
  const rows = secretRows(view, options);
  const row = (name: string) => rows.find((candidate) => candidate.name === name)!;

  it("says where the value stands, never the value", () => {
    expect(valueText(row("litellm-master-key"))).toBe("Stored · 2 Oct");
    expect(valueText({ when: null })).toBe("Stored");
  });

  it("says who stored it only when the Hub says", () => {
    expect(storedBy(row("litellm-master-key"))).toBe("Stored by Slavo");
    expect(storedBy(row("OLD_JIRA_HOOK"))).toBeNull();
  });

  it("confirms the stored and deleted secrets by name", () => {
    expect(storedMessage("OPS_SIGNING_KEY")).toBe("Stored OPS_SIGNING_KEY");
    expect(deletedMessage("OLD_JIRA_HOOK")).toBe("Deleted OLD_JIRA_HOOK");
  });
});
