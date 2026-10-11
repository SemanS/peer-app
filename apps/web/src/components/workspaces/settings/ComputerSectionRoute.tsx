import type { ComponentType } from "react";

import { usePeerSettings } from "./PeerSettingsContext";
import { PeerSettingsRedirect } from "./peerSettingsLinks";
import {
  DEFAULT_COMPUTER_SECTION,
  isComputerSection,
  type ComputerSection,
} from "./peerSettings.logic";
import type { ComputerPageProps } from "./pageProps";
import { CoordinationAndPlugins } from "./pages/CoordinationAndPlugins";
import { ToolTrustPage } from "./pages/ToolTrustPage";

const PAGES: Readonly<Record<ComputerSection, ComponentType<ComputerPageProps>>> = {
  coordination: CoordinationAndPlugins,
  "tool-trust": ToolTrustPage,
};

/** `/settings/peer/computer/<section>`: a page about this computer, whatever workspace is open. */
export function ComputerSectionRoute({ section }: { readonly section: string }) {
  const { environmentId, status } = usePeerSettings();
  if (!isComputerSection(section)) {
    return <PeerSettingsRedirect to={{ kind: "computer", section: DEFAULT_COMPUTER_SECTION }} />;
  }
  const Page = PAGES[section];
  return <Page environmentId={environmentId} status={status} />;
}
