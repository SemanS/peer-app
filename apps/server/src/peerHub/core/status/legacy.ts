/**
 * Where the status slices of plugins that existed before plugins go, and what those places read
 * while their plugin is inactive. The fields keep their shape for clients of every age, so these
 * places are frozen: plugins that came later get a field of their own instead
 * (`peerPluginStatusFields`), and nothing is ever added here.
 *
 * @module peerHub/core/status/legacy
 */
import {
  PeerAgentRequest,
  PeerCoordinationState,
  PeerGitHubState,
  PeerHubStatus,
  PeerProjectState,
  type PeerPluginId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { projectKey } from "../state/PeerState.ts";

/** One plugin's place in the status. */
export interface LegacyPlace {
  readonly plugin: PeerPluginId;
  /** The status with the plugin's slice in its place; a slice of another shape reads as neutral. */
  readonly place: (status: PeerHubStatus, slice: unknown) => PeerHubStatus;
  /** The status with the plugin's place at its neutral value. */
  readonly neutral: (status: PeerHubStatus) => PeerHubStatus;
}

const legacyPlace = <A, I>(
  plugin: PeerPluginId,
  schema: Schema.Codec<A, I>,
  neutral: A,
  set: (status: PeerHubStatus, value: A) => PeerHubStatus,
): LegacyPlace => {
  const isSlice = Schema.is(schema);
  return {
    plugin,
    place: (status, slice) => set(status, isSlice(slice) ? slice : neutral),
    neutral: (status) => set(status, neutral),
  };
};

const NO_SHARED_CAPACITY = { enabled: false, instanceIds: [] };

export const LEGACY_PLACES: ReadonlyArray<LegacyPlace> = [
  legacyPlace(
    "herdr",
    PeerHubStatus.fields.agents,
    { herdr: "not-running", list: [] },
    (status, agents) => ({ ...status, agents }),
  ),
  legacyPlace(
    "github",
    PeerGitHubState,
    { cli: false, account: null, signIn: null, error: null },
    (status, github) => ({ ...status, github }),
  ),
  // Keyed "workspace/project"; a project the slice does not name has shared capacity off.
  legacyPlace(
    "capacity",
    Schema.Record(Schema.String, PeerProjectState.fields.sharedCapacity),
    {},
    (status, capacity) => ({
      ...status,
      workspaces: status.workspaces.map((workspace) => ({
        ...workspace,
        projects: workspace.projects.map((project) => ({
          ...project,
          sharedCapacity:
            capacity[projectKey(workspace.slug, project.project.id)] ?? NO_SHARED_CAPACITY,
        })),
      })),
    }),
  ),
  legacyPlace(
    "requests",
    Schema.UndefinedOr(
      Schema.Array(Schema.Struct({ workspace: Schema.String, request: PeerAgentRequest })),
    ),
    [],
    (status, requests) => ({ ...status, requests }),
  ),
  legacyPlace("observe", Schema.Array(Schema.String), [], (status, sharedThreads) => ({
    ...status,
    sharedThreads,
  })),
  legacyPlace("knowledge", PeerCoordinationState.fields.candidates, [], (status, candidates) => ({
    ...status,
    coordination: { ...status.coordination, candidates },
  })),
];
