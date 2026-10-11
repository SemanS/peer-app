import { createFileRoute } from "@tanstack/react-router";

import { ComputerSectionRoute } from "../components/workspaces/settings/ComputerSectionRoute";
import { peerSettingsRedirect } from "../components/workspaces/settings/peerSettingsLinks";
import {
  DEFAULT_COMPUTER_SECTION,
  isComputerSection,
} from "../components/workspaces/settings/peerSettings.logic";

export const Route = createFileRoute("/settings/peer/computer/$section")({
  beforeLoad: ({ params }) => {
    if (!isComputerSection(params.section)) {
      throw peerSettingsRedirect({ kind: "computer", section: DEFAULT_COMPUTER_SECTION });
    }
  },
  component: ComputerSectionPage,
});

function ComputerSectionPage() {
  const { section } = Route.useParams();
  return <ComputerSectionRoute section={section} />;
}
