import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { getAreaCoverage } from "@/lib/radar/data";
export const runtime="nodejs";
export async function GET(req:NextRequest){const s=await createClient();const {data:{user}}=await s.auth.getUser();if(!user)return NextResponse.json({error:"Cần đăng nhập"},{status:401});const n=Number(req.nextUrl.searchParams.get("areaV2"));if(!Number.isInteger(n)||n<=0)return NextResponse.json({error:"Thiếu areaV2"},{status:400});try{return NextResponse.json({coverage:await getAreaCoverage(adminClient(),n)});}catch{return NextResponse.json({error:"Chưa xác nhận được độ phủ dữ liệu."},{status:500});}}