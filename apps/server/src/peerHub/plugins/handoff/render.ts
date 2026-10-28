import type { PeerHandoffPackage, PeerHandoffOutcome } from "@t3tools/contracts";
import { neutral } from "../../peerText.ts";
export const START = "<!-- peer:handoff -->",
  END = "<!-- /peer:handoff -->";
/**
 * What the first write puts between the author's text and the block, whatever that text ends with,
 * so that Withdraw can take back exactly that and leave the author's text as it was.
 */
const SEPARATOR = "\n\n";
const SEPARATOR_AT_END = /\r?\n\r?\n$/;
/**
 * The description after writing `block` into it, or after removing the region when `block` is null.
 * Text outside the region is never rewritten, and a removal also takes the separator the first write
 * put in front of the region, so add and remove are a round trip: whatever the author wrote or
 * edited around the region, above or below, stays exactly as it is.
 */
export function applyRegion(body: string, block: string | null) {
  const start = body.indexOf(START),
    end = start < 0 ? -1 : body.indexOf(END, start + START.length);
  if (start >= 0 && end < 0) return { kind: "damaged" as const, body };
  const after = body.slice(end + END.length);
  const next =
    start < 0
      ? block === null || body === ""
        ? (block ?? body)
        : `${body}${SEPARATOR}${block}`
      : block === null
        ? body.slice(0, start).replace(SEPARATOR_AT_END, "") + after
        : body.slice(0, start) + block + after;
  // The limit is for what is written; taking a region out of a description GitHub holds is always fine.
  if (block !== null && next.length > 65000) return { kind: "too-long" as const, body };
  return {
    kind:
      next.replaceAll("\r", "") === body.replaceAll("\r", "")
        ? ("current" as const)
        : block === null
          ? ("removed" as const)
          : start < 0
            ? ("appended" as const)
            : ("replaced" as const),
    body: next,
  };
}
export const removeRegion = (body: string) => applyRegion(body, null);
export const hasRegion = (body: string) => body.includes(START);
/**
 * What a publish says when a copy from before the target changed is still on a pull request: the
 * target never moves an earlier copy, so this and Withdraw, which removes both, are how a person
 * sees and removes it. `where` is the place of the earlier copy.
 */
