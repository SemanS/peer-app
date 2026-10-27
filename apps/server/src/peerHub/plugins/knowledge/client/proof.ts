/**
 * Asking a capture for its proof: an agent that records a learning or decision has usually just run
 * the test that proves it. The plugin keeps the last few test runs of a session that did not fail,
 * and after a `ctx_capture` (or `kontext capture`) of a learning or decision without `verify` it
 * names the latest once (`ctx_inbox` action verify adds it to the draft). Peer never writes `verify` itself: whether the command proves the entry is
 * the agent's to say.
 *
 * @module peerHub/plugins/knowledge/client/proof
 */
import { clip, plain } from "../../../peerText.ts";

/** How many test runs a session keeps. */
export const TEST_RUNS_KEPT = 5;

/** A shell command that ran a project's tests: a runner Peer knows, at the start of a step of it. */
const TEST_RUNNER =
  /^(?:cargo (?:test|nextest)|vp test|(?:pnpm|npm|bun|yarn)(?: run)? test|npx (?:vitest|jest)|vitest|jest|pytest|python3? -m (?:unittest|pytest)|go test|make (?:test|check)|mix test|rspec|dotnet test|(?:gradle|gradlew|mvn) test|bun run check)(?:\s|$)/;

/** Whether `command` runs tests: one of its steps (`&&`, `;`, `||`) starts with a known runner. */
export function isTestRun(command: string): boolean {
  return command.split(/&&|\|\||;|\n/).some((step) =>
    TEST_RUNNER.test(
      step
        .trim()
        // Environment set for the step, and a timer, come before the runner.
        .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*/, "")
        .replace(/^(?:time|timeout \d+[smh]?)\s+/, "")
        .replace(/^\.\//, ""),
    ),
  );
}

/** A test run a session made: the command as typed and when it finished. */
export interface TestRun {
  readonly command: string;
  readonly at: number;
}

/** The session's runs with `command` added as the newest, `TEST_RUNS_KEPT` at most. */
export const withTestRun = (
  runs: ReadonlyArray<TestRun>,
  command: string,
  at: number,
): ReadonlyArray<TestRun> =>
  [...runs.filter((run) => run.command !== command), { command, at }].slice(-TEST_RUNS_KEPT);

/** A capture of knowledge an agent made, as far as a finished tool call shows it. */
export interface Capture {
  readonly kind: string;
  /** It names its proof already. */
  readonly verify: boolean;
  /** It is a private note, not the team's knowledge. */
  readonly private: boolean;
  /** The draft's id in the inbox, or the entry's when it was written straight away; null if not shown. */
  readonly id: string | null;
  /** Written into the knowledge at once (`promote`), not an inbox draft. */
  readonly promoted: boolean;
}

const KONTEXT_CAPTURE = /^mcp__.+__ctx_capture$/;
const SAFE_ID = /^[\p{L}\p{N}_.:-]{1,160}$/u;

/** What kontext answered of where a capture went: `inbox:<id>`, or `(id <id>)` once written. */
function capturedId(output: string): { readonly id: string | null; readonly promoted: boolean } {
  const inbox = /\binbox:([^\s,.)]+(?:\.[^\s,.)]+)*)/.exec(output)?.[1];
  if (inbox !== undefined && SAFE_ID.test(inbox)) return { id: inbox, promoted: false };
  const written = /\(id ([^)\s]+)\)/.exec(output)?.[1];
  if (written !== undefined && SAFE_ID.test(written)) return { id: written, promoted: true };
  return { id: null, promoted: /^wrote /m.test(output) };
}

/** A flag's value in a shell command: `--name value`, `--name=value`, or `-n value`. */
const flag = (command: string, long: string, short?: string) => {
  const names = short === undefined ? `--${long}` : `(?:--${long}|-${short})`;
  return new RegExp(`(?:^|\\s)${names}(?:=|\\s+)("[^"]*"|'[^']*'|\\S+)`).exec(command)?.[1];
};
const has = (command: string, long: string) =>
  new RegExp(`(?:^|\\s)--${long}(?:=|\\s|$)`).test(command);
const unquoted = (value: string | undefined) => value?.replace(/^["']|["']$/g, "");

/**
 * The capture a finished tool call made: kontext's MCP tool (`mcp__<server>__ctx_capture`, with its
 * input) or its command line (`kontext capture …` in a shell step); null for any other call.
 */
export function captureOf(call: {
  readonly tool: string;
  readonly input?: Readonly<Record<string, unknown>> | undefined;
  readonly command?: string | undefined;
  readonly output?: string | undefined;
}): Capture | null {
  const output = call.output ?? "";
  if (KONTEXT_CAPTURE.test(call.tool)) {
    const input = call.input ?? {};
    if (typeof input.kind !== "string") return null;
    return {
      kind: input.kind,
      verify: typeof input.verify === "string" && input.verify.trim() !== "",
      private: input.visibility === "private",
      ...capturedId(output),
    };
  }
  const step = call.command
    ?.split(/&&|\|\||;|\n/)
    .map((part) => part.trim())
    .find((part) => /^(?:\S*\/)?kontext\s+capture(?:\s|$)/.test(part));
  if (step === undefined) return null;
  const kind = unquoted(flag(step, "kind", "k"));
  if (kind === undefined) return null;
  return {
    kind,
    verify: has(step, "verify"),
    private: has(step, "private"),
    ...capturedId(output),
  };
}

/** Whether a capture should be asked for its proof: a team learning or decision without one. */
export const wantsProof = (capture: Capture) =>
  !capture.verify &&
  !capture.private &&
  (capture.kind === "learning" || capture.kind === "decision");

const ago = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes === 0
    ? "less than a minute ago"
    : `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
};

/** The one line the agent reads after such a capture, naming the latest test run (≤ 1200 characters). */
export function proofNudge(capture: Capture, run: TestRun, now: number): string {
  const command = clip(plain(run.command, 500), 300).replaceAll("`", "'");
  const quoted = command.replaceAll('"', '\\"');
  const how = capture.promoted
    ? `add it to the entry${capture.id === null ? "" : ` ${capture.id}`} as verify: "${quoted}" in its frontmatter`
    : `ctx_inbox (action verify, id ${capture.id ?? "<the draft you just captured>"}, verify "${quoted}")`;
  return clip(
    `Peer: this entry has no check. You ran \`${command}\` ${ago(now - run.at)} and it passed. If it proves the entry, add it: ${how}. If it does not, ignore this.`,
    1200,
  );
}
