const NO_BLOCKERS =
  /^(?:none(?: (?:reported|known|identified|remaining|currently|yet))?|no (?:known |reported |remaining )?blockers?(?: (?:reported|identified|remaining|currently|yet))?|not blocked|n\/a)(?: for (?:(?:this|the) )?[\p{L}\p{N}_-]+)?(?: at (?:this time|present))?[.!]?$/iu;
const OPEN_TASKS = /^(?:feature )?tasks intentionally (?:remain|stay|are) open[.!]?$/iu;

/** Only explicit absence reports are omitted; unknown prose stays visible as reported attention. */
export function contextBlockerText(line: string): string | undefined {
  const text = line
    .trim()
    .replace(/^[-*+•](?:\s+|$)/u, "")
    .trim();
  const statements = text.split(/(?<=[.!])\s+|\r?\n/u).filter((statement) => {
    const plain = statement.replace(/[*_`]/g, "").trim();
    return plain !== "" && !NO_BLOCKERS.test(plain) && !OPEN_TASKS.test(plain);
  });
  return statements.length === 0 ? undefined : statements.join(" ");
}
