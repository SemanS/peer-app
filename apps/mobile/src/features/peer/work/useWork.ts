import { useAtomValue } from "@effect/atom-react";
import { deriveNeedsYou } from "@t3tools/client-runtime/peer/needs-you";
import { resolveScope } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useMemo, useState } from "react";

import { useNavigationThreadShells } from "../../../state/entities";
import { serverEnvironment } from "../../../state/server";
import { workspaceConnections } from "../../../state/workspace";
import { threadHasUnseenCompletion } from "../../threads/threadListV2";
import { mergeWorkEnvironments, mobileWork, type WorkEnvironment } from "./work.logic";
import { useWorkScope } from "./workScope";

/** The last status each computer reported, kept while it is away and between visits. */
let last: ReadonlyMap<string, PeerHubStatus> = new Map();

/** One full Peer status subscription per known computer, held while the Work screen reads it. */
const workEnvironmentsAtom = Atom.make((get) => {
  const current = get(workspaceConnections.environmentsAtom).map((environment): WorkEnvironment => {
    const result = get(
      serverEnvironment.peerHubLive({ environmentId: environment.environmentId, input: {} }),
    );
    const cause = result._tag === "Failure" ? Cause.squash(result.cause) : null;
    return {
      environmentId: environment.environmentId,
      label: environment.environmentLabel,
      connected: environment.connectionState === "connected",
      status: Option.getOrNull(AsyncResult.value(result)),
      error:
        cause === null
          ? null
          : cause instanceof Error
            ? cause.message
            : "Could not read Peer status on this computer.",
    };
  });
  const merged = mergeWorkEnvironments(current, last);
  last = merged.last;
  return { environments: merged.environments, observedAt: Date.now() };
});

/**
 * The team's work over every computer the phone knows, as the Work screen shows it: the merged
 * tree, what waits on the person, each computer's state and the project the screen shows.
 */
export function useWork() {
  const { environments, observedAt } = useAtomValue(workEnvironmentsAtom);
  const threads = useNavigationThreadShells();
  const [clock, setClock] = useState(Date.now);
  // A colleague's thread shows as away once its computer stops reporting it, minutes later.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = Math.max(clock, observedAt);
  const work = useMemo(
    () => mobileWork({ environments, threads, now }),
    [environments, threads, now],
  );
  const needs = useMemo(
    () =>
      deriveNeedsYou({
        environments: environments.map((environment) => ({ ...environment, threads })),
        now,
        unseen: threadHasUnseenCompletion,
      }),
    [environments, threads, now],
  );
  const [storedScope, setScope] = useWorkScope();
  return {
    ...work,
    environments,
    needs,
    scope: resolveScope(storedScope, work.tree),
    setScope,
  };
}
