import type { PeerImpactView, PeerImpactRootState, PeerImpactChange } from "@t3tools/contracts";
import type { PeerSessionView } from "../../core/plugin.ts";
import { parseProvides } from "./provides.ts";
import { severity } from "./footprint.ts";
import { itemNotice, providedNotice, keeperLine } from "./text.ts";
type Told = { items: Map<string, number>; reads: Map<string, number>; format: boolean };
const data = (s: PeerSessionView) =>
  s.local<Told>("impact", () => ({ items: new Map(), reads: new Map(), format: false }));
export const resetTold = (s: PeerSessionView) => {
  const d = data(s);
  d.items.clear();
  d.reads.clear();
  d.format = false;
};
export function tell(
  session: PeerSessionView,
  view: PeerImpactView,
  state: PeerImpactRootState["state"],
  _now: number,
  waking: boolean,
): string | null {
  if (waking || session.adapter === "mcp" || !["claude", "codex"].includes(session.agent))
    return null;
  const d = data(session),
    messages: string[] = [];
  const unseen = (key: string, kind: PeerImpactChange) => {
    const n = severity(kind),
      old = d.items.get(key) ?? -1;
    if (old >= n) return false;
    d.items.set(key, n);
    return true;
  };
  for (const record of view.records)
    if (
      record.project === session.project &&
      record.state === "open" &&
      record.live &&
      record.sides.some((s) => s.session === session.id)
    )
      for (const item of record.items)
        if (unseen(`${record.id}/${item.changer}/${item.path}\0${item.name}`, item.change))
          messages.push(itemNotice(record, item, session.id, session.keeps));
  for (const item of view.provided)
    if (
      item.project === session.project &&
      item.side.session === session.id &&
      unseen(`provided/${item.path}\0${item.name}`, item.change)
    )
      messages.push(
        providedNotice(
          item.side.task ?? item.side.label,
          item,
          parseProvides(session.sharedContext?.text ?? "").find(
            (p) => p.name === item.name && (p.path === undefined || p.path === item.path),
          )?.contract ?? "",
          true,
        ),
      );
  for (const read of session.contextReads ?? [])
    for (const entry of parseProvides(read.text)) {
      const matches = view.provided.filter(
          (p) =>
            p.project === session.project &&
            p.side.session !== session.id &&
            read.scope === `task:${p.side.task}` &&
            p.name === entry.name &&
            (entry.path === undefined || entry.path === p.path),
        ),
        key = `${read.scope}/${read.version}/${entry.path ?? ""}\0${entry.name}`;
      const previous = d.reads.get(key);
      if (previous === undefined) {
        d.reads.set(
          key,
          matches.length ? Math.max(...matches.map((p) => Date.parse(p.changedAt))) : 0,
        );
        continue;
      }
      for (const item of matches)
        if (
          Date.parse(item.changedAt) > previous &&
          unseen(`read/${key}/${item.side.session}`, item.change)
        )
          messages.push(
            providedNotice(item.side.task ?? item.side.label, item, entry.contract, false),
          );
    }
  const first = messages.slice(0, 3),
    out: string[] = [];
  for (const m of first) if (out.join("\n\n").length + m.length + 2 <= 1100) out.push(m);
  if (messages.length > out.length)
    out.push(`Further impact changes: peer impact (${messages.length - out.length} more).`);
  if (
    !d.format &&
    session.keeps &&
    (state === "ready" || state === "pending") &&
    out.join("\n\n").length + keeperLine.length <= 1200
  ) {
    d.format = true;
    out.push(keeperLine);
  }
  return out.length ? out.join("\n\n") : null;
}
