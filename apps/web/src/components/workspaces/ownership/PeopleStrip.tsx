import {
  onlyOnWords,
  teamPersonWords,
  type TeamPerson,
} from "@t3tools/client-runtime/peer/ownership";

import { Badge } from "../../ui/badge";
import { PeerCard, PeerSectionLabel } from "../PeerPageHeader";
import { peopleCount, personRole } from "./team.logic";
import { PersonAvatar, SectionNote } from "./TeamParts";

/**
 * The project's members: how many of their agents are at work and how many wait for them, how many
 * tasks and which areas they own, and how many decisions wait on them; a member an invitation
 * limited to named projects says which. Their chats are counted, never listed or named: the page
 * shows facts about work, not people's conversations.
 */
export function PeopleStrip({ people }: { readonly people: ReadonlyArray<TeamPerson> }) {
  return (
    <section aria-label="People" className="flex flex-col gap-2.5">
      <PeerSectionLabel after={<SectionNote>{peopleCount(people)}</SectionNote>}>
        People
      </PeerSectionLabel>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
        {people.map((person) => (
          <PersonCard key={person.email} person={person} />
        ))}
      </ul>
    </section>
  );
}

function PersonCard({ person }: { readonly person: TeamPerson }) {
  const words = teamPersonWords(person);
  return (
    <li className="min-w-0">
      <PeerCard>
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={person.name} mine={person.mine} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{person.name}</span>
            <span className="text-xs text-muted-foreground">{personRole(person)}</span>
            {person.onlyOn === undefined ? null : (
              <span className="truncate text-xs text-muted-foreground">
                {onlyOnWords(person.onlyOn)}
              </span>
            )}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="text-foreground">{words.agents}</span>
          <span className="text-muted-foreground">{words.owns}</span>
        </div>
        <div className="flex">
          <Badge variant={person.decisions > 0 ? "warning" : "secondary"} size="control">
            {words.waiting}
          </Badge>
        </div>
      </PeerCard>
    </li>
  );
}
