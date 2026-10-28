/**
 * `peer capture` and the `peer_capture` tool: an agent records a decision, convention or learning
 * as a candidate in the project's kontext inbox, the same unreviewed, this-clone-only candidate
 * that kontext's own `ctx_capture` records, for a person to promote and commit. It gives the
 * intake to sessions without the kontext MCP server (herdr terminals, Cursor, OpenCode, editors
 * connected with `peer connect`); one that has it keeps using `ctx_capture`.
 *
 * @module peerHub/plugins/knowledge/client/capture
 */
import { usage, type PeerAgentTool } from "../../../core/plugin.ts";
import { plain } from "../../../peerText.ts";

export const CAPTURE_USAGE =
  'capture --kind <decision|convention|learning> --title "<title>" --what "<what>" --why "<why>" [--consequences "<text>"] [--paths <path>]... [--verify "<command>"]';
export const KINDS = ["decision", "convention", "learning"] as const;
export type CaptureKind = (typeof KINDS)[number];
const isKind = (value: unknown): value is CaptureKind =>
  typeof value === "string" && (KINDS as ReadonlyArray<string>).includes(value);

/** What `peer capture` asks of kontext, once its arguments are read. */
export interface CaptureRequest {
  readonly kind: CaptureKind;
  readonly title: string;
  readonly what: string;
  readonly why: string;
  readonly consequences?: string;
  readonly paths: ReadonlyArray<string>;
  readonly verify?: string;
}

const LIMITS = { title: 160, what: 2000, why: 2000, consequences: 2000, verify: 500 } as const;
const MAX_PATHS = 20;
const invalid = (reason: string) => usage(reason, `use peer ${CAPTURE_USAGE}.`);

/** The request `peer capture <args>` makes, or the usage error it ends with. Parsing touches nothing. */
export function parseCapture(args: ReadonlyArray<string>): CaptureRequest {
  const valued = ["--kind", "--title", "--what", "--why", "--consequences", "--verify"] as const;
  const found = new Map<string, string>();
  const paths: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const flag = args[at] ?? "";
    const value = args[at + 1];
    if (flag === "--paths") {
      if (value === undefined || value.startsWith("--")) throw invalid("--paths needs a path");
      paths.push(value);
      at += 1;
    } else if ((valued as ReadonlyArray<string>).includes(flag)) {
      if (found.has(flag)) throw invalid(`${flag} is given once`);
      if (value === undefined || value.startsWith("--")) throw invalid(`${flag} needs a value`);
      found.set(flag, value);
      at += 1;
    } else {
      throw invalid(
        flag.startsWith("--")
          ? `${plain(flag, 40)} is not a flag of peer capture`
          : `"${plain(flag, 60)}" is not a flag or the value of one`,
      );
    }
  }
  const kind = found.get("--kind");
  if (!isKind(kind)) throw invalid("--kind is decision, convention or learning");
  const text = (flag: "--title" | "--what" | "--why", max: number) => {
    const value = plain(found.get(flag) ?? "", max + 1);
    if (value === "") throw invalid(`${flag} is required`);
    if (value.length > max) throw invalid(`${flag} has at most ${max} characters`);
    return value;
  };
  const optional = (flag: "--consequences" | "--verify", max: number) => {
    const value = found.get(flag);
    if (value === undefined) return undefined;
    const cleaned = plain(value, max + 1);
    if (cleaned.length > max) throw invalid(`${flag} has at most ${max} characters`);
    return cleaned === "" ? undefined : cleaned;
  };
  if (paths.length > MAX_PATHS) throw invalid(`at most ${MAX_PATHS} paths`);
  for (const path of paths)
    if (path.split("/").includes("..") || path.startsWith("/"))
      throw invalid(`${plain(path, 60)} is not a path inside the repository`);
  const consequences = optional("--consequences", LIMITS.consequences);
  const verify = optional("--verify", LIMITS.verify);
  return {
    kind,
    title: text("--title", LIMITS.title),
    what: text("--what", LIMITS.what),
    why: text("--why", LIMITS.why),
    ...(consequences === undefined ? {} : { consequences }),
    paths: paths.map((path) => path.replace(/^\.\//, "")),
    ...(verify === undefined ? {} : { verify }),
  };
}

/** The entry kontext's `drafts.capture` takes, as `ctx_capture` sends it. */
export function captureEntry(request: CaptureRequest, source: string) {
  const body = [
    `## What\n\n${request.what}`,
    `## Why\n\n${request.why}`,
    ...(request.consequences === undefined ? [] : [`## Consequences\n\n${request.consequences}`]),
  ].join("\n\n");
  return {
    entry: {
      kind: request.kind,
      title: request.title,
      body,
      paths: request.paths,
      ...(request.verify === undefined ? {} : { verify: request.verify }),
    },
    source,
  };
}

/** What the command answers once kontext took the candidate. */
export function captureAnswer(id: string, kind: CaptureKind, related: number): string {
  const also =
    related === 0
      ? ""
      : ` ${related} existing ${related === 1 ? "entry says" : "entries say"} something near it; a person compares them.`;
  return `Captured ${kind} ${id} in the project's knowledge inbox (this clone only). It is reviewed when a person promotes and commits it; until then it binds nobody.${also}`;
}

const text = (description: string, maxLength: number) => ({
  type: "string",
  description,
  maxLength,
});
const KNOWN_INPUTS = new Set(["kind", "title", "what", "why", "consequences", "paths", "verify"]);

/** `peer capture` for agents that call tools: the same grammar, answers and refusals. */
export const captureTool: PeerAgentTool = {
  name: "peer_capture",
  command: "capture",
  description:
    "Record a decision, convention or learning about this project as a candidate for its reviewed knowledge (kontext's inbox); a person promotes and commits it. Not for state (Peer has it) or your person's preferences (tell them).",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS], description: "decision, convention or learning" },
      title: text("one line", LIMITS.title),
      what: text("what holds", LIMITS.what),
      why: text("why it holds", LIMITS.why),
      consequences: text("what follows from it", LIMITS.consequences),
      paths: {
        type: "array",
        description: "repository paths it governs",
        maxItems: MAX_PATHS,
        items: { type: "string", maxLength: 520 },
      },
      verify: text("a command that proves it", LIMITS.verify),
    },
    required: ["kind", "title", "what", "why"],
    additionalProperties: false,
  },
  arguments: (input) => {
    const bad = (reason: string) => usage(reason, "check the peer_capture tool schema.");
    const unknown = Object.keys(input).find((key) => !KNOWN_INPUTS.has(key));
    if (unknown !== undefined) throw bad(`${plain(unknown, 40)} is not an input of peer_capture`);
    const args: string[] = [];
    for (const key of ["kind", "title", "what", "why", "consequences", "verify"] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (typeof value !== "string") throw bad(`${key} is text`);
      args.push(`--${key}`, value);
    }
    const paths = input.paths;
    if (paths !== undefined) {
      if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string"))
        throw bad("paths is a list of text");
      for (const path of paths) args.push("--paths", path);
    }
    return args;
  },
};
