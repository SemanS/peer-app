import { handoffLines, inputState } from "@t3tools/client-runtime/peer/handoff";
import { contextBlockerText, type PeerHandoffPackage } from "@t3tools/contracts";

export function handoffPresentation(pkg: PeerHandoffPackage) {
  const sections =
    pkg.context?.sections.flatMap((section) => {
      const lines =
        section.name === "Blockers"
          ? section.lines.flatMap((line) => {
              const text = contextBlockerText(line);
              return text === undefined ? [] : [text];
            })
          : section.lines;
      return handoffLines(lines).length === 0 ? [] : [{ ...section, lines }];
    }) ?? [];
  return {
    sections,
    result: sections.find((section) => section.name === "Provides"),
    blockers: sections.find((section) => section.name === "Blockers"),
    blockersShortened:
      pkg.context?.sections.some((section) => section.name === "Blockers" && section.shortened) ??
      false,
    next: sections.find((section) => section.name === "Next"),
    openOverlaps: pkg.overlaps.filter((overlap) => overlap.state === "open"),
    changedInputs: pkg.inputs.filter((input) => inputState(input) !== "current"),
    pulls: [...new Set(pkg.pullRequests)].filter((url) =>
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url),
    ),
  };
}
