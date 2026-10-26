import type {
  PeerSettingsProposal,
  PeerSettingsProposeInput,
  PeerSettingsProposeResult,
  PeerWorkspaceRole,
} from "@t3tools/contracts";

/** What a member's request to be added to a project says, as the admins read it. */
export const ASK_TO_BE_ADDED = "Please add me to a project";

/** An admin of the workspace, as the person may be told to ask them. */
export interface WorkspaceAdmin {
  readonly email: string;
  readonly name: string;
}

/**
 * The people who may add someone to a project: the workspace's owners and admins, in the order
 * the Hub lists its people. A person with no name is called by the part of their address before `@`.
 */
export function adminsOf(
  people: ReadonlyArray<{
    readonly email: string;
    readonly name: string;
    readonly role: PeerWorkspaceRole;
  }>,
): ReadonlyArray<WorkspaceAdmin> {
  return people
    .filter((person) => person.role !== "member")
    .map((person) => ({
      email: person.email,
      name: person.name.trim() === "" ? (person.email.split("@")[0] ?? person.email) : person.name,
    }));
}

/** `Slavo`, `Slavo and Eva`, `Slavo, Eva and Ana`. */
export function listNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What Work says to a member of a workspace who is on none of its projects. */
export function memberWords(input: {
  readonly workspaceName: string;
  readonly admins: ReadonlyArray<WorkspaceAdmin>;
}) {
  const { workspaceName, admins } = input;
  const adding = "Project leads and admins add people in a project’s settings.";
  return {
    title: `You’re in ${workspaceName}, but not on a project yet`,
    text:
      admins.length === 0
        ? adding
        : `${adding} Admins in ${workspaceName}: ${listNames(admins.map((admin) => admin.name))}.`,
    ask: admins.length === 0 ? "Ask an admin to add you" : `Ask ${admins[0]!.name} to add you`,
  };
}

/** What Work says to an admin of a workspace that has no project. */
export function adminWords(input: { readonly workspaceName: string; readonly several: boolean }) {
  return {
    title: input.several ? `Set up ${input.workspaceName}` : "Set up your workspace",
    text: "Four steps get it ready for your team. Each opens the page that does it.",
  };
}

/**
 * The request: a proposal without changes, which the Hub addresses to the workspace's admins. It
 * names the revision the person last read, as every proposal does.
 */
export function askInput(workspace: string, base: number): PeerSettingsProposeInput {
  return { workspace, base, set: [], message: ASK_TO_BE_ADDED, scope: "workspace" };
}

/** Whether the person already has a request to be added waiting: one without changes, theirs. */
export function alreadyAsked(proposals: ReadonlyArray<PeerSettingsProposal>): boolean {
  return proposals.some(
    (proposal) =>
      proposal.mine &&
      proposal.state === "pending" &&
      proposal.lines.length === 0 &&
      proposal.message === ASK_TO_BE_ADDED,
  );
}

/** What went wrong with a request the Hub answered but did not take, in a line; null when it took it. */
export function askRefusal(result: PeerSettingsProposeResult): string | null {
  switch (result.kind) {
    case "proposed":
      return null;
    case "forbidden":
      return "Peer could not send the request to the admins.";
    case "invalid":
      return result.diagnostics[0]?.message ?? "Peer could not send the request to the admins.";
  }
}
