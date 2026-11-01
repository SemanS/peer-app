// @effect-diagnostics globalDate:off - it times how long a pure function takes.
import { describe, expect, it } from "@effect/vitest";

import { getAt, harnessLabel, jsonEqual, readDocument, setAt, setsFor } from "./peerSettings.ts";

describe("the draft", () => {
  const base = {
    currency: "EUR",
    projects: {
      booking: {
        name: "Booking",
        members: ["ana@acme.dev"],
        leads: ["ana@acme.dev"],
        coordination: { policy: "notify", paths: { "docs/**": "notify" } },
      },
      camp: { name: "Camp-bot" },
    },
  };

  it("reads a node at a path whose keys are data, and enters only mappings", () => {
    const keyed = {
      paths: { "migrations/**": "exclusive", "a.b": 1, constructor: "own" },
      list: [1],
    };
    expect(getAt(keyed, ["paths", "migrations/**"])).toBe("exclusive");
    expect(getAt(keyed, ["paths", "a.b"])).toBe(1);
    expect(getAt(keyed, ["paths", "constructor"])).toBe("own");
    expect(getAt(keyed, [])).toBe(keyed);
    expect(getAt(keyed, ["paths", "missing"])).toBeUndefined();
    // Not a key of its own, so not there; and a list is no mapping to enter.
    expect(getAt({}, ["constructor"])).toBeUndefined();
    expect(getAt({}, ["__proto__"])).toBeUndefined();
    expect(getAt(keyed, ["list", "0"])).toBeUndefined();
    expect(getAt(null, ["a"])).toBeUndefined();
  });

  it("sets and removes a node without touching the rest, copying only the way to it", () => {
    const changed = setAt(base, ["projects", "booking", "coordination", "policy"], "coordinate");
    expect(getAt(changed, ["projects", "booking", "coordination", "policy"])).toBe("coordinate");
    expect(getAt(base, ["projects", "booking", "coordination", "policy"])).toBe("notify");
    expect(changed.projects.camp).toBe(base.projects.camp);
    expect(changed.projects.booking.members).toBe(base.projects.booking.members);
    expect(Object.keys(changed.projects.booking)).toEqual(Object.keys(base.projects.booking));
    const without = setAt(
      base,
      ["projects", "booking", "coordination", "paths", "docs/**"],
      undefined,
    );
    expect(getAt(without, ["projects", "booking", "coordination", "paths"])).toEqual({});
    expect(Object.keys(setAt(base, ["projects", "camp"], undefined).projects)).toEqual(["booking"]);
    expect(setAt(undefined, ["a", "b"], 1)).toEqual({ a: { b: 1 } });
    expect(setAt(base, [], "whole")).toBe("whole");
  });

  it("keeps a key called __proto__ a key, and never a prototype", () => {
    const made = setAt({}, ["paths", "__proto__"], { polluted: true }) as { paths: object };
    expect(Object.keys(made.paths)).toEqual(["__proto__"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect((made.paths as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("compares as JSON does: keys in any order, lists in order, nothing as null", () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual(undefined, null)).toBe(true);
    expect(jsonEqual({ a: undefined }, {})).toBe(true);
    expect(jsonEqual({ a: null }, {})).toBe(true);
    expect(jsonEqual("", undefined)).toBe(false);
    expect(jsonEqual(0, null)).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual({ toString: 1 }, {})).toBe(false);
  });

  it("turns a draft into the sets of what changed at the paths a page edits", () => {
    const draft = setAt(
      setAt(
        setAt(base, ["projects", "booking", "coordination", "policy"], "coordinate"),
        ["projects", "booking", "coordination", "paths", "migrations/**"],
        "exclusive",
      ),
      ["projects", "booking", "leads"],
      ["ana@acme.dev", "eva@acme.dev"],
    );
    const paths = [
      ["projects", "booking", "coordination", "policy"],
      ["projects", "booking", "coordination", "paths"],
      ["projects", "booking", "leads"],
      ["projects", "booking", "members"],
      ["currency"],
    ];
    expect(setsFor(base, draft, paths)).toEqual([
      { path: ["projects", "booking", "coordination", "policy"], value: "coordinate" },
      {
        path: ["projects", "booking", "coordination", "paths"],
        value: { "docs/**": "notify", "migrations/**": "exclusive" },
      },
      { path: ["projects", "booking", "leads"], value: ["ana@acme.dev", "eva@acme.dev"] },
    ]);
    expect(setsFor(base, base, paths)).toEqual([]);
    expect(setsFor(base, structuredCloneOf(base), paths)).toEqual([]);
  });

  it("sends null for what the draft no longer has, and the whole value of what it adds", () => {
    const removed = setAt(base, ["projects", "booking", "coordination"], undefined);
    expect(setsFor(base, removed, [["projects", "booking", "coordination"]])).toEqual([
      { path: ["projects", "booking", "coordination"], value: null },
    ]);
    const added = setAt(base, ["projects", "city"], { name: "City-bot", leads: ["bob@acme.dev"] });
    expect(setsFor(base, added, [["projects", "city"]])).toEqual([
      { path: ["projects", "city"], value: { name: "City-bot", leads: ["bob@acme.dev"] } },
    ]);
    expect(
      setsFor(base, setAt(base, ["projects", "camp"], undefined), [["projects", "camp"]]),
    ).toEqual([{ path: ["projects", "camp"], value: null }]);
  });

  it("leaves a path to its ancestor when both are named, and a path named twice to once", () => {
    const draft = setAt(base, ["projects", "booking", "coordination", "policy"], "ask");
    const policy = ["projects", "booking", "coordination", "policy"];
    const coordination = ["projects", "booking", "coordination"];
    for (const paths of [
      [policy, coordination],
      [coordination, policy],
      [coordination, coordination],
    ]) {
      expect(setsFor(base, draft, paths)).toEqual([
        { path: coordination, value: { policy: "ask", paths: { "docs/**": "notify" } } },
      ]);
    }
    expect(setsFor(base, draft, [policy, policy])).toEqual([{ path: policy, value: "ask" }]);
  });
});

const structuredCloneOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("names", () => {
  it("says a harness by its product's name, and an unknown one as it is", () => {
    expect(harnessLabel("claude")).toBe("Claude Code");
    expect(harnessLabel("future")).toBe("future");
  });
});

describe("the document", () => {
  it("reads the parts the pages read, leaving out an entry that does not read", () => {
    const parts = readDocument({
      currency: "EUR",
      people: { "ana@acme.dev": { name: "Ana" } },
      projects: {
        booking: {
          name: "Booking",
          members: ["*"],
          leads: [],
          repositories: [],
          tools: ["postgres"],
          future: { kept: true },
        },
        broken: { members: "everyone" },
      },
      tools: { postgres: { name: "Postgres", mcp: { command: "npx" } } },
    });
    expect(Object.keys(parts.projects)).toEqual(["booking"]);
    expect(parts.projects.booking!.future).toEqual({ kept: true });
    expect(parts.people["ana@acme.dev"]!.name).toBe("Ana");
    expect(Object.keys(parts.tools)).toEqual(["postgres"]);
    expect(readDocument({})).toEqual({
      people: {},
      projects: {},
      tools: {},
    });
    expect(readDocument({ projects: ["no", "mapping"], tools: null }).projects).toEqual({});
  });
});