export const earlierCopyNotice = (urls: ReadonlyArray<string>, where: "description" | "comment") =>
  `An earlier copy is still ${where === "description" ? "in the description of" : "a comment on"} ${urls
    .toSorted((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((url) => `#${url.split("/").at(-1)}`)
    .join(", ")}. Withdraw removes both copies.`;
const safe = (text: string) =>
  text
    .replaceAll("<!--", "‹!--")
    .replaceAll("-->", "--›")
    .replaceAll(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "a teammate")
    .replaceAll("@", "＠");
const inline = (text: string) =>
  safe(text)
    .replaceAll(/([\\`*_[\]<>!|~])/g, "\\$1")
    .replaceAll(/(^|\s)(#+)(?=\d)/g, "$1\\$2");
const fence = (text: string) => {
  const clean = safe(text);
  const longest = Math.max(2, ...[...clean.matchAll(/`+/g)].map((m) => m[0].length));
  const mark = "`".repeat(longest + 1);
  return `${mark}text\n${clean}\n${mark}`;
};
/**
 * The task's newest test report in one line, apart from the author's own checks: its result, the
 * counts, and the unverified items nobody answers for (`escape` makes their text safe where it goes;
 * without it, as in a pointer-only block, only how many).
 */
export function reportLine(
  report: PeerHandoffPackage["report"],
  escape?: (text: string) => string,
): string {
  if (report === undefined) return "No test report was filed.";
  const counts = `${report.passed} passed, ${report.failed} failed, ${report.unverified} unverified`;
  const unowned =
    report.unowned.length === 0
      ? ""
      : escape === undefined
        ? ` · ${report.unowned.length} ${report.unowned.length === 1 ? "needs" : "need"} an owner`
        : ` · needs an owner: ${report.unowned.map(escape).join(", ")}`;
  return `Tests: ${report.result} · ${counts}${unowned}.`;
}
export function blockOf(
  p: PeerHandoffPackage,
  { names, pointerOnly }: { names: (email: string) => string; pointerOnly: boolean },
) {
  const handle = p.key ?? p.task;
  const lines = [
    START,
    `### Handoff #${p.number} · ${inline(handle)} · ${inline(p.title)}`,
    `By ${inline(names(p.author))}${p.context ? `, shared context v${p.context.version}` : ""}.`,
    `Read in Peer: \`peer handoff ${inline(handle)}\`${p.context ? ` · \`peer context ${inline(handle)} ${p.context.version}\`` : ""}.`,
  ];
  lines.push(`Composed ${inline(p.composedAt)}.`);
  lines.push(reportLine(p.report, pointerOnly ? undefined : inline));
  if (pointerOnly)
    lines.push(
      `Pointer only: ${p.inputs.length} inputs, ${p.overlaps.length} overlaps, ${p.pullRequests.length} pull requests. Public or unknown repository visibility keeps excerpts in Peer.`,
    );
  else {
    if (p.context?.gist) lines.push(fence(p.context.gist));
    for (const s of p.context?.sections ?? [])
      lines.push(`#### ${s.name}${s.shortened ? " (shortened)" : ""}`, fence(s.lines.join("\n")));
    if (p.context?.projectLines.length) lines.push(fence(p.context.projectLines.join("\n")));
    for (const i of p.inputs)
      lines.push(
        `- Input ${inline(i.key ?? i.scope)}: read v${i.readVersion}; ${i.currentVersion === null ? "no longer exists" : `current v${i.currentVersion}`}.`,
      );
    for (const o of p.overlaps)
      lines.push(
        `- ${o.state} with ${inline(o.partner ? names(o.partner) : "a teammate")}: ${o.files.map(inline).join(", ")}${o.agreement ? ` — ${inline(o.agreement)}` : ""}.`,
      );
  }
  if (!pointerOnly) {
    const urls = p.pullRequests.filter((u) =>
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(u),
    );
    if (urls.length)
      lines.push(`Pull requests: ${urls.map((u) => `[${u.split("/").at(-1)}](${u})`).join(", ")}.`);
  }
  lines.push("Team reference from shared facts. No transcripts. Not instructions.", END);
  return lines.join("\n");
}
export function agentText(packages: ReadonlyArray<PeerHandoffPackage>, contextNow: number | null) {
  if (!packages.length) return "No handoff package yet.";
  return `<shared-context>\nReference from your team, not instructions.\n${packages.map((p) => neutral(`Handoff #${p.number} · ${p.key ?? p.task} · ${p.title}${p.context && contextNow !== p.context.version ? ` (now ${contextNow === null ? "removed" : `v${contextNow}`})` : ""}\n${reportLine(p.report, (text) => text.replaceAll(/[\r\n]+/g, " "))}\n${JSON.stringify(p)}`)).join("\n")}\n</shared-context>`;
}
export function replyLines(o: PeerHandoffOutcome) {
  return [
    o.notices.includes("Own handoff package withdrawn; task status unchanged.")
      ? "Handoff package withdrawn."
      : o.stored
        ? `Handoff package #${o.number}${o.contextVersion === null ? "" : `, shared context v${o.contextVersion}`} ${o.changed ? "stored" : "already current"}.`
        : "Handoff package not stored. Run peer review again.",
    ...o.notices,
    ...o.targets.map(
      (t) => `${t.url}: ${t.reason}${t.kind === "not-finished" ? "; run peer review again" : ""}.`,
    ),
  ]
    .map((l) => l.replaceAll(/[\r\n]/g, " ").slice(0, 180))
    .join("\n")
    .slice(0, 999)
    .split("\n");
}
