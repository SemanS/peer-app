import type { PeerSettingsDomainCheck } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  NAME_MAX,
  NOT_CHECKED,
  checkName,
  checkNewDomain,
  checkOutcome,
  claimNote,
  claimOutcome,
  configurationText,
  domainNote,
  domainRows,
  mailDomainOf,
  removeDomainWords,
  withDomain,
  withoutDomain,
  type DomainClaim,
} from "./workspaceGeneral.logic";

describe("the workspace's name", () => {
  it("can be saved once it is typed and differs", () => {
    expect(checkName("  Acme Labs ", "Acme")).toEqual({ ok: true, name: "Acme Labs" });
  });

  it("says nothing of a name that is what it was", () => {
    expect(checkName("Acme", "Acme")).toEqual({ ok: false, problem: null });
    expect(checkName(" Acme ", "Acme")).toEqual({ ok: false, problem: null });
  });

  it("is never blank", () => {
    expect(checkName("   ", "Acme")).toEqual({ ok: false, problem: "A workspace needs a name." });
  });

  it("is no longer than the Hub keeps", () => {
    const result = checkName("a".repeat(NAME_MAX + 1), "Acme");
    expect(result).toEqual({ ok: false, problem: `A name is at most ${NAME_MAX} characters.` });
    expect(checkName("a".repeat(NAME_MAX), "Acme").ok).toBe(true);
  });
});

describe("the domains", () => {
  const claims = [
    { domain: "acme.dev", state: "verified" as const },
    { domain: "acme.io", state: "claimed" as const },
    { domain: "acme-studio.com", state: "listed" as const },
  ];

  it("lists them in the Hub's order, each with its state, its words and whether it can be verified", () => {
    const rows = domainRows({
      workspace: "Acme",
      domains: ["acme.dev", "acme.io", "acme-studio.com"],
      claims,
      checked: {},
    });
    expect(rows.map((row) => [row.domain, row.state, row.canVerify])).toEqual([
      ["acme.dev", "verified", false],
      ["acme.io", "claimed", true],
      ["acme-studio.com", "listed", true],
    ]);
    expect(rows[0]?.note).toBe(
      "Proved with DNS. Colleagues with this address join Acme on their own.",
    );
    expect(rows[1]?.note).toBe(
      "Acme listed it first, so colleagues join on their own. Verify to keep it for sure.",
    );
    expect(rows[2]?.note).toBe(
      "Another workspace holds it. People here get an offer to join, not a seat.",
    );
  });

  it("takes what a check found over what the status still says", () => {
    const rows = domainRows({
      workspace: "Acme",
      domains: ["acme-studio.com"],
      claims,
      checked: { "acme-studio.com": "verified" },
    });
    expect(rows[0]).toMatchObject({ state: "verified", canVerify: false });
  });

  it("does not make up a state a Hub from before domain claims does not give", () => {
    const rows = domainRows({
      workspace: "Acme",
      domains: ["acme.dev"],
      claims: undefined,
      checked: {},
    });
    expect(rows[0]).toMatchObject({
      state: undefined,
      canVerify: false,
      note: "Colleagues with this address join Acme on their own.",
    });
    expect(domainNote(undefined, "Acme")).toBe(rows[0]?.note);
  });

  it("is looked up by its own name, whatever else is in the record", () => {
    const rows = domainRows({
      workspace: "Acme",
      domains: ["constructor.com"],
      claims: [],
      checked: {},
    });
    expect(rows[0]?.state).toBeUndefined();
  });

  it("adds a domain to the list once, and takes one away", () => {
    expect(withDomain(["acme.dev"], "acme.io")).toEqual(["acme.dev", "acme.io"]);
    expect(withDomain(["acme.dev"], "acme.dev")).toEqual(["acme.dev"]);
    expect(withoutDomain(["acme.dev", "acme.io"], "acme.dev")).toEqual(["acme.io"]);
  });

  it("says what removing a domain does, and that a verified one loses its proof", () => {
    expect(removeDomainWords({ domain: "acme.io", state: "claimed" }, "Acme")).toBe(
      "Remove acme.io? People with an address at acme.io stop joining Acme on their own. Whoever is in it stays.",
    );
    expect(removeDomainWords({ domain: "acme.dev", state: "verified" }, "Acme")).toContain(
      "to take it back later you prove it again",
    );
  });
});

describe("a domain that is typed to be added", () => {
  const context = { listed: ["acme.dev"], mine: "acme.io" };

  it("is taken lower case, with a leading @ or a whole address cut to its domain", () => {
    expect(checkNewDomain(" ACME.io ", context)).toEqual({ ok: true, domain: "acme.io" });
    expect(checkNewDomain("@acme.io", context)).toEqual({ ok: true, domain: "acme.io" });
    expect(checkNewDomain("Slavo@Acme.io", context)).toEqual({ ok: true, domain: "acme.io" });
  });

  it("says nothing while the field is empty", () => {
    expect(checkNewDomain("  ", context)).toEqual({ ok: false, problem: null });
    expect(checkNewDomain("@", context)).toEqual({ ok: false, problem: null });
  });

  it.each(["nodot", "acme..io", "-acme.io", "acme-.io", "ac me.io", "acme.io/path", "a_b.io"])(
    "refuses %j as not a domain",
    (typed) => {
      expect(checkNewDomain(typed, context)).toEqual({
        ok: false,
        problem: "That is not a domain. Write it like acme.com.",
      });
    },
  );

  it("refuses a public mail provider, in the words under the field", () => {
    expect(checkNewDomain("gmail.com", { listed: [], mine: "gmail.com" })).toEqual({
      ok: false,
      problem: "Public mail domains like gmail.com can’t be added.",
    });
  });

  it("refuses a domain the workspace lists already", () => {
    expect(checkNewDomain("acme.dev", context)).toEqual({
      ok: false,
      problem: "acme.dev is listed already.",
    });
  });

  it("refuses a domain the person has no address at", () => {
    expect(checkNewDomain("other.com", context)).toEqual({
      ok: false,
      problem: "Add a domain you have an address at. Yours is acme.io.",
    });
  });

  it("leaves it to the Hub where the person's own domain is not known", () => {
    expect(checkNewDomain("other.com", { listed: [], mine: null })).toEqual({
      ok: true,
      domain: "other.com",
    });
  });

  it("reads the domain of an address", () => {
    expect(mailDomainOf("Ana@Acme.dev")).toBe("acme.dev");
    expect(mailDomainOf("nobody")).toBeNull();
    expect(mailDomainOf(null)).toBeNull();
  });
});

