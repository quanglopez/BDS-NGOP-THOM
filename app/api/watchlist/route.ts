// Route wiring /api/watchlist — thân handler ở lib/watchlist/handlers.ts.
// `export const runtime = "nodejs"` để khớp convention (see app/api/check/route.ts).
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import {
  handleGet,
  handlePost,
  handleGetByCheck,
  asWatchlistDeps,
  type WatchlistDeps,
} from "@/lib/watchlist/handlers";

export const runtime = "nodejs";

// Next 15.5: handler thứ 2 nhận RouteContext (params Promise). Test bơm deps
// qua cùng tham số này; `asWatchlistDeps` phân biệt deps thật vs context route.
// Tham số thứ 2 phải BẮT BUỘC và khớp ParamCheck<RouteContext> (xem
// app/api/check/route.ts:38-42) — để optional thì `next build` fail type check.
type RouteArg = Partial<WatchlistDeps> & { params: Promise<unknown> };

function realDeps(): WatchlistDeps {
  return {
    createSupabaseClient: createClient,
    adminClient,
  };
}

function depsOrReal(value: unknown): WatchlistDeps {
  return asWatchlistDeps(value) ?? realDeps();
}

export async function GET(req: NextRequest, arg: RouteArg) {
  const deps = depsOrReal(arg);
  if (new URL(req.url).searchParams.has("checkId")) return handleGetByCheck(req, deps);
  return handleGet(deps);
}

export async function POST(req: NextRequest, arg: RouteArg) {
  const deps = depsOrReal(arg);
  return handlePost(req, deps);
}
