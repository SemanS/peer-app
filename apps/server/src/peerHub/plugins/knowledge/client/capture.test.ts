import { assert, describe, expect, it } from "@effect/vitest";

import { CliError } from "../../../core/plugin.ts";
import { captureAnswer, captureEntry, captureTool, parseCapture } from "./capture.ts";

const FULL = [
  "--kind",
  "learning",
  "--title",
  "Totals round per line",
  "--what",
  "The total is the sum of rounded lines.",
  "--why",
  "Two agents summed first and rounded last.",
  "--paths",
  "src/pricing/",
  "--paths",
  "./src/pricing/total.ts",
  "--verify",
  "cargo test pricing",
];

describe("peer capture's arguments", () => {
  it("reads the kind, the three texts, the paths and the check", () => {
    const request = parseCapture(FULL);
    assert.deepEqual(request, {
      kind: "learning",
      title: "Totals round per line",
      what: "The total is the sum of rounded lines.",
      why: "Two agents summed first and rounded last.",
      paths: ["src/pricing/", "src/pricing/total.ts"],
      verify: "cargo test pricing",
    });
    assert.deepEqual(captureEntry(request, "peer:claude:one"), {
      entry: {
        kind: "learning",
        title: "Totals round per line",
        body: "## What\n\nThe total is the sum of rounded lines.\n\n## Why\n\nTwo agents summed first and rounded last.",
        paths: ["src/pricing/", "src/pricing/total.ts"],
        verify: "cargo test pricing",
      },
      source: "peer:claude:one",
    });
  });

  it("ends with a usage error naming what is missing or wrong, and records nothing", () => {
    const usage = (args: ReadonlyArray<string>) => {
      try {
        parseCapture(args);
      } catch (error) {
        assert.instanceOf(error, CliError);
        assert.equal((error as CliError).outcome, "usage");
        return (error as CliError).reason;
      }
      assert.fail("no usage error");
    };
    assert.include(usage([]), "--kind is decision, convention or learning");
    assert.include(
      usage(["--kind", "incident", "--title", "x", "--what", "y", "--why", "z"]),
      "--kind",
    );
    assert.include(
      usage(["--kind", "decision", "--what", "y", "--why", "z"]),
      "--title is required",
    );
    assert.include(
      usage(["--kind", "decision", "--title", "", "--what", "y", "--why", "z"]),
      "--title",
    );
    assert.include(
      usage(["--kind", "decision", "--title", "x", "--what", "y", "--why", "z", "--when"]),
      "not a flag",
    );
    assert.include(usage(["--kind", "decision", "--kind", "learning"]), "given once");
    assert.include(usage(["--kind", "decision", "--title"]), "needs a value");
    assert.include(usage([...FULL, "--paths", "../secret"]), "not a path inside the repository");
    assert.include(usage([...FULL, "--paths", "/etc/passwd"]), "not a path inside the repository");
    assert.include(
      usage(["--kind", "decision", "--title", "x".repeat(161), "--what", "y", "--why", "z"]),
      "at most 160",
    );
  });

  it("drops what a reader cannot see and keeps the consequences when given", () => {
    const request = parseCapture([
      "--kind",
      "decision",
      "--title",
      "Keep​ prices\nin cents",
      "--what",
      "w",
      "--why",
      "y",
      "--consequences",
      "  ",
    ]);
    assert.equal(request.title, "Keep prices in cents");
    assert.isUndefined(request.consequences);
    assert.include(
      captureEntry({ ...request, consequences: "Migrate the column." }, "s").entry.body,
      "## Consequences\n\nMigrate the column.",
    );
  });

  it("answers with the candidate's id and that a person reviews it", () => {
    assert.equal(
      captureAnswer("2026-10-28-totals", "learning", 0),
      "Captured learning 2026-10-28-totals in the project's knowledge inbox (this clone only). It is reviewed when a person promotes and commits it; until then it binds nobody.",
    );
    assert.include(captureAnswer("x", "decision", 2), "2 existing entries say something near it");
    assert.include(captureAnswer("x", "decision", 1), "1 existing entry says something near it");
  });
});

describe("the peer_capture tool", () => {
  it("maps its input to the command's arguments and refuses what the command does not take", () => {
    assert.deepEqual(
      captureTool.arguments({
        kind: "learning",
        title: "t",
        what: "w",
        why: "y",
        paths: ["src/a.ts", "src/b/"],
        verify: "npm test",
      }),
      [
        "--kind",
        "learning",
        "--title",
        "t",
        "--what",
        "w",
        "--why",
        "y",
        "--verify",
        "npm test",
        "--paths",
        "src/a.ts",
        "--paths",
        "src/b/",
      ],
    );
    expect(() => captureTool.arguments({ kind: "learning", title: 3 })).toThrow(/title is text/);
    expect(() => captureTool.arguments({ kind: "learning", paths: "src" })).toThrow(
      /paths is a list of text/,
    );
    expect(() => captureTool.arguments({ kind: "learning", private: true })).toThrow(
      /not an input of peer_capture/,
    );
    assert.equal(captureTool.command, "capture");
    assert.deepEqual((captureTool.inputSchema as { required: string[] }).required, [
      "kind",
      "title",
      "what",
      "why",
    ]);
  });
});
