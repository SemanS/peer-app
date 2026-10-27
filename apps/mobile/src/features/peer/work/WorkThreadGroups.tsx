import { needsYouCardCopy, personName, taskLabel } from "@t3tools/client-runtime/peer/needs-you";
import type { BoardCard, BoardColumn } from "@t3tools/client-runtime/peer/work";
import type { EnvironmentId, PeerHubStatus } from "@t3tools/contracts";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../../components/ui/AppText";
import { cn } from "../../../lib/cn";
import type { SignalTone } from "../slotTypes";
import { ownerCallLabels } from "../ownership/ownerCall.logic";
import { RoleMark } from "../roles/RoleMark";
import { threadRoleChip } from "../roles/roles.logic";
import { TONE_DOT, TONE_TEXT } from "./signals";
import { ToneChip } from "./WorkMarks";
import {
  workCardAction,
  type WorkCardAction,
  type WorkEnvironment,
  type WorkGroup,
} from "./work.logic";

/** The color of each column's state, as web's board draws it. */
const COLUMN_TONE: Readonly<Record<BoardColumn, SignalTone>> = {
  needs: "needs",
  working: "working",
  review: "delivery",
  idle: "neutral",
};

type ThreadCard = Extract<BoardCard, { readonly kind: "thread" }>;

/** The harness a thread's agent runs on, as people name it. */
function harnessName(card: ThreadCard): string | undefined {
  const { agent } = card.thread;
  const harness = agent !== undefined && "harness" in agent ? agent.harness : card.thread.harness;
  return harness === "claude" ? "Claude Code" : harness === "codex" ? "Codex" : harness;
}

/** The chips a thread's card carries, as web's board shows them. */
function threadChips(
  card: ThreadCard,
): ReadonlyArray<{ readonly tone: SignalTone; readonly label: string }> {
  const { thread } = card;
  return [
    ...(thread.mine && card.column === "needs"
      ? [
          {
            tone: "needs" as const,
            label:
              card.need === "approval"
                ? "Needs approval"
                : card.need === "input"
                  ? "Needs input"
                  : "Needs you",
          },
        ]
      : []),
    ...(card.waitingOn === undefined
      ? []
      : [{ tone: "needs" as const, label: `Waiting on ${card.waitingOn}` }]),
    ...(thread.concerns === undefined ? [] : [{ tone: "coordination" as const, label: "Overlap" }]),
    ...(thread.keepsContext ? [{ tone: "knowledge" as const, label: "Keeps task context" }] : []),
    ...(thread.observable
      ? [{ tone: "team" as const, label: thread.mine ? "Shared to watch" : "Watch live" }]
      : []),
    ...(thread.delivery === "review" ? [{ tone: "delivery" as const, label: "In review" }] : []),
    ...(thread.source === "herdr" ? [{ tone: "neutral" as const, label: "herdr" }] : []),
    ...(thread.stale ? [{ tone: "neutral" as const, label: "Away" }] : []),
  ];
}

/** What a card says, whatever it shows: its title, a line about it and its chips. */
function cardText(
  card: BoardCard,
  status: PeerHubStatus | null,
): {
  readonly title: string;
  readonly detail: string | null;
  readonly chips: ReadonlyArray<{ readonly tone: SignalTone; readonly label: string }>;
} {
  switch (card.kind) {
    case "thread": {
      const who = card.thread.mine ? "You" : card.thread.person;
      return {
        title: card.thread.title,
        detail: [who, harnessName(card), card.task === undefined ? null : taskLabel(card.task)]
          .filter((part) => part !== undefined && part !== null)
          .join(" · "),
        chips: threadChips(card),
      };
    }
    case "request": {
      const { workspace, request } = card.item;
      const sender =
        status === null ? request.sender : personName(status, workspace, request.sender);
      return {
        title: card.item.title,
        detail: `From ${sender}`,
        chips: [{ tone: "team", label: "Team request" }],
      };
    }
    case "overlap":
      return {
        title: card.item.title,
        detail: card.item.participants.join(" + "),
        chips: [
          {
            tone: "coordination",
            label: card.item.phase === "unanswered" ? "Agreement not reached" : "Overlap",
          },
        ],
      };
    case "stale":
      return {
        title: card.item.title,
        detail: needsYouCardCopy(card.item).guidance,
        chips: [{ tone: "needs", label: "Inputs changed" }],
      };
    case "owner-call":
      return {
        title: card.item.title,
        detail: card.item.call.paths.join(", "),
        chips: [{ tone: "needs", label: "Owner's call" }],
      };
  }
}

