import { setAt } from "@t3tools/client-runtime/peer-settings";
import { describe, expect, it } from "vite-plus/test";

import { countChanges, draftSets } from "./settingsDraft.logic";
import {
  DEFAULT_KEY_SECRET,
  adminUrlEdit,
  adminUrlProblem,
  checkNewPool,
  currencyEdits,
  emptyPoolsText,
  gatewayUrlProblem,
  harnessFor,
  harnessText,
  keyValue,
  manifestGateway,
  masterKeyText,
  modelRows,
  moment,
  newModelEntry,
  newPoolEdit,
  parseRate,
  poolIdFromName,
  poolModelsWith,
  poolUses,
  providerFor,
  rateEdit,
  readCatalogPools,
  readCurrency,
  readGateway,
  shortDate,
  syncConsequence,
  syncState,
  testOutcome,
  urlEdits,
  type Edit,
  type GatewaySettings,
} from "./sharedCapacity.logic";

const sonnet = {
  id: "claude-sonnet-5-5",
  provider: "anthropic",
  harness: ["claude"],
  credentialEnv: "ANTHROPIC_API_KEY",
};
const haiku = {
  id: "claude-haiku-5-5",
  provider: "anthropic",
  upstream: "claude-haiku-5-5-20251001",
  harness: ["claude"],
};
const opus = { id: "claude-opus-5-5", provider: "anthropic", harness: ["claude"] };

const document = {
  currency: "EUR",
  gateway: {
    kind: "litellm",
    url: "https://llm.acme.dev",
    usdPerUnit: 1.08,
    masterKeySecret: "litellm-master-key",
  },
  capacity: {
    standard: { name: "Standard", models: [sonnet, haiku] },
    advanced: { name: "Advanced", models: [sonnet, opus] },
  },
  projects: {
    booking: {
      name: "Booking",
      capacity: { shared: { pool: "standard", budget: { amount: 600, period: "month" } } },
    },
    "peer-hub": {
      name: "Peer Hub",
      capacity: { shared: { pool: "standard", budget: { amount: 400, period: "week" } } },
    },
    "camp-bot": { name: "Camp-bot", capacity: { personal: "any" } },
  },
};

/** What the draft sends once the edits are applied to the document, as the page's bar would. */
function sentFor(edits: ReadonlyArray<Edit>, base: Record<string, unknown> = document) {
  const next = edits.reduce((current, edit) => setAt(current, edit.path, edit.value), base);
  return { count: countChanges(base, next), sets: draftSets(base, next) };
}

