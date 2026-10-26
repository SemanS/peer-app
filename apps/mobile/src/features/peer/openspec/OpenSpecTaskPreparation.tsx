import { openSpecGoal } from "@t3tools/client-runtime/peer/openspec";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { SettingsSection } from "../../settings/components/SettingsSection";
import type { TaskPreparationProps, TaskPreparationState } from "../slotTypes";
import { openSpecAtoms } from "./atoms";
import { BriefActions } from "./BriefActions";

function SourceSection({
  title,
  content,
  initiallyOpen = false,
}: {
  title: string;
  content: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View className="gap-2 border-t border-border pt-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        className="py-2"
      >
        <Text className="font-t3-medium text-foreground">
          {open ? "▾ " : "▸ "}
          {title}
        </Text>
      </Pressable>
      {open ? (
        <ScrollView className="max-h-64" nestedScrollEnabled>
          <Text selectable className="text-foreground">
            {content}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Read the selected computer's checkout; starting an agent remains the launcher's decision. */
export function OpenSpecTaskPreparation({
  environmentId,
  label,
  status,
  workspace,
  project,
  task,
  repositoryId,
  children,
}: TaskPreparationProps) {
  const selectedRepository =
    repositoryId ?? project.repositories.find((repository) => repository.state === "ready")?.id;
  const key = `${environmentId}/${status.email ?? ""}/${workspace}/${project.project.id}/${task.id}/${selectedRepository ?? ""}`;
  const [manualFor, setManualFor] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    status.email === null
      ? null
      : openSpecAtoms.read({
          environmentId,
          person: status.email,
          input: {
            workspace,
            projectId: project.project.id,
            taskId: task.id,
            ...(selectedRepository === undefined ? {} : { repositoryId: selectedRepository }),
          },
        }),
  );
  const ready = query.error === null && query.data?.state === "ready" ? query.data : null;
  const saved = query.error === null && query.data?.state === "brief" ? query.data : null;
  const reason =
    status.email === null
      ? "Sign in to read the task brief."
      : (query.error ?? (query.data?.state === "unavailable" ? query.data.reason : null));
  const state: TaskPreparationState =
    manualFor === key && selectedRepository !== undefined
      ? { state: "ready", prompt: "", repositoryId: selectedRepository }
      : query.isPending
        ? { state: "loading" }
        : reason !== null
          ? { state: "unavailable", reason }
          : ready !== null
            ? { state: "ready", prompt: ready.prompt, repositoryId: ready.repositoryId }
            : saved !== null
              ? { state: "ready", prompt: saved.prompt, repositoryId: saved.repositoryId }
              : { state: "loading" };
  return (
    <>
      <SettingsSection title="Task brief">
        <View className="gap-3 p-4">
          {ready !== null ? (
            <>
              <Text className="font-t3-medium text-foreground">OpenSpec · {ready.changeId}</Text>
              <Text className="text-sm text-foreground-muted">
                {ready.completed} of {ready.total} tasks complete
              </Text>
              <Text selectable className="text-foreground">
                {openSpecGoal(ready.proposal)}
              </Text>
              <SourceSection
                title="Source"
                content={`${label} · ${ready.repositoryId}\n${ready.sourcePath}`}
              />
              <SourceSection title="Full proposal" content={ready.proposal} />
              <SourceSection title="Checklist" content={ready.tasks} />
              {ready.design === null ? null : (
                <SourceSection title="Design" content={ready.design} initiallyOpen={false} />
              )}
            </>
          ) : saved !== null && saved.link.brief !== null ? (
            <>
              <Text className="text-sm text-foreground-muted">{saved.reason}</Text>
              <Text selectable className="text-foreground">
                {saved.link.brief.goal}
              </Text>
              <SourceSection
                title="Saved checklist"
                content={saved.link.brief.checklist
                  .map((item) => `${item.done ? "☑" : "☐"} ${item.text}`)
                  .join("\n")}
                initiallyOpen
              />
            </>
          ) : reason !== null ? (
            <Text accessibilityRole="alert" className="text-foreground-muted">
              {reason}
            </Text>
          ) : (
            <Text accessibilityLiveRegion="polite" className="text-foreground-muted">
              Reading the current OpenSpec change…
            </Text>
          )}
          {query.error === null && query.data ? (
            <BriefActions
              environmentId={environmentId}
              workspace={workspace}
              projectId={project.project.id}
              taskId={task.id}
              repositoryId={selectedRepository}
              data={query.data}
              onChanged={query.refresh}
            />
          ) : null}
          {manualFor === key ? (
            <Text className="text-sm text-foreground-muted">Manual prompt selected.</Text>
          ) : reason !== null && children !== undefined && selectedRepository !== undefined ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setManualFor(key)}
              className="py-2"
            >
              <Text className="text-primary">Write a prompt manually</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={query.isPending || status.email === null}
            onPress={query.refresh}
            className="py-2 disabled:opacity-50"
          >
            <Text className="text-primary">
              {query.isPending ? "Refreshing…" : "Refresh brief"}
            </Text>
          </Pressable>
        </View>
      </SettingsSection>
      {children?.(state)}
    </>
  );
}
