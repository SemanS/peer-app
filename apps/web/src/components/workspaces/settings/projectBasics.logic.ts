/**
 * What a project's Basics tab shows and does, apart from how it draws (design artboard 05): the
 * values of its form read from the settings document, what typed text becomes in the document,
 * and what deleting the project says it takes with it.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";

import type { ReviewOperation } from "./reviewChanges.logic";

/** The longest description the form takes. */
export const DESCRIPTION_MAX = 300;

type Mapping = Readonly<Record<string, unknown>>;

const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textAt = (entry: unknown, path: ReadonlyArray<string>): string | undefined => {
  const value = getAt(entry, path);
  return typeof value === "string" ? value : undefined;
};

/** What the Basics form edits. */
export interface BasicsValues {
  readonly name: string;
  readonly client: string;
  readonly description: string;
}

/**
 * The form's values from the project's entry of the settings document; where the document is not
 * read (an older Hub, or a moment before it arrives) from what the manifest says of the project.
 */
export function basicsValues(
  entry: unknown,
  manifest: {
    readonly name: string;
    readonly client?: string | undefined;
    readonly description?: string | undefined;
  },
): BasicsValues {
  if (!isMapping(entry)) {
    return {
      name: manifest.name,
      // oxlint-disable-next-line t3code/no-rpc-permission-bypass -- `client` is the project's customer, not an RPC client.
      client: manifest.client ?? "",
      description: manifest.description ?? "",
    };
  }
  return {
    name: textAt(entry, ["name"]) ?? manifest.name,
    client: textAt(entry, ["client"]) ?? "",
    description: textAt(entry, ["description"]) ?? "",
  };
}

/**
 * What typed text becomes in the document: trimmed, and nothing for a blank. A name that comes to
 * nothing is not taken into the draft (a project needs one); a blank client or description removes
 * the field.
 */
export function settledText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** How long a text is, in characters as people count them. */
export const textLength = (text: string): number => Array.from(text).length;

/** "92 / 300": beside the description's label. */
export const descriptionCount = (text: string): string =>
  `${textLength(text)} / ${DESCRIPTION_MAX}`;

export const NAME_REQUIRED = "A project needs a name.";

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * What the form says to someone who may not change it: who may, in the Hub's words ("Booking's
 * leads and admins"), and the leads by name.
 */
export function basicsReadOnlyNote(owners: string, leadNames: ReadonlyArray<string>): string {
  const leads = leadNames.length === 0 ? "" : ` Leads: ${leadNames.join(", ")}.`;
  return `${capital(owners)} change this.${leads}`;
}

export interface DeleteFacts {
  readonly tasks: number;
  /** The project's areas, in which tasks sit. */
  readonly areas: number;
  /** The people the project goes away for. */
  readonly people: number;
  /** The project has shared capacity, so a gateway team exists under its id. */
  readonly gatewayTeam: boolean;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What goes away with the project, and what does not, one line each (design artboard 05): its
 * tasks with their context and coordination history, its settings, its place in Work for the
 * people on it, and what stays behind (their threads, the gateway team with its usage).
 */
export function deleteConsequences(
  project: { readonly id: string; readonly name: string },
  facts: DeleteFacts,
): string[] {
  const tasks =
    facts.tasks === 0
      ? `${facts.areas > 0 ? "Its areas, task" : "Its task"} context and coordination history`
      : `${count(facts.tasks, "task", "tasks")}${
          facts.areas > 0 ? ` in ${count(facts.areas, "area", "areas")}` : ""
        }, with their task context and coordination history`;
  return [
    tasks,
    `${project.name}’s settings: people, tools and allocations`,
    `${project.name} leaves Work for ${count(facts.people, "person", "people")}. Threads on their computers stay, without the project.`,
    ...(facts.gatewayTeam
      ? [`The gateway team “${project.id}” stays, with its usage. Remove it there if you want.`]
      : []),
  ];
}

/** The person typed the project's id, so the delete button is on. */
export const confirmsDeletion = (typed: string, id: string): boolean => typed.trim() === id;

/** The change that deletes a project: its node set to nothing, against the revision the page read. */
export function deleteOperation(workspace: string, base: number, id: string): ReviewOperation {
  return { kind: "save", workspace, base, set: [{ path: ["projects", id], value: null }] };
}
