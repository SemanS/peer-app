import type { PeerPathPattern } from "@t3tools/contracts";

export function validatePattern(glob: string): string | null {
  if (
    !glob ||
    [...glob].length > 200 ||
    [...glob].some((c) => {
      const n = c.codePointAt(0)!;
      return n <= 31 || (n >= 127 && n <= 159) || "?[]{}!\\:".includes(c);
    }) ||
    glob.startsWith("/") ||
    glob.endsWith("/")
  )
    return "Use a relative pattern of at most 200 characters, with * within a segment or ** as a whole segment.";
  return glob
    .split("/")
    .some((s) => !s || s === "." || s === ".." || (s !== "**" && s.includes("**")))
    ? "A pattern has no empty, . or .. segment; ** is a whole segment."
    : null;
}
function segmentMatches(pattern: string, segment: string) {
  const chars = [...segment];
  let reach = Array<boolean>(chars.length + 1).fill(false);
  reach[0] = true;
  for (const wanted of pattern) {
    const next = Array<boolean>(reach.length).fill(false);
    if (wanted === "*") {
      let any = false;
      for (let j = 0; j < reach.length; j++) {
        any ||= reach[j]!;
        next[j] = any;
      }
    } else for (let j = 0; j < chars.length; j++) next[j + 1] = reach[j]! && chars[j] === wanted;
    reach = next;
  }
  return reach[chars.length]!;
}
/** Twin of Hub coord/rules.rs: a segment DP, never regular-expression backtracking. */
export function matches(glob: string, path: string) {
  const segments = path.replace(/\/$/, "").split("/");
  let reach = Array<boolean>(segments.length + 1).fill(false);
  reach[0] = true;
  for (const part of glob.split("/")) {
    const next = Array<boolean>(reach.length).fill(false);
    if (part === "**") {
      let any = false;
      for (let j = 0; j < reach.length; j++) {
        any ||= reach[j]!;
        next[j] = any;
      }
    } else
      for (let j = 0; j < segments.length; j++)
        next[j + 1] = reach[j]! && segmentMatches(part, segments[j]!);
    reach = next;
  }
  return reach[segments.length]!;
}
const specificity = (glob: string) =>
  [
    -[...glob].filter((c) => c !== "*").length,
    glob.split("/").filter((s) => s === "**").length,
    glob
      .split("/")
      .filter((s) => s !== "**")
      .join("")
      .split("*").length - 1,
  ] as const;
export function bestRule(rules: ReadonlyArray<PeerPathPattern>, path: string) {
  return rules
    .filter((r) => validatePattern(r.pattern) === null && matches(r.pattern, path))
    .sort((a, b) => {
      const aa = specificity(a.pattern),
        bb = specificity(b.pattern);
      for (let i = 0; i < aa.length; i++) {
        const delta = aa[i]! - bb[i]!;
        if (delta) return delta;
      }
      return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
    })[0];
}
