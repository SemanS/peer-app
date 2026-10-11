import { describe, expect, it } from "vite-plus/test";

import { currencySymbol, formatMoney, isSafeGitRef, isSafeGitRemote } from "./shared.logic";

describe("money", () => {
  it.each<[number, string, string]>([
    [630, "EUR", "€630"],
    [150, "EUR", "€150"],
    [12.5, "EUR", "€12.50"],
    [80.5, "USD", "$80.50"],
    [1200, "USD", "$1,200"],
    [0, "EUR", "€0"],
    [12, "XX", "XX 12"],
    [30, "CZK", "CZK 30"],
  ])("writes %d %s as %s", (amount, currency, text) => {
    expect(formatMoney(amount, currency)).toBe(text);
  });

  it("marks an amount with the symbol of its currency, else with its code", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("CZK")).toBe("CZK ");
  });
});

describe("a repository address git may clone", () => {
  it.each([
    "https://github.com/acme/booking-api",
    "https://github.com/acme/booking-api.git",
    "http://git.acme.dev/app",
    "ssh://git@gitlab.com/acme/app.git",
    "git://example.test/app.git",
    "git@gitlab.com:acme/app.git",
    "gitlab.com:acme/app.git",
    "file:///srv/git/app.git",
    "/Users/ana/code/app",
    "HTTPS://github.com/acme/app",
    `https://example.test/${"a".repeat(479)}`,
  ])("takes %s", (url) => {
    expect(isSafeGitRemote(url)).toBe(true);
  });

  it.each([
    // A helper that runs a command, and an option: what the check exists for.
    "ext::sh -c touch% /tmp/pwned",
    "fd::17",
    "--upload-pack=touch /tmp/pwned",
    "-b",
    // Something git could take for more than an address.
    "https://example.test/app.git --config=x",
    " https://example.test/app.git",
    "https://example.test/app.git\n",
    "https://exa\u0000mple.test/app.git",
    "https:///etc/passwd",
    "https://",
    // Not an address of any kind.
    "acme/booking-api",
    "github.com/acme/app",
    "",
    // scp-style with something the Hub does not take: two users, none, a rooted or drive path.
    "a@b@host:path",
    "@host:path",
    "host:",
    "host:/abs",
    "host:\\path",
    "host:a:b",
    "ho st:path",
  ])("refuses %j", (url) => {
    expect(isSafeGitRemote(url)).toBe(false);
  });

  it("holds an address to 500 bytes, as the Hub does, whatever it is written in", () => {
    const prefix = "https://example.test/";
    expect(isSafeGitRemote(`${prefix}${"a".repeat(500 - prefix.length)}`)).toBe(true);
    expect(isSafeGitRemote(`${prefix}${"a".repeat(501 - prefix.length)}`)).toBe(false);
    // 250 letters of two bytes each are 271 characters but 521 bytes.
    expect(isSafeGitRemote(`${prefix}${"é".repeat(250)}`)).toBe(false);
    expect(isSafeGitRemote(`${prefix}${"é".repeat(100)}`)).toBe(true);
  });
});

describe("a branch git may check out", () => {
  it("takes a plain branch name", () => {
    for (const name of ["main", "release/2026", "feature/KRK-812_split.payments", "v1.2.3"]) {
      expect(isSafeGitRef(name)).toBe(true);
    }
  });

  it("refuses an option, a path trick, a lock and what is not plain", () => {
    for (const name of [
      "--orphan",
      "-b",
      "a..b",
      "a b",
      "/main",
      "main/",
      "x.lock",
      "a//b",
      "a\nb",
      "é",
      "",
    ]) {
      expect(isSafeGitRef(name)).toBe(false);
    }
  });

  it("holds a name to 200 characters", () => {
    expect(isSafeGitRef("a".repeat(200))).toBe(true);
    expect(isSafeGitRef("a".repeat(201))).toBe(false);
  });
});
