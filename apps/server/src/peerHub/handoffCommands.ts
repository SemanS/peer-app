/**
 * What a shell tool runs of git, gh and jj, read from the words of its command line and never from
 * its output: `git push`, `jj git push` and `gh pr create` publish work (`publishesWork`), and
 * landing adds `git commit`, `jj commit`, `jj squash`, `jj new` and `gh pr merge`
 * (`core/broker/landing.ts`). Scripts and aliases remain outside it.
 */

/**
 * The words of each command of a shell line, split at `; & | ( )` and line breaks, quotes and escapes
 * honoured. A heredoc's body is data, not commands: it is skipped, so an apostrophe in it opens no quote
 * and a `git commit` written into a file is not run.
 */
function commandsIn(command: string): string[][] {
  const commands: string[][] = [[]];
  let word = "";
  let quote = "";
  let escaped = false;
  /** Heredocs opened on the current line: their bodies follow its line break. */
  const heredocs: Array<{ readonly delimiter: string; readonly tabs: boolean }> = [];
  const flush = () => {
    if (word !== "") commands[commands.length - 1]!.push(word);
    word = "";
  };
  let i = 0;
  while (i < command.length) {
    const char = command[i]!;
    i++;
    if (escaped) {
      word += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== "") {
      if (char === quote) quote = "";
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "<" && command.startsWith("<<", i)) {
      // A here-string: its word follows on the same line, read as any other.
      flush();
      i += 2;
      continue;
    }
    if (char === "<" && command[i] === "<") {
      flush();
      i++;
      const tabs = command[i] === "-";
      if (tabs) i++;
      while (command[i] === " " || command[i] === "\t") i++;
      let delimiter = "";
      while (i < command.length && !/[\s;&|()<>]/.test(command[i]!)) {
        if (command[i] !== "'" && command[i] !== '"' && command[i] !== "\\")
          delimiter += command[i];
        i++;
      }
      if (delimiter !== "") heredocs.push({ delimiter, tabs });
      continue;
    }
    if (/[;&|\n()]/.test(char)) {
      flush();
      commands.push([]);
      if (char === "\n") {
        for (const { delimiter, tabs } of heredocs.splice(0)) {
          while (i < command.length) {
            const next = command.indexOf("\n", i);
            const line = command.slice(i, next === -1 ? command.length : next);
            i = next === -1 ? command.length : next + 1;
            if ((tabs ? line.replace(/^\t+/, "") : line) === delimiter) break;
          }
        }
      }
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    word += char;
  }
  flush();
  return commands;
}

/**
 * The words of one command after its leading `VAR=value` words, `command` and `env` (and the options
 * each takes): the executable's basename and where its own arguments start. Null when the command
 * cannot be read as a literal one (`command -v`, `env -S`).
 */
function executableOf(
  words: ReadonlyArray<string>,
): { readonly executable: string | undefined; readonly from: number } | null {
  let i = 0;
  while (true) {
    while (/^[A-Za-z_]\w*=/.test(words[i] ?? "")) i++;
    if (words[i] === "command") {
      i++;
      while (words[i] === "--" || words[i] === "-p") i++;
      if (words[i] === "-v" || words[i] === "-V") return null;
      continue;
    }
    if (words[i]?.split("/").at(-1) === "env") {
      i++;
      while (words[i]?.startsWith("-")) {
        const option = words[i++];
        if (option === "--") break;
        if (["-u", "--unset", "-C", "--chdir"].includes(option!)) i++;
        // env -S evaluates another command string, outside this literal-command gate.
        else if (option === "-S" || option === "--split-string") return null;
      }
      continue;
    }
    break;
  }
  return { executable: words[i]?.split("/").at(-1), from: i + 1 };
}

/**
 * What each command of a shell line runs of git, gh and jj, as `git push`, `gh pr create` or `jj
 * git push`: after any leading `VAR=value` words, `command` and `env`, and the options each takes
 * before its subcommand. `echo "git push"` runs none.
 */
export function gitCommands(command: string): string[] {
  return commandsIn(command).flatMap((words) => {
    const start = executableOf(words);
    if (start === null) return [];
    const { executable } = start;
    let i = start.from;
    if (executable === "jj") {
      const run = parseJj(words, i).command;
      return run === "" ? [] : [run];
    }
    if (executable !== "git" && executable !== "gh") return [];
    const takesValue =
      executable === "git"
        ? new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"])
        : new Set(["-R", "--repo", "--hostname"]);
    while (words[i]?.startsWith("-")) i += takesValue.has(words[i]!) ? 2 : 1;
    return [
      executable === "git"
        ? `git ${words[i] ?? ""}`.trim()
        : `gh ${words[i] ?? ""} ${words[i + 1] ?? ""}`.trim(),
    ];
  });
}

/** jj's global options that take a value, by the long name they are kept under. */
const JJ_VALUE_OPTIONS: ReadonlyMap<string, string> = new Map([
  ["-R", "--repository"],
  ["--repository", "--repository"],
  ["--at-op", "--at-op"],
  ["--at-operation", "--at-op"],
  ["--config", "--config"],
  ["--config-toml", "--config"],
  ["--config-file", "--config-file"],
  ["--color", "--color"],
]);
/** Global flags that mean something to Peer wherever on the command line jj accepts them. */
const JJ_FLAGS: ReadonlySet<string> = new Set([
  "--ignore-immutable",
  "--ignore-working-copy",
  "--no-pager",
  "--quiet",
  "--debug",
]);

/** One global option of a jj command, under its long name; `value` is set for options that take one. */
export interface JjGlobalOption {
  readonly name: string;
  readonly value?: string;
}

/** One `jj` run of a shell command line, read from its words. */
export interface JjInvocation {
  /** `jj commit` or `jj git push`: the subcommand words, as landing names them. */
  readonly command: string;
  /** The subcommand words (`["git", "push"]`), past jj's global options. */
  readonly subcommand: ReadonlyArray<string>;
  /** Every global option of the run, in order, wherever it stands: jj takes them after the subcommand too. */
  readonly globals: ReadonlyArray<JjGlobalOption>;
  /** The words after the subcommand words, global options included, as written. */
  readonly args: ReadonlyArray<string>;
}

/**
 * A jj command line from the word after `jj`. Options before the subcommand are all global (`--opt=value`
 * is one word, `-Rpath` too); after it only the options jj shares with every subcommand count, because
 * the subcommand's own options are not jj's to name.
 */
function parseJj(words: ReadonlyArray<string>, from: number): JjInvocation {
  let i = from;
  const globals: JjGlobalOption[] = [];
  /** Reads a global option at `i` if there is one, and moves past it. */
  const take = (leading: boolean): boolean => {
    const word = words[i];
    if (word === undefined || !word.startsWith("-") || word === "-" || word === "--") return false;
    const equals = word.startsWith("--") ? word.indexOf("=") : -1;
    const flag = equals === -1 ? word : word.slice(0, equals);
    const valued = JJ_VALUE_OPTIONS.get(flag);
    if (valued !== undefined) {
      if (equals !== -1) globals.push({ name: valued, value: word.slice(equals + 1) });
      else {
        globals.push({ name: valued, value: words[i + 1] ?? "" });
        i++;
      }
      i++;
      return true;
    }
    if (word.startsWith("-R") && word.length > 2 && !word.startsWith("--")) {
      globals.push({ name: "--repository", value: word.slice(2) });
      i++;
      return true;
    }
    if (JJ_FLAGS.has(flag)) {
      globals.push({ name: flag });
      i++;
      return true;
    }
    if (!leading) return false;
    // Another leading option (`-h`, `--version`, a flag newer than this list): global, with no value.
    globals.push({ name: flag });
    i++;
    return true;
  };
  while (take(true));
  const subcommand: string[] = [];
  const first = words[i++];
  if (first !== undefined) {
    subcommand.push(first);
    if (first === "git") {
      while (take(true));
      if (words[i] !== undefined) subcommand.push(words[i++]!);
    }
  }
  const args = words.slice(i);
  for (; i < words.length;) if (!take(false)) i++;
  return {
    command: subcommand.length === 0 ? "" : `jj ${subcommand.join(" ")}`,
    subcommand,
    globals,
    args,
  };
}

/**
 * Each `jj` run of a shell command line, with its global options (`-R`, `--config`, `--at-op`,
 * `--ignore-immutable`, `--ignore-working-copy`, ...) and its subcommand words. Landing reads its
 * jj commands through this, so whatever else decides on a jj command line reads it the same way.
 * `echo "jj git push"` runs none.
 */
export function jjInvocations(command: string): JjInvocation[] {
  return commandsIn(command).flatMap((words) => {
    const start = executableOf(words);
    if (start === null || start.executable !== "jj") return [];
    return [parseJj(words, start.from)];
  });
}

/** Direct git/gh/jj publication commands exposed by a shell tool. Scripts remain outside this gate. */
export function publishesWork(command: string): boolean {
  return gitCommands(command).some(
    (run) => run === "git push" || run === "jj git push" || run === "gh pr create",
  );
}
