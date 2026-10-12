import { usage, type PeerAgentTool } from "../../../core/plugin.ts";
import { plain } from "../../../peerText.ts";
import { MAX_CHANGES, MAX_PROVIDES, MAX_USES } from "./rules.ts";

/** The flag each list of the tool's input goes to on the command line. */
const FLAGS = {
  changes: "--change",
  maybes: "--maybe",
  uses: "--uses",
  provides: "--provides",
} as const;

const list = (description: string, maxItems: number, maxLength: number) => ({
  type: "array",
  description,
  maxItems,
  items: { type: "string", maxLength },
});

/**
 * `peer plan` for agents that call tools (MCP-only threads, the Mod's tool path): the same grammar,
 * and the answers and refusals of the command. The input names nothing the command does not take.
 */
export const planTool: PeerAgentTool = {
  name: "peer_plan",
  command: "plan",
  description:
    "Before you edit, say what you will change, use and provide; Peer answers with whose work meets yours. With no input it shows your plan.",
  inputSchema: {
    type: "object",
    properties: {
      changes: list("path, dir/ or path#symbol you will change", MAX_CHANGES, 520),
      maybes: list("what you may change", MAX_CHANGES, 520),
      uses: list("path#symbol you use that others change", MAX_USES, 520),
      provides: list('"symbol (path): contract" for what you provide', MAX_PROVIDES, 800),
      amend: { type: "boolean", description: "add to your plan instead of replacing it" },
      withdraw: { type: "boolean", description: "end your plan; give no items" },
    },
    additionalProperties: false,
  },
  arguments: (input) => {
    const invalid = (reason: string) => usage(reason, "check the peer_plan tool schema.");
    const unknown = Object.keys(input).find(
      (key) => !Object.hasOwn(FLAGS, key) && key !== "amend" && key !== "withdraw",
    );
    if (unknown !== undefined) throw invalid(`${plain(unknown, 40)} is not an input of peer_plan`);
    for (const key of ["amend", "withdraw"])
      if (input[key] !== undefined && typeof input[key] !== "boolean")
        throw invalid(`${key} is true or false`);
    const items = (Object.keys(FLAGS) as Array<keyof typeof FLAGS>).flatMap((key) => {
      const given = input[key];
      if (given === undefined) return [];
      if (!Array.isArray(given) || !given.every((item) => typeof item === "string"))
        throw invalid(`${key} is a list of text`);
      if (given.some((item) => item.trimStart().startsWith("--")))
        throw invalid(`an item of ${key} starts with a flag; write the item itself`);
      return given.flatMap((item) => [FLAGS[key], item]);
    });
    return [
      ...(input.amend === true ? ["--amend"] : []),
      ...items,
      ...(input.withdraw === true ? ["--withdraw"] : []),
    ];
  },
};
