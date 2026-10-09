import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { canPollAnnouncement, receiptLabel } from "@t3tools/client-runtime/peer/announcements";
import type { EnvironmentId } from "@t3tools/contracts";
import { AppText as Text } from "../../../components/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { announcementAtoms } from "./atoms";
export function AnnouncementReceiptsList({
  environmentId,
  workspace,
  project,
  id,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspace: string;
  readonly project: string;
  readonly id: string;
  readonly status: string;
}) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (value) =>
      setActive(value === "active"),
    );
    return () => subscription.remove();
  }, []);
  const visible = focused && active;
  const query = useEnvironmentQuery(
    visible ? announcementAtoms.detail({ environmentId, input: { workspace, project, id } }) : null,
  );
  const state = query.data?.status ?? status;
  useEffect(() => {
    if (!canPollAnnouncement(visible, state)) return;
    const timer = setInterval(query.refresh, 15000);
    return () => clearInterval(timer);
  }, [visible, state, query.refresh]);
  return (
    <View className="gap-1 border-t border-border pt-2">
      {query.error ? (
        <Text accessibilityRole="alert" className="text-foreground">
          {query.error}
        </Text>
      ) : null}
      {query.isPending && !query.data ? (
        <Text className="text-foreground-muted">Loading receipts…</Text>
      ) : null}
      {query.data?.audience.length === 0 ? (
        <Text className="text-foreground-muted">No live agents or receipts yet.</Text>
      ) : null}
      {query.data?.audience.map((row) => (
        <Text
          key={`${row.email}/${row.environment}/${row.session}`}
          className="text-sm text-foreground"
        >
          {row.email} · {row.agent ?? row.session} · {row.environment} · {receiptLabel(row.state)}
          {row.live ? "" : " · session ended"}
        </Text>
      ))}
    </View>
  );
}
