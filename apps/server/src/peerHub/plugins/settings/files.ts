/**
 * The settings as YAML files, in the layout `peerhub workspace apply` reads: `workspace.yaml`, then
 * `projects/` and `tools/` with a file for each id. `settingsFiles` lays a visible document out that
 * way for an agent.
 *
 * @module peerHub/plugins/settings/files
 */
import { PeerHubError } from "@t3tools/contracts";
import { parse, stringify } from "yaml";

import { block } from "../../peerText.ts";

const DIRECTORIES = ["projects", "tools"] as const;
/** What `workspace.yaml` holds of the configuration; the workspace's name and domains are its own. */
export const WORKSPACE_KEYS = ["currency", "people"] as const;

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/** An empty mapping: a section that holds nothing. */
export const isEmpty = (value: unknown) => isMapping(value) && Object.keys(value).length === 0;

/**
 * `workspace.yaml` when the document holds any of its settings, then each id's file. An empty
 * section is left out.
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
