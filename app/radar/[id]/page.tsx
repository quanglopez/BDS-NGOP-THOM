import { notFound,redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getRadar,getRadarMatches } from "@/lib/radar/data";
import { RadarDetailClient } from "@/components/radar/RadarDetailClient";
import { RadarStatusBadge } from "@/components/radar/RadarStatusBadge";
import { Button } from "@/components/ui/button";
export const metadata:Metadata={title:"Kèo Radar - CheckBDS.online",robots:{index:false,follow:false}};
export default async function RadarDetailPage({params}:{params:Promise<{id:string}>}){const s=await createClient();const{data:{user}}=await s.auth.getUser();if(!user)redirect("/login");const id=(await params).id;const radar=await getRadar(s,user.id,id);if(!radar)notFound();const matches=await getRadarMatches(s,radar);return <main className="min-h-screen bg-cream"><header className="sticky top-0 z-30 border-b border-white/10 bg-navy/90 backdrop-blur-xl"><div className="mx-auto flex h-[64px] max-w-[1120px] items-center justify-between gap-3 px-5 md:px-8"><Link href="/radar" className="text-small font-semibold text-white">← Kèo Radar</Link><div className="flex items-center gap-2"><RadarStatusBadge status={radar.status}/><Link href={"/radar/"+id+"/edit"}><Button size="lg" className="h-11 bg-gold-base text-navy">Sửa</Button></Link></div></div></header><div className="mx-auto max-w-[1120px] px-5 py-10 md:px-8"><RadarDetailClient radar={radar} initialMatches={matches}/></div></main>;}