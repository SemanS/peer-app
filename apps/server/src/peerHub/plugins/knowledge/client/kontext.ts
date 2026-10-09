// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - runs kontext in a project's checkout and reads the entry it wrote.
/**
 * kontext's CLI as the knowledge plugin uses it: writing a kept candidate into a project's
 * knowledge, reading a task's shared context for what to keep, and proposing the guidance a project
 * gives its agents on what to mark for it.
 *
 * Everything goes through kontext's own capture and promote, so a kept
 * candidate lands staged in the repository and is reviewed with the commit
 * like any other knowledge. Wording an entry uses kontext's distill and its
 * llm adapter, on the computer of the person who asked for it.
 *
 * @module peerHub/plugins/knowledge/client/kontext
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Context from "effect/Context";

import { modelEnv } from "../../../core/local.ts";
import { entryParts } from "../../../knowledgeEntry.ts";
import { projectGuidance } from "./store.ts";

export interface KontextRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `kontext <args>` in `cwd`, with `stdin` when given. Never throws: a missing kontext is code -1. */
export function runKontext(
  args: ReadonlyArray<string>,
  cwd: string,
  stdin?: string,
  timeoutMs = 600_000,
): Promise<KontextRun> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn("kontext", [...args], {
      cwd,
      env: modelEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? "");
  });
}

/** kontext as the plugin runs it; each call resolves as `runKontext` does, never rejecting. */
export interface KontextClientShape {
  readonly run: (
    args: ReadonlyArray<string>,
    cwd: string,
    stdin?: string,
    timeoutMs?: number,
  ) => Promise<KontextRun>;
}

/** kontext on this computer's PATH. Tests put a stand-in in its place, so none runs the real one. */
export class KontextClient extends Context.Reference<KontextClientShape>(
  "t3/peerHub/plugins/knowledge/client/KontextClient",
  { defaultValue: () => ({ run: runKontext }) },
) {}

/** kontext's `captured inbox:<id>`. */
export function capturedId(stdout: string): string | null {
  return /captured inbox:(\S+)/.exec(stdout)?.[1] ?? null;
}