describe("the gateway and the currency", () => {
  it("reads what the document holds", () => {
    expect(readGateway(document)).toEqual({
      url: "https://llm.acme.dev",
      adminUrl: undefined,
      usdPerUnit: 1.08,
      masterKeySecret: "litellm-master-key",
    });
    expect(readCurrency(document)).toBe("EUR");
    expect(readCurrency({ currency: "USD" })).toBe("USD");
    expect(readCurrency({})).toBe("EUR");
  });

  it("is none without an address, and falls back to the Hub's defaults for the rest", () => {
    expect(readGateway({})).toBeUndefined();
    expect(readGateway({ gateway: { kind: "litellm" } })).toBeUndefined();
    expect(
      readGateway({ gateway: { kind: "litellm", url: "https://g", usdPerUnit: 0, adminUrl: "" } }),
    ).toEqual({
      url: "https://g",
      adminUrl: undefined,
      usdPerUnit: 1,
      masterKeySecret: DEFAULT_KEY_SECRET,
    });
  });

  it("wants an address that starts with https:// or http://", () => {
    expect(gatewayUrlProblem("https://llm.acme.dev")).toBeNull();
    expect(gatewayUrlProblem(" http://localhost:4000 ")).toBeNull();
    expect(gatewayUrlProblem("")).toBe("The gateway needs an address, like https://llm.acme.dev.");
    expect(gatewayUrlProblem("llm.acme.dev")).toBe("An address starting with https:// or http://.");
    expect(gatewayUrlProblem("https://llm acme.dev")).not.toBeNull();
  });

  it("takes an admin address or none", () => {
    expect(adminUrlProblem("")).toBeNull();
    expect(adminUrlProblem("https://admin.llm.acme.dev")).toBeNull();
    expect(adminUrlProblem("admin.llm")).toBe("An address starting with https:// or http://.");
  });

  it.each([
    ["1.08", 1.08],
    ["1,08", 1.08],
    [" 2 ", 2],
    ["0.000001", 0.000001],
  ])("reads the rate %j", (typed, value) => {
    expect(parseRate(typed)).toEqual({ ok: true, value });
  });

  it.each(["", "0", "0.0", "-1", "1.2.3", "abc", "1.1234567", "1e3"])(
    "refuses the rate %j",
    (typed) => {
      expect(parseRate(typed)).toEqual({
        ok: false,
        problem: "A rate is a number above zero, like 1.08.",
      });
    },
  );

  it("changes the address alone, or makes the gateway when there is none", () => {
    const gateway = readGateway(document);
    expect(urlEdits(gateway, " https://llm.new.dev ")).toEqual([
      { path: ["gateway", "url"], value: "https://llm.new.dev" },
    ]);
    const made = urlEdits(undefined, "https://llm.new.dev");
    expect(made).toEqual([
      {
        path: ["gateway"],
        value: {
          kind: "litellm",
          url: "https://llm.new.dev",
          usdPerUnit: 1,
          masterKeySecret: "litellm-master-key",
        },
      },
    ]);
    expect(sentFor(made, { currency: "EUR" }).sets).toEqual([
      {
        path: ["gateway"],
        value: made[0]?.value,
      },
    ]);
  });

  it("sets an admin address and clears it again", () => {
    expect(adminUrlEdit(" https://admin ")).toEqual({
      path: ["gateway", "adminUrl"],
      value: "https://admin",
    });
    expect(adminUrlEdit("  ")).toEqual({ path: ["gateway", "adminUrl"], value: undefined });
    expect(rateEdit(1.17)).toEqual({ path: ["gateway", "usdPerUnit"], value: 1.17 });
  });

  describe("choosing a currency", () => {
    const gateway = (usdPerUnit: number): GatewaySettings => ({
      url: "https://g",
      adminUrl: undefined,
      usdPerUnit,
      masterKeySecret: DEFAULT_KEY_SECRET,
    });

    it("makes a dollar a dollar", () => {
      expect(
        currencyEdits({
          to: "USD",
          gateway: gateway(1.08),
          saved: { currency: "EUR", usdPerUnit: 1.08 },
        }),
      ).toEqual([
        { path: ["currency"], value: "USD" },
        { path: ["gateway", "usdPerUnit"], value: 1 },
      ]);
    });

    it("leaves a rate that is 1 alone", () => {
      expect(
        currencyEdits({
          to: "USD",
          gateway: gateway(1),
          saved: { currency: "USD", usdPerUnit: 1 },
        }),
      ).toEqual([{ path: ["currency"], value: "USD" }]);
    });

    it("gives back the euro rate that was saved when going back to euros", () => {
      expect(
        currencyEdits({
          to: "EUR",
          gateway: gateway(1),
          saved: { currency: "EUR", usdPerUnit: 1.08 },
        }),
      ).toEqual([
        { path: ["currency"], value: "EUR" },
        { path: ["gateway", "usdPerUnit"], value: 1.08 },
      ]);
    });

    it("leaves the rate to be entered when the saved currency was dollars", () => {
      expect(
        currencyEdits({
          to: "EUR",
          gateway: gateway(1),
          saved: { currency: "USD", usdPerUnit: 1 },
        }),
      ).toEqual([{ path: ["currency"], value: "EUR" }]);
    });

    it("only changes the currency where there is no gateway", () => {
      expect(
        currencyEdits({
          to: "USD",
          gateway: undefined,
          saved: { currency: "EUR", usdPerUnit: undefined },
        }),
      ).toEqual([{ path: ["currency"], value: "USD" }]);
    });

    it("is one change to the currency and one to the rate, as the review will list them", () => {
      const edits = currencyEdits({
        to: "USD",
        gateway: readGateway(document),
        saved: { currency: "EUR", usdPerUnit: 1.08 },
      });
      expect(sentFor(edits).sets).toEqual([
        { path: ["currency"], value: "USD" },
        { path: ["gateway", "usdPerUnit"], value: 1 },
      ]);
    });
  });
});

