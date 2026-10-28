/**
 * The Hub's task routes: creating, moving and deleting a task, and who owns which task. Split from
 * `hubApi.ts` as `accessApi.ts` and `coordApi.ts` are.
 *
 * @module peerHub/core/hub/workApi
 */
import { PeerOwnershipView, PeerTask, PeerTaskOwner } from "@t3tools/contracts";
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
    body: { readonly title: string; readonly key?: string; readonly area?: string },
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
    body: {
      readonly title?: string;
      readonly area?: string;
      readonly status?: "open" | "review" | "done";
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
