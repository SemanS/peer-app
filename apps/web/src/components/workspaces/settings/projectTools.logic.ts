/**
 * A project's tools as the Tools page shows and edits them: the keyed list (by tool id, a bare string
 * being `{tool: id}`) in the settings document, what each tool is in the workspace catalog, and what
 * this computer says of it: whether it approved the tool, which secrets it has, which commands the
 * tool needs are installed. Approval, secrets and commands are per computer, so they come from the
 * status, never from the document.
 */
import type { PeerSettingsTool, PeerTool } from "@t3tools/contracts";

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Env = Readonly<Record<string, string>>;

/** The string values of a mapping; whatever else is in it is left out. */
const stringsOf = (value: unknown): Env =>
  isMapping(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

/** One tool a project uses, with the settings the project gives it (its own environment). */
export interface ToolEntry {
  readonly id: string;
  readonly env: Env;
}

const idOf = (element: unknown): string | undefined =>
  typeof element === "string"
    ? element
    : isMapping(element) && typeof element.tool === "string"
      ? element.tool
      : undefined;

/** The tools a document's project list holds. */
export function toolEntries(value: unknown): ReadonlyArray<ToolEntry> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((element: unknown) => {
    const id = idOf(element);
    return id === undefined ? [] : [{ id, env: isMapping(element) ? stringsOf(element.env) : {} }];
  });
}

const listOf = (list: unknown): ReadonlyArray<unknown> => (Array.isArray(list) ? list : []);

/** The list with a tool at its end (the Hub writes new ones last); a tool it has is not added twice. */
export function addTool(list: unknown, id: string): ReadonlyArray<unknown> {
  const items = listOf(list);
  return items.some((element) => idOf(element) === id) ? items : [...items, id];
}

export const removeTool = (list: unknown, id: string): ReadonlyArray<unknown> =>
  listOf(list).filter((element) => idOf(element) !== id);

const sameEnv = (a: Env, b: Env): boolean => {
  const left = Object.entries(a);
  const right = new Map(Object.entries(b));
  return left.length === right.size && left.every(([name, value]) => right.get(name) === value);
};

/**
 * The list with the project's settings for one tool: the tool alone where it has none, else
 * `{tool, env}`. A tool whose settings did not change keeps the element it had.
 */
export function setToolEnv(list: unknown, id: string, env: Env): ReadonlyArray<unknown> {
  return listOf(list).map((element) => {
    if (idOf(element) !== id) return element;
    if (sameEnv(isMapping(element) ? stringsOf(element.env) : {}, env)) return element;
    return Object.keys(env).length === 0 ? id : { tool: id, env };
  });
}

/** What the draft does to the project's tools, by tool id. */
export function toolChanges(
  saved: ReadonlyArray<ToolEntry>,
  draft: ReadonlyArray<ToolEntry>,
): {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
} {
  const before = new Map(saved.map((entry) => [entry.id, entry]));
  const after = new Map(draft.map((entry) => [entry.id, entry]));
  return {
    added: draft.filter((entry) => !before.has(entry.id)).map((entry) => entry.id),
    changed: draft
      .filter((entry) => {
        const was = before.get(entry.id);
        return was !== undefined && !sameEnv(was.env, entry.env);
      })
      .map((entry) => entry.id),
    removed: saved.filter((entry) => !after.has(entry.id)).map((entry) => entry.id),
  };
}

/**
 * What saving adds or changes beyond the lines themselves: each person approves a tool, or its new
 * definition, on their own computer before their agents get it (design artboard 09).
 */
export function toolNotes(input: {
  /** Names of the tools the draft adds. */
  readonly added: ReadonlyArray<string>;
  /** Names of the saved tools whose settings the draft changes. */
  readonly changed: ReadonlyArray<string>;
  /** How many people are on the project. */
  readonly people: number;
}): ReadonlyArray<string> {
  const { people } = input;
  const lead = (verb: string, name: string) =>
    people === 1
      ? `Saving ${verb} ${name} for 1 person, who approves it`
      : `Saving ${verb} ${name} for ${people} people. Each approves it`;
  const tail = (again: boolean) =>
    `${again ? " again" : ""} on their own computer before their agents get it.`;
  return [
    ...input.added.map((name) => lead("adds", name) + tail(false)),
    ...input.changed.map((name) => lead("changes", name) + tail(true)),
  ];
}

