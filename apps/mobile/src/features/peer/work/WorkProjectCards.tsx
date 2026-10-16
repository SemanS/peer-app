import {
  ALL_PROJECTS,
  projectScopeKey,
  projectTaskCount,
  type ColumnCounts,
  type WorkProjectNode,
} from "@t3tools/client-runtime/peer/work";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import type { ProjectSignal } from "../slotTypes";
import { TONE_TEXT, TONE_TINT } from "./signals";
import { ToneChip, WorkProjectMark } from "./WorkMarks";

/** A project as the Work screen lists it: what its work adds up to, and its signals. */
export interface WorkProjectSummary {
  readonly project: WorkProjectNode;
  readonly counts: ColumnCounts;
  readonly signals: ReadonlyArray<ProjectSignal>;
}

/**
 * Which project the Work screen shows: all of them, or one, so the work of different projects
 * never mixes. The choice is the one web's project switcher makes.
 */
export function WorkScopePills({
  tree,
  scope,
  onChange,
}: {
  readonly tree: ReadonlyArray<WorkProjectNode>;
  readonly scope: string;
  readonly onChange: (scope: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2"
      accessibilityLabel="Choose the project Work shows"
    >
      <ScopePill
        label="All projects"
        selected={scope === ALL_PROJECTS}
        onPress={() => onChange(ALL_PROJECTS)}
      />
      {tree.map((project) => {
        const key = projectScopeKey(project);
        return (
          <ScopePill
            key={key}
            label={project.name}
            colorKey={key}
            selected={scope === key}
            onPress={() => onChange(key)}
          />
        );
      })}
    </ScrollView>
  );
}

function ScopePill({
  label,
  colorKey,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly colorKey?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-2 rounded-full border py-1.5 pr-3",
        colorKey === undefined ? "pl-3" : "pl-1.5",
        selected ? "border-primary bg-card" : "border-border bg-subtle",
      )}
    >
      {colorKey === undefined ? null : <WorkProjectMark name={label} colorKey={colorKey} small />}
      <AppText
        className={cn("text-sm", selected ? "font-t3-medium" : "text-foreground-muted")}
        numberOfLines={1}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/** What waits on the person, what works and what waits for review, as colored chips. */
function CountChips({ counts }: { readonly counts: ColumnCounts }) {
  const chips = [
    { key: "needs", tone: "needs", label: `${counts.needs} need you`, count: counts.needs },
    { key: "working", tone: "working", label: `${counts.working} working`, count: counts.working },
    {
      key: "review",
      tone: "delivery",
      label: `${counts.review} need review`,
      count: counts.review,
    },
  ] as const;
  return chips.some((chip) => chip.count > 0) ? (
    <View className="flex-row flex-wrap gap-1.5">
      {chips.map((chip) =>
        chip.count > 0 ? <ToneChip key={chip.key} tone={chip.tone} label={chip.label} /> : null,
      )}
    </View>
  ) : null;
}

/** The signals that count something, as chips in their colors. */
function SignalChips({ signals }: { readonly signals: ReadonlyArray<ProjectSignal> }) {
  const counting = signals.filter((signal) => signal.count !== null && signal.count > 0);
  return counting.length === 0 ? null : (
    <View className="flex-row flex-wrap gap-1.5">
      {counting.map((signal) => (
        <ToneChip
          key={signal.id}
          tone={signal.tone}
          icon={signal.icon}
          label={`${signal.label} · ${signal.count}`}
        />
      ))}
    </View>
  );
}

/**
 * One project: its mark, its tasks, how much of its work needs the person, works or waits for
 * review, and its signals. With `onPress` it is a card that scopes the screen to the project;
 * without, the head of that project's page.
 */
export function WorkProjectCard({
  summary,
  showWorkspace,
  onPress,
}: {
  readonly summary: WorkProjectSummary;
  readonly showWorkspace: boolean;
  readonly onPress?: () => void;
}) {
  const { project, counts, signals } = summary;
  const tasks = projectTaskCount(project);
  const content = (
    <>
      <View className="flex-row items-center gap-3">
        <WorkProjectMark name={project.name} colorKey={projectScopeKey(project)} />
        <View className="min-w-0 flex-1 gap-0.5">
          <AppText className="text-base font-t3-medium" numberOfLines={1}>
            {project.name}
          </AppText>
          <AppText className="text-sm text-foreground-muted" numberOfLines={1}>
            {showWorkspace ? `${project.workspaceName} · ` : ""}
            {tasks} {tasks === 1 ? "task" : "tasks"}
          </AppText>
        </View>
        {onPress === undefined ? null : (
          <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
        )}
      </View>
      <CountChips counts={counts} />
      <SignalChips signals={signals} />
    </>
  );
  return onPress === undefined ? (
    <View className="gap-2.5 rounded-xl border border-border bg-card p-4">{content}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Shows only this project's work"
      onPress={onPress}
      className="gap-2.5 rounded-xl border border-border bg-card p-4"
    >
      {content}
    </Pressable>
  );
}

/** Every project, as cards; opening one scopes the screen to it. */
export function WorkProjectCards({
  summaries,
  showWorkspace,
  onOpen,
}: {
  readonly summaries: ReadonlyArray<WorkProjectSummary>;
  readonly showWorkspace: boolean;
  readonly onOpen: (scope: string) => void;
}) {
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="px-1 text-sm font-t3-medium">
        Projects
      </AppText>
      {summaries.map((summary) => (
        <WorkProjectCard
          key={projectScopeKey(summary.project)}
          summary={summary}
          showWorkspace={showWorkspace}
          onPress={() => onOpen(projectScopeKey(summary.project))}
        />
      ))}
    </View>
  );
}

/**
 * What agents and the team say to each other on one project, a row per signal with what it says;
 * the pages behind them are on web and desktop.
 */
export function WorkSignalRows({ signals }: { readonly signals: ReadonlyArray<ProjectSignal> }) {
  if (signals.length === 0) return null;
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="px-1 text-sm font-t3-medium">
        Between agents & team
      </AppText>
      <View className="overflow-hidden rounded-xl border border-border bg-card">
        {signals.map((signal, index) => (
          <View
            key={signal.id}
            accessibilityLabel={[
              signal.label,
              signal.count === null ? null : String(signal.count),
              signal.detail,
            ]
              .filter((part) => part !== null)
              .join(", ")}
            className={cn(
              "flex-row items-center gap-3 px-4 py-3",
              index > 0 && "border-t border-border",
            )}
          >
            <SymbolView
              name={signal.icon}
              size={18}
              tintColorClassName={TONE_TINT[signal.tone]}
              type="monochrome"
            />
            <View className="min-w-0 flex-1 gap-0.5">
              <AppText className="text-sm font-t3-medium" numberOfLines={1}>
                {signal.label}
              </AppText>
              <AppText className="text-xs text-foreground-muted" numberOfLines={2}>
                {signal.detail}
              </AppText>
            </View>
            {signal.count === null ? null : (
              <AppText className={cn("text-sm font-t3-bold", TONE_TEXT[signal.tone])}>
                {signal.count}
              </AppText>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
