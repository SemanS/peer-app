/**
 * The ownership feature's Hub endpoints (the Hub's `ownership` feature): what a workspace's projects
 * hold, naming a task's owner, saving a project's owner map, and an owner's call (asking, deciding,
 * withdrawing it). They are called on the signed-in session; what a refusal means is for the caller.
 * A save of the owner map that someone else saved first is `conflict` carrying the map as it is saved
 * now, since the editor keeps the draft and compares; every other refusal fails as a `PeerHubError`.
 *
 * @module peerHub/plugins/ownership/client/hub
 */
import {
  PeerOwnerCall,
  PeerOwnerMap,
  PeerOwnershipAskResult,
  PeerOwnershipView,
  PeerTaskOwner,
  type PeerOwnershipAskInput,
  type PeerOwnershipSetMapInput,
  type PeerOwnershipSetMapResult,
  type PeerOwnershipSetTaskOwnerInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type * as PeerHubClient from "../../../core/hub/PeerHubClient.ts";

const OwnerSet = Schema.Struct({
  task: Schema.String,
  owner: Schema.NullOr(PeerTaskOwner),
  changed: Schema.Boolean,
  replayed: Schema.optional(Schema.Boolean),
});
const MapSaved = Schema.Struct({ map: PeerOwnerMap, changed: Schema.Boolean });
const CallAnswer = Schema.Struct({ call: PeerOwnerCall });
/** What `409 owner_map_changed` carries: the map as it is saved. */
const decodeSavedMap = Schema.decodeUnknownOption(Schema.Struct({ map: PeerOwnerMap }));

const segment = encodeURIComponent;
const projectPath = (project: string, rest: string) => `/projects/${segment(project)}${rest}`;

/** The endpoints, called on the signed-in session. */
export const ownershipHub = (client: PeerHubClient.PeerHubClient["Service"]) => ({
  /** Each of the caller's projects (or the one asked for: 404 when it is not theirs). */
  view: (workspace: string, project?: string) =>
    client.request(PeerOwnershipView, {
      workspace,
      path: project === undefined ? "/ownership" : `/ownership?project=${segment(project)}`,
    }),

  setTaskOwner: (input: PeerOwnershipSetTaskOwnerInput) =>
    client.request(OwnerSet, {
      workspace: input.workspace,
      path: projectPath(input.project, `/tasks/${segment(input.task)}/owner`),
      method: "PUT",
      body: { owner: input.owner, ...(input.op === undefined ? {} : { op: input.op }) },
    }),

  setMap: (input: PeerOwnershipSetMapInput) =>
    client
      .request(MapSaved, {
        workspace: input.workspace,
        path: projectPath(input.project, "/ownership"),
        method: "PUT",
        body: {
          version: input.version,
          areas: input.areas,
          paths: input.paths,
          decide: input.decide,
        },
        conflict: (code, details) =>
          code === "owner_map_changed"
            ? Option.getOrUndefined(
                Option.map(decodeSavedMap(details), ({ map }) => ({
                  kind: "conflict" as const,
                  map,
                })),
              )
            : undefined,
      })
      .pipe(
        Effect.map((answer): PeerOwnershipSetMapResult =>
          "kind" in answer ? answer : { kind: "saved", ...answer },
        ),
      ),

  /** One call per owner of the paths, or paths added to the call that waits for the same work. */
  ask: (workspace: string, project: string, input: PeerOwnershipAskInput) =>
    client.request(PeerOwnershipAskResult, {
      workspace,
      path: projectPath(project, "/owner-calls"),
      method: "POST",
      body: input,
    }),

  decide: (
    workspace: string,
    project: string,
    id: string,
    decision: "accept" | "decline",
    note?: string,
  ) =>
    client
      .request(CallAnswer, {
        workspace,
        path: projectPath(project, `/owner-calls/${segment(id)}/decide`),
        method: "POST",
        body: { decision, ...(note === undefined ? {} : { note }) },
      })
      .pipe(Effect.map(({ call }) => call)),

  /** The asking person, or the asking agent when it names its session and computer, takes a call back. */
  withdraw: (
    workspace: string,
    project: string,
    id: string,
    agent?: { readonly environment: string; readonly session: string },
  ) =>
    client
      .request(CallAnswer, {
        workspace,
        path: projectPath(project, `/owner-calls/${segment(id)}/withdraw`),
        method: "POST",
        body: agent ?? {},
      })
      .pipe(Effect.map(({ call }) => call)),
});
