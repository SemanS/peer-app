import { describe, expect, it } from "vite-plus/test";

import { readDefaultMobileThemeVariables } from "./mobileTheme.test-support";
import {
  getMobileThemeVariables,
  MOBILE_THEME_IDS,
  themeColorWithAlpha,
  type MobileThemeVariable,
} from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

/** Info, success and Peer's three signal kinds: a tinted surface, a hairline and text each. */
const SIGNAL_VARIABLES = [
  "--color-info",
  "--color-info-border",
  "--color-info-foreground",
  "--color-success",
  "--color-success-border",
  "--color-success-foreground",
  "--color-peer-coordination",
  "--color-peer-coordination-border",
  "--color-peer-coordination-foreground",
  "--color-peer-knowledge",
  "--color-peer-knowledge-border",
  "--color-peer-knowledge-foreground",
  "--color-peer-team",
  "--color-peer-team-border",
  "--color-peer-team-foreground",
] as const satisfies ReadonlyArray<MobileThemeVariable>;

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    const [red, green, blue] = (hex.slice(1).match(/.{2}/g) ?? []).map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("mobile theme runtime variables", () => {
  it("matches the standard base palette to the generated stylesheet", () => {
    expect(getMobileThemeRuntimeVariables("t3-code", "light", "web")).toEqual(
      readDefaultMobileThemeVariables("light"),
    );
    expect(getMobileThemeRuntimeVariables("t3-code", "dark", "web")).toEqual(
      readDefaultMobileThemeVariables("dark"),
    );
  });

  it("uses the same shared palette source as generated custom themes", () => {
    expect(getMobileThemeRuntimeVariables("ocean", "light", "ios")).toEqual(
      getMobileThemeVariables("ocean", "light"),
    );
    expect(getMobileThemeRuntimeVariables("iris", "dark", "ios")).toEqual(
      getMobileThemeVariables("iris", "dark"),
    );
  });

  it("lists the signal colors in light and dark for every theme and platform", () => {
    for (const themeId of MOBILE_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        for (const platform of ["ios", "android", "web"]) {
          const variables = getMobileThemeRuntimeVariables(themeId, appearance, platform);
          for (const name of SIGNAL_VARIABLES) {
            expect(variables[name]).toMatch(/^(#[\da-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/);
          }
        }
      }
    }
  });

  it("takes the signal colors of the standard palette from web's Tailwind shades", () => {
    // Text: 700 on light and 400 on dark; surfaces and hairlines: the 500 shade, tinted.
    const text = {
      light: ["#1447e6", "#007a55", "#ca3500", "#7008e7", "#00786f"],
      dark: ["#51a2ff", "#00d492", "#ff8904", "#a684ff", "#00d5be"],
    };
    const base = ["43, 127, 255", "0, 188, 125", "255, 105, 0", "142, 81, 255", "0, 187, 167"];
    const hues = ["info", "success", "peer-coordination", "peer-knowledge", "peer-team"] as const;
    for (const appearance of ["light", "dark"] as const) {
      const variables = readDefaultMobileThemeVariables(appearance);
      expect(hues.map((hue) => variables[`--color-${hue}-foreground`])).toEqual(text[appearance]);
      expect(hues.map((hue) => variables[`--color-${hue}`])).toEqual(
        base.map((rgb) => `rgba(${rgb}, ${appearance === "light" ? 0.08 : 0.12})`),
      );
      expect(hues.map((hue) => variables[`--color-${hue}-border`])).toEqual(
        base.map((rgb) => `rgba(${rgb}, 0.3)`),
      );
    }
  });

  it("keeps signal text readable on every theme's screens and cards", () => {
    for (const themeId of MOBILE_THEME_IDS) {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, "ios");
        for (const name of SIGNAL_VARIABLES.filter((variable) => variable.endsWith("foreground"))) {
          for (const surface of ["--color-screen", "--color-card"] as const) {
            expect(contrastRatio(variables[name], variables[surface])).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it.each(MOBILE_THEME_IDS)(
    "uses a screen-colored %s sidebar beneath an opaque Android frame",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const base = getMobileThemeVariables(
          themeId === "material-you" ? "t3-code" : themeId,
          appearance,
        );
        const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(android).toEqual({
          ...base,
          "--color-header": themeColorWithAlpha(
            base[
              themeId === "t3-code" || themeId === "material-you"
                ? "--color-row-hover"
                : "--color-drawer"
            ],
            1,
          ),
          "--color-header-foreground": base["--color-drawer-foreground"],
          "--color-drawer": base["--color-screen"],
        });
        expect(android["--color-header"]).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
      }
    },
  );

  it.each(["t3-code", "material-you"] as const)(
    "keeps the %s default Material frame distinct in both appearances",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const variables = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(variables["--color-header"]).toBe(
          appearance === "light" ? "rgba(244, 244, 245, 1)" : "rgba(20, 20, 20, 1)",
        );
        for (const pane of ["--color-screen", "--color-sheet-solid", "--color-drawer"] as const) {
          expect(variables["--color-header"]).not.toBe(themeColorWithAlpha(variables[pane], 1));
        }
      }
    },
  );

  it.each(["t3-code", "material-you"] as const)(
    "adapts %s iPad chrome without reversing the dark desktop hierarchy",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const ios = getMobileThemeRuntimeVariables(themeId, appearance, "ios");
        const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        if (appearance === "light") {
          expect(ios["--color-drawer"]).toBe(android["--color-header"]);
          expect(ios["--color-header"]).toBe(android["--color-header"]);
          expect(ios["--color-header-foreground"]).toBe(ios["--color-drawer-foreground"]);
        } else {
          expect(ios).toEqual(getMobileThemeVariables("t3-code", appearance));
          expect(ios["--color-drawer"]).toBe("#000000");
          expect(ios["--color-thread-canvas"]).toBe("#0a0a0a");
        }
        expect(themeColorWithAlpha(ios["--color-thread-hover"], 1)).not.toBe(
          themeColorWithAlpha(ios["--color-drawer"], 1),
        );
        expect(themeColorWithAlpha(ios["--color-thread-hover"], 1)).not.toBe(
          themeColorWithAlpha(ios["--color-thread-selected"], 1),
        );
        for (const role of [
          "--color-screen",
          "--color-thread-canvas",
          "--color-card",
          "--color-composer-surface",
          "--color-grouped-card",
        ] as const) {
          expect(ios[role]).toBe(android[role]);
        }
      }
    },
  );
});
