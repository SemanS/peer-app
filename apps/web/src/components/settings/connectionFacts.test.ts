import { describe, expect, it } from "vite-plus/test";

import { CHECKING, factOfQuery, isUnderway } from "./connectionFacts";

describe("a fact read from a query", () => {
  it("is loading until the query has data, and ready with it", () => {
    expect(factOfQuery({ data: null, error: null })).toEqual({ kind: "loading" });
    expect(factOfQuery({ data: 3, error: null })).toEqual({ kind: "ready", value: 3 });
  });

  it("is failed when the query failed, even with the data it kept from an earlier read", () => {
    expect(factOfQuery({ data: null, error: "boom" })).toEqual({ kind: "failed", message: "boom" });
    expect(factOfQuery({ data: 3, error: "boom" })).toEqual({ kind: "failed", message: "boom" });
  });

  it("keeps a falsy value: zero and the empty list are answers", () => {
    expect(factOfQuery({ data: 0, error: null })).toEqual({ kind: "ready", value: 0 });
    expect(factOfQuery({ data: [], error: null })).toEqual({ kind: "ready", value: [] });
  });
});

describe("the view of a connection that is not read yet", () => {
  it("says Checking… without calling it on, off by a choice, or in trouble", () => {
    expect(CHECKING).toEqual({ state: "off", label: "Checking…" });
    expect(isUnderway(CHECKING)).toBe(false);
  });
});

describe("what is under way", () => {
  it("is a setup that has a step left, or a connection that broke", () => {
    expect(
      isUnderway({ state: "setup", step: { n: 3, of: 4, title: "verify the stored token" } }),
    ).toBe(true);
    expect(isUnderway({ state: "problem", detail: "Slack rejected the token." })).toBe(true);
  });

  it("is not a setup nobody started, nor what is off, unavailable or connected", () => {
    expect(isUnderway({ state: "setup", detail: "Sign in with an access token." })).toBe(false);
    expect(isUnderway({ state: "off" })).toBe(false);
    expect(isUnderway({ state: "unavailable" })).toBe(false);
    expect(isUnderway({ state: "connected" })).toBe(false);
  });
});
