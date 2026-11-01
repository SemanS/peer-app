import { PEER_CARD_MAX, type PeerCard } from "@t3tools/contracts";
import { useState } from "react";

import { useEnvironmentQuery } from "../../../../state/query";
import { serverEnvironment } from "../../../../state/server";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsRow, SettingsSection } from "../../../settings/settingsLayout";
import { Button } from "../../../ui/button";
import { Switch } from "../../../ui/switch";
import { Textarea } from "../../../ui/textarea";
import type { ComputerPageProps } from "../pageProps";
import { PeerSettingsPage } from "../PeerSettingsPage";

/** The card as it was read, edited here; a save reads it again, so what shows is what is stored. */
function CardForm({
  environmentId,
  card,
  onSaved,
}: Pick<ComputerPageProps, "environmentId"> & {
  readonly card: PeerCard;
  readonly onSaved: () => void;
}) {
  const save = useAtomCommand(serverEnvironment.peerCard.save);
  const [text, setText] = useState(card.text);
  const [teammatesMayWake, setTeammatesMayWake] = useState(card.teammatesMayWake);
  const changed = text !== card.text || teammatesMayWake !== card.teammatesMayWake;
  return (
    <SettingsSection title="Your card" hideTitle>
      <SettingsRow
        title="In your words"
        description="Your agents read this when they start: where your notes and memory are, what they may share with teammates' agents, and whether to stop and ask you."
        control={
          <Textarea
            aria-label="Your card"
            value={text}
            maxLength={PEER_CARD_MAX}
            rows={6}
            onChange={(event) => setText(event.target.value)}
            placeholder="My notes are in OpenViking. Teammates' agents may ask you about them. I look at work at the end: decide what you can undo and go on."
          />
        }
      />
      <SettingsRow
        title="Teammates may wake my idle agent"
        description="Off: a teammate's words reach your agent at its next step, and wait for your yes when it is idle. They never start an agent you are not running."
        control={
          <Switch
            aria-label="Teammates may wake my idle agent"
            checked={teammatesMayWake}
            onCheckedChange={(checked) => setTeammatesMayWake(checked === true)}
          />
        }
      />
      <div className="flex justify-end p-4">
        <Button
          size="sm"
          disabled={!changed}
          onClick={() => {
            void save({
              environmentId,
              input: { text, teammatesMayWake },
            }).then(onSaved);
          }}
        >
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}

/** What this person's agents read about them. It stays on this computer. */
export function CardPage({ environmentId }: ComputerPageProps) {
  const query = useEnvironmentQuery(serverEnvironment.peerCard.read({ environmentId, input: {} }));
  return (
    <PeerSettingsPage
      title="Your card"
      description="Tell your agents how you work. Peer passes it on and knows nothing about the tools it names."
    >
      {query.data === undefined || query.data === null ? null : (
        <CardForm
          key={`${query.data.text}:${query.data.teammatesMayWake}`}
          environmentId={environmentId}
          card={query.data}
          onSaved={query.refresh}
        />
      )}
    </PeerSettingsPage>
  );
}
