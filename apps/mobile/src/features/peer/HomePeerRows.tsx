import { HomeNeedsYouRow } from "./needs-you/HomeNeedsYouRow";
import { HomeWorkRow } from "./work/HomeWorkRow";

/** Peer's rows at the top of Home and of the thread sidebar: what needs you, then the team's work. */
export function HomePeerRows() {
  return (
    <>
      <HomeNeedsYouRow />
      <HomeWorkRow />
    </>
  );
}
