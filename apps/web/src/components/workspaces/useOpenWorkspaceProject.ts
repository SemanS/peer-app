import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  PeerHubStatus,
  PeerHubUseJujutsuInput,
  PeerProjectState,
  ProjectId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useEffect, useRef, useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { failureMessage } from "./WorkspaceAccess";
import { withFinally } from "~/lib/withFinally";

/** Where a workspace project stands on this computer. */
export interface ProjectCheckout {
  /** What it opens as here, once one of its repositories is checked out and opened. */
  readonly projectId: ProjectId | undefined;
  readonly cloning: boolean;
  /** A repository is not on this computer yet. */
  readonly missing: boolean;
  /** Why the last clone or open failed. */
  readonly errors: ReadonlyArray<string>;
  /**
   * Why a checkout is a jj repository Peer cannot work in (not colocated, jj missing or too old).
   * Such a checkout is neither missing nor a failed clone: cloning again would not fix it.
   */
  readonly unsupported: ReadonlyArray<string>;
  /** Every repository is such a checkout, so there is nothing to clone or open here. */
  readonly onlyUnsupported: boolean;
  /** Connecting GitHub, with an account that can open it, fixes a failure. */
  readonly gitHubSignIn: boolean;
}

export function projectCheckout(state: PeerProjectState): ProjectCheckout {
  const usable = state.repositories.filter((repo) => repo.unsupported !== true);
  return {
    projectId: state.repositories.find((repo) => repo.projectId !== undefined)?.projectId,
    cloning: usable.some((repo) => repo.state === "cloning"),
    missing: usable.some((repo) => repo.state === "missing" || repo.state === "error"),
    errors: usable.flatMap((repo) =>
      repo.state === "error" && repo.error !== undefined ? [repo.error] : [],
    ),
    unsupported: state.repositories.flatMap((repo) =>
      repo.unsupported === true
        ? [repo.error ?? "Peer cannot work in this Jujutsu repository."]
        : [],
    ),
    onlyUnsupported: state.repositories.length > 0 && usable.length === 0,
    gitHubSignIn: usable.some((repo) => repo.state === "error" && repo.gitHubSignIn === true),
  };
}

/** Puts a project's checkouts here on Jujutsu; a refusal arrives as a toast with its reason. */
export function useSwitchToJujutsu(environmentId: EnvironmentId) {
  const command = useAtomCommand(serverEnvironment.peerHubUseJujutsu, { reportFailure: false });
  const allowed = useAtomValue(serverEnvironment.peerHubUseJujutsu.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const switchTo = async (input: PeerHubUseJujutsuInput) => {
    setBusy(true);
    const message = failureMessage(await command({ environmentId, input }));
    setBusy(false);
    if (message !== null) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not switch to Jujutsu",
          description: message,
        }),
      );
    }
    return message === null;
  };
  return { allowed, busy, switchTo };
}

function projectState(status: PeerHubStatus, workspace: string, projectId: string) {
  return status.workspaces
    .find((w) => w.slug === workspace)
    ?.projects.find((p) => p.project.id === projectId);
}

/**
 * "Clone & open": clones a workspace project onto this computer when it is not
 * here yet, then opens a new thread in it. The hub command answers once the
 * clone is done, so a failure arrives with its reason.
 */
export function useOpenWorkspaceProject(target: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly projectId: string;
  readonly name: string;
}) {
  const { environmentId, workspace, projectId, name } = target;
  const openProject = useAtomCommand(serverEnvironment.peerHubOpenProject, {
    reportFailure: false,
  });
  const openNewThread = useNewThreadHandler();
  const projects = useProjects();
  const [busy, setBusy] = useState(false);
  // Opened on the server; the thread opens once this window lists the project.
  const [waitingFor, setWaitingFor] = useState<ProjectId | null>(null);
  const listed =
    waitingFor !== null &&
    projects.some((p) => p.environmentId === environmentId && p.id === waitingFor);
  const opening = useRef<ProjectId | null>(null);

  useEffect(() => {
    if (waitingFor === null || !listed || opening.current === waitingFor) return;
    opening.current = waitingFor;
    void openNewThread(scopeProjectRef(environmentId, waitingFor)).finally(() => {
      opening.current = null;
      setWaitingFor(null);
    });
  }, [environmentId, listed, openNewThread, waitingFor]);

  const fail = (description: string) =>
    toastManager.add(
      stackedThreadToast({ type: "error", title: `Could not open ${name}`, description }),
    );

  const open = async () => {
    setBusy(true);
    await withFinally(
      async () => {
        const result = await openProject({ environmentId, input: { workspace, projectId } });
        if (result._tag === "Failure") {
          const message = failureMessage(result);
          if (message !== null) fail(message);
          return;
        }
        const state = projectState(result.value, workspace, projectId);
        const checkout = state === undefined ? undefined : projectCheckout(state);
        if (checkout?.projectId !== undefined) setWaitingFor(checkout.projectId);
        if (checkout === undefined) fail(`${name} is no longer in your workspaces.`);
        else if (checkout.errors.length > 0) fail(checkout.errors.join(" "));
        else if (checkout.projectId === undefined && checkout.unsupported.length > 0)
          fail(checkout.unsupported.join(" "));
        else if (checkout.projectId === undefined) fail("None of its repositories opened here.");
      },
      () => {
        setBusy(false);
      },
    );
  };

  return { open, opening: busy || waitingFor !== null };
}
