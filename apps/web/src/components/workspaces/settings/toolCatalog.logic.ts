/**
 * What the workspace's tool catalog page works out, apart from how it draws (design artboard 17):
 * the catalog as a list with where each tool is used, a tool as the editor holds it and the writes
 * that change it, what is wrong with a definition (mirroring what the Hub and each person's
 * computer refuse), what saving it pauses and for whom, and the change that deletes a tool with its
 * uses. The Hub decides every change again (admins alone change the catalog, a project's leads its
 * tools); these only keep the page from offering what would be refused.
 */
import { getAt } from "@t3tools/client-runtime/peer-settings";
import type { PeerTool } from "@t3tools/contracts";

import { projectIdFromName } from "./newProject.logic";
import { joinNames } from "./projectCapacity.logic";
import { addTool, removeTool, toolEntries, type Transport } from "./projectTools.logic";
import type { ReviewOperation } from "./reviewChanges.logic";

type Mapping = Readonly<Record<string, unknown>>;
const isMapping = (value: unknown): value is Mapping =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A write to the draft, at a path from the document's root; `undefined` removes the node. */
export interface Edit {
  readonly path: ReadonlyArray<string>;
  readonly value: unknown;
}

export const TRANSPORTS: ReadonlyArray<Transport> = ["stdio", "http", "sse"];

const toolPath = (id: string, ...rest: string[]) => ["tools", id, ...rest];

// ---- the catalog ----------------------------------------------------------------------------------

/** A project and the tools it uses, as the catalog needs it. */
export interface ProjectUse {
  readonly id: string;
  readonly name: string;
  /** The tool ids in its list. */
  readonly tools: ReadonlyArray<string>;
  /** Addresses, or `*` for the whole workspace. */
  readonly people: ReadonlyArray<string>;
}

/** The projects the document shows, in the Hub's order. */
export function readProjects(document: unknown): ReadonlyArray<ProjectUse> {
  const projects = getAt(document, ["projects"]);
  if (!isMapping(projects)) return [];
  const texts = (value: unknown): ReadonlyArray<string> =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return Object.entries(projects).flatMap(([id, project]) => {
    if (!isMapping(project)) return [];
    const name = project.name;
    return [
      {
        id,
        name: typeof name === "string" && name !== "" ? name : id,
        tools: toolEntries(project.tools).map((entry) => entry.id),
        people: [...texts(project.members), ...texts(project.leads)],
      },
    ];
  });
}

