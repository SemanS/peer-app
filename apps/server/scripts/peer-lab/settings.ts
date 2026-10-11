// @effect-diagnostics nodeBuiltinImport:off - host-side lab harness: writes the file an agent proposes.
/**
 * The lab's settings step (after arXiv:2609.37725, where a model manages its context as a file it
 * edits): an agent reads its project's Peer settings as a YAML file, edits its copy and proposes it
 * with a reason. Nothing changes until an owner saves the proposal, as themselves, with the
 * proposal named in the commit; the path rule it adds (a directory made exclusive) then decides edits.
 */
import * as NodeFS from "node:fs";

import { parse, stringify } from "yaml";

export type SettingsLine = {
  readonly path: ReadonlyArray<string>;
  readonly label: string;
  readonly from: string;
  readonly to: string;
};
export type SettingsProposal = {
  readonly id: string;
  readonly by: { readonly email: string };
  readonly via: { readonly agent: string } | null;
  readonly message: string;
  readonly lines: ReadonlyArray<SettingsLine>;
  readonly state: string;
  readonly revision: number | null;
  readonly canDecide: boolean;
};
/** A Hub route as the workspace's admin calls it; a refusal throws. */
export type AdminHub = (
  path: string,
  init?: { readonly method?: string; readonly body?: unknown },
) => Promise<Record<string, any>>;

interface Agent {
  readonly name: string;
  readonly peer: (...args: string[]) => string;
  readonly peerStatus: number;
  readonly start: () => unknown;
  readonly edit: (event: "PreToolUse" | "PostToolUse", path: string) => unknown;
  readonly hook: (event: string, extra?: Record<string, unknown>) => unknown;
}

const SETTINGS = "/v1/workspaces/acme/settings";

/** `peer config show`'s one file with `edit` applied to its YAML; its header lines stay as printed. */
export function editSettingsFile(
  shown: string,
  edit: (value: Record<string, unknown>) => Record<string, unknown>,
): string {
  const lines = shown.trimEnd().split("\n");
  const body = lines.findIndex((line) => !line.startsWith("#"));
  if (body <= 0 || lines.filter((line) => line.startsWith("# File: ")).length !== 1) {
    throw new Error(`expected one settings file with its header:\n${shown}`);
  }
  const value = parse(lines.slice(body).join("\n")) as Record<string, unknown>;
  return `${[...lines.slice(0, body), stringify(edit(value)).trimEnd()].join("\n")}\n`;
}

/** A project's settings with `pattern` exclusive; its policy kept, `coordinate` when it had none. */
export const exclusive =
  (pattern: string) =>
  (project: Record<string, unknown>): Record<string, unknown> => {
    const coordination = (project.coordination ?? {}) as {
      readonly policy?: string;
      readonly paths?: Record<string, string>;
    };
    return {
      ...project,
      coordination: {
        policy: coordination.policy ?? "coordinate",
        paths: { ...coordination.paths, [pattern]: "exclusive" },
      },
    };
  };

/** The change line that makes `pattern` exclusive. */
export const makesExclusive = (pattern: string) => (line: SettingsLine) =>
  line.path.at(-1) === pattern && line.path.at(-2) === "paths" && line.to.includes("exclusive");

/** A commit's message among `GET /settings/git`'s objects (base64 of the raw `commit <size>\0…`). */
export function commitMessage(
  objects: ReadonlyArray<{ readonly id: string; readonly data: string }>,
  id: string,
): string {
  const object = objects.find((candidate) => candidate.id === id);
  if (object === undefined) return "";
  const raw = Buffer.from(object.data, "base64").toString("utf8");
  const content = raw.slice(raw.indexOf("\0") + 1);
  const blank = content.indexOf("\n\n");
  return blank < 0 ? "" : content.slice(blank + 2);
}

/** The head revision's number. */
export const headOf = async (hub: AdminHub) =>
  Number((await hub(SETTINGS)).revision?.seq ?? Number.NaN);

/** Every proposal the admin sees, pending first. */
export const proposalsOf = async (hub: AdminHub) =>
  ((await hub(`${SETTINGS}/proposals`)).proposals ?? []) as ReadonlyArray<SettingsProposal>;

/**
 * The owner's half, with simulated or real agents alike: the admin saves `proposal`, which becomes
 * one revision by the admin with `Peer-Source: proposal` and the proposer in its commit; the path
 * rule then holds `pattern` for the first agent to edit there, and the revert undoes it.
 */
