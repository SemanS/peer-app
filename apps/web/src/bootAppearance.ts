/**
 * Saved appearance settings load asynchronously (over the desktop bridge or the server), after the
 * first paint. What they set on the root element is remembered here and put back by the boot script
 * in index.html, so a reload paints the person's fonts, sizes and contrast at once instead of
 * redrawing every line when the settings arrive. Keep the key and lists in sync with index.html.
 */
const BOOT_APPEARANCE_STORAGE_KEY = "peer:boot-appearance:v1";
const STYLE_PROPERTIES = [
  "--font-sans",
  "--font-mono",
  "--font-composer",
  "font-size",
  "--font-size-prompt",
  "--font-size-code",
  "--diffs-font-size",
  "-webkit-font-smoothing",
  "-moz-osx-font-smoothing",
  "--appearance-contrast-base",
  "--appearance-contrast-boost",
  "--appearance-contrast-border-boost",
  "--glass-opacity",
  "--glass-blur",
] as const;
const DATA_ATTRIBUTES = ["chatWidth", "diffColorScheme"] as const;

export function rememberBootAppearance(root: HTMLElement): void {
  const style = Object.fromEntries(
    STYLE_PROPERTIES.map((name) => [name, root.style.getPropertyValue(name)] as const).filter(
      ([, value]) => value !== "",
    ),
  );
  const data = Object.fromEntries(
    DATA_ATTRIBUTES.flatMap((name) =>
      root.dataset[name] === undefined ? [] : [[name, root.dataset[name]] as const],
    ),
  );
  try {
    window.localStorage.setItem(BOOT_APPEARANCE_STORAGE_KEY, JSON.stringify({ style, data }));
  } catch {
    // Without storage a reload paints the defaults first, as before.
  }
}
