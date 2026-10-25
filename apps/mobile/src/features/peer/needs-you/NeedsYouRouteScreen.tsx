import type { StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { AppText } from "../../../components/ui/AppText";
import {
  focusItem,
  needsYouNotice,
  type NeedsYouItem,
} from "@t3tools/client-runtime/peer/needs-you";
import { useNeedsYou } from "./useNeedsYou";
import { NeedsYouScreen } from "./NeedsYouScreen";
import { NeedsYouCard } from "./NeedsYouCards";
import { NeedsYouRequestSheet } from "./NeedsYouRequestSheet";
export function NeedsYouRouteScreen({
  route,
}: StaticScreenProps<{ focus?: string; environment?: string }>) {
  const { items, errors, environments, connected, loaded } = useNeedsYou(),
    [request, setRequest] = useState<Extract<NeedsYouItem, { kind: "request" }> | null>(null);
  const focused = route.params?.focus ? focusItem(items, route.params.focus) : null;
  const target = route.params?.environment
    ? environments.find((environment) => environment.environmentId === route.params.environment)
    : undefined;
  const notice = needsYouNotice({
    focus: route.params?.focus,
    found: focused !== null,
    connected: route.params?.environment ? target?.connected === true : connected,
    loaded: route.params?.environment ? target?.status != null : loaded,
  });
  const accepted = new Map(
    environments.flatMap((environment) =>
      (environment.status?.signedIn ? (environment.status.requests ?? []) : [])
        .filter(
          (row) =>
            row.request.status === "accepted" &&
            row.request.recipient === environment.status?.email,
        )
        .map((row) => [`${row.workspace}/${row.request.id}`, row] as const),
    ),
  );
  return (
    <NeedsYouScreen title="Needs you">
      <AppText accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
        {items.length} {items.length === 1 ? "item" : "items"} need you.
      </AppText>
      {errors.map((error) => (
        <AppText key={error.environmentId} accessibilityRole="alert">
          {error.message}
        </AppText>
      ))}
      {notice ? <AppText accessibilityRole="alert">{notice}</AppText> : null}
      {environments.some(
        (environment) =>
          environment.connected && environment.status && !environment.status.signedIn,
      ) ? (
        <AppText className="text-sm text-foreground-muted">
          Connect Peer Hub on the computer to see team requests. Local coordination is available in
          Peer settings.
        </AppText>
      ) : null}
      {items.length === 0 && loaded && connected ? (
        <AppText>Nothing needs you right now.</AppText>
      ) : null}
      {items.map((item) => (
        <NeedsYouCard
          key={item.key}
          item={item}
          environments={environments}
          focused={item.key === focused?.key}
          onRequest={setRequest}
        />
      ))}
      {accepted.size > 0 ? (
        <>
          <AppText accessibilityRole="header" className="font-t3-medium">
            Recently accepted
          </AppText>
          <AppText className="text-sm text-foreground-muted">
            Acceptance takes ownership. Check the task and herdr before starting another agent.
          </AppText>
          {[...accepted].map(([key, row]) => (
            <AppText key={key}>
              {row.request.title} · {row.workspace}
            </AppText>
          ))}
        </>
      ) : null}
      {request ? (
        <NeedsYouRequestSheet key={request.key} item={request} onClose={() => setRequest(null)} />
      ) : null}
    </NeedsYouScreen>
  );
}
