/**
 * The Hub's task routes: creating, moving and deleting a task. Split from `hubApi.ts` as
 * `accessApi.ts` and `coordApi.ts` are.
 *
 * @module peerHub/core/hub/workApi
 */
import {
  PeerTask,
  type PeerHubCreateTaskInput,
  type PeerHubUpdateTaskInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { HubCall } from "./hubApi.ts";

const Ok = Schema.Struct({});

const segment = (value: string) => encodeURIComponent(value);

/** The tree's fields of a task as the Hub's routes take them (`PeerTask`). */
type TreeFields = Pick<
  PeerHubCreateTaskInput,
  "parent" | "kind" | "executable" | "unsettled" | "position" | "description"
>;

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
    },
  ) =>
    request(PeerTask, {
      hubUrl,
      path: projectPath(slug, projectId, `/tasks/${segment(taskId)}`),
      method: "PATCH",
      session,
      body,
    }),

  deleteTask: (hubUrl: string, session: string, slug: string, projectId: string, taskId: string) =>
    request(Ok, {
      hubUrl,
      path: projectPath(slug, projectId, `/tasks/${segment(taskId)}`),
      method: "DELETE",
      session,
    }),
});
