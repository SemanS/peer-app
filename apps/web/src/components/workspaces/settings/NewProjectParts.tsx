/**
 * The parts of the New project form (design artboard 06) that are not fields: a chosen person, and
 * the projects open on this computer to take a repository from.
 */
import { XIcon } from "lucide-react";

import { Button, InlineButton } from "../../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import type { Chip, RepositoryChoice } from "./newProject.logic";
import { PersonAvatar } from "./ProjectPeopleParts";

/**
 * A person chosen for the project, as a pill: the creator's reads "Slavo · lead" and stays; anyone
 * else can be taken out again.
 */
export function PersonChip({
  chip,
  onRemove,
}: {
  readonly chip: Chip;
  readonly onRemove: (email: string) => void;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card ps-1 pe-2.5 text-sm text-foreground">
      <PersonAvatar name={chip.name} size="sm" />
      {chip.lead ? `${chip.name} · lead` : chip.name}
      {chip.lead ? null : (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={`Take ${chip.name} off the project`}
          onClick={() => onRemove(chip.email)}
        >
          <XIcon aria-hidden />
        </Button>
      )}
    </span>
  );
}

/** How many checkouts are named in the sentence before the rest go into a menu. */
const SHOWN = 6;

/**
 * "Or pick one open on this computer: booking-api · booking-web": the projects whose checkout has a
 * remote the Hub takes, each filling in the repository's address; once the project is created, this
 * computer works in that checkout rather than cloning the repository again. Beyond a few, the rest
 * are in a menu rather than a wall of names.
 */
export function LocalRepositories<Id extends string>({
  choices,
  onPick,
}: {
  readonly choices: ReadonlyArray<RepositoryChoice<Id>>;
  readonly onPick: (choice: RepositoryChoice<Id>) => void;
}) {
  if (choices.length === 0) return null;
  const shown = choices.slice(0, SHOWN);
  const rest = choices.slice(SHOWN);
  return (
    <p className="text-xs text-muted-foreground">
      Or pick one open on this computer:{" "}
      {shown.map((choice, index) => (
        <span key={choice.id}>
          {index === 0 ? null : " · "}
          <InlineButton onClick={() => onPick(choice)}>{choice.title}</InlineButton>
        </span>
      ))}
      {rest.length === 0 ? null : (
        <>
          {" · "}
          <Menu>
            <MenuTrigger render={<InlineButton tone="picker" />}>{rest.length} more</MenuTrigger>
            <MenuPopup align="start" className="max-h-64">
              {rest.map((choice) => (
                <MenuItem key={choice.id} onClick={() => onPick(choice)}>
                  {choice.title}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </>
      )}
    </p>
  );
}
