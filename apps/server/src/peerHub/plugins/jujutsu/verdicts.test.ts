import { assert, describe, it } from "@effect/vitest";

import type { PeerToolContext } from "../../core/plugin.ts";
import { stopGeneral, stopNamed } from "./text.ts";
import { judge, named, type Other, type Place } from "./verdicts.ts";
import { sessionIn } from "./fixtures.test.ts";
import { jjInvocations } from "../../core/plugin.ts";

const ANA: Other = {
  ids: ["lrorvllttwkzsxvmuywpqzmpmovyzlxm"],
  bookmark: "feature/ORD-11-cents",
  owner: { person: "Ana", task: "ORD-11" },
};
const place: Place = { jj: true, others: [ANA] };
const step = (command: string | undefined): PeerToolContext => ({
  session: sessionIn("/work/ord-12"),
  event: "pre-tool",
  tool: "Bash",
  paths: [],
  remainingMs: 1_000,
  ...(command === undefined ? {} : { command }),
});

describe("the stop of --ignore-immutable", () => {
  it("denies it and names the change the words name", () => {
    const verdict = judge(
      step("jj --ignore-immutable squash --into lrorvllt order.js"),
      place,
      true,
    );
    assert.deepStrictEqual(verdict, {
      decision: "deny",
      reason: stopNamed("lrorvllt", ANA.owner),
    });
  });

  it("denies it with the general text when nothing of another session is named", () => {
    const verdict = judge(step("jj --ignore-immutable rebase -s main -o @"), place, true);
    assert.deepStrictEqual(verdict, { decision: "deny", reason: stopGeneral() });
  });

  it("finds the flag wherever jj takes it, and in any command of a line", () => {
    for (const command of [
      "jj squash --into lrorvllt --ignore-immutable",
      "cd ../x && jj --ignore-immutable describe -r lrorvllt -m x",
      "jj log; jj --ignore-immutable abandon feature/ORD-11-cents",
    ])
      assert.strictEqual(judge(step(command), place, true)?.decision, "deny", command);
  });

  it("names a bookmark, but not a prefix shorter than four letters", () => {
    assert.include(
      judge(step("jj --ignore-immutable abandon feature/ORD-11-cents"), place, true)?.reason ?? "",
      "would rewrite feature/ORD-11-cents, Ana's change for ORD-11",
    );
    assert.strictEqual(
      judge(step("jj --ignore-immutable abandon lro"), place, true)?.reason,
      stopGeneral(),
    );
  });

  it("stops nothing else: no flag, no jj, no command, or the flag only in words", () => {
    for (const command of [
      "jj squash --into lrorvllt order.js",
      "jj log -r 'main..@'",
      "git push origin main",
      'echo "jj --ignore-immutable squash"',
      undefined,
    ])
      assert.isNull(judge(step(command), place, true), String(command));
  });

  it("applies in a jj checkout with protection on, and nowhere else", () => {
    const command = "jj --ignore-immutable squash --into lrorvllt";
    assert.isNull(judge(step(command), place, false));
    // A Git checkout, or a session Peer has not found in a jj one: unaffected.
    assert.isNull(judge(step(command), { jj: false, others: [ANA] }, true));
  });
});

describe("naming a change of another session", () => {
  const runs = (command: string) => jjInvocations(command);

  it("reads each change once, by its id prefix or its bookmark", () => {
    const hits = named(
      runs("jj squash --into lrorvllt order.js && jj describe -r 'lrorvllt::' -m x"),
      [ANA],
    );
    assert.deepStrictEqual(
      hits.map((hit) => [hit.key, hit.word]),
      [["lrorvllttwkzsxvmuywpqzmpmovyzlxm", "lrorvllt"]],
    );
    assert.strictEqual(
      named(runs("jj new feature/ORD-11-cents"), [ANA])[0]?.key,
      "bookmark:feature/ORD-11-cents",
    );
  });

  it("does not take a path or a word that is not a change id for one", () => {
    assert.deepStrictEqual(named(runs("jj squash --into mspqrmyv order.js"), [ANA]), []);
    assert.deepStrictEqual(named(runs("jj log -r main"), [ANA]), []);
  });
});
