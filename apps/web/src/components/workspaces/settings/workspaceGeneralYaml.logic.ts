/**
 * Settings as YAML (design artboard 14): what Export saves and what Import reads. The Hub's export
 * is a set of files (`workspace.yaml`, one file per project, tool, pool and webhook, and
 * `.peer-revision`), which `peerhub workspace apply` reads from a folder. Export saves them as one
 * .zip of that folder; Import takes the folder, the .zip or loose files back and arranges them as
 * the Hub reads them, keeping what is in `.peer-revision` as the revision the files started from.
 * Pure but for the archive, which JSZip (already in the web bundle) reads and writes.
 */

/** The largest YAML a workspace's settings may be (the Hub's document limit is 1 MiB). */
const MAX_BYTES = 2 * 1024 * 1024;

/** The folders the Hub keeps one file per id in, and what to call what is in them. */
const FOLDERS = [
  ["projects", "project", "projects"],
  ["tools", "tool", "tools"],
  ["capacity", "pool", "pools"],
  ["webhooks", "webhook", "webhooks"],
] as const;

type Folder = (typeof FOLDERS)[number][0];

// ---- export ---------------------------------------------------------------------------------------

/** `acme-settings-r42.zip`: the workspace and the revision the files are of. */
export const archiveName = (slug: string, seq: number | undefined): string =>
  `${slug}-settings${seq === undefined ? "" : `-r${seq}`}.zip`;

/**
 * The exported files as a .zip with one folder in it (`acme-settings/`), so that opening it anywhere
 * leaves a folder `peerhub workspace apply` can be pointed at.
 */
export async function buildArchive(
  slug: string,
  files: Readonly<Record<string, string>>,
): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const root = zip.folder(`${slug}-settings`);
  if (root === null) throw new Error("The archive could not be made.");
  for (const [path, text] of Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b))) {
    root.file(path, text);
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// ---- import ---------------------------------------------------------------------------------------

/** A file to import: where it sits (a folder's files carry their path from the folder) and its text. */
export interface ImportEntry {
  readonly path: string;
  /** Bytes, where known; 0 for a file inside an archive. */
  readonly size: number;
  readonly text: () => Promise<string>;
}

/** What the file picker gave, which may be one .zip. */
export interface ImportSource extends ImportEntry {
  readonly bytes: () => Promise<Uint8Array>;
}

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

/** The files of a .zip, without the operating system's litter. */
export async function readArchive(bytes: Uint8Array): Promise<ReadonlyArray<ImportEntry>> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  return Object.values(zip.files)
    .filter((file) => !file.dir && !JUNK.test(file.name))
    .map((file) => ({ path: file.name, size: 0, text: () => file.async("string") }));
}

export interface ImportFiles {
  /** File path → YAML, as the Hub's export gives them. */
  readonly files: Readonly<Record<string, string>>;
  /** The revision the files started from, when `.peer-revision` says. */
  readonly base: number | undefined;
  /** What is in them, in a line: "workspace.yaml, 3 projects, 2 tools". */
  readonly summary: string;
}

export type ImportRead =
  | ({ readonly ok: true } & ImportFiles)
  | { readonly ok: false; readonly problem: string };

const NO_WORKSPACE =
  "Those files have no workspace.yaml. Pick the folder that holds it, or a .zip from Export.";
const SEVERAL_WORKSPACES =
  "Those files hold more than one workspace.yaml. Pick the folder of one workspace.";
const TOO_LARGE = "Those files are larger than settings can be.";
const notAnId = (path: string) =>
  `${path}: the file name is the ID, so use lowercase letters, digits and hyphens.`;

/** The revision a `.peer-revision` file names: `<seq> <commit>`. */
export function revisionOf(text: string | undefined): number | undefined {
  const seq = /^(\d+)\b/.exec(text ?? "")?.[1];
  return seq === undefined ? undefined : Number(seq);
}

const normalized = (path: string) =>
  path
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/{2,}/g, "/");

const WORKSPACE_FILE = /(^|\/)workspace\.ya?ml$/;
const FOLDER_FILE = /^(projects|tools|capacity|webhooks)\/([^/]+)\.ya?ml$/;
const LOOSE_YAML = /^([^/]+)\.ya?ml$/;
/** What a file in a folder may be called for the Hub to read it: its name is the id. */
const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A YAML file with no folder around it cannot say what it is, but its top-level keys do: a tool has
 * `mcp`, a pool `models`, a webhook `events` or `format`; anything else is a project.
 */
export function sniffFolder(text: string): Folder {
  if (/^mcp\s*:/m.test(text)) return "tools";
  if (/^models\s*:/m.test(text)) return "capacity";
  if (/^(events|format)\s*:/m.test(text)) return "webhooks";
  return "projects";
}

/** "workspace.yaml, 3 projects, 2 tools": what the files hold. */
export function importSummary(files: Readonly<Record<string, string>>): string {
  const parts = FOLDERS.flatMap(([folder, one, many]) => {
    const count = Object.keys(files).filter((path) => path.startsWith(`${folder}/`)).length;
    return count === 0 ? [] : [`${count} ${count === 1 ? one : many}`];
  });
  return ["workspace.yaml", ...parts].join(", ");
}