/** Why `name` cannot be a setting beside `others`; null where it can. */
export function envNameProblem(name: string, others: ReadonlyArray<string>): string | null {
  if (name === "") return "Give the setting a name.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use letters, digits and underscores, and do not start with a digit.";
  }
  return others.includes(name) ? "There is a setting with that name already." : null;
}

/** `env` with the setting `from` (none: a new one) as `name` = `value`, in the same place. */
export function setEnvEntry(env: Env, from: string | null, name: string, value: string): Env {
  const entries = Object.entries(env);
  const at = from === null ? -1 : entries.findIndex(([existing]) => existing === from);
  if (at < 0) return Object.fromEntries([...entries, [name, value]]);
  return Object.fromEntries(entries.map((entry, index) => (index === at ? [name, value] : entry)));
}

export const removeEnvEntry = (env: Env, name: string): Env =>
  Object.fromEntries(Object.entries(env).filter(([existing]) => existing !== name));

export type Transport = "stdio" | "http" | "sse";

export interface ToolRequirement {
  readonly command: string;
  readonly install?: string | undefined;
  readonly docs?: string | undefined;
}

/** What the page reads of a tool in the catalog or the manifest. */
export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly transport: Transport;
  /** Where a secret may be named besides the environment: command and arguments, or URL and headers. */
  readonly strings: ReadonlyArray<string>;
  /** A local tool's own environment, which a project's settings add to. */
  readonly env: Env;
  readonly requires: ReadonlyArray<ToolRequirement>;
}

const transportOf = (named: string | undefined, local: boolean): Transport =>
  named === "stdio" || named === "http" || named === "sse" ? named : local ? "stdio" : "http";

/** A catalog tool as the settings document holds it (a missing transport is stdio for a command, else http). */
export function catalogDefinition(id: string, tool: PeerSettingsTool): ToolDefinition {
  const { mcp } = tool;
  const transport = transportOf(mcp.transport, mcp.command !== undefined);
  return {
    id,
    name: tool.name,
    description: tool.description,
    transport,
    strings:
      transport === "stdio"
        ? [mcp.command ?? "", ...(mcp.args ?? [])]
        : [mcp.url ?? "", ...Object.values(mcp.headers ?? {})],
    env: transport === "stdio" ? (mcp.env ?? {}) : {},
    requires: tool.requires ?? [],
  };
}

/** A tool as the manifest gives it to this computer, the project's settings already in its environment. */
export function manifestDefinition(tool: PeerTool): ToolDefinition {
  const { mcp } = tool;
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    transport: mcp.transport,
    strings:
      mcp.transport === "stdio"
        ? [mcp.command, ...mcp.args]
        : [mcp.url, ...Object.values(mcp.headers)],
    env: mcp.transport === "stdio" ? mcp.env : {},
    requires: tool.requires,
  };
}

/** The tools a document's catalog holds, by id. */
export function catalogDefinitions(
  catalog: Readonly<Record<string, PeerSettingsTool>>,
): ReadonlyMap<string, ToolDefinition> {
  return new Map(
    Object.entries(catalog).map(([id, tool]) => [id, catalogDefinition(id, tool)] as const),
  );
}

const SECRET_REFERENCE = /\$\{secret:([A-Z_][A-Z0-9_]{0,63})\}/g;

/** The secrets a tool names, for a project that gives it these settings, sorted. */
export function secretNamesOf(
  definition: ToolDefinition,
  projectEnv: Env = {},
): ReadonlyArray<string> {
  const values = [
    ...definition.strings,
    ...Object.values({
      ...definition.env,
      ...(definition.transport === "stdio" ? projectEnv : {}),
    }),
  ];
  return [
    ...new Set(
      values.flatMap((value) =>
        [...value.matchAll(SECRET_REFERENCE)].flatMap((match) => match[1] ?? []),
      ),
    ),
  ].sort();
}

/** The first documentation link a tool's requirements carry, where it is a web address. */
export function docsUrl(requires: ReadonlyArray<ToolRequirement>): string | undefined {
  for (const requirement of requires) {
    const docs = requirement.docs;
    if (docs === undefined) continue;
    try {
      const { protocol } = new URL(docs);
      if (protocol === "https:" || protocol === "http:") return docs;
    } catch {
      // Not an address: the next requirement may have one.
    }
  }
  return undefined;
}