export async function saveProposal(input: {
  readonly hub: AdminHub;
  readonly pattern: string;
  readonly proposal: SettingsProposal;
  readonly before: number;
  readonly proposedBy: string;
  readonly holders: readonly [Agent, Agent];
  readonly check: (ok: boolean, what: string) => void;
  readonly told: (who: string, text: string) => void;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly sync: () => Promise<void>;
}) {
  const { hub, pattern, proposal, before, proposedBy, holders, check, told, pause, sync } = input;
  const directory = pattern.replace(/\/\*\*$/, "");
  check(proposal.canDecide, "the admin may decide the proposal");
  const saved = await hub(`${SETTINGS}/proposals/${proposal.id}/apply`, {
    method: "POST",
    body: { message: `Agreed: one agent at a time in ${directory}/` },
  });
  const seq = Number(saved.revision?.seq);
  check(seq === before + 1, `saving the proposal made revision ${before + 1}`);
  const revision = await hub(`${SETTINGS}/history/${seq}`);
  told(
    `revision ${seq}`,
    [
      `${revision.by?.email} · ${revision.source} · ${revision.message}`,
      ...(revision.files ?? []).map((file: { path: string; diff: string }) => file.diff),
    ].join("\n"),
  );
  check(
    revision.source === "proposal" && revision.by?.email === "ana@acme.test",
    "the revision is the admin's, saved from a proposal",
  );
  check(
    (revision.files ?? []).some(
      (file: { path: string; diff: string }) =>
        file.path === "projects/lab.yaml" && file.diff.includes(pattern),
    ),
    "the revision's diff changes projects/lab.yaml",
  );
  const git = await hub(`${SETTINGS}/git?after=${before}`);
  const message = commitMessage(git.objects ?? [], String(revision.commit));
  check(
    message.includes("Peer-Source: proposal") &&
      message.includes(`Peer-Proposed-By: ${proposedBy}`) &&
      message.includes(`Peer-Revision: ${seq}`),
    `the commit names its source and ${proposedBy}`,
  );
  const decided = (await proposalsOf(hub)).find((one) => one.id === proposal.id);
  check(
    decided?.state === "applied" && decided.revision === seq,
    "the proposal reads as saved, with its revision",
  );

  // The rule decides edits from the next one: the first agent in the directory holds the pattern.
  await sync();
  const [first, second] = holders;
  for (const holder of holders) holder.start();
  await pause(1500);
  const mine = first.edit("PreToolUse", `${directory}/0001_init.sql`);
  first.edit("PostToolUse", `${directory}/0001_init.sql`);
  await pause(1500);
  const theirs = second.edit("PreToolUse", `${directory}/0002_users.sql`) as {
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
  } | null;
  told(
    `${second.name} (${directory}/0002_users.sql)`,
    theirs?.hookSpecificOutput?.permissionDecisionReason ?? "(let through)",
  );
  check(
    (mine as { hookSpecificOutput?: { permissionDecision?: string } } | null)?.hookSpecificOutput
      ?.permissionDecision !== "deny",
    `the first agent in ${directory}/ may edit`,
  );
  check(
    theirs?.hookSpecificOutput?.permissionDecision === "deny" &&
      theirs.hookSpecificOutput.permissionDecisionReason?.includes(first.name) === true,
    `the saved path rule stops a second agent in ${directory}/ and names the holder`,
  );
  for (const holder of holders) holder.hook("SessionEnd", { reason: "exit" });

  const reverted = await hub(`${SETTINGS}/revert`, {
    method: "POST",
    body: { seq, message: `Back to the project's policy for ${directory}/` },
  });
  const back = await hub(`${SETTINGS}/history/${Number(reverted.revision?.seq)}`);
  check(
    back.source === "revert" &&
      (back.lines ?? []).some(
        (line: SettingsLine) => line.path.at(-1) === pattern && line.to === "none",
      ),
    "reverting the revision removes the path rule as a new revision",
  );
}

/**
 * Step 19 with simulated agents: Bob's agent reads its project's settings with `peer config show`,
 * makes `pattern` exclusive in its copy and proposes it; Bob is a member, so nothing is saved.
 */
export async function settingsLab(input: {
  readonly hub: AdminHub;
  readonly pattern: string;
  readonly proposer: Agent;
  readonly holders: readonly [Agent, Agent];
  readonly scratch: string;
  readonly check: (ok: boolean, what: string) => void;
  readonly told: (who: string, text: string) => void;
  readonly pause: (milliseconds: number) => Promise<void>;
  readonly sync: () => Promise<void>;
}) {
  const { hub, pattern, proposer, scratch, check, told } = input;
  const before = await headOf(hub);
  proposer.start();
  const shown = proposer.peer("config", "show");
  told(`${proposer.name} (peer config show)`, shown);
  check(
    proposer.peerStatus === 0 &&
      shown.includes("# File: projects/lab.yaml") &&
      shown.includes(`revision ${before}`),
    "peer config show prints the project's settings as a file with its header",
  );
  NodeFS.writeFileSync(scratch, editSettingsFile(shown, exclusive(pattern)));
  const proposed = proposer.peer(
    "config",
    "propose",
    "--file",
    scratch,
    "--why",
    "Schema changes must not run twice",
  );
  told(`${proposer.name} (peer config propose)`, proposed);
  check(
    proposer.peerStatus === 0 &&
      proposed.includes("Nothing is saved") &&
      proposed.includes(`${pattern} exclusive`),
    "peer config propose says what would change and that nothing is saved",
  );
  check((await headOf(hub)) === before, "a proposal saves nothing");
  const proposal = (await proposalsOf(hub)).find((one) => one.state === "pending");
  if (proposal === undefined) throw new Error("expected: the admin sees Bob's agent's proposal");
  check(
    proposal.by.email === "bob@acme.test" &&
      proposal.via?.agent === "claude" &&
      proposal.message === "Schema changes must not run twice" &&
      proposal.lines.some(makesExclusive(pattern)),
    "the admin sees Bob's agent's proposal with its reason and the path rule",
  );
  await saveProposal({ ...input, proposal, before, proposedBy: "Claude for bob@acme.test" });
}
