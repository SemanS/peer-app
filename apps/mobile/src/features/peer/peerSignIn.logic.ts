/** An address worth asking the Hub to mail a code to: the same check web and desktop make. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** What the code field keeps of what was typed or pasted: its first six digits. */
export function signInCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
