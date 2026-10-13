/**
 * What a shell tool runs of git and gh, read from the words of its command line and never from its
 * output: `git push` and `gh pr create` publish work (`publishesWork`), and landing adds `git
 * commit` and `gh pr merge` (`core/broker/landing.ts`). Scripts and aliases remain outside it.
 */

/** The words of each command of a shell line, split at `; & | ( )` and line breaks, quotes and escapes honoured. */
function commandsIn(command: string): string[][] {
  const commands: string[][] = [[]];
  let word = "";
  let quote = "";
  let escaped = false;
  const flush = () => {
    if (word !== "") commands[commands.length - 1]!.push(word);
    word = "";
  };
  for (const char of command) {
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
    if (/[;&|\n()]/.test(char)) {
      flush();
      commands.push([]);
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
 * What each command of a shell line runs of git and gh, as `git push` or `gh pr create`: after any
 * leading `VAR=value` words, `command` and `env`, and the options git and gh take before their
 * subcommand. `echo "git push"` runs neither.
 */
export function gitCommands(command: string): string[] {
  return commandsIn(command).flatMap((words) => {
    let i = 0;
    while (/^[A-Za-z_]\w*=/.test(words[i] ?? "")) i++;
    while (true) {
      while (/^[A-Za-z_]\w*=/.test(words[i] ?? "")) i++;
      if (words[i] === "command") {
        i++;
        while (words[i] === "--" || words[i] === "-p") i++;
        if (words[i] === "-v" || words[i] === "-V") return [];
        continue;
      }
      if (words[i]?.split("/").at(-1) === "env") {
        i++;
        while (words[i]?.startsWith("-")) {
          const option = words[i++];
          if (option === "--") break;
          if (["-u", "--unset", "-C", "--chdir"].includes(option!)) i++;
          // env -S evaluates another command string, outside this literal-command gate.
          else if (option === "-S" || option === "--split-string") return [];
        }
        continue;
      }
      break;
    }
    const executable = words[i++]?.split("/").at(-1);
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

/** Direct git/gh publication commands exposed by a shell tool. Scripts remain outside this gate. */
export function publishesWork(command: string): boolean {
  return gitCommands(command).some((run) => run === "git push" || run === "gh pr create");
}
