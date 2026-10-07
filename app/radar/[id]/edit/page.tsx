import { notFound,redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { adminClient } from "@/lib/admin";
import { getRadar,getRadarAreas } from "@/lib/radar/data";
import { RadarForm } from "@/components/radar/RadarForm";
export const metadata:Metadata={title:"Sửa Kèo Radar - CheckBDS.online",robots:{index:false,follow:false}};
export default async function EditRadarPage({params}:{params:Promise<{id:string}>}){const s=await createClient();const{data:{user}}=await s.auth.getUser();if(!user)redirect("/login");const id=(await params).id;const[radar,areas]=await Promise.all([getRadar(s,user.id,id),getRadarAreas(adminClient())]);if(!radar)notFound();return <main className="min-h-screen bg-cream"><header className="border-b border-white/10 bg-navy/90"><div className="mx-auto flex h-[64px] max-w-[1120px] items-center justify-between px-5 md:px-8"><Link href={"/radar/"+id} className="inline-flex min-h-12 items-center text-small font-semibold text-white">← Quay lại Radar</Link><span className="text-micro font-bold tracking-[0.18em] text-gold-soft">SỬA TIÊU CHÍ</span></div></header><div className="mx-auto max-w-[1120px] px-5 py-10 md:px-8"><div className="max-w-[720px]"><p className="text-micro font-semibold uppercase tracking-[0.18em] text-gold-ink">KÈO RADAR</p><h1 className="mt-1 text-h2 text-navy">Sửa tiêu chí</h1><p className="mt-2 text-lead text-ink-600">Thu hẹp tiêu chí không xoá các kèo đã tìm được.</p><RadarForm areas={areas} initial={radar}/></div></div></main>;}