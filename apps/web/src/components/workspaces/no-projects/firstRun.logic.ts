/**
 * The first steps of a new organization, as its owners and admins see them in Work's empty state:
 * a project, colleagues, tools and the company's AI capacity. Each opens the settings page that
 * does it and is ticked from what the workspace's settings and invitations already say.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";

import type { WorkspaceSection } from "../settings/peerSettings.logic";
import { readCatalogPools } from "../settings/sharedCapacity.logic";
import { readCatalog } from "../settings/toolCatalog.logic";

export interface FirstRunStep {
  readonly id: "project" | "people" | "tools" | "capacity";
  readonly title: string;
  readonly text: string;
  readonly section: WorkspaceSection;
  /** Null while the facts it is told from are not read yet. */
  readonly done: boolean | null;
}

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The four steps. `document` is the workspace's settings (null while unread), `people` its members
 * as the settings list them, `invitations` how many invitations are pending or were accepted (null
 * where the Hub does not list them).
 */
export function firstRunSteps(input: {
  readonly projects: number;
  readonly document: unknown;
  readonly people: number | null;
  readonly invitations: number | null;
}): ReadonlyArray<FirstRunStep> {
  const { document } = input;
  const read = document !== null && document !== undefined;
  const projectsInSettings = read ? getAt(document, ["projects"]) : undefined;
  const hasProject =
    input.projects > 0 ||
    (isMapping(projectsInSettings) && Object.keys(projectsInSettings).length > 0);
  const colleagues =
    input.people === null && input.invitations === null
      ? null
      : (input.people ?? 0) > 1 || (input.invitations ?? 0) > 0;
  return [
    {
      id: "project",
      title: "Add a project or repository",
      text: "A project gathers its repositories, people, tools and budget.",
      section: "new-project",
      done: hasProject,
    },
    {
      id: "people",
      title: "Invite colleagues",
      text: "They get an email and join once they sign in with that address.",
      section: "people",
      done: colleagues,
    },
    {
      id: "tools",
      title: "Set up tools",
      text: "The MCP servers and commands your agents may use.",
      section: "tools",
      done: read ? readCatalog(document).length > 0 : null,
    },
    {
      id: "capacity",
      title: "Company AI capacity",
      text: "The company's own API keys behind its gateway, shared by its projects.",
      section: "capacity",
      done: read ? readCatalogPools(document).length > 0 : null,
    },
  ];
}