/** One tool of the catalog in the list. */
export interface CatalogTool {
  readonly id: string;
  readonly name: string;
  readonly transport: Transport;
  /** The projects that use it. */
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

const byName = (a: { readonly name: string; readonly id: string }, b: typeof a) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** The catalog's tools by name, each with the projects that use it. */
export function readCatalog(document: unknown): ReadonlyArray<CatalogTool> {
  const tools = getAt(document, ["tools"]);
  if (!isMapping(tools)) return [];
  const projects = readProjects(document);
  return Object.entries(tools)
    .map(([id, raw]) => {
      const tool = readToolValue(raw);
      return {
        id,
        name: tool.name || id,
        transport: tool.transport,
        projects: projects
          .filter((project) => project.tools.includes(id))
          .map(({ id: projectId, name }) => ({ id: projectId, name })),
      };
    })
    .toSorted(byName);
}

/** "http · 3 projects", "stdio · Booking", "http · not in a project yet" (design artboard 17). */
export function toolMeta(tool: Pick<CatalogTool, "transport" | "projects">): string {
  const { projects } = tool;
  const use =
    projects.length === 0
      ? "not in a project yet"
      : projects.length === 1
        ? projects[0]!.name
        : `${projects.length} projects`;
  return `${tool.transport} · ${use}`;
}

/**
 * The tools the manifest gives this computer, for a Hub without settings: the ones the person's
 * projects use, each with its definition as the document would hold it.
 */
export function manifestCatalog(
  projects: ReadonlyArray<{
    readonly project: {
      readonly id: string;
      readonly name: string;
      readonly tools: ReadonlyArray<PeerTool>;
    };
  }>,
): ReadonlyArray<CatalogTool & { readonly raw: Mapping }> {
  const seen = new Map<string, CatalogTool & { readonly raw: Mapping }>();
  for (const { project } of projects) {
    for (const tool of project.tools) {
      const known = seen.get(tool.id);
      const use = { id: project.id, name: project.name };
      seen.set(
        tool.id,
        known === undefined
          ? {
              id: tool.id,
              name: tool.name,
              transport: tool.mcp.transport,
              projects: [use],
              raw: {
                name: tool.name,
                ...(tool.description === undefined ? {} : { description: tool.description }),
                mcp: tool.mcp,
                requires: tool.requires,
              },
            }
          : { ...known, projects: [...known.projects, use] },
      );
    }
  }
  return [...seen.values()].toSorted(byName);
}

// ---- a tool as the editor holds it ----------------------------------------------------------------

export interface RequirementValue {
  readonly command: string;
  readonly install: string;
  readonly docs: string;
}

/** What the editor shows of a tool. */
export interface ToolValue {
  readonly name: string;
  readonly description: string;
  /** The documentation link, which the Hub keeps with the first command the tool needs. */
  readonly docs: string;
  readonly transport: Transport;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly url: string;
  /** The environment of a local tool, the headers of a remote one, in order. */
  readonly pairs: ReadonlyArray<readonly [string, string]>;
  readonly requires: ReadonlyArray<RequirementValue>;
}

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

const pairsOf = (value: unknown): ReadonlyArray<readonly [string, string]> =>
  isMapping(value)
    ? Object.entries(value).flatMap(([name, text]) =>
        typeof text === "string" ? [[name, text] as const] : [],
      )
    : [];

/** A tool node of the settings document (or the manifest) as the editor holds it. */
export function readToolValue(raw: unknown): ToolValue {
  const mcp = getAt(raw, ["mcp"]);
  const named = getAt(mcp, ["transport"]);
  const transport: Transport =
    named === "stdio" || named === "http" || named === "sse"
      ? named
      : typeof getAt(mcp, ["command"]) === "string"
        ? "stdio"
        : "http";
  const args = getAt(mcp, ["args"]);
  const required = getAt(raw, ["requires"]);
  const requires = (Array.isArray(required) ? required : []).flatMap((entry: unknown) =>
    isMapping(entry)
      ? [
          {
            command: textOf(entry.command),
            install: textOf(entry.install),
            docs: textOf(entry.docs),
          },
        ]
      : [],
  );
  return {
    name: textOf(getAt(raw, ["name"])),
    description: textOf(getAt(raw, ["description"])),
    docs: requires.find((requirement) => requirement.docs !== "")?.docs ?? "",
    transport,
    command: textOf(getAt(mcp, ["command"])),
    args: Array.isArray(args) ? args.filter((arg): arg is string => typeof arg === "string") : [],
    url: textOf(getAt(mcp, ["url"])),
    pairs: pairsOf(getAt(mcp, transport === "stdio" ? ["env"] : ["headers"])),
    requires,
  };
}

/** The tool a person starts: a name, run by a command they fill in, needing nothing yet. */
export const newToolValue = (name: string): Mapping => ({
  name: name.trim(),
  mcp: { transport: "stdio", command: "", args: [], env: {} },
  requires: [],
});

export const newToolEdit = (id: string, name: string): Edit => ({
  path: ["tools", id],
  value: newToolValue(name),
});

export type NewTool =
  | { readonly ok: true; readonly id: string; readonly name: string }
  | { readonly ok: false; readonly problem: string | null };

/** The id a name makes, as the new project form makes one. */
export const toolIdFromName = projectIdFromName;

/**
 * Whether a name and an id make a tool: a name, and an id of lowercase letters and digits joined by
 * hyphens that no tool has. Nothing is said while the name is empty.
 */
export function checkNewTool(input: {
  readonly name: string;
  readonly id: string;
  readonly taken: ReadonlySet<string>;
}): NewTool {
  const name = input.name.trim();
  const id = input.id.trim();
  if (name === "") return { ok: false, problem: null };
  if (id === "") {
    return {
      ok: false,
      problem: "The ID is made from the letters a–z and the digits in the name. Add some.",
    };
  }
  if (id.length > 48 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    return {
      ok: false,
      problem: "An ID is lowercase letters and digits joined by hyphens, like postgres-staging.",
    };
  }
  if (input.taken.has(id)) {
    return { ok: false, problem: `A tool with the ID “${id}” exists already. Pick another.` };
  }
  return { ok: true, id, name };
}

// ---- arguments ------------------------------------------------------------------------------------

export type Args =
  | { readonly ok: true; readonly args: ReadonlyArray<string> }
  | { readonly ok: false; readonly problem: string };

/**
 * Arguments as they are typed: split on spaces, where quotes (`"` or `'`) keep words together and a
 * backslash takes the next character as it is. Inside single quotes everything is as written.
 */
export function splitArgs(text: string): Args {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\"))
        current += text[++i]!;
      else current += char;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === "\\" && i + 1 < text.length) {
      current += text[++i]!;
      started = true;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote !== null) return { ok: false, problem: "A quote is not closed." };
  if (started) args.push(current);
  return { ok: true, args };
}

