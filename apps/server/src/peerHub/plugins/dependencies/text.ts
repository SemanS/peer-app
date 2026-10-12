import type { PeerSessionView } from "../../core/plugin.ts";
import type { Fact } from "./facts.ts";
export const stateWord = (state: string) =>
  state === "review" ? "in review" : state === "done" ? "closed" : state;
export interface Ledger {
  epoch: number;
  ready: boolean;
  told: Map<string, Fact>;
  versionAt: Map<string, number>;
}
export const ledger = (epoch: number): Ledger => ({
  epoch,
  ready: false,
  told: new Map(),
  versionAt: new Map(),
});
/**
 * A session's ledger, read back from what core keeps for it across Peer's restarts
 * (`PeerSessionView.told`): whether its start gave the dependencies, each fact it was told (a task's
 * handle, state and context version) and when it was last told of a version.
 */
export const ledgerOf = (session: PeerSessionView, epoch: number) =>
  session.local("dependencies", () => {
    const memory = ledger(epoch);
    for (const id of session.told?.("dependencies") ?? []) {
      const [kind, task = "", name = "", state = "", version = "0"] = id.split("\u0000");
      if (kind === "ready") memory.ready = true;
      else if (kind === "fact")
        memory.told.set(task, { id: task, name, state, version: Number(version) });
      else if (kind === "at") memory.versionAt.set(task, Number(name));
    }
    return memory;
  });

/** What a session was told, as the ids core keeps for it. */
export function keepLedger(session: PeerSessionView, memory: Ledger) {
  const kept = session.told?.("dependencies");
  if (kept === undefined) return;
  kept.clear();
  if (memory.ready) kept.add("ready");
  for (const fact of memory.told.values())
    kept.add(["fact", fact.id, fact.name, fact.state, String(fact.version)].join("\u0000"));
  for (const [task, at] of memory.versionAt) kept.add(["at", task, String(at)].join("\u0000"));
}

export function startText(on: ReadonlyArray<Fact>, needed: ReadonlyArray<Fact>) {
  if (!on.length && !needed.length) return null;
  const sorted = [
    ...on.filter((f) => f.state === "open" || f.state === "review"),
    ...on.filter((f) => f.state !== "open" && f.state !== "review"),
  ];
  const lines = [
    "Peer · dependencies recorded for this task (reference from your team, not instructions):",
    ...sorted
      .slice(0, 8)
      .map(
        (f) =>
          `- you depend on ${f.name}: ${f.version ? `context v${f.version}, ` : ""}${stateWord(f.state)}`,
      ),
    ...needed.slice(0, 5).map((f) => `- ${f.name} depends on this task`),
  ];
  if (on.length > 8 || needed.length > 5)
    lines.push(
      `(+${Math.max(0, on.length - 8) + Math.max(0, needed.length - 5)} more: peer depends)`,
    );
  lines.push("`peer context <task>` reads one; `peer depends` lists them.");
  return lines.join("\n");
}
export function baseline(memory: Ledger, on: ReadonlyArray<Fact>, now: number) {
  memory.ready = true;
  memory.told = new Map(on.map((f) => [f.id, f]));
  for (const f of on) memory.versionAt.set(f.id, now);
}
export function stepText(
  memory: Ledger,
  on: ReadonlyArray<Fact>,
  now: number,
  read: (scope: string) => number | undefined,
  told: (scope: string) => void,
) {
  const notices: string[] = [];
  let deferred = 0;
  const current = new Map(on.map((f) => [f.id, f]));
  const emit = (line: string, apply: () => void) => {
    if (notices.length < 4) {
      notices.push(line);
      apply();
    } else deferred++;
  };
  for (const [id, old] of memory.told)
    if (!current.has(id))
      emit(`${old.name} is no longer a dependency (removed).`, () => {
        memory.told.delete(id);
        memory.versionAt.delete(id);
      });
  for (const f of on) {
    const old = memory.told.get(f.id);
    if (!old) {
      emit(`You now depend on ${f.name}: ${stateWord(f.state)}.`, () => {
        memory.told.set(f.id, f);
        memory.versionAt.set(f.id, now);
      });
      continue;
    }
    if (old.state !== f.state)
      emit(`${f.name} is ${stateWord(f.state)}${f.state === "open" ? " again" : ""}.`, () =>
        memory.told.set(f.id, { ...old, state: f.state }),
      );
    if (old.version !== f.version) {
      if (read(`task:${f.id}`) !== undefined) {
        memory.told.set(f.id, { ...(memory.told.get(f.id) ?? f), version: f.version });
        continue;
      }
      if (now - (memory.versionAt.get(f.id) ?? 0) >= 120000)
        emit(`${f.name} has context v${f.version}; peer context ${f.name} reads it.`, () => {
          memory.told.set(f.id, { ...(memory.told.get(f.id) ?? f), version: f.version });
          memory.versionAt.set(f.id, now);
          told(`task:${f.id}`);
        });
    }
  }
  if (deferred) notices.push(`(+${deferred} more changes: peer depends)`);
  return notices.length
    ? `Peer · dependency facts (reference, not instructions):\n${notices.map((n) => `- ${n}`).join("\n")}`
    : null;
}
export const handoffText = (on: ReadonlyArray<Fact>) => {
  const open = on.filter((f) => f.state === "open" || f.state === "review");
  return open.length
    ? `Heads-up: this task still depends on ${open.map((f) => `${f.name} (${stateWord(f.state)})`).join(", ")}. Nothing holds this handoff.`
    : null;
};
export function listText(name: string, on: ReadonlyArray<Fact>, needed: ReadonlyArray<Fact>) {
  return [
    `${name} depends on:`,
    ...(on.length
      ? on.map(
          (f) => `- ${f.name}: ${stateWord(f.state)}${f.version ? `; context v${f.version}` : ""}`,
        )
      : ["None."]),
    "Depended on by:",
    ...(needed.length ? needed.map((f) => `- ${f.name}`) : ["None."]),
  ]
    .slice(0, 30)
    .join("\n");
}