describe("when", () => {
  const now = new Date(2026, 9, 11, 14, 30);
  const clock = (iso: string) => {
    const date = new Date(iso);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };
  const at = (day: number, hour: number, minute: number) =>
    new Date(2026, 9, day, hour, minute).toISOString();

  it("writes a date the way the design does, with the year only when it is another", () => {
    expect(shortDate(at(2, 9, 0), now)).toBe("2 Oct");
    expect(shortDate(new Date(2025, 9, 2).toISOString(), now)).toBe("2 Oct 2025");
    expect(shortDate("not a time", now)).toBeNull();
  });

  it("leaves the date out of today", () => {
    expect(moment(at(11, 12, 4), now, clock)).toEqual({ date: null, time: "12:04" });
    expect(moment(at(2, 12, 4), now, clock)).toEqual({ date: "2 Oct", time: "12:04" });
    expect(moment("nope", now, clock)).toBeNull();
  });

  describe("the sync banner", () => {
    const format = { now, clock, ago: () => "4m ago" };

    it("says the last sync failed, why, and what the gateway has", () => {
      expect(
        syncState(
          {
            at: at(11, 12, 4),
            ok: false,
            error: "the gateway answered 401",
            lastOkAt: at(11, 11, 20),
          },
          format,
        ),
      ).toEqual({
        kind: "failed",
        when: "at 12:04",
        error: "the gateway answered 401",
        lastOk: "11:20",
      });
    });

    it("names the day of a failure that was not today", () => {
      expect(
        syncState(
          { at: at(10, 12, 4), ok: false, error: "timed out.", lastOkAt: at(2, 11, 20) },
          format,
        ),
      ).toEqual({
        kind: "failed",
        when: "on 10 Oct at 12:04",
        error: "timed out",
        lastOk: "2 Oct 11:20",
      });
    });

    it("says nothing reached the gateway when it never worked", () => {
      const state = syncState({ at: at(11, 12, 4), ok: false, lastOkAt: null }, format);
      expect(state).toEqual({
        kind: "failed",
        when: "at 12:04",
        error: "the gateway did not answer",
        lastOk: null,
      });
    });

    it("words what follows the failure", () => {
      expect(syncConsequence("11:20")).toBe(
        "Settings are saved, but limits on the gateway are from 11:20.",
      );
      expect(syncConsequence(null)).toBe(
        "Settings are saved, but nothing has reached the gateway yet.",
      );
    });

    it("says when it worked, and when none has run", () => {
      expect(syncState({ at: at(11, 14, 26), ok: true, lastOkAt: at(11, 14, 26) }, format)).toEqual(
        {
          kind: "ok",
          ago: "4m ago",
        },
      );
      expect(syncState(null, format)).toEqual({ kind: "never" });
      expect(syncState(undefined, format)).toEqual({ kind: "never" });
    });
  });
});

describe("the master key", () => {
  const now = new Date(2026, 9, 11, 14, 30);
  const slavo = { email: "slavo@acme.dev", name: "Slavo" };
  const nameOf = (person: { name: string }) => person.name;

  it("says it is stored, by whom and when, and that it is never shown", () => {
    expect(
      masterKeyText(
        { stored: true, at: new Date(2026, 9, 2, 9).toISOString(), by: slavo },
        nameOf,
        now,
      ),
    ).toBe("Stored · set by Slavo on 2 Oct. Never shown again.");
  });

  it("says as much as it knows", () => {
    expect(masterKeyText({ stored: true, by: slavo }, nameOf, now)).toBe(
      "Stored · set by Slavo. Never shown again.",
    );
    expect(
      masterKeyText({ stored: true, at: new Date(2026, 9, 2, 9).toISOString() }, nameOf, now),
    ).toBe("Stored · set on 2 Oct. Never shown again.");
    expect(masterKeyText({ stored: true }, nameOf, now)).toBe("Stored. Never shown again.");
  });

  it("says there is none to show", () => {
    expect(masterKeyText({ stored: false }, nameOf, now)).toBe(
      "No key stored yet. The Hub needs it to manage keys on the gateway.",
    );
  });

  it("takes a typed key without the whitespace around it, and none that cannot be stored", () => {
    expect(keyValue("  sk-abc123\n")).toBe("sk-abc123");
    expect(keyValue("   ")).toBeNull();
    expect(keyValue("a\nb")).toBeNull();
    expect(keyValue("x".repeat(8193))).toBeNull();
  });
});

