import { useState } from "react";
import { Pressable, View } from "react-native";
import type { PeerProjectState, PeerWorkspaceState } from "@t3tools/contracts";
import {
  announcementAuthor,
  announcementTiming,
  recentAnnouncements,
  receiptCounts,
  mayWithdrawAnnouncement,
  mayManageAnnouncementCredentials,
} from "@t3tools/client-runtime/peer/announcements";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../../components/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { PeerSectionProps } from "../slotTypes";
import { announcementAtoms } from "./atoms";
import { NotifyAgentsForm } from "./NotifyAgentsForm";
import { AnnouncementReceiptsList } from "./AnnouncementReceiptsList";
import { AnnouncementCredentialsList } from "./AnnouncementCredentialsList";
export function PeerAnnouncements(props: PeerSectionProps) {
  return props.status.workspaces.flatMap((workspace) =>
    props.status.announcements?.unsupported.includes(workspace.slug)
      ? []
      : workspace.projects.map((project) => (
          <ProjectAnnouncements
            key={`${workspace.slug}/${project.project.id}`}
            {...props}
            workspace={workspace}
            project={project}
          />
        )),
  );
}
function ProjectAnnouncements({
  environmentId,
  status,
  workspace,
  project,
}: PeerSectionProps & {
  readonly workspace: PeerWorkspaceState;
  readonly project: PeerProjectState;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = { workspace: workspace.slug, project: project.project.id };
  const summary = status.announcements?.projects.find(
    (p) => p.workspace === input.workspace && p.project === input.project,
  );
  const query = useEnvironmentQuery(
    open ? announcementAtoms.list({ environmentId, input: { ...input, rev: summary?.rev } }) : null,
  );
  const withdraw = useAtomCommand(announcementAtoms.withdraw, { reportFailure: false });
  async function remove(id: string) {
    setBusy(true);
    try {
      const result = await withdraw({ environmentId, input: { ...input, id } });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        setMessage(failure instanceof Error ? failure.message : String(failure));
      } else {
        setMessage("Announcement withdrawn.");
        query.refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  const tasks = project.work.tasks;
  return (
    <SettingsSection title={`Announcements · ${project.project.name}`}>
      <View className="gap-3 p-4">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          className="py-2"
        >
          <Text className="text-primary">
            {open
              ? "Hide announcements"
              : `Notify agents${summary?.active ? ` · ${summary.active} active` : ""}`}
          </Text>
        </Pressable>
        {open ? (
          <>
            <NotifyAgentsForm
              environmentId={environmentId}
              status={status}
              {...input}
              tasks={tasks}
              onPosted={query.refresh}
            />
            <Text className="font-t3-medium text-foreground">Active and recent announcements</Text>
            {query.error ? (
              <Text accessibilityRole="alert" className="text-foreground">
                {query.error}
              </Text>
            ) : null}
            <Pressable accessibilityRole="button" onPress={query.refresh}>
              <Text className="text-primary">Refresh</Text>
            </Pressable>
            {recentAnnouncements(query.data?.announcements ?? []).map((row) => (
              <View key={row.id} className="gap-2 border-t border-border pt-3">
                <Text className="text-foreground">{row.text}</Text>
                <Text className="text-sm text-foreground-muted">
                  {announcementAuthor(row.author)} ·{" "}
                  {row.task
                    ? `Task: ${tasks.find((t) => t.id === row.task)?.title ?? row.task}`
                    : "Whole project"}{" "}
                  · {row.status ?? "active"} · {announcementTiming(row, query.data!.at)}
                </Text>
                <Text className="text-sm text-foreground-muted">{receiptCounts(row.counts)}</Text>
                <View className="flex-row gap-4">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expanded === row.id }}
                    onPress={() => setExpanded(expanded === row.id ? null : row.id)}
                  >
                    <Text className="text-primary">
                      {expanded === row.id ? "Hide receipts" : "Receipts"}
                    </Text>
                  </Pressable>
                  {row.status !== "withdrawn" &&
                  row.status !== "expired" &&
                  mayWithdrawAnnouncement(
                    row.author,
                    status.email ?? "",
                    project.project.role,
                    workspace.role,
                  ) ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void remove(row.id)}
                    >
                      <Text className="text-primary">Withdraw</Text>
                    </Pressable>
                  ) : null}
                </View>
                {expanded === row.id ? (
                  <AnnouncementReceiptsList
                    environmentId={environmentId}
                    {...input}
                    id={row.id}
                    status={row.status ?? "active"}
                  />
                ) : null}
              </View>
            ))}
            {query.data?.announcements.length === 0 ? (
              <Text className="text-foreground-muted">No recent announcements.</Text>
            ) : null}
            {message ? (
              <Text accessibilityRole="alert" className="text-foreground">
                {message}
              </Text>
            ) : null}
            {mayManageAnnouncementCredentials(project.project.role, workspace.role) ? (
              <AnnouncementCredentialsList environmentId={environmentId} {...input} />
            ) : null}
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}