/**
 * Arranges what was picked as the Hub reads it. The folder holding `workspace.yaml` is the root
 * (whatever folders it sits in, as a picked folder or an archive has them); under it only the files
 * the Hub reads are taken, and are never read otherwise, so picking a repository does not read the
 * repository. Files picked one by one (`loose`) have no folder to say what they are, so what is in
 * them does. A file whose name is no id would be dropped by the Hub and look like a removal in the
 * review, so it is refused instead.
 */
export async function arrangeImport(
  entries: ReadonlyArray<ImportEntry>,
  options: { readonly loose: boolean } = { loose: false },
): Promise<ImportRead> {
  const listed = entries.map((entry) => ({ entry, path: normalized(entry.path) }));
  const depth = (path: string) => path.split("/").length;
  const found = listed.filter(({ path }) => WORKSPACE_FILE.test(path));
  const shallowest = Math.min(...found.map(({ path }) => depth(path)));
  const roots = found.filter(({ path }) => depth(path) === shallowest);
  const first = roots[0];
  if (first === undefined) return { ok: false, problem: NO_WORKSPACE };
  // Two workspaces' folders side by side cannot both be what is imported, and guessing would import the wrong one.
  if (roots.length > 1) return { ok: false, problem: SEVERAL_WORKSPACES };
  const root = first.path.slice(0, first.path.lastIndexOf("/") + 1);

  const wanted = new Map<string, ImportEntry>();
  const unsorted: Array<{ readonly name: string; readonly entry: ImportEntry }> = [];
  let size = 0;
  for (const { entry, path } of listed) {
    if (!path.startsWith(root)) continue;
    const relative = path.slice(root.length);
    // A hidden file (an editor's leftover, a `._name` copy) is not settings; `.peer-revision` is.
    if (relative.split("/").at(-1)?.startsWith(".") === true && relative !== ".peer-revision") {
      continue;
    }
    const inFolder = FOLDER_FILE.exec(relative);
    const name = options.loose && !path.includes("/") ? LOOSE_YAML.exec(relative)?.[1] : undefined;
    if (/^workspace\.ya?ml$/.test(relative)) {
      wanted.set("workspace.yaml", entry);
    } else if (relative === ".peer-revision") {
      wanted.set(".peer-revision", entry);
    } else if (inFolder !== null) {
      const id = inFolder[2]!;
      if (!ID.test(id)) return { ok: false, problem: notAnId(relative) };
      const key = `${inFolder[1]}/${id}.yaml`;
      if (wanted.has(key)) return { ok: false, problem: `There are two files for ${key}.` };
      wanted.set(key, entry);
    } else if (name !== undefined) {
      if (!ID.test(name)) return { ok: false, problem: notAnId(relative) };
      unsorted.push({ name, entry });
    } else {
      continue;
    }
    size += entry.size;
  }
  if (size > MAX_BYTES) return { ok: false, problem: TOO_LARGE };

  const texts = new Map<string, string>();
  for (const [key, entry] of wanted) texts.set(key, await entry.text());
  for (const { name, entry } of unsorted) {
    const text = await entry.text();
    const key = `${sniffFolder(text)}/${name}.yaml`;
    if (texts.has(key)) return { ok: false, problem: `There are two files for ${key}.` };
    texts.set(key, text);
  }
  if ([...texts.values()].reduce((sum, text) => sum + text.length, 0) > MAX_BYTES) {
    return { ok: false, problem: TOO_LARGE };
  }

  const files = Object.fromEntries([...texts].toSorted(([a], [b]) => a.localeCompare(b)));
  return {
    ok: true,
    files,
    base: revisionOf(files[".peer-revision"]),
    summary: importSummary(files),
  };
}

/**
 * What a person picked, read: one .zip is opened, anything else is taken as the files it is. A
 * file that cannot be read says so instead of failing the page.
 */
export async function readImport(sources: ReadonlyArray<ImportSource>): Promise<ImportRead> {
  const only = sources.length === 1 ? sources[0] : undefined;
  try {
    if (only !== undefined && /\.zip$/i.test(only.path)) {
      let entries: ReadonlyArray<ImportEntry>;
      try {
        entries = await readArchive(await only.bytes());
      } catch {
        return { ok: false, problem: `${only.path} could not be opened as a .zip.` };
      }
      return await arrangeImport(entries);
    }
    return await arrangeImport(sources, { loose: true });
  } catch (cause) {
    return {
      ok: false,
      problem:
        cause instanceof Error
          ? `The files could not be read: ${cause.message}`
          : "The files could not be read.",
    };
  }
}

/** What the review says the files are, and what that means for what they change. */
export function importContext(read: ImportFiles): string {
  return read.base === undefined
    ? `Importing ${read.summary}. They carry no revision, so every difference from the current settings is a change, including what was saved since they were made.`
    : `Importing ${read.summary}, which start from revision ${read.base}. What was saved after it stays unless the files change it too.`;
}
