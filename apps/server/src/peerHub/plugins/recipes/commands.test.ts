// @effect-diagnostics nodeBuiltinImport:off - check source procedures against the running router's help.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { NO_PLUGINS } from "../../core/broker/host.ts";
import { brokerFixture } from "../../core/broker/testkit.ts";
import { isPlainCliCall } from "../../core/coordination/edits.ts";
import type { PeerCommand } from "../../core/plugin.ts";
import { recipeTable } from "./recipeTable.generated.ts";
import type { Recipe } from "./generate.ts";
const readonly = new Set([
  "status",
  "index",
  "context",
  "log",
  "knowledge",
  "find",
  "recipe",
  "help",
]);
function check(recipe: Recipe, help: string) {
  const forms = new Map(
    help.split("\n").flatMap((line) => {
      const match = /^\s+peer ([a-z-]+)\b(.*)$/.exec(line);
      return match ? [[match[1]!, new Set(match[2]!.match(/--[a-z-]+/g) ?? [])] as const] : [];
    }),
  );
  forms.set("help", new Set());
  const lines = [...recipe.body.matchAll(/`(peer [^`]+)`/g)].map((match) => match[1]!);
  for (const raw of lines) {
    const name = raw.split(/\s/)[1]!;
    const fail = (why: string) => {
      throw new Error(`${recipe.name}: ${raw}: ${why}`);
    };
    if (!forms.has(name)) fail("unknown command");
    if (recipe.access === "read" && !readonly.has(name)) fail("read-only recipe writes");
    for (const flag of raw.match(/--[a-z-]+/g) ?? [])
      if (!forms.get(name)!.has(flag)) fail(`unknown flag ${flag}`);
    const command = raw.replace(/<[^>]+>/g, "word").replace(/[[\]]/g, "");
    if (!isPlainCliCall(command, "peer")) fail("unsafe plain command");
  }
}
it("validates real recipe commands and flags, detecting unknown, write and shell-expansion plants", async () => {
  const request = await NodeFSP.readFile(
    NodePath.join(import.meta.dirname, "..", "requests", "text.ts"),
    "utf8",
  );
  const requestUsage = /const REQUEST_USAGE =\s*'([^']+)'/.exec(request)![1]!;
  const commands: PeerCommand[] = [
    {
      name: "request",
      usage: requestUsage,
      summary: "Requests",
      run: () => Effect.die("not executed"),
    },
  ];
  for (const id of ["announcements", "dependencies"]) {
    const source = await NodeFSP.readFile(
      NodePath.join(import.meta.dirname, "..", id, "index.ts"),
      "utf8",
    );
    const match = /name:\s*"([^"]+)",\s*usage:\s*"([^"]+)"/.exec(source)!;
    commands.push({
      name: match[1]!,
      usage: match[2]!,
      summary: id,
      run: () => Effect.die("not executed"),
    });
  }
  const fixture = await brokerFixture(() => ({
    plugins: async () => ({
      ...NO_PLUGINS,
      commands: commands.map((command) => ({ plugin: "recipes", command })),
    }),
  }));
  try {
    const help = await fixture.broker.runCli("help", [], {});
    for (const row of recipeTable) check(row, help);
    const base = recipeTable.find((r) => r.name === "catch-up")!;
    expect(() => check({ ...base, body: base.body + " `peer sync-all`" }, help)).toThrow(
      /catch-up: peer sync-all/,
    );
    expect(() => check({ ...base, body: base.body + ' `peer note "x"`' }, help)).toThrow(
      /read-only/,
    );
    expect(() =>
      check({ ...base, access: "write", body: '`peer note "before`after"`' }, help),
    ).toThrow(/unsafe/);
  } finally {
    await fixture.dispose();
  }
});
