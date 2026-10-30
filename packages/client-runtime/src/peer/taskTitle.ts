/** How long a navigation title may get; the task's page keeps the whole text. */
const MAX_WORDS = 6;

const OPENING_CLAUSE = /^in\s+[^,]+,\s*/i;
const CREATION_VERB =
  /^(?:create|add|implement|build|introduce|write|define)\s+(?:(?:a|an|the|new|one)\s+)*/i;
const SENTENCE_END = /[.:;](?:\s|$)/;
const DANGLING_WORD = /\s+(?:to|in|into|of|for|with|on|at|from|by|and|or|the|a|an)$/i;
const LOWERCASE_WORDS = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g;

/** A file, or a dotted member with its type: what names a place rather than the work. */
const isPath = (code: string) => code.includes("/") || /\.[cm]?[jt]sx?$|\.md$/.test(code);

/** `SurveyConflictError` → `survey conflict error`, `options.precondition?: …` → `precondition`. */
function wordsOfCode(code: string): string {
  const name =
    code
      .split(/[?:({<\s]/)[0]
      ?.split(".")
      .at(-1) ?? code;
  return (name.match(LOWERCASE_WORDS) ?? [name]).join(" ").toLowerCase();
}

/**
 * The short name a task goes by in navigation, worked out from its title alone: the first clause,
 * without what names files, without a creating verb ("Create the shared concurrency contract
 * `a/b.ts`" → "Shared concurrency contract"), and code as words. It renames nothing: the title,
 * as a tracker or an OpenSpec change wrote it, stays what the task's page shows.
 */
export function taskShortTitle(title: string): string {
  const sentence = title
    .replace(/\s+/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/`([^`]*)`/g, (_match, code: string) => (isPath(code) ? " " : wordsOfCode(code)))
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const clause = sentence.split(SENTENCE_END)[0] ?? sentence;
  const subject = clause
    .replace(OPENING_CLAUSE, "")
    .replace(CREATION_VERB, "")
    .replace(/,.*$/, "")
    .trim();
  const short = subject.split(" ").slice(0, MAX_WORDS).join(" ").replace(DANGLING_WORD, "");
  // A title that is only a path or a code name leaves nothing; it then stands as it was written.
  if (short === "") return title.trim();
  return `${short.charAt(0).toUpperCase()}${short.slice(1)}`;
}