describe("what a check of a domain found", () => {
  const found = (patch: Partial<PeerSettingsDomainCheck>): PeerSettingsDomainCheck => ({
    domain: "acme-studio.com",
    state: "verified",
    dns: "found",
    ...patch,
  });
  const context = { workspace: "Acme", before: "listed" as const };

  it("starts as not checked", () => {
    expect(NOT_CHECKED).toEqual({ tone: "idle", text: "Not checked yet" });
  });

  it("says a domain is the workspace's now, taken over from who held it", () => {
    expect(checkOutcome(found({}), { ...context, holder: "Studio North" })).toEqual({
      tone: "ok",
      text: "Verified. acme-studio.com now belongs to Acme, taken over from Studio North.",
    });
    expect(checkOutcome(found({}), context).text).toContain("taken over from another workspace");
  });

  it("says a claimed domain that was proved stays with the workspace", () => {
    expect(
      checkOutcome(found({ domain: "acme.io" }), { workspace: "Acme", before: "claimed" }),
    ).toEqual({
      tone: "ok",
      text: "Verified. acme.io is proved with DNS and stays with Acme.",
    });
  });

  it("asks for patience while the record is not there yet", () => {
    expect(checkOutcome(found({ state: "listed", dns: "missing" }), context)).toEqual({
      tone: "wait",
      text: "We don’t see the record yet. DNS can take up to an hour; the value stays the same.",
    });
  });

  it("says a check that finds no record has ended an earlier verification", () => {
    const outcome = checkOutcome(found({ state: "claimed", dns: "missing" }), {
      workspace: "Acme",
      before: "verified",
    });
    expect(outcome.tone).toBe("wait");
    expect(outcome.text).toContain("is not verified now");
  });

  it("says when DNS could not be read, which changed nothing", () => {
    expect(checkOutcome(found({ state: "listed", dns: "unavailable" }), context).text).toBe(
      "DNS can’t be read right now, so nothing was checked. Try again in a few minutes.",
    );
    expect(
      checkOutcome(found({ state: "verified", dns: "unavailable" }), {
        workspace: "Acme",
        before: "verified",
      }).text,
    ).toContain("DNS can’t be read right now");
  });

  it("says when the Hub does not check DNS at all", () => {
    expect(checkOutcome(found({ state: "listed", dns: "off" }), context).text).toBe(
      "This Hub doesn’t check DNS, so a record can’t verify acme-studio.com. Ask the Hub’s operator to settle it.",
    );
  });

  it("does not claim more than it knows of an answer it does not know", () => {
    const outcome = checkOutcome(found({ state: "listed", dns: "somethingnew" }), context);
    expect(outcome.tone).toBe("wait");
    expect(outcome.text).toContain("could not check acme-studio.com");
  });
});

describe("a domain another workspace holds", () => {
  const claim: DomainClaim = {
    domain: "acme-studio.com",
    record: "peer-hub-verify=7f3c9a1e52b84d06a1c2",
    holder: { slug: "studio-north", name: "Studio North", verified: false },
    dns: "missing",
  };

  it("names who holds it and what proves control", () => {
    expect(claimNote(claim)).toBe(
      "Studio North holds it. Prove you control acme-studio.com to add it.",
    );
    expect(claimNote({ ...claim, holder: undefined })).toContain("Another workspace holds it");
  });

  it("says what DNS said when the Hub looked for the record", () => {
    expect(claimOutcome(claim).text).toContain("We don’t see the record yet");
    expect(claimOutcome({ ...claim, dns: "unavailable" }).text).toContain("DNS can’t be read");
    expect(claimOutcome({ ...claim, dns: "off" }).text).toContain("doesn’t check DNS");
  });

  it("asks to publish the record when DNS was not asked", () => {
    expect(claimOutcome({ ...claim, dns: undefined })).toEqual({
      tone: "idle",
      text: "Studio North holds acme-studio.com. Publish the record, then check.",
    });
  });

  it("says a holder that proved its domain cannot be overtaken", () => {
    const proved = {
      ...claim,
      holder: { slug: "studio-north", name: "Studio North", verified: true },
    };
    expect(claimNote(proved)).toContain("proved it with DNS, so it can’t be taken over");
    expect(claimOutcome(proved).text).toContain("Ask its owners to release it");
  });
});

describe("where the configuration stands", () => {
  it("names the settings revision and what the Hub applied", () => {
    expect(configurationText(42, "3f2a9c1e5b7d")).toBe("Revision 42 · applied 3f2a9c1e5b7d");
    expect(configurationText(null, "3f2a9c1e5b7d")).toBe("applied 3f2a9c1e5b7d");
    expect(configurationText(7, undefined)).toBe("Revision 7");
    expect(configurationText(null, undefined)).toBe("Nothing applied yet");
  });
});
