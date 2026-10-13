/**
 * The cards of the Plans list on the phone: one per live plan, one for each agent on the task that
 * declared none. They draw what the client runtime's `peer/plans-view` works out. Names, items and
 * contract lines are teammate text, so they are text children only, selectable, never markup or a
 * link. The list is read-only, so a relation's `open` and an agent's `initial` are not drawn.
 */
import type { PlanRelationKind } from "@t3tools/client-runtime/peer/plans";
import type {
  NoPlanCardModel,
  PlanCardModel,
  PlanRelationLine,
  PlansSectionModel,
} from "@t3tools/client-runtime/peer/plans-view";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { cn } from "../../../lib/cn";
import type { SignalTone } from "../slotTypes";
import { TONE_SURFACE, TONE_TEXT } from "../work/signals";
import { ToneChip } from "../work/WorkMarks";

/** The two uses read in the amber of what needs a look, a shared change quietly. */
const KIND_TONE = {
  "uses-their-change": "needs",
  "changes-their-use": "needs",
  "same-change": "neutral",
} as const satisfies Record<PlanRelationKind, SignalTone>;

const GroupLabel = ({ children }: { readonly children: string }) => (
  <Text className="text-xs font-t3-medium text-foreground-muted">{children}</Text>
);

function Group({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <View className="gap-1">
      <GroupLabel>{label}</GroupLabel>
      {children}
    </View>
  );
}

const None = () => <Text className="text-sm text-foreground-muted">None</Text>;

const Mono = ({ children }: { readonly children: string }) => (
  <Text selectable className="font-mono text-sm text-foreground">
    {children}
  </Text>
);

function RelationRow({ line }: { readonly line: PlanRelationLine }) {
  return (
    <View className="items-start gap-1">
      <ToneChip tone={KIND_TONE[line.kind]} label={line.kindLabel} />
      <Text selectable className="text-sm text-foreground">
        {line.item} · {line.who}
      </Text>
      {line.contract === null ? null : (
        <View className={cn("self-stretch rounded-lg border p-2.5", TONE_SURFACE.knowledge)}>
          <Text selectable className={cn("font-mono text-sm", TONE_TEXT.knowledge)}>
            Their contract (teammate text): {line.contract}
          </Text>
        </View>
      )}
      <Text className="text-sm text-foreground-muted">{line.mark}</Text>
    </View>
  );
}

/** What a work meets in other work, kind first; nothing while there is nothing. */
function Relations({ lines }: { readonly lines: ReadonlyArray<PlanRelationLine> }) {
  if (lines.length === 0) return null;
  return (
    <View className="gap-2.5 border-t border-border pt-3">
      <GroupLabel>Where it meets other work</GroupLabel>
      {lines.map((line) => (
        <RelationRow key={line.key} line={line} />
      ))}
    </View>
  );
}

function PlanCard({ card }: { readonly card: PlanCardModel }) {
  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-4">
      <View className="gap-0.5">
        <Text selectable className="font-t3-medium text-foreground">
          {card.agent}
        </Text>
        <Text className="text-sm text-foreground-muted">{card.heading}</Text>
      </View>
      <Group label="Changes">
        {card.changes.length === 0 ? (
          <None />
        ) : (
          card.changes.map((item) => (
            <Mono key={`${item.maybe}:${item.text}`}>
              {item.maybe ? `${item.text} · maybe` : item.text}
            </Mono>
          ))
        )}
      </Group>
      <Group label="Uses">
        {card.uses.length === 0 ? (
          <None />
        ) : (
          card.uses.map((text) => <Mono key={text}>{text}</Mono>)
        )}
      </Group>
      <Group label="Provides">
        {card.provides.length === 0 ? (
          <None />
        ) : (
          card.provides.map((text) => <Mono key={text}>{text}</Mono>)
        )}
      </Group>
      <Relations lines={card.relations} />
    </View>
  );
}

/** An agent that declared nothing: said in a line, with what its reported changes meet. */
function NoPlanCard({ card }: { readonly card: NoPlanCardModel }) {
  return (
    <View className="gap-3 rounded-xl border border-border p-4">
      <Text className="text-sm text-foreground-muted">
        <Text selectable className="font-t3-medium text-foreground">
          {card.agent}
        </Text>{" "}
        {card.line}
      </Text>
      <Relations lines={card.relations} />
    </View>
  );
}

export function PlanCards({ model }: { readonly model: PlansSectionModel }) {
  return (
    <>
      {model.cards.map((card) =>
        card.kind === "plan" ? (
          <PlanCard key={card.key} card={card} />
        ) : (
          <NoPlanCard key={card.key} card={card} />
        ),
      )}
      {model.loose.length === 0 ? null : (
        <View className="rounded-xl border border-border bg-card p-4">
          <Relations lines={model.loose} />
        </View>
      )}
    </>
  );
}
