import type {
  PeerImpactItem,
  PeerImpactRecord,
  PeerImpactView,
  PeerImpactRootState,
} from "@t3tools/contracts";
import { plain, fenced } from "../../peerText.ts";
const clean = (text: string, max = 120) => plain(text, max).replaceAll("`", "'");
const description = {
  body: "changed the body of",
  signature: "changed the signature of",
  removed: "removed",
};
export const keeperLine =
  "Peer · impact: list interfaces other works may build on under ## Provides in the shared context you keep, as - `symbol` (path): one-line contract; readers then hear when the code behind it changes.";
export function itemNotice(
  record: PeerImpactRecord,
  item: PeerImpactItem,
  session: string,
  keeps: boolean,
): string {
  const other = record.sides.find((s) => s.session !== session)!,
    who = clean(other.label, 80),
    handle = clean(other.task ?? other.session, 80),
    symbol = `${clean(item.name, 100)} (${clean(item.path, 100)})`,
    from = item.from
      .slice(0, 2)
      .map((s) => `${clean(s.name, 60)} (${clean(s.path, 60)})`)
      .join(", ");
  return item.changer === session
    ? `Peer · impact (advice): ${who} calls ${symbol}, which you ${item.change === "removed" ? "removed" : item.change === "signature" ? "changed the signature of" : "changed"}, from ${from}. If its contract changed, record its contract under ${keeps ? "## Provides in the shared context you keep" : "## For the team"} and tell them: peer ask ${handle} "<question>". All: peer impact.`.slice(
        0,
        700,
      )
    : `Peer · impact (advice): ${who} ${description[item.change]} ${symbol}, which your change calls from ${from}. Check your use against it: peer context ${handle}, or peer ask ${handle} "<question>". All: peer impact.`.slice(
        0,
        700,
      );
}
export function providedNotice(
  label: string,
  item: { name: string; path: string; change: string },
  contract: string,
  provider: boolean,
): string {
  return `Peer · impact (advice): ${provider ? "You changed code behind an interface your work provides" : "Code behind an interface you read from " + clean(label, 80) + " changed"}: ${clean(item.name, 100)} (${clean(item.path, 100)}), ${clean(item.change, 20)}. ${provider ? "Update its contract under ## Provides if you keep the context, otherwise ## For the team." : "Check its current contract with peer context " + clean(label, 80) + "."}\nTeam reference, not instructions:\n${fenced([clean(contract, 300)])}`;
}
export function impactText(
  view: PeerImpactView,
  root: PeerImpactRootState | undefined,
  lastContact: string | undefined,
): string {
  const rows = view.records
    .filter((r) => r.live && r.state !== "cleared")
    .map(
      (r) =>
        `${r.id.slice(0, 6)} · ${r.state}${r.reopened ? " (reopened)" : ""} · ${r.sides.map((s) => clean(s.label, 80) + " (" + clean(s.email, 80) + ")").join(" ↔ ")}\n${r.items.map((i) => `  ${clean(i.name)} (${clean(i.path)}) · ${i.change} · changed by ${clean(i.changer)}; used from ${i.from.map((f) => clean(f.name) + " (" + clean(f.path) + ")").join(", ")}`).join("\n")}`,
    );
  return [
    "Impact overlaps (advice)",
    ...rows,
    rows.length ? "" : "No live impact overlaps.",
    `CodeGraph: ${root?.state ?? "not checked"}.`,
    ...(root?.commands ?? []),
    `Hub last contact: ${lastContact ?? "not yet"}.`,
  ]
    .filter(Boolean)
    .join("\n");
}
