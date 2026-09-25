import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;
let runtimeSupabaseUrl: string | null = null;
let runtimeSupabaseAnonKey: string | null = null;

export function configureRuntimeSupabase(url?: string | null, anonKey?: string | null): void {
  const previousUrl = getSupabaseUrl();
  const previousAnonKey = getSupabaseAnonKey();
  if (url && typeof url === "string") {
    runtimeSupabaseUrl = url.trim();
  }
  if (anonKey && typeof anonKey === "string") {
    runtimeSupabaseAnonKey = anonKey.trim();
  }
  if (
    publicClient &&
    (getSupabaseUrl() !== previousUrl || getSupabaseAnonKey() !== previousAnonKey)
  ) {
    // Only replace a live auth client when its effective credentials changed.
    // Recreating it for the same runtime config duplicates GoTrue listeners and
    // storage locks during the AuthProvider bootstrap.
    publicClient = null;
  }
}

export function getSupabaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    runtimeSupabaseUrl ||
    "";
  return (url || "").trim();
}

export function getSupabaseAnonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    runtimeSupabaseAnonKey ||
    "";
  return (key || "").trim();
}

export function getSupabaseServiceRoleKey(): string {
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  return key.trim();
}

export function getSupabaseDatabaseUrl(): string {
  const url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "";
  return url.trim();
}

/**
 * Server-only admin client using service_role key to bypass RLS for durable storage operations.
 * Never import or use this on the browser/client.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!url || !serviceKey) return null;
  if (!adminClient) {
    adminClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return adminClient;
}

/**
 * Public client for client-side operations (uses anon key, respects RLS).
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return null;
  if (!publicClient) {
    publicClient = createClient(url, anonKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return publicClient;
}
