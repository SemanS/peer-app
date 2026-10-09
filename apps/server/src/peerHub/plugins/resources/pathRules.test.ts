import { describe, expect, it } from "@effect/vitest";
import { matches, bestRule, validatePattern } from "./pathRules.ts";
// Twin: Hub server/src/coord/rules/matching.rs VECTORS. Change both tables together.
const vectors = [
  ["migrations/**", "migrations/0019_a.sql", true],
  ["migrations/**", "migrations/legacy/0001.sql", true],
  ["migrations/**", "src/migrations/x.sql", false],
  ["docs/*.md", "docs/a.md", true],
  ["docs/*.md", "docs/api/a.md", false],
  ["**/*.sql", "x.sql", true],
  ["**/*.sql", "db/x.sql", true],
  ["package.json", "package.json", true],
  ["package.json", "apps/web/package.json", false],
  ["src/*/index.ts", "src/a/index.ts", true],
  ["src/*/index.ts", "src/a/b/index.ts", false],
  ["migrations/**", "migrations", true],
  ["migrations/**", "migrations/", true],
  ["migrations/**", "migrationsx/a.sql", false],
  ["**", "a/b/c.ts", true],
  ["**", "README.md", true],
  ["a/**/b", "a/b", true],
  ["a/**/b", "a/x/y/b", true],
  ["a/**/b", "a/x/b/c", false],
  ["**/index.ts", "index.ts", true],
  ["**/index.ts", "a/index.tsx", false],
  ["*", "file.ts", true],
  ["*", "dir/file.ts", false],
  ["docs/*.md", "docs/.md", true],
  ["docs/*.md", "docs/a.mdx", false],
  ["*a*", "bab", true],
  ["*a*", "bbb", false],
  ["src/*.test.ts", "src/pay.test.ts", true],
  ["src/*.test.ts", "src/pay.ts", false],
  ["Migrations/**", "migrations/x.sql", false],
  ["with space/*.md", "with space/a b.md", true],
  ["čaj/*.md", "čaj/x.md", true],
] as const;
describe("path policies learned from the Hub", () => {
  it("matches the complete Rust vector table", () => {
    for (const [glob, path, expected] of vectors) {
      expect(validatePattern(glob)).toBeNull();
      expect(matches(glob, path), `${glob} against ${path}`).toBe(expected);
    }
  });
  it("selects by literals, fewer doubles, fewer singles and lexical tie break", () => {
    for (const [patterns, path, winner] of [
      [["src/**", "src/payments/**"], "src/payments/pay.ts", "src/payments/**"],
      [["src/**", "src/payments/**"], "src/util.ts", "src/**"],
      [["**/*.sql", "migrations/**"], "migrations/x.sql", "migrations/**"],
      [["docs/**", "docs/*.md"], "docs/a.md", "docs/*.md"],
      [["**", "package.json"], "package.json", "package.json"],
      [["a/**", "a/*"], "a/b", "a/*"],
      [["*a*", "a*"], "ab", "a*"],
      [["a/*", "*/b"], "a/b", "*/b"],
    ] as const) {
      const rules = patterns.map((pattern) => ({ pattern, policy: "notify" as const }));
      expect(bestRule(rules, path)?.pattern).toBe(winner);
      expect(bestRule(rules.toReversed(), path)?.pattern).toBe(winner);
    }
    expect(bestRule([{ pattern: "docs/**", policy: "ask" }], "src/a.ts")).toBeUndefined();
  });
  it("rejects ambiguous grammar and bounds wildcard work without backtracking", () => {
    for (const bad of [
      "",
      "a".repeat(201),
      "/a",
      "a/",
      "a//b",
      "a/./b",
      "a/../b",
      "a\\b",
      "a:b",
      "a?",
      "a[bc]",
      "a{b,c}",
      "!a",
      "a**b",
      "a\n",
    ])
      expect(validatePattern(bad)).not.toBeNull();
    expect(
      matches(Array(60).fill("**").join("/") + "/c", Array(140).fill("a").join("/") + "/b"),
    ).toBe(false);
    expect(matches("*a".repeat(60), "a".repeat(250) + "b")).toBe(false);
  });
});