describe("the connection test", () => {
  it("says the key works and how many models the gateway has", () => {
    expect(testOutcome({ ok: true, models: ["a", "b", "c"] })).toEqual({
      tone: "ok",
      text: "Connected · the key works · 3 models",
      models: ["a", "b", "c"],
    });
    expect(testOutcome({ ok: true, models: ["a"] }).text).toBe(
      "Connected · the key works · 1 model",
    );
    expect(testOutcome({ ok: true }).models).toEqual([]);
  });

  it("says why it could not connect", () => {
    expect(testOutcome({ ok: false, error: "the gateway answered 401." })).toEqual({
      tone: "error",
      text: "Could not connect: the gateway answered 401.",
      models: null,
    });
    expect(testOutcome({ ok: false }).text).toBe("Could not connect: the gateway did not answer.");
  });
});

describe("the pools", () => {
  const pools = readCatalogPools(document);

  it("reads them from the capacity section, a pool without a name by its id", () => {
    expect(pools.map((pool) => [pool.id, pool.name, pool.models.map((m) => m.id)])).toEqual([
      ["standard", "Standard", ["claude-sonnet-5-5", "claude-haiku-5-5"]],
      ["advanced", "Advanced", ["claude-sonnet-5-5", "claude-opus-5-5"]],
    ]);
    expect(
      readCatalogPools({ capacity: { raw: { models: [{ id: "x" }, 3, { name: "y" }] } } }),
    ).toEqual([{ id: "raw", name: "raw", models: [{ id: "x", raw: { id: "x" } }] }]);
    expect(readCatalogPools({})).toEqual([]);
  });

  it("says which agents a model is for from its name", () => {
    expect(harnessFor("claude-sonnet-5-5")).toEqual(["claude"]);
    expect(harnessFor("gpt-6.1-sol")).toEqual(["codex", "opencode"]);
    expect(harnessFor("o3-mini")).toEqual(["codex", "opencode"]);
    expect(harnessFor("o4")).toEqual(["codex", "opencode"]);
    expect(harnessFor("gemini-3-pro")).toEqual(["opencode"]);
    expect(harnessFor("opus-4")).toEqual(["opencode"]);
    expect(harnessFor("ollama/llama")).toEqual(["opencode"]);
    expect(harnessText(["claude"])).toBe("Claude Code");
    expect(harnessText(["codex", "opencode"])).toBe("Codex, OpenCode");
    expect(harnessText([])).toBe("—");
  });

  it("says whose a model is, as the Hub names providers", () => {
    expect(providerFor("claude-haiku-5-5")).toBe("anthropic");
    expect(providerFor("gpt-6.1-sol")).toBe("openai");
    expect(providerFor("o3")).toBe("openai");
    expect(providerFor("gemini-3-pro")).toBe("gemini");
    expect(providerFor("mistral-large")).toBe("openai-compatible");
    expect(newModelEntry("gpt-6.1-sol")).toEqual({
      id: "gpt-6.1-sol",
      provider: "openai",
      harness: ["codex", "opencode"],
    });
  });

  describe("the table", () => {
    it("lists the gateway's models first, then the ones only a pool has, with the pools that hold each", () => {
      const rows = modelRows(pools, ["claude-opus-5-5", "gpt-6.1-sol", "claude-sonnet-5-5"]);
      expect(rows.map((row) => [row.id, [...row.inPools], row.missing])).toEqual([
        ["claude-opus-5-5", ["advanced"], false],
        ["gpt-6.1-sol", [], false],
        ["claude-sonnet-5-5", ["standard", "advanced"], false],
        ["claude-haiku-5-5", ["standard"], true],
      ]);
    });

    it("has only what the pools hold before a test, and calls none of them missing", () => {
      const rows = modelRows(pools, null);
      expect(rows.map((row) => row.id)).toEqual([
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-opus-5-5",
      ]);
      expect(rows.some((row) => row.missing)).toBe(false);
    });

    it("says what the pools say of a model's harness, and what its name suggests while none holds it", () => {
      const rows = modelRows(
        [
          {
            id: "p",
            name: "P",
            models: [{ id: "x", raw: { id: "x", harness: ["codex", "cursor"] } }],
          },
        ],
        ["x", "claude-new"],
      );
      expect(rows.map((row) => row.harness)).toEqual([["codex", "cursor"], ["claude"]]);
    });

    it("has no rows with no pools and no test", () => {
      expect(modelRows([], null)).toEqual([]);
    });
  });

  describe("ticking a model", () => {
    const standard = pools[0]!;
    const advanced = pools[1]!;

    it("adds it as another pool already has it, last", () => {
      const models = poolModelsWith(standard, pools, "claude-opus-5-5", true);
      expect(models).toEqual([sonnet, haiku, opus]);
    });

    it("keeps everything the entry says of a model another pool holds", () => {
      const models = poolModelsWith({ ...advanced, models: [] }, pools, "claude-sonnet-5-5", true);
      expect(models).toEqual([sonnet]);
    });

    it("writes a model no pool holds from its name", () => {
      expect(poolModelsWith(standard, pools, "gpt-6.1-sol", true)).toEqual([
        sonnet,
        haiku,
        { id: "gpt-6.1-sol", provider: "openai", harness: ["codex", "opencode"] },
      ]);
    });

    it("does not add a model twice, and takes one out", () => {
      expect(poolModelsWith(standard, pools, "claude-haiku-5-5", true)).toEqual([sonnet, haiku]);
      expect(poolModelsWith(standard, pools, "claude-haiku-5-5", false)).toEqual([sonnet]);
      expect(poolModelsWith(standard, pools, "gpt-6.1-sol", false)).toEqual([sonnet, haiku]);
    });

    it("is one change to the pool's models, which the Hub merges by their ids", () => {
      const next = {
        ...document,
        capacity: {
          ...document.capacity,
          standard: {
            name: "Standard",
            models: poolModelsWith(standard, pools, "claude-opus-5-5", true),
          },
        },
      };
      expect(countChanges(document, next)).toBe(1);
      expect(draftSets(document, next)).toEqual([
        { path: ["capacity", "standard", "models"], value: [sonnet, haiku, opus] },
      ]);
    });
  });

  it("warns of a pool with no model, which the Hub refuses", () => {
    expect(emptyPoolsText(pools)).toBeNull();
    expect(emptyPoolsText([...pools, { id: "premium", name: "Premium", models: [] }])).toBe(
      "Premium has no models yet. A pool needs at least one.",
    );
    expect(
      emptyPoolsText([
        { id: "a", name: "A", models: [] },
        { id: "b", name: "B", models: [] },
      ]),
    ).toBe("A and B have no models yet. A pool needs at least one.");
  });

  it("says who uses each pool and what they may spend", () => {
    expect(poolUses(document, "EUR")).toEqual([
      "Standard is used by Booking (€600 a month) and Peer Hub (€400 a week).",
    ]);
    expect(poolUses(document, "USD")[0]).toContain("$600 a month");
    expect(poolUses({}, "EUR")).toEqual([]);
  });
});

