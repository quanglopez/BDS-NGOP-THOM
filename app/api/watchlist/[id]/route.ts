// PATCH/DELETE /api/watchlist/:id — wiring tới handlers.
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import {
  handlePatch,
  handleDelete,
  asWatchlistDeps,
  type WatchlistDeps,
} from "@/lib/watchlist/handlers";

export const runtime = "nodejs";

type RouteArg = Partial<WatchlistDeps> & { params: Promise<{ id: string }> };

function realDeps(): WatchlistDeps {
  return { createSupabaseClient: createClient, adminClient };
}

function depsOrReal(value: unknown): WatchlistDeps {
  return asWatchlistDeps(value) ?? realDeps();
}

export async function PATCH(req: NextRequest, arg: RouteArg) {
  const deps = depsOrReal(arg);
  const ctx = { params: arg.params ?? Promise.resolve({ id: "" }) };
  return handlePatch(ctx, req, deps);
}

export async function DELETE(req: NextRequest, arg: RouteArg) {
  const deps = depsOrReal(arg);
  const ctx = { params: arg.params ?? Promise.resolve({ id: "" }) };
  return handleDelete(ctx, deps);
}
