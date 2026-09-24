/**
 * Clean and extract a user name from raw name or email.
 * Removes numbers and keeps only characters (e.g. "umesh21@gmail.com" -> "umesh").
 */
export function extractCleanUserName(raw?: string | null): string {
  if (!raw) return "";
  const base = raw.includes("@") ? raw.split("@")[0] : raw;
  // Remove numbers (only char allowed), normalize delimiters
  const onlyChars = base.replace(/[0-9]/g, "").replace(/[._-]/g, " ").trim();
  return onlyChars || base.trim();
}