describe("a new pool", () => {
  const taken = new Set(["standard", "advanced"]);

  it("is a name and an id nobody has", () => {
    expect(checkNewPool({ name: " Premium ", id: " premium ", taken })).toEqual({
      ok: true,
      id: "premium",
      name: "Premium",
    });
  });

  it("makes its id from its name", () => {
    expect(poolIdFromName("Premium plus")).toBe("premium-plus");
    expect(poolIdFromName("Café Ñandú")).toBe("cafe-nandu");
  });

  it("says nothing while the name is empty", () => {
    expect(checkNewPool({ name: "  ", id: "", taken })).toEqual({ ok: false, problem: null });
  });

  it("asks for letters and digits when the name has none to make an id from", () => {
    expect(checkNewPool({ name: "!!!", id: "", taken })).toEqual({
      ok: false,
      problem: "Include a letter (a-z) or digit in the name so Peer can create an ID.",
    });
  });

  it.each(["Premium", "pre mium", "-premium", "premium-", "pre--mium", "a".repeat(49)])(
    "refuses the id %j",
    (id) => {
      expect(checkNewPool({ name: "Premium", id, taken })).toEqual({
        ok: false,
        problem: "An ID is lowercase letters and digits joined by hyphens, like standard.",
      });
    },
  );

  it("refuses an id a pool has", () => {
    expect(checkNewPool({ name: "Standard", id: "standard", taken })).toEqual({
      ok: false,
      problem: "A pool with the ID “standard” exists already. Pick another.",
    });
  });

  it("is made with a name and no models, which are ticked in the table", () => {
    expect(newPoolEdit("premium", "Premium")).toEqual({
      path: ["capacity", "premium"],
      value: { name: "Premium", models: [] },
    });
  });
});

describe("without settings", () => {
  it("takes the gateway's address from a project that has a budget", () => {
    expect(
      manifestGateway([
        { project: { capacity: {} } },
        { project: { capacity: { shared: { gatewayUrl: "https://llm.acme.dev" } } } },
      ]),
    ).toBe("https://llm.acme.dev");
    expect(manifestGateway([{ project: { capacity: {} } }])).toBeUndefined();
  });
});
