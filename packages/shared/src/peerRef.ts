/** A stable opaque reference, shared by producers and clients. This is not an identity hash. */
export function taskRef(value?: string | null) {
  if (!value || value === "project" || value === "none") return "none";
  const text = value.replace(/^task:/, "");
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 2654435761);
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `t_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, "0").slice(-12)}`;
}
