// @effect-diagnostics nodeBuiltinImport:off - own marked companion in configured Codex homes.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { writePreservingLink } from "../../core/plugin.ts";
const MARKER = "<!-- peer-owned: recipes -->";
export function codexRecipeSkill(peerScript: string) {
  if (!NodePath.isAbsolute(peerScript) || /[\n\r\0]/.test(peerScript))
    throw new Error("An absolute Peer command path is required.");
  return `---\nname: peer-recipes\ndescription: List and follow Peer procedures for your own coordinated work.\n---\n${MARKER}\nRun ${JSON.stringify(peerScript)} recipe to list the available procedures.\nRun ${JSON.stringify(peerScript)} recipe <name> "<your words>" and follow the returned procedure.\n`;
}
export async function installCodexRecipeSkill(home: string, peerScript: string, install: boolean) {
  const file = NodePath.join(home, "skills", "peer-recipes", "SKILL.md");
  const old = await NodeFSP.readFile(file, "utf8").catch((failure: unknown) => {
    if (
      typeof failure === "object" &&
      failure !== null &&
      "code" in failure &&
      failure.code === "ENOENT"
    )
      return null;
    throw failure;
  });
  if (old !== null && !old.includes(MARKER)) return;
  if (!install) {
    if (old !== null) await NodeFSP.rm(file, { force: true });
    return;
  }
  const text = codexRecipeSkill(peerScript);
  if (old !== text) await writePreservingLink(file, text);
}
