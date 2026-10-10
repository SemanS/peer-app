import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import * as Cause from "effect/Cause";
import { useEffect, useMemo, useState } from "react";
import {
  deriveNeedsYou,
  needsYouTickNeeded,
  type NeedsYouEnvironment,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import type { PeerHubStatus } from "@t3tools/contracts";
import { workspaceConnections } from "../../../state/workspace";
import { useNavigationThreadShells } from "../../../state/entities";
import { serverEnvironment } from "../../../state/server";
import { threadHasUnseenCompletion } from "../../threads/threadListV2";

const last = new Map<string, PeerHubStatus>();
const environmentsAtom = Atom.make((get) => {
  const known = get(workspaceConnections.environmentsAtom);
  const ids = new Set(known.map((environment) => String(environment.environmentId)));
  for (const id of last.keys()) if (!ids.has(id)) last.delete(id);
  const errors: Array<{ environmentId: string; message: string }> = [];
  const environments = known.map((environment) => {
    const result = get(
      serverEnvironment.peerHubLive({
        environmentId: environment.environmentId,
        input: { scope: "needs-you" },
      }),
    );
    const value = Option.getOrNull(AsyncResult.value(result));
    if (value) last.set(environment.environmentId, value);
    let cached = value ?? last.get(environment.environmentId) ?? null;
    if (result._tag === "Failure") {
      const cause = Cause.squash(result.cause),
        message =
          cause instanceof Error ? cause.message : "Could not read Peer status on this computer.";
      errors.push({ environmentId: environment.environmentId, message });
      if (cached) cached = { ...cached, error: message };
    }
    return {
      environmentId: environment.environmentId,
      label: environment.environmentLabel,
      connected: environment.connectionState === "connected",
      status: cached,
      threads: [],
    } satisfies NeedsYouEnvironment;
  });
  return { environments, errors, observedAt: Date.now() };
});
/** Each known computer with its last Needs you status, without deriving the list: for Home rows. */
export function useNeedsYouEnvironments(): ReadonlyArray<NeedsYouEnvironment> {
  return useAtomValue(environmentsAtom).environments;
}

/** The shared atom owns one scoped subscription per known computer, retaining its last snapshot. */
export function useNeedsYou() {
  const snapshot = useAtomValue(environmentsAtom),
    environments = snapshot.environments;
  const threads = useNavigationThreadShells();
  const [clock, setClock] = useState(Date.now),
    now = Math.max(clock, snapshot.observedAt);
  const tick = needsYouTickNeeded(environments, now);
  useEffect(() => {
    if (!tick) return;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [tick]);
  const [memoize] = useState(() => {
    let known = new Map<string, NeedsYouItem>();
    return (derived: ReadonlyArray<NeedsYouItem>) => {
      const next = new Map<string, NeedsYouItem>();
      const result = derived.map((item) => {
        const old = known.get(item.key);
        const value = old && JSON.stringify(old) === JSON.stringify(item) ? old : item;
        next.set(item.key, value);
        return value;
      });
      known = next;
      return result;
    };
  });
  const items = useMemo(
    () =>
      memoize(
        deriveNeedsYou({
          environments: environments.map((environment) => ({ ...environment, threads })),
          now,
          unseen: threadHasUnseenCompletion,
        }),
      ),
    [environments, threads, now, memoize],
  );
  return {
    items,
    errors: snapshot.errors,
    environments,
    now,
    connected: environments.some((environment) => environment.connected),
    loaded: environments.every(
      (environment) => !environment.connected || environment.status !== null,
    ),
  };
}
