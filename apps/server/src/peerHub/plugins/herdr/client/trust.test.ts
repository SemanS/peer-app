import { assert, describe, it } from "@effect/vitest";

import { trustKeys, trustQuestionOf } from "./trust.ts";

const CLAUDE = `hotovo@Mac chat % claude --model claude-haiku-5-5

 Accessing workspace:

 /Users/hotovo/Peer/.worktrees/chat

 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source
 project, or work from your team). If not, take a moment to review what's in this folder first.

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`;

describe("the folder trust question", () => {
  it("moves to the answer from Claude Code's preselected one", () => {
    const question = trustQuestionOf(CLAUDE);
    assert.isNotNull(question);
    assert.deepStrictEqual(trustKeys(question!, true), ["down", "enter"]);
    assert.deepStrictEqual(trustKeys(question!, false), ["enter"]);
  });

  it("reads the other order, and a numbered menu", () => {
    const question = trustQuestionOf(
      "Do you trust the contents of this directory?\n\n› 1. Yes, continue\n  2. No, quit\n",
    );
    assert.isNotNull(question);
    assert.deepStrictEqual(trustKeys(question!, true), ["enter"]);
    assert.deepStrictEqual(trustKeys(question!, false), ["down", "enter"]);
  });

  it("takes no words on the screen for the menu", () => {
    assert.isNull(trustQuestionOf(`${CLAUDE}\n> done\n1\n2\n3\n4\n5\n6\n7\n`));
    assert.isNull(trustQuestionOf("No, exit\nYes, I trust this folder\n"));
    assert.isNull(trustQuestionOf(CLAUDE.replace("❯", " ")));
  });
});
