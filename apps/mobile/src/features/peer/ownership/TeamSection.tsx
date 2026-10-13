import type { TeamView } from "@t3tools/client-runtime/peer/ownership";
import { useMemo } from "react";
import { ScrollView, View } from "react-native";

import { AppText } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import type { PeerSectionProps } from "../slotTypes";
import { TONE_DOT, TONE_SURFACE } from "../work/signals";
import { PersonMark } from "./PersonMark";
import {
  TEAM_WORDS,
  teamAreaRows,
  teamHeading,
  teamPeople,
  teamProjects,
  teamSignalRows,
  type TeamAreaRow,
  type TeamPersonCard,
  type TeamSignalRow,
} from "./team.logic";
import { useMinuteClock } from "./useMinuteClock";

/** The people of the project, each with their agents and what waits on them. */
function PeopleStrip({ people }: { readonly people: ReadonlyArray<TeamPersonCard> }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2"
      accessibilityLabel="People on the project"
    >
      {people.map((person) => (
        <View
          key={person.key}
          accessible
          accessibilityRole="summary"
          accessibilityLabel={person.label}
          className="w-28 gap-1.5 rounded-xl border border-border bg-card p-2.5"
        >
          <PersonMark name={person.name} colorKey={person.key} />
          <AppText className="text-xs font-t3-medium" numberOfLines={1}>
            {person.name}
          </AppText>
          <AppText className="text-2xs text-foreground-muted">{person.agents}</AppText>
          <AppText
            className={cn(
              "text-2xs font-t3-medium",
              person.needsThem ? "text-warning-foreground" : "text-foreground-muted",
            )}
          >
            {person.waiting}
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}

/** What needs a person, in the amber of what waits on someone, or that nothing does. */
function Signals({ rows }: { readonly rows: ReadonlyArray<TeamSignalRow> }) {
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="px-1 text-base font-t3-medium">
        {TEAM_WORDS.signals}
      </AppText>
      {rows.length === 0 ? (
        <AppText className="px-1 text-sm text-foreground-muted">{TEAM_WORDS.nothingWaits}</AppText>
      ) : (
        <View className={cn("overflow-hidden rounded-xl border", TONE_SURFACE.needs)}>
          {rows.map((row, index) => (
            <View
              key={row.key}
              accessible
              accessibilityLabel={`${row.what}, ${row.detail}`}
              className={cn(
                "min-h-14 flex-row items-start gap-2.5 px-3 py-2.5",
                index > 0 && "border-t border-warning-border",
              )}
            >
              <View className={cn("mt-1.5 size-2 rounded-full", TONE_DOT.needs)} />
              <View className="min-w-0 flex-1 gap-0.5">
                <AppText className="text-sm font-t3-medium">{row.what}</AppText>
                <AppText className="text-xs text-foreground-muted">{row.detail}</AppText>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** The project's areas with their owners; the owners change on a computer. */
function Areas({ rows }: { readonly rows: ReadonlyArray<TeamAreaRow> }) {
  return (
    <View className="gap-2">
      <AppText accessibilityRole="header" className="px-1 text-base font-t3-medium">
        {TEAM_WORDS.areas}
      </AppText>
      <View className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((row, index) => (
          <View
            key={row.key}
            accessible
            accessibilityLabel={row.label}
            className={cn(
              "min-h-13 flex-row items-center gap-2.5 px-3 py-2",
              index > 0 && "border-t border-border",
            )}
          >
            <View className="min-w-0 flex-1">
              <AppText className="text-sm font-t3-medium">{row.name}</AppText>
              <AppText className="text-xs text-foreground-muted">{row.tasks}</AppText>
            </View>
            <AppText className="text-sm">{row.owner}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function TeamProject({ view, heading }: { readonly view: TeamView; readonly heading: string }) {
  return (
    <View className="gap-5">
      <View className="gap-1">
        <AppText className="text-base font-t3-medium" numberOfLines={1}>
          {heading}
        </AppText>
        <AppText
          accessibilityRole="header"
          accessibilityLabel={`${TEAM_WORDS.title}, ${heading}`}
          className="text-xl font-t3-bold"
        >
          {TEAM_WORDS.title}
        </AppText>
        <AppText className="text-sm text-foreground-muted">{TEAM_WORDS.subtitle}</AppText>
      </View>
      {view.coordinationOff ? (
        <AppText className="rounded-xl border border-border bg-subtle p-3 text-sm text-foreground-muted">
          {TEAM_WORDS.coordinationOff}
        </AppText>
      ) : null}
      <PeopleStrip people={teamPeople(view)} />
      <Signals rows={teamSignalRows(view)} />
      <Areas rows={teamAreaRows(view)} />
    </View>
  );
}

/**
 * The Team section of a workspace, read-only: each of the computer's projects with its people, what
 * needs a person and its areas with their owners, as the Team page shows them on web. It states
 * facts about work and counts the chats it never names. The decisions that wait on the person are
 * decided in Needs you; owners change on a computer. With the plugin not active there is no
 * section: its status carries no ownership, and the registry leaves the plugin out.
 */
export function TeamSection({ status }: PeerSectionProps) {
  const now = useMinuteClock();
  const views = useMemo(() => teamProjects(status, now), [status, now]);
  if (views.length === 0) return null;
  return (
    <View className="gap-8">
      {views.map((view) => (
        <TeamProject
          key={`${view.workspace}/${view.project}`}
          view={view}
          heading={teamHeading(status, view)}
        />
      ))}
    </View>
  );
}
