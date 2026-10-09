// @effect-diagnostics nodeBuiltinImport:off - isolated native and shadow homes.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import { codexRecipeSkill, installCodexRecipeSkill } from "./codexSkill.ts";
it("owns only its marked skill, preserves links and user content, and is idempotent", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-recipes-skill-"));
  try {
    const native = NodePath.join(root, "native"),
      shadow = NodePath.join(root, "shadow"),
      file = NodePath.join(native, "skills", "peer-recipes", "SKILL.md");
    await installCodexRecipeSkill(native, "/peer/bin/peer", true);
    const before = await NodeFSP.stat(file);
    expect(await NodeFSP.readFile(file, "utf8")).toBe(codexRecipeSkill("/peer/bin/peer"));
    await installCodexRecipeSkill(native, "/peer/bin/peer", true);
    expect((await NodeFSP.stat(file)).mtimeMs).toBe(before.mtimeMs);
    await NodeFSP.mkdir(shadow);
    await NodeFSP.symlink(NodePath.join(native, "skills"), NodePath.join(shadow, "skills"));
    await installCodexRecipeSkill(shadow, "/other/peer", true);
    expect(await NodeFSP.readFile(file, "utf8")).toContain('"/other/peer" recipe');
    await installCodexRecipeSkill(shadow, "/other/peer", false);
    expect(
      await NodeFSP.stat(file).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await NodeFSP.writeFile(file, "my own skill");
    await installCodexRecipeSkill(native, "/peer/bin/peer", true);
    await installCodexRecipeSkill(native, "/peer/bin/peer", false);
    expect(await NodeFSP.readFile(file, "utf8")).toBe("my own skill");
    const userFile = NodePath.join(root, "user-skill.md");
    await NodeFSP.writeFile(userFile, "user's linked skill");
    await NodeFSP.unlink(file);
    await NodeFSP.symlink(userFile, file);
    await installCodexRecipeSkill(native, "/peer/bin/peer", true);
    await installCodexRecipeSkill(native, "/peer/bin/peer", false);
    expect((await NodeFSP.lstat(file)).isSymbolicLink()).toBe(true);
    expect(await NodeFSP.readFile(userFile, "utf8")).toBe("user's linked skill");
    expect(codexRecipeSkill("/peer/bin/peer")).not.toContain("Input:");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
