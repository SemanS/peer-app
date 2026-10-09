import { useEffect, useLayoutEffect } from "react";
import { AppState } from "react-native";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { EnvironmentId } from "@t3tools/contracts";
import { HEARTBEAT_MS } from "@t3tools/client-runtime/peer-digest";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import { serverEnvironment } from "../../../state/server";
import { useEnvironmentQuery } from "../../../state/query";
import { makeMobileVisits } from "./visitStore";
let storage:
  | { read: (email: string) => string | null; write: (email: string, value: string) => void }
  | undefined;
export const visits = makeMobileVisits({
  read: (email) => storage?.read(email) ?? null,
  write: (email, value) => storage?.write(email, value),
});
let users = 0,
  stop: (() => void) | undefined;
function activate(email: string) {
  const release = visits.activate(email, Date.now());
  users++;
  if (users === 1) {
    const subscription = AppState.addEventListener("change", (state) =>
      visits.signal(Date.now(), state !== "active"),
    );
    const timer = setInterval(() => {
      if (AppState.currentState === "active") visits.signal(Date.now());
    }, HEARTBEAT_MS);
    stop = () => {
      subscription.remove();
      clearInterval(timer);
    };
  }
  return () => {
    release();
    users--;
    if (users === 0) {
      stop?.();
      stop = undefined;
    }
  };
}
function EnvironmentVisit({
  environmentId,
  ready,
}: {
  environmentId: EnvironmentId;
  ready: boolean;
}) {
  const query = useEnvironmentQuery(serverEnvironment.peerHubLive({ environmentId, input: {} }));
  const status = query.data,
    email =
      ready && status?.signedIn && status.plugins?.some((p) => p.id === "digest" && p.active)
        ? status.email
        : null;
  useEffect(() => (email ? activate(email) : undefined), [email]);
  return null;
}
export function VisitsBackground({
  environmentIds,
}: {
  environmentIds: ReadonlyArray<EnvironmentId>;
}) {
  const preferences = useAtomValue(mobilePreferencesAtom),
    save = useAtomSet(updateMobilePreferencesAtom);
  useLayoutEffect(() => {
    storage = {
      read: (email) =>
        AsyncResult.isSuccess(preferences)
          ? (preferences.value.peerDigestVisits?.[email] ?? null)
          : null,
      write: (email, value) =>
        save({
          transform: (previous) => ({
            peerDigestVisits: { ...previous.peerDigestVisits, [email]: value },
          }),
        }),
    };
  }, [preferences, save]);
  useEffect(
    () => () => {
      storage = undefined;
    },
    [],
  );
  return environmentIds.map((environmentId) => (
    <EnvironmentVisit
      key={environmentId}
      environmentId={environmentId}
      ready={AsyncResult.isSuccess(preferences)}
    />
  ));
}
