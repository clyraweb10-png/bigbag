/** The browser is signed in only after the server accepts its Supabase token. */
export async function establishServerSession(accessToken: string): Promise<void> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken }),
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !payload?.ok) {
    const detail = typeof payload?.error === "string" ? payload.error.trim() : "";
    throw new Error(detail || `Sign-in could not be verified by the server (HTTP ${response.status})`);
  }
}
