/**
 * The Hub's task routes: creating, moving and deleting a task, and who owns which task. Split from
 * `hubApi.ts` as `accessApi.ts` and `coordApi.ts` are.
 *
 * @module peerHub/core/hub/workApi
 */
import {
  PeerOwnershipView,
  PeerTask,
  PeerTaskOwner,
  type PeerHubCreateTaskInput,
  type PeerHubUpdateTaskInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { HubCall } from "./hubApi.ts";

const Ok = Schema.Struct({});
/** What `PUT …/tasks/{task}/owner` answers. */
const OwnerSet = Schema.Struct({
  task: Schema.String,
  owner: Schema.NullOr(PeerTaskOwner),
  changed: Schema.Boolean,
  replayed: Schema.optional(Schema.Boolean),
});
/** The owner a refusal to take a task names, in its details; older Hubs name none. */
const decodeOwnerDetails = Schema.decodeUnknownOption(Schema.Struct({ owner: Schema.String }));
/** What the Hub says when it did not move an agent's task because a change of its session waits for an owner's call. */
const OwnerCallNeeded = Schema.Struct({ owner: Schema.String, paths: Schema.Array(Schema.String) });
export type OwnerCallNeeded = typeof OwnerCallNeeded.Type;
const decodeOwnerCallNeeded = Schema.decodeUnknownOption(OwnerCallNeeded);

const segment = (value: string) => encodeURIComponent(value);

/** The tree's fields of a task as the Hub's routes take them (`PeerTask`). */
type TreeFields = Pick<
  PeerHubCreateTaskInput,
  "parent" | "kind" | "executable" | "unsettled" | "position" | "description"
>;
/** What `PATCH …/tasks/{task}/dependencies` answers. */
const DependenciesChanged = Schema.Struct({
  task: Schema.String,
  dependsOn: Schema.Array(Schema.String),
  changed: Schema.Boolean,
});

export const workApi = (
  request: HubCall,
  workspacePath: (slug: string, rest?: string) => string,
  projectPath: (slug: string, projectId: string, rest: string) => string,
) => ({
  createTask: (
    hubUrl: string,
    session: string,
    slug: string,
    projectId: string,
    body: TreeFields & {
      readonly title: string;
      readonly key?: string;
      readonly area?: string;
      readonly source?: PeerHubCreateTaskInput["source"];
    },
  ) =>
    request(PeerTask, {
      hubUrl,
      path: projectPath(slug, projectId, "/tasks"),
      method: "POST",
      session,
      body,
    }),

  updateTask: (
    hubUrl: string,
    session: string,
    slug: string,
    projectId: string,
    taskId: string,
    body: TreeFields & {
      readonly title?: string | undefined;
      readonly area?: string | undefined;
      readonly source?: PeerHubUpdateTaskInput["source"];
      readonly status?: "open" | "review" | "done" | undefined;
      readonly session?: string;
      readonly environment?: string;
      readonly op?: string;
    },
  ) =>
    request(PeerTask, {
      hubUrl,
      path: projectPath(slug, projectId, `/tasks/${segment(taskId)}`),
      method: "PATCH",
      session,
      body,
      // An agent's move that waits for an owner's call is told whose and for which paths, not failed.
      conflict: (code, details) =>
        body.session === undefined || code !== "owner_call_needed"
          ? undefined
          : Option.getOrUndefined(
              Option.map(decodeOwnerCallNeeded(details), (needed) => ({
                ownerCallNeeded: needed,
              })),
            ),
    }),

  deleteTask: (hubUrl: string, session: string, slug: string, projectId: string, taskId: string) =>
    request(Ok, {
      hubUrl,
      path: projectPath(slug, projectId, `/tasks/${segment(taskId)}`),
      method: "DELETE",
      session,
    }),

  /**
   * Adds to what a task depends on (the dependencies feature); null when this Hub does not serve
   * it, so an importer says so and goes on.
   */
  dependencies: (
    hubUrl: string,
    session: string,
    slug: string,
    projectId: string,
    taskId: string,
    body: { readonly add: ReadonlyArray<string> },
  ) =>
    request(DependenciesChanged, {
      hubUrl,
      path: projectPath(slug, projectId, `/tasks/${segment(taskId)}/dependencies`),
      method: "PATCH",
      session,
      body: { add: body.add, remove: [] },
      unsupported: {
        value: null,
        when: (_status: number, message: string) => message === "no such route",
      },
    }),

  /** The owner of each task of the caller's projects (the ownership feature's view). */
  taskOwners: (hubUrl: string, session: string, slug: string) =>
    request(PeerOwnershipView, { hubUrl, path: workspacePath(slug, "/ownership"), session }),

  /**
   * Makes `owner` (the caller) the owner of a task nobody owns. A refusal that names who owns it
   * answers `{ ownedBy }`; any other refusal fails with the Hub's words.
   */
  takeTask: (
    hubUrl: string,
    session: string,
    slug: string,
    projectId: string,
    taskId: string,
    body: { readonly owner: string; readonly op?: string },
  ) => {
    const owned = (_status: number, _code: string, details: unknown) =>
      Option.getOrUndefined(
        Option.map(decodeOwnerDetails(details), ({ owner }) => ({ ownedBy: owner })),
      );
    return request(OwnerSet, {
      hubUrl,
      path: projectPath(slug, projectId, `/tasks/${segment(taskId)}/owner`),
      method: "PUT",
      session,
      body,
      rejected: owned,
      conflict: (code, details) => owned(409, code, details),
    });
  },
});
