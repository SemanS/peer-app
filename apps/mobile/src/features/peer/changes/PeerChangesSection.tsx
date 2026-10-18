import type { PeerHubStatus } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import { useMinuteClock } from "../ownership/useMinuteClock";
import type { PeerSectionProps } from "../slotTypes";
import { TONE_DOT, TONE_SURFACE } from "../work/signals";
import {
  CHANGES_WORDS,
  changesHeading,
  changesProjects,
  phoneChangesModel,
  waitsHeading,
  type ChangesProject,
  type PhoneChangeRow,
  type PhoneWait,
} from "./changes.logic";
import { ReviewDiffPanel } from "./ReviewDiffPanel";
import { useChangesView } from "./useChangesView";

function ChangeRow({ row }: { readonly row: PhoneChangeRow }) {
  return (
    <View
      accessible
      accessibilityLabel={`${row.title}, ${row.line}`}
      className="min-h-14 flex-row items-start gap-2.5 px-3 py-2.5"
    >
      <Text className="mt-0.5 font-mono text-xs text-foreground-muted">
        <Text className="font-mono text-xs text-foreground">{row.idPre}</Text>
        {row.idRest}
      </Text>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text selectable className="text-sm font-t3-medium">
          {row.title}
        </Text>
        <Text selectable className="text-xs text-foreground-muted">
          {row.line}
        </Text>
      </View>
    </View>
  );
}

function Wait({
  wait,
  open,
  onToggle,
  children,
}: {
  readonly wait: PhoneWait;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <View className="gap-2 px-3 py-2.5">
      <View className="flex-row items-center gap-2.5">
        <View className={cn("size-2 rounded-full", TONE_DOT.needs)} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-sm font-t3-medium">{wait.text}</Text>
          {wait.detail === null ? null : (
            <Text selectable className="text-xs text-foreground-muted">
              {wait.detail}
            </Text>
          )}
        </View>
        {wait.canReview ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${open ? CHANGES_WORDS.hideReview : CHANGES_WORDS.review}: ${wait.text}`}
            accessibilityState={{ expanded: open }}
            onPress={onToggle}
            className="h-11 min-w-16 items-center justify-center rounded-xl border border-border bg-subtle px-4"
          >
            <Text className="font-t3-medium text-foreground">
              {open ? CHANGES_WORDS.hideReview : CHANGES_WORDS.review}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {open ? children : null}
    </View>
  );
}

function ProjectChanges({
  environmentId,
  status,
  project,
}: {
  readonly environmentId: PeerSectionProps["environmentId"];
  readonly status: PeerHubStatus;
  readonly project: ChangesProject;
}) {
  const now = useMinuteClock();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const { view, error, refresh } = useChangesView({
    environmentId,
    workspace: project.workspace,
    project: project.projectId,
    // A jj problem is the answer before any view: nothing is read until it is fixed.
    enabled: status.jujutsu?.problem === undefined,
  });
  const model = phoneChangesModel({ status, project, view, error, now });
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="px-1 text-base font-t3-medium" numberOfLines={1}>
        {changesHeading(status, project)}
      </Text>
      {model.kind === "jj" ? (
        <View className="gap-1 rounded-xl border border-border bg-card p-3">
          <Text className="text-xs font-t3-medium text-foreground-muted">{model.note.word}</Text>
          <Text className="text-sm font-t3-medium">{model.note.title}</Text>
          <Text className="text-sm text-foreground-muted">{model.note.body}</Text>
          <Text selectable className="font-mono text-sm">
            {model.note.fix}
          </Text>
        </View>
      ) : null}
      {model.kind === "hubOlder" || model.kind === "loading" || model.kind === "empty" ? (
        <View className="gap-1 px-1">
          <Text className="text-sm font-t3-medium">{model.title}</Text>
          <Text className="text-sm text-foreground-muted">{model.body}</Text>
        </View>
      ) : null}
      {model.kind === "readFailed" || model.kind === "failed" ? (
        <View className="gap-1 px-1">
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {model.kind === "failed" ? model.title : model.message}
          </Text>
          {model.kind === "failed" ? (
            <>
              <Text selectable className="text-sm text-foreground-muted">
                {model.message}
              </Text>
              <Text className="text-sm text-foreground-muted">{model.footnote}</Text>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={refresh}
              className="min-h-11 justify-center"
            >
              <Text className="text-primary">{CHANGES_WORDS.retry}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      {model.kind === "ready" ? (
        <>
          <Text className="px-1 text-xs text-foreground-muted">{model.summary}</Text>
          {model.waits.length === 0 ? null : (
            <View className="gap-2">
              <Text accessibilityRole="header" className="px-1 text-sm font-t3-medium">
                {waitsHeading(model.waits.length)}
              </Text>
              <View className={cn("overflow-hidden rounded-xl border", TONE_SURFACE.needs)}>
                {model.waits.map((wait) => (
                  <Wait
                    key={`${wait.kind}:${wait.changeId}`}
                    wait={wait}
                    open={reviewing === wait.changeId}
                    onToggle={() =>
                      setReviewing((current) => (current === wait.changeId ? null : wait.changeId))
                    }
                  >
                    <ReviewDiffPanel
                      environmentId={environmentId}
                      input={{
                        workspace: project.workspace,
                        project: project.projectId,
                        changeId: wait.changeId,
                        mode: wait.diffMode,
                      }}
                    />
                  </Wait>
                ))}
              </View>
            </View>
          )}
          <View className="gap-2">
            <Text accessibilityRole="header" className="px-1 text-sm font-t3-medium">
              {model.inFlightHeading}
            </Text>
            <View className="overflow-hidden rounded-xl border border-border bg-card">
              {model.rows.map((row, index) => (
                <View key={row.changeId} className={cn(index > 0 && "border-t border-border")}>
                  <ChangeRow row={row} />
                </View>
              ))}
            </View>
          </View>
          {model.twoVersions.map((two) => (
            <View key={two.changeId} className="gap-0.5 px-1">
              <Text className="text-sm font-t3-medium">{two.title}</Text>
              <Text selectable className="font-mono text-xs text-foreground-muted">
                {two.versionIds.join(" · ")}
              </Text>
              <Text className="text-xs text-foreground-muted">{CHANGES_WORDS.twoVersionsNote}</Text>
            </View>
          ))}
          {model.problems.map((problem) => (
            <Text
              key={problem.workspace}
              selectable
              className="px-1 text-xs text-danger-foreground"
            >
              {`jj failed in ${problem.workspace}: ${problem.message}`}
            </Text>
          ))}
        </>
      ) : null}
      <Text className="px-1 text-xs text-foreground-muted">{CHANGES_WORDS.readOnly}</Text>
    </View>
  );
}

/**
 * The Changes section of each project that has changes, read-only: what waits for the person, then
 * the changes in flight with their state. Undo, resolve and converge run on the computer that holds
 * the change, and conflicts between changes are on the integration preview, which the section says.
 */
export function PeerChangesSection({ environmentId, status }: PeerSectionProps) {
  const projects = useMemo(() => changesProjects(status), [status]);
  if (projects.length === 0) return null;
  return (
    <View className="gap-8">
      {projects.map((project) => (
        <ProjectChanges
          key={`${project.workspace}/${project.projectId}`}
          environmentId={environmentId}
          status={status}
          project={project}
        />
      ))}
    </View>
  );
}