/** The inbox ids `kontext distill` captured, from its `→ inbox:<id>` lines. */
export function distilledIds(stdout: string): string[] {
  return [...stdout.matchAll(/→ inbox:(\S+)/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/**
 * Why `kontext distill` captured nothing: its model failed on the thread (its
 * `part <n>: <error>` note), or found nothing it does not have already.
 */
export function distillMiss(run: KontextRun): string {
  const failed =
    run.code === 0
      ? /· part \d+: (.+)$/m.exec(run.stdout)?.[1]
      : `${run.stderr}\n${run.stdout}`.trim().split("\n").at(-1) || `exit ${run.code}`;
  return failed === undefined
    ? "kontext's model found nothing new in it (it may be recorded already)"
    : `kontext's model did not run (${failed.trim()})`;
}

/** Where `kontext promote` wrote an entry: `<id> → <path> (staged)`. */
export function promotedPath(stdout: string): string | null {
  return /→ (\S+\.md)(?: \(staged\))?/.exec(stdout)?.[1] ?? null;
}

export interface DistilledEntry {
  readonly kind: string;
  readonly title: string;
  readonly paths: ReadonlyArray<string>;
  readonly body: string;
}

const ENTRY_HEADER = /^\[(decision|convention|learning|incident)\] (.+?)(?: {2}\((.+)\))?$/;

/** The entries `kontext distill --dry-run` printed: `[kind] title  (paths)`, then the body. */
export function dryRunEntries(stdout: string): DistilledEntry[] {
  const entries: Array<{ kind: string; title: string; paths: string[]; body: string[] }> = [];
  for (const line of stdout.split("\n")) {
    const header = ENTRY_HEADER.exec(line);
    if (header !== null) {
      entries.push({
        kind: header[1] ?? "learning",
        title: (header[2] ?? "").trim(),
        paths: (header[3] ?? "")
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path !== ""),
        body: [],
      });
      continue;
    }
    const current = entries.at(-1);
    if (current === undefined) continue;
    if (/^\d+ entr(y|ies) found/.test(line) || line.startsWith("## ")) {
      entries.push({ kind: "", title: "", paths: [], body: [] });
      continue;
    }
    current.body.push(line);
  }
  return entries
    .filter((entry) => entry.kind !== "" && entry.title !== "")
    .map((entry) => ({ ...entry, body: entry.body.join("\n").trim() }));
}

/** A title for knowledge from a line an agent wrote: its first sentence, short. */
export function titleOf(text: string): string {
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text.trim())?.[1] ?? text.trim();
  const plain = sentence.replace(/[.!?]$/, "");
  return plain.length > 90 ? `${plain.slice(0, 89).trimEnd()}…` : plain;
}

export interface CandidateForKnowledge {
  readonly text: string;
  readonly finders: number;
  readonly sources: ReadonlyArray<{
    readonly text: string;
    readonly task?: string | undefined;
    readonly tagged: boolean;
  }>;
}

/**
 * What kontext distill reads to word a kept candidate as one entry: what the
 * agents wrote, where, and the shared context of the work it came from.
 */
export function keepThread(input: {
  readonly project: string;
  readonly candidate: CandidateForKnowledge;
  readonly where: (task: string | undefined) => string;
  readonly context: { readonly subject: string; readonly text: string } | undefined;
}): string {
  const { candidate } = input;
  const parts = [
    `People on the project ${input.project} reviewed what their coding agents found while working, and decided to keep this as the project's knowledge:`,
    candidate.text,
    [
      `What the agents wrote${candidate.finders > 1 ? ` (${candidate.finders} found it on their own, on different work)` : ""}:`,
      ...candidate.sources.map((source) => `- ${source.text} (${input.where(source.task)})`),
    ].join("\n"),
  ];
  if (input.context !== undefined && input.context.text.trim() !== "") {
    parts.push(
      `The shared context of ${input.context.subject}, where it was found (for reference):\n\n${input.context.text.trim().slice(0, 6000)}`,
    );
  }
  parts.push(
    "Record it as one entry for the team: the point, why it holds, what follows from it, and the files it concerns.",
  );
  return parts.join("\n\n");
}

/** What kontext distill reads to find what a task's shared context holds for the project. */
export function harvestThread(input: {
  readonly project: string;
  readonly subject: string;
  readonly text: string;
}): string {
  return [
    `This is the shared context an agent kept for ${input.subject} in the project ${input.project}: where the work stands, findings, decisions, what failed. Its agents wrote it while working.`,
    input.text.trim().slice(0, 20_000),
    "Name only what the project should keep beyond this work.",
  ].join("\n\n");
}

/**
 * What kontext distill reads to propose the project's guidance for its agents
 * on what to mark `[project]`: the lines people kept and dismissed, and what
 * they kept that no agent had marked.
 */
export function guidanceThread(input: {
  readonly project: string;
  readonly current: string | null;
  readonly kept: ReadonlyArray<string>;
  readonly dismissed: ReadonlyArray<string>;
  readonly missed: ReadonlyArray<string>;
}): string {
  const list = (title: string, lines: ReadonlyArray<string>) =>
    lines.length === 0 ? [] : [`${title}\n${lines.map((line) => `- ${line}`).join("\n")}`];
  return [
    `The coding agents on the project ${input.project} mark a line [project] when they think it holds beyond their task and the project should keep it. People reviewed those marks.`,
    ...list("Kept (marks the team wanted):", input.kept),
    ...list("Dismissed (marks the team did not want):", input.dismissed),
    ...list(
      "Kept although no agent marked it (several agents found it on their own):",
      input.missed,
    ),
    ...(input.current === null ? [] : [`The guidance the agents had:\n${input.current}`]),
    "Write this project's convention for its agents: when to mark a line [project] and when not to, in a few sentences, with this project's own examples.",
  ].join("\n\n");
}

const KNOWLEDGE_KINDS = new Set(["decision", "convention", "learning", "incident"]);

/** The title of the entry `kontext search --json` found first in the knowledge itself, if any. */
export function relatedTitle(searchJson: string): string | null {
  try {
    const parsed = JSON.parse(searchJson) as {
      readonly hits?: ReadonlyArray<{ readonly kind?: unknown; readonly title?: unknown }>;
    };
    const hit = (parsed.hits ?? []).find(
      (candidate) => typeof candidate.kind === "string" && KNOWLEDGE_KINDS.has(candidate.kind),
    );
    return typeof hit?.title === "string" ? hit.title : null;
  } catch {
    return null;
  }
}

/** An entry's body when no model words it: what was found, and how the team came by it. */
export function directBody(
  candidate: CandidateForKnowledge,
  where: (task: string | undefined) => string,
): string {
  const places = [...new Set(candidate.sources.map((source) => where(source.task)))];
  return [
    candidate.text,
    `${candidate.finders > 1 ? `${candidate.finders} coding agents found it on their own` : "A coding agent marked it for the project"}, working on ${places.join(", ")}; the team kept it in Peer.`,
  ].join("\n\n");
}

// ---- kontext's commands in a project's checkout ----

/** What kontext said last: why it did not do what it was asked. */
const lastLine = (run: KontextRun) =>
  `${run.stderr}\n${run.stdout}`.trim().split("\n").at(-1) ?? `exit ${run.code}`;

/** `kontext capture` of one entry into the inbox. */
const captureArgs = (entry: {
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly tags?: string;
  readonly supersedes?: string;
}) => [
  "capture",
  "--kind",
  entry.kind,
  ...(entry.tags === undefined ? [] : ["--tags", entry.tags]),
  "--title",
  entry.title,
  "--body",
  entry.body,
  ...(entry.supersedes === undefined ? [] : ["--supersedes", entry.supersedes]),
];

/** A candidate to keep: what agents wrote, and what people already said of it. */
export interface CandidateToKeep extends CandidateForKnowledge {
  /** decision, convention, learning or incident, when someone already said. */
  readonly kind?: string | undefined;
  /** The entry's body, when it came already written. */
  readonly detail?: string | undefined;
}

/**
 * kontext's commands in a project's checkout, as the knowledge plugin runs them. Each rejects, with
 * a line people read, when kontext does not do what it was asked.
 */
export const kontextIn = (client: KontextClientShape, checkout: string) => {
  const kontext = (args: ReadonlyArray<string>, stdin?: string) =>
    client.run(args, checkout, stdin);

  /** Writes an inbox entry into the store, staged: where it is now. */
  const promote = async (id: string): Promise<string> => {
    const run = await kontext(["promote", id]);
    const path = promotedPath(run.stdout);
    if (path === null) throw new Error(`kontext could not write it: ${lastLine(run)}`);
    return path;
  };

  return {
    /** `kontext init`: the checkout keeps knowledge from now on. */
    init: async (): Promise<void> => {
      const run = await kontext(["init"]);
      if (run.code !== 0) throw new Error(`kontext init failed: ${lastLine(run)}`);
    },

    /**
     * Writes a candidate into the knowledge, staged: as it came when already worded, else as
     * kontext's model words it with the shared context of its work (`word`), else as the agents
     * wrote it. Also the title of an entry already there that may say the same, and why kontext's
     * model did not word it.
     */
    keep: async (input: {
      readonly project: string;
      readonly candidate: CandidateToKeep;
      readonly where: (task: string | undefined) => string;
      readonly word:
        | { readonly context: { readonly subject: string; readonly text: string } | undefined }
        | undefined;
    }): Promise<{
      readonly keptAs: { readonly path: string; readonly title: string; readonly kind: string };
      readonly related: string | null;
      readonly asWritten: string | null;
    }> => {
      const { candidate, where } = input;
      // An entry already in the knowledge may say the same: the person checks before committing.
      const related = relatedTitle(
        (await kontext(["search", "--json", "-n", "3", "-s", "local", candidate.text])).stdout,
      );
      const kind = candidate.kind ?? "learning";
      let id: string | null = null;
      // Why kontext's model did not word it, when it is kept as the agents wrote it.
      let asWritten: string | null = null;
      if (candidate.detail !== undefined) {
        // Already worded, e.g. read from a task's context: written as it is.
        const run = await kontext(
          captureArgs({ kind, title: candidate.text, body: candidate.detail }),
        );
        id = capturedId(run.stdout);
      } else if (input.word !== undefined) {
        // kontext words it, with the shared context of the work it came from.
        const run = await kontext(
          ["distill", "--max", "1", "-"],
          keepThread({ project: input.project, candidate, where, context: input.word.context }),
        );
        id = distilledIds(run.stdout)[0] ?? null;
        if (id === null) asWritten = distillMiss(run);
      }
      if (id === null) {
        const run = await kontext(
          captureArgs({ kind, title: titleOf(candidate.text), body: directBody(candidate, where) }),
        );
        id = capturedId(run.stdout);
        if (id === null) throw new Error(`kontext did not take it: ${lastLine(run)}`);
      }
      const path = await promote(id);
      const entry = entryParts(
        await NodeFSP.readFile(NodePath.join(checkout, path), "utf8").catch(() => ""),
      );
      return {
        keptAs: {
          path,
          title: entry.fields.title ?? titleOf(candidate.text),
          kind: entry.fields.kind ?? kind,
        },
        related,
        asWritten,
      };
    },

    /** What kontext's model finds a shared context holds for the project, three at most. */
    harvest: async (input: {
      readonly project: string;
      readonly subject: string;
      readonly text: string;
    }): Promise<ReadonlyArray<DistilledEntry>> => {
      const run = await kontext(["distill", "--dry-run", "--max", "3", "-"], harvestThread(input));
      if (run.code !== 0) throw new Error(`kontext could not read it: ${lastLine(run)}`);
      return dryRunEntries(run.stdout);
    },

    /**
     * The project's guidance for its agents as kontext's model proposes it from what people kept
     * and dismissed, staged in place of the current one.
     */
    guidance: async (labels: {
      readonly project: string;
      readonly kept: ReadonlyArray<string>;
      readonly dismissed: ReadonlyArray<string>;
      readonly missed: ReadonlyArray<string>;
    }): Promise<{ readonly path: string; readonly title: string }> => {
      const current = await projectGuidance(checkout);
      const run = await kontext(
        ["distill", "--dry-run", "--max", "1", "-"],
        guidanceThread({ ...labels, current: current?.text ?? null }),
      );
      const [entry] = dryRunEntries(run.stdout);
      if (entry === undefined) throw new Error(`kontext proposed nothing: ${lastLine(run)}`);
      const capture = await kontext(
        captureArgs({
          kind: "convention",
          tags: "peer-skill",
          title: entry.title,
          body: entry.body,
          ...(current === null ? {} : { supersedes: current.id }),
        }),
      );
      const id = capturedId(capture.stdout);
      if (id === null) throw new Error(`kontext did not take it: ${lastLine(capture)}`);
      return { path: await promote(id), title: entry.title };
    },
  };
};
