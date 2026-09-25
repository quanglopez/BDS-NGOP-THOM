import { createBrowserClient } from "@supabase/ssr";

// Supabase client phía browser (dùng cho login/logout trên client component)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
