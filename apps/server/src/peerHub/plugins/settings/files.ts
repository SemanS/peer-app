/**
 * The settings as YAML files, in the layout the Hub exports and `peerhub workspace apply` reads:
 * `workspace.yaml`, then `projects/`, `tools/`, `capacity/` and `webhooks/` with a file for each
 * id. `settingsFiles` lays a visible document out that way for an agent; `bundleOf` reads such
 * files back into what the Hub imports.
 *
 * @module peerHub/plugins/settings/files
 */
import { PeerHubError } from "@t3tools/contracts";
import { parse, stringify } from "yaml";

import { block } from "../../peerText.ts";

const DIRECTORIES = ["projects", "tools", "capacity", "webhooks"] as const;
/** What `workspace.yaml` holds of the configuration; the workspace's name and domains are its own. */
export const WORKSPACE_KEYS = ["currency", "gateway", "knowledge", "people", "github"] as const;
const FILE = /^(projects|tools|capacity|webhooks)\/([a-z0-9][a-z0-9-]*)\.ya?ml$/;

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** An empty mapping: a section that holds nothing. */
export const isEmpty = (value: unknown) => isMapping(value) && Object.keys(value).length === 0;

/**
 * `workspace.yaml` when the document holds any of its settings, then each id's file. An empty
 * section is left out: the Hub shows a member that a gateway exists as `gateway: {}`, which is
 * nothing to read or to propose.
 */
export function settingsFiles(document: Readonly<Record<string, unknown>>) {
  const own = Object.fromEntries(
    WORKSPACE_KEYS.flatMap((key) =>
      key in document && !isEmpty(document[key]) ? [[key, document[key]] as const] : [],
    ),
  );
  return [
    ...(Object.keys(own).length === 0 ? [] : [{ path: "workspace.yaml", value: own as unknown }]),
    ...DIRECTORIES.flatMap((directory) => {
      const section = document[directory];
      return isMapping(section)
        ? Object.keys(section)
            .sort()
            .map((id) => ({ path: `${directory}/${id}.yaml`, value: section[id] }))
        : [];
    }),
  ];
}

/** A file's YAML as an agent reads it: what a teammate hid or made look like Peer's own is harmless. */
export const renderYaml = (value: unknown) => block(stringify(value, { lineWidth: 0 }), 1_000_000);

/** One YAML file as the mapping it holds (an empty file holds none); a refusal says what is wrong. */
export function readMapping(path: string, text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parse(text, { maxAliasCount: 20 });
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : "it is not YAML";
    throw new PeerHubError({ detail: `${path}: ${reason}`, refused: true });
  }
  if (value === null || value === undefined) return {};
  if (!isMapping(value)) {
    throw new PeerHubError({ detail: `${path} must hold one mapping.`, refused: true });
  }
  return value;
}

/**
 * What the Hub imports from exported files (path → text): `workspace.yaml` splits into the
 * workspace's own `settings` and the `config`, each directory into a map by id. A missing
 * directory is none of its kind, as for `peerhub workspace apply`, but for `webhooks/`: without
 * it the Hub keeps its webhooks. `base` is `given`, else `.peer-revision`'s (`<seq> <commit>`).
 */
export function bundleOf(files: Readonly<Record<string, string>>, given?: number) {
  if (files["workspace.yaml"] === undefined) {
    throw new PeerHubError({ detail: "The files have no workspace.yaml.", refused: true });
  }
  const { name, allowedDomains, ...rest } = readMapping("workspace.yaml", files["workspace.yaml"]);
  const sections: Record<string, Record<string, unknown>> = {};
  for (const path of Object.keys(files).sort()) {
    const match = FILE.exec(path);
    if (match !== null) (sections[match[1]!] ??= {})[match[2]!] = readMapping(path, files[path]!);
  }
  const seq = /^(\d+)\b/.exec(files[".peer-revision"] ?? "")?.[1];
  const settings: Record<string, unknown> = {};
  if (name !== undefined) settings.name = name;
  if (allowedDomains !== undefined) settings.allowedDomains = allowedDomains;
  const config: Record<string, unknown> = {
    ...rest,
    projects: sections.projects ?? {},
    tools: sections.tools ?? {},
    capacity: sections.capacity ?? {},
  };
  return {
    bundle: {
      settings,
      config,
      ...(sections.webhooks === undefined ? {} : { webhooks: sections.webhooks }),
    },
    base: given ?? (seq === undefined ? undefined : Number(seq)),
  };
}