/** What the card's button says, for what it opens. */
function actionLabel(card: BoardCard, action: WorkCardAction): string | null {
  switch (action.kind) {
    case "thread":
    case "agent":
      return card.column === "needs" && card.kind === "thread" && card.thread.mine
        ? "Review"
        : "Open";
    case "request":
      return "Review request";
    case "owner-call":
      return ownerCallLabels(action.item).entry;
    case "stale":
      return "Inspect changed inputs";
    case "overlap":
      return "Settle in Needs you";
    case "unavailable":
      return null;
  }
}

const WorkCard = memo(function WorkCard({
  card,
  status,
  hosts,
  environments,
  onAction,
}: {
  readonly card: BoardCard;
  readonly status: PeerHubStatus | null;
  readonly hosts: ReadonlyMap<string, EnvironmentId>;
  readonly environments: ReadonlyArray<WorkEnvironment>;
  readonly onAction: (action: WorkCardAction) => void;
}) {
  const action = workCardAction(card, hosts, environments);
  const text = cardText(card, status);
  const label = action === null ? null : actionLabel(card, action);
  const role =
    card.kind === "thread"
      ? threadRoleChip(status, { key: card.thread.key, harness: card.thread.harness })
      : null;
  const content = (
    <>
      <AppText className="text-base font-t3-medium">{text.title}</AppText>
      {text.detail === null || text.detail === "" ? null : (
        <AppText className="text-sm text-foreground-muted">{text.detail}</AppText>
      )}
      {text.chips.length === 0 && role === null ? null : (
        <View className="flex-row flex-wrap gap-1.5">
          {role === null ? null : <RoleMark chip={role} />}
          {text.chips.map((chip) => (
            <ToneChip key={chip.label} tone={chip.tone} label={chip.label} />
          ))}
        </View>
      )}
      {action?.kind === "unavailable" ? (
        <AppText className="text-sm text-foreground-muted">{action.reason}</AppText>
      ) : label === null ? null : (
        <AppText className="text-sm font-t3-medium text-primary-text">{label}</AppText>
      )}
    </>
  );
  const className = cn(
    "gap-1.5 rounded-xl border border-border bg-card p-4",
    card.kind === "thread" && card.thread.stale && "opacity-70",
  );
  return action === null || action.kind === "unavailable" ? (
    <View className={className}>{content}</View>
  ) : (
    <Pressable accessibilityRole="button" className={className} onPress={() => onAction(action)}>
      {content}
    </Pressable>
  );
});

/**
 * One project's work in the Work board's columns — Needs you, Working, Needs review, Idle — in
 * the colors of their states. A card opens what the phone has: a thread or agent on one of its
 * computers, a team request, an overlap to settle in Needs you; else it says where to go.
 */
export function WorkThreadGroups({
  groups,
  status,
  hosts,
  environments,
  onAction,
}: {
  readonly groups: ReadonlyArray<WorkGroup>;
  /** The status of the computer that reports the project, for people's names. */
  readonly status: PeerHubStatus | null;
  readonly hosts: ReadonlyMap<string, EnvironmentId>;
  readonly environments: ReadonlyArray<WorkEnvironment>;
  readonly onAction: (action: WorkCardAction) => void;
}) {
  return (
    <View className="gap-5">
      {groups.map((group) => (
        <View key={group.column} className="gap-2">
          <View className="flex-row items-center gap-2 px-1">
            <View className={cn("size-2 rounded-full", TONE_DOT[COLUMN_TONE[group.column]])} />
            <AppText
              accessibilityRole="header"
              className={cn("text-sm font-t3-medium", TONE_TEXT[COLUMN_TONE[group.column]])}
            >
              {group.title}
            </AppText>
            <AppText className="text-sm text-foreground-muted">{group.cards.length}</AppText>
          </View>
          {group.cards.length === 0 ? (
            <AppText className="px-1 text-sm text-foreground-muted">Nothing here.</AppText>
          ) : (
            group.cards.map((card) => (
              <WorkCard
                key={card.key}
                card={card}
                status={status}
                hosts={hosts}
                environments={environments}
                onAction={onAction}
              />
            ))
          )}
        </View>
      ))}
    </View>
  );
}
