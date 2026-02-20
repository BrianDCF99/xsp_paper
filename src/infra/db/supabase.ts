import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { AppConfig } from "../../config/schema.js";

export function createSupabase(cfg: AppConfig["supabase"]): SupabaseClient<any, any, any> {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: cfg.schema
    }
  });
}