/** Arguments as one field shows them: quoted only where a word needs it, so `splitArgs` reads them back. */
export function joinArgs(args: ReadonlyArray<string>): string {
  return args
    .map((arg) =>
      arg !== "" && !/[\s"'\\]/.test(arg) ? arg : `"${arg.replace(/(["\\])/g, "\\$1")}"`,
    )
    .join(" ");
}

// ---- what is wrong with a definition --------------------------------------------------------------

export type ProblemField = "name" | "command" | "url" | "docs" | "secret" | "pairs" | "requires";
export type ToolProblems = Partial<Record<ProblemField, string>>;

const ADDRESS = /^https?:\/\/\S+$/i;
const SECRET_REFERENCE = /\$\{secret:([^}]*)(\}|$)/g;
const SECRET_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;

/** Why `text` is not the address of a remote tool; null where it is one. */
export function toolUrlProblem(text: string): string | null {
  const url = text.trim();
  if (url === "") return "Enter the tool’s address, like https://mcp.acme.dev/jira.";
  return ADDRESS.test(url) ? null : "An address starting with https:// or http://.";
}

/** The documentation link is optional: nothing typed is fine, anything typed is a web address. */
export function docsLinkProblem(text: string): string | null {
  const link = text.trim();
  return link === "" || ADDRESS.test(link) ? null : "A web address starting with https://.";
}

/** The name of an environment variable (letters, digits and underscores). */
export function envVariableProblem(name: string, others: ReadonlyArray<string>): string | null {
  if (name === "") return "Give the variable a name.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use letters, digits and underscores, and do not start with a digit.";
  }
  return others.includes(name) ? "There is a variable with that name already." : null;
}

/** The name of an HTTP header. */
export function headerNameProblem(name: string, others: ReadonlyArray<string>): string | null {
  if (name === "") return "Give the header a name.";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "Use letters, digits and - _ . only.";
  return others.some((other) => other.toLowerCase() === name.toLowerCase())
    ? "There is a header with that name already."
    : null;
}

/** Why a command a tool needs on the computer is not one: Peer looks for a program by its name on the PATH. */
export function requirementCommandProblem(command: string): string | null {
  return /\s/.test(command.trim()) && !command.includes("/")
    ? "Name only the command, like psql. Peer looks for it on the PATH and never runs it."
    : null;
}

/** The first thing wrong with how secrets are named in `values`, or null. */
function secretProblem(values: ReadonlyArray<string>): string | null {
  for (const value of values) {
    for (const match of value.matchAll(SECRET_REFERENCE)) {
      if (match[2] !== "}") return "A secret is written ${secret:NAME}: close it with }.";
      if (!SECRET_NAME.test(match[1]!)) {
        return "Secret names are capital letters, digits and underscores, like STAGING_DB_URL.";
      }
    }
  }
  return null;
}

/** Every string of the definition a secret may be named in. */
const secretValues = (tool: ToolValue): ReadonlyArray<string> => [
  tool.transport === "stdio" ? tool.command : tool.url,
  ...(tool.transport === "stdio" ? tool.args : []),
  ...tool.pairs.map(([, value]) => value),
];

/**
 * What a definition cannot be saved with: no name, no command or address, a name or address that
 * cannot be one, a secret named in a way no computer would accept, a variable or header that cannot
 * be one, a command to look for that is not one. Each problem is for the field it is about.
 */
export function toolProblems(tool: ToolValue): ToolProblems {
  const problems: Record<string, string> = {};
  if (tool.name.trim() === "") problems.name = "A tool needs a name.";
  if (tool.transport === "stdio") {
    if (tool.command.trim() === "") {
      problems.command = "Enter the command that starts it, like npx.";
    } else if (/\s/.test(tool.command.trim()) && !tool.command.includes("/")) {
      problems.command = "The command is one word. Put the rest in the arguments.";
    }
  } else {
    const url = toolUrlProblem(tool.url);
    if (url !== null) problems.url = url;
  }
  const docs = docsLinkProblem(tool.docs);
  if (docs !== null) problems.docs = docs;
  const secret = secretProblem(secretValues(tool));
  if (secret !== null) problems.secret = secret;
  const names = tool.pairs.map(([name]) => name);
  for (const [name] of tool.pairs) {
    const others = names.filter((other) => other !== name);
    const problem =
      tool.transport === "stdio"
        ? envVariableProblem(name, others)
        : headerNameProblem(name, others);
    if (problem !== null) {
      problems.pairs = problem;
      break;
    }
  }
  for (const requirement of tool.requires) {
    if (requirement.command.trim() === "") {
      problems.requires = "Name the command this install line is for.";
      break;
    }
    const problem = requirementCommandProblem(requirement.command);
    if (problem !== null) {
      problems.requires = problem;
      break;
    }
  }
  return problems;
}

// ---- secrets --------------------------------------------------------------------------------------

/** The secrets a definition names, sorted: each person sets their own on their computer. */
export function secretNamesIn(tool: ToolValue): ReadonlyArray<string> {
  const names = new Set<string>();
  for (const value of secretValues(tool)) {
    for (const match of value.matchAll(SECRET_REFERENCE)) {
      if (match[2] === "}" && SECRET_NAME.test(match[1]!)) names.add(match[1]!);
    }
  }
  return [...names].toSorted();
}

/** The line under the environment (design artboard 17): secrets are named, never given. */
export function secretsNote(names: ReadonlyArray<string>): string {
  return names.length === 0
    ? "Secret values never go here. Write ${secret:NAME} and each person sets NAME on their own computer, in Tool trust."
    : `Secret values never go here. Each person sets ${joinNames(names)} on their own computer, in Tool trust.`;
}

// ---- the writes -----------------------------------------------------------------------------------

export const nameEdit = (id: string, name: string): Edit => ({
  path: toolPath(id, "name"),
  value: name,
});

export const descriptionEdit = (id: string, text: string): Edit => ({
  path: toolPath(id, "description"),
  value: text.trim() === "" ? undefined : text.trim(),
});

export const commandEdit = (id: string, command: string): Edit => ({
  path: toolPath(id, "mcp", "command"),
  value: command.trim(),
});

export const argsEdit = (id: string, args: ReadonlyArray<string>): Edit => ({
  path: toolPath(id, "mcp", "args"),
  value: args,
});

export const urlEdit = (id: string, url: string): Edit => ({
  path: toolPath(id, "mcp", "url"),
  value: url.trim(),
});

/** The environment (for a local tool) or headers (for a remote one), as the mapping the Hub keeps. */
export function pairsEdit(
  id: string,
  transport: Transport,
  pairs: ReadonlyArray<readonly [string, string]>,
): Edit {
  return {
    path: toolPath(id, "mcp", transport === "stdio" ? "env" : "headers"),
    value: Object.fromEntries(pairs),
  };
}

/** `pairs` with the one called `from` (none: a new one) as `name` = `value`, in the same place. */
export function withPair(
  pairs: ReadonlyArray<readonly [string, string]>,
  from: string | null,
  name: string,
  value: string,
): ReadonlyArray<readonly [string, string]> {
  const at = from === null ? -1 : pairs.findIndex(([existing]) => existing === from);
  return at < 0
    ? [...pairs, [name, value]]
    : pairs.map((pair, index) => (index === at ? ([name, value] as const) : pair));
}

export const withoutPair = (
  pairs: ReadonlyArray<readonly [string, string]>,
  name: string,
): ReadonlyArray<readonly [string, string]> => pairs.filter(([existing]) => existing !== name);

/**
 * The tool's `mcp` node once it is reached another way: a local tool is a command with arguments and
 * an environment, a remote one an address with headers (and http and sse share theirs). What belongs
 * to the other kind is left behind, empty, to be filled in.
 */
export function switchTransport(mcp: unknown, to: Transport): Mapping {
  const current = readToolValue({ mcp });
  if (to === "stdio") {
    return current.transport === "stdio"
      ? isMapping(mcp)
        ? mcp
        : {}
      : { transport: "stdio", command: "", args: [], env: {} };
  }
  return current.transport === "stdio"
    ? { transport: to, url: "", headers: {} }
    : { transport: to, url: current.url, headers: Object.fromEntries(current.pairs) };
}

export const transportEdit = (id: string, raw: unknown, to: Transport): Edit => ({
  path: toolPath(id, "mcp"),
  value: switchTransport(mcpOf(raw), to),
});

/** The tool's `mcp` node: how it is reached. */
export const mcpOf = (raw: unknown): unknown => getAt(raw, ["mcp"]);

/**
 * The `mcp` node of a way of reaching the tool that was left, as it is when that way is chosen
 * again: what was typed for it is still there, and a remote one takes the transport chosen now
 * (http and sse share an address and headers).
 */
export function restoreTransport(left: unknown, to: Transport): Mapping {
  const node = isMapping(left) ? left : {};
  return to === "stdio" ? node : { ...node, transport: to };
}

const requirementEntries = (raw: unknown): ReadonlyArray<Mapping> => {
  const list = getAt(raw, ["requires"]);
  return Array.isArray(list) ? list.filter(isMapping) : [];
};

const requirementEntry = (
  existing: Mapping | undefined,
  next: { readonly command: string; readonly install: string },
): Mapping => {
  const { install: _install, ...rest } = existing ?? {};
  return {
    ...rest,
    command: next.command.trim(),
    ...(next.install.trim() === "" ? {} : { install: next.install.trim() }),
  };
};

/**
 * The write for a command the tool needs: the one at `index` changed, or (with none) a new one at the
 * end. What the entry carries besides the command and how to install it, its documentation link
 * among it, stays.
 */
export function setRequirementEdit(
  id: string,
  raw: unknown,
  index: number | null,
  next: { readonly command: string; readonly install: string },
): Edit {
  const entries = requirementEntries(raw);
  return {
    path: toolPath(id, "requires"),
    value:
      index === null
        ? [...entries, requirementEntry(undefined, next)]
        : entries.map((entry, at) => (at === index ? requirementEntry(entry, next) : entry)),
  };
}

export const removeRequirementEdit = (id: string, raw: unknown, index: number): Edit => ({
  path: toolPath(id, "requires"),
  value: requirementEntries(raw).filter((_, at) => at !== index),
});

/**
 * The write for the documentation link. The Hub keeps it with a command the tool needs, so it is put
 * on the entry that has one, else the first; a blank link takes it away. A tool that needs nothing
 * has no entry to keep one with.
 */
export function docsEdit(id: string, raw: unknown, link: string): Edit {
  const entries = requirementEntries(raw);
  const at = Math.max(
    0,
    entries.findIndex((entry) => typeof entry.docs === "string" && entry.docs !== ""),
  );
  const text = link.trim();
  return {
    path: toolPath(id, "requires"),
    value: entries.map((entry, index) => {
      if (index !== at) return entry;
      const { docs: _docs, ...rest } = entry;
      return text === "" ? rest : { ...rest, docs: text };
    }),
  };
}

/** The write that gives a project the tool or takes it away; the Hub merges a project's tools by id. */
export function usageEdit(
  document: unknown,
  projectId: string,
  toolId: string,
  use: boolean,
): Edit {
  const list = getAt(document, ["projects", projectId, "tools"]);
  return {
    path: ["projects", projectId, "tools"],
    value: use ? addTool(list, toolId) : removeTool(list, toolId),
  };
}

/** The change that deletes a tool from the catalog and from every project that uses it. */
export function deleteToolOperation(input: {
  readonly workspace: string;
  readonly base: number;
  readonly document: unknown;
  readonly id: string;
}): ReviewOperation {
  const users = readProjects(input.document).filter((project) => project.tools.includes(input.id));
  return {
    kind: "save",
    workspace: input.workspace,
    base: input.base,
    set: [
      { path: ["tools", input.id], value: null },
      ...users.map((project) => ({
        path: ["projects", project.id, "tools"],
        value: removeTool(getAt(input.document, ["projects", project.id, "tools"]), input.id),
      })),
    ],
  };
}

/** What deleting says it takes with it, one line each, before the review. */
export function deleteWords(tool: string, projects: ReadonlyArray<string>): ReadonlyArray<string> {
  return [
    `${tool} leaves the catalog, so no project can pick it again.`,
    projects.length === 0
      ? "No project uses it, so no one’s agents change."
      : `It is taken out of ${joinNames(projects)}: agents there stop getting it.`,
  ];
}

// ---- what saving does -----------------------------------------------------------------------------

/** What identifies a definition to the people who approved it; a name or a description is not part of it. */
function fingerprintOf(tool: ToolValue): string {
  const pairs = tool.pairs.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(
    tool.transport === "stdio"
      ? ["stdio", tool.command, tool.args, pairs]
      : [tool.transport, tool.url, pairs],
  );
}

/**
 * Whether the new definition is another one to the people who approved the old: how the tool is
 * reached (transport, command or address, arguments, environment or headers). Its name, description,
 * documentation and what it needs on the computer do not ask for another approval.
 */
export const pausesTool = (before: ToolValue, after: ToolValue): boolean =>
  fingerprintOf(before) !== fingerprintOf(after);

/** How many people are on the projects that use a tool: everyone if one of them is for the whole workspace. */
export function peopleUsing(
  projects: ReadonlyArray<Pick<ProjectUse, "people">>,
  workspacePeople: number,
): number {
  const people = new Set<string>();
  for (const project of projects) {
    if (project.people.includes("*")) return workspacePeople;
    for (const person of project.people) people.add(person.toLowerCase());
  }
  return people.size;
}

/** "Saving pauses Postgres staging for the 5 people in Booking until each of them approves it again on their computer." */
export function pauseNote(input: {
  readonly tool: string;
  readonly people: number;
  readonly projects: ReadonlyArray<string>;
}): string | null {
  const { people } = input;
  if (people <= 0) return null;
  const who = `${people} ${people === 1 ? "person" : "people"}`;
  const where = input.projects.length === 0 ? "" : ` in ${joinNames(input.projects)}`;
  return `Saving pauses ${input.tool} for the ${who}${where} until ${people === 1 ? "they approve" : "each of them approves"} it again on their computer.`;
}