/** A catalog tool in the "Add from catalog" menu: its name, then what it does and how it runs. */
export interface CatalogChoice {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

/** The catalog's tools the project does not use yet, by name. */
export function catalogChoices(
  catalog: ReadonlyMap<string, ToolDefinition>,
  used: ReadonlyArray<string>,
): ReadonlyArray<CatalogChoice> {
  return [...catalog.values()]
    .filter((tool) => !used.includes(tool.id))
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      detail:
        tool.description === undefined ? tool.transport : `${tool.description} · ${tool.transport}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The menu's last line: the way on to the catalog, or whom to ask where the person cannot change it. */
export type CatalogMenuFooter =
  | { readonly kind: "open"; readonly label: string }
  | { readonly kind: "ask"; readonly text: string };

/**
 * What "Add from catalog" shows. Four states that are not told as one: the catalog is not read yet,
 * it has no tool, the project has every tool it has, or there are tools to add. The first three
 * carry the sentence that says so; a menu that answered all of them "every tool is here already"
 * told an admin with an empty catalog the opposite of what was true.
 */
export type AddFromCatalog =
  | { readonly kind: "loading"; readonly message: string; readonly footer: null }
  | { readonly kind: "empty"; readonly message: string; readonly footer: CatalogMenuFooter }
  | { readonly kind: "all-added"; readonly message: string; readonly footer: CatalogMenuFooter }
  | {
      readonly kind: "choices";
      readonly choices: ReadonlyArray<CatalogChoice>;
      readonly footer: CatalogMenuFooter;
    };

export function addFromCatalogState(input: {
  readonly workspaceName: string;
  /** The settings, and with them the catalog, have not been read yet. */
  readonly loading: boolean;
  readonly catalog: ReadonlyMap<string, ToolDefinition>;
  /** The ids of the tools the project has. */
  readonly used: ReadonlyArray<string>;
  /** Admins change the catalog; everyone else reads it. */
  readonly canEditCatalog: boolean;
}): AddFromCatalog {
  const { workspaceName, canEditCatalog } = input;
  if (input.loading) {
    return { kind: "loading", message: `Loading ${workspaceName}’s catalog…`, footer: null };
  }
  if (input.catalog.size === 0) {
    return {
      kind: "empty",
      message: `${workspaceName}’s catalog is empty, so there’s nothing to add yet.`,
      footer: canEditCatalog
        ? { kind: "open", label: "Open Workspace › Tools" }
        : { kind: "ask", text: "Ask an admin to add tools" },
    };
  }
  const footer: CatalogMenuFooter = {
    kind: "open",
    label: `${canEditCatalog ? "Edit" : "See"} the catalog in Workspace › Tools`,
  };
  const choices = catalogChoices(input.catalog, input.used);
  if (choices.length > 0) return { kind: "choices", choices, footer };
  const total = input.catalog.size;
  return {
    kind: "all-added",
    message:
      total === 1
        ? "The only tool in the catalog is in this project already."
        : `All ${total} tools from the catalog are in this project already.`,
    footer,
  };
}

/** A pill: `value · source`, amber where it needs attention. `action` is where the person goes to fix it. */
export interface Chip {
  readonly value: string;
  readonly source: string;
  readonly tone: "ok" | "warn";
  readonly action?: "review" | "secrets";
}

/** This computer's approval of a tool (the tool trust review's states). */
export type TrustState = "on" | "review" | "changed" | "secret" | "off" | "invalid";

/**
 * Whether this computer approved the tool, as a pill; nothing for a tool this computer has not seen
 * (one the draft adds). A tool approved but waiting on a secret is approved: its secret says so.
 */
export function approvalChip(
  trust: { readonly state: TrustState; readonly reason?: string | undefined } | undefined,
): Chip | undefined {
  if (trust === undefined) return undefined;
  const here = "on this computer";
  switch (trust.state) {
    case "on":
    case "secret":
      return { value: "approved", source: here, tone: "ok" };
    case "review":
      return { value: "needs approval", source: here, tone: "warn", action: "review" };
    case "changed":
      return { value: "needs approval again", source: here, tone: "warn", action: "review" };
    case "off":
      return { value: "off", source: here, tone: "warn", action: "review" };
    case "invalid":
      return { value: "invalid", source: trust.reason ?? here, tone: "warn" };
  }
}

/** What this computer holds of a secret a tool names. */
export interface SecretStatus {
  readonly name: string;
  readonly source: "stored" | "environment" | "missing";
  readonly environmentSet: boolean;
}

/**
 * A secret a tool names, as a pill: set here, missing here, or (where this computer has not seen the
 * tool yet) every computer sets its own, since a secret is never in the settings.
 */
export function secretChip(name: string, status: SecretStatus | undefined): Chip {
  if (status === undefined)
    return { value: name, source: "each computer sets its own", tone: "ok" };
  const set =
    status.source === "stored" || (status.source === "environment" && status.environmentSet);
  return set
    ? { value: name, source: "set on this computer", tone: "ok" }
    : { value: name, source: "missing on this computer", tone: "warn", action: "secrets" };
}

/** Whether a command a tool needs is on this computer's PATH: not known for a tool it has not seen. */
export type CommandProbe = "installed" | "missing" | "unknown";

export function commandProbe(
  command: string,
  seen: ReadonlyArray<string> | undefined,
  missing: ReadonlyArray<string>,
): CommandProbe {
  if (missing.includes(command)) return "missing";
  return seen?.includes(command) === true ? "installed" : "unknown";
}

export function commandChip(command: string, probe: CommandProbe): Chip {
  switch (probe) {
    case "missing":
      return { value: command, source: "required, not installed", tone: "warn" };
    case "installed":
      return { value: command, source: "required, installed", tone: "ok" };
    case "unknown":
      return { value: command, source: "required", tone: "ok" };
  }
}

/** One tool on the page. */
export interface ToolRowModel {
  readonly id: string;
  readonly name: string;
  readonly description: string | undefined;
  readonly docs: string | undefined;
  /** Approval, then each secret, then each command the tool needs. */
  readonly chips: ReadonlyArray<Chip>;
  /** How to install what is missing here. */
  readonly installHints: ReadonlyArray<string>;
  /** The project's own settings for it. */
  readonly env: Env;
  /** Whether a project can give it settings: only a local (stdio) tool takes an environment. */
  readonly takesSettings: boolean;
}

/** What the page knows of a tool a project uses, as the row shows it. */
export function toolRow(input: {
  readonly entry: ToolEntry;
  /** From the catalog, else the manifest; undefined where neither knows the tool. */
  readonly definition: ToolDefinition | undefined;
  /** The commands the manifest says the tool needs, which this computer looked for. */
  readonly seen: ReadonlyArray<string> | undefined;
  readonly trust: { readonly state: TrustState; readonly reason?: string | undefined } | undefined;
  readonly secrets: ReadonlyArray<SecretStatus>;
  /** The commands this computer lacks for it. */
  readonly missing: ReadonlyArray<string>;
}): ToolRowModel {
  const { entry, definition } = input;
  const requires = definition?.requires ?? [];
  const approval = approvalChip(input.trust);
  const probes = requires.map((requirement) => ({
    requirement,
    probe: commandProbe(requirement.command, input.seen, input.missing),
  }));
  const chips = [
    ...(approval === undefined ? [] : [approval]),
    ...(definition === undefined
      ? []
      : secretNamesOf(definition, entry.env).map((name) =>
          secretChip(
            name,
            input.secrets.find((secret) => secret.name === name),
          ),
        )),
    ...probes.map(({ requirement, probe }) => commandChip(requirement.command, probe)),
  ];
  return {
    id: entry.id,
    name: definition?.name ?? entry.id,
    description: definition?.description,
    docs: docsUrl(requires),
    // A command a tool lists twice is one pill.
    chips: chips.filter(
      (chip, index) =>
        chips.findIndex((other) => other.value === chip.value && other.source === chip.source) ===
        index,
    ),
    installHints: probes.flatMap(({ requirement, probe }) =>
      probe === "missing" && requirement.install !== undefined
        ? [`Install ${requirement.command}: ${requirement.install}`]
        : [],
    ),
    env: entry.env,
    takesSettings: definition?.transport === "stdio",
  };
}
