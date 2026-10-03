import type { SupabaseClient } from "@supabase/supabase-js";
import { confidenceFrom } from "@/lib/price/stats";
import { MIN_SAMPLE_SIZE, type PriceConfidence } from "@/lib/price/types";
import { listingMatchesCriteria } from "./criteria";
import { attachSignals, buildSignalIndex, type ListingSignal } from "./signals";
import { materialInputFromRow, materialFingerprint, planAutoEnrollmentForRows, AUTO_ENRICHMENT_DAILY_LIMIT, AUTO_ENRICHMENT_TTL_MS } from "./auto-enrollment";
import { effectivePlan, vnDayStartISO } from "@/lib/quota";
import type { CoverageStatus,RadarAreaOption,RadarComparison,RadarCriteria,RadarCoverage,RadarMatch,RadarSummary,Staleness,AutoEnrollmentStatus } from "./types";

type Row=Record<string,unknown>;
const SOURCE="chotot_gateway";
/** Chỉ lấy Check đã chấm điểm, mới nhất trước. Listing có Check quá hạn sẽ hiện là chưa chấm.
 *  Đổi lại: khi nền tảng bận, tin có Check nằm ngoài 5000 Check mới nhất sẽ mất
 *  tín hiệu và hiện `scoring_available:false` cho tới lượt quét sau — tin vẫn hiện,
 *  chỉ mất điểm/loại kéo/điểm Ngộp. */
const SIGNAL_WINDOW=5000;
const STALE_AFTER=24*60*60*1000;
function n(v:unknown):number|null{const x=typeof v==="number"?v:typeof v==="string"&&v.trim()?Number(v):null;return x!=null&&Number.isFinite(x)?x:null;}
function s(v:unknown):string|null{return typeof v==="string"&&v.trim()?v:null;}
function rel(iso:string|null){if(!iso)return null;const d=Math.max(0,Date.now()-new Date(iso).getTime()),m=Math.floor(d/60000);if(m<1)return"vừa xong";if(m<60)return m+" phút trước";const h=Math.floor(m/60);if(h<24)return h+" giờ trước";return Math.floor(h/24)+" ngày trước";}
function stale(iso:string|null):Staleness{if(!iso)return"unknown";return Date.now()-new Date(iso).getTime()>STALE_AFTER?"stale":"fresh";}
function covStatus(v:unknown):CoverageStatus{return v==="ok"||v==="thin"||v==="none"?v:"unknown";}
function staleOf(v:unknown):Staleness{return v==="fresh"||v==="stale"?v:"unknown";}
function mapCoverage(r:Row):RadarCoverage{return{status:covStatus(r.coverage_status),lastSeenAt:s(r.last_seen_at),freshness:s(r.coverage_freshness),staleness:staleOf(r.coverage_staleness),listingCount:n(r.coverage_listing_count),checkedAt:s(r.checked_at),source:s(r.coverage_source)??SOURCE,description:s(r.coverage_description),excludedCount:n(r.excluded_count)};}
function mapRadar(r:Row):RadarSummary{return{id:String(r.id),userId:typeof r.user_id==='string'?r.user_id:null,name:String(r.name),areaV2:Number(r.area_v2),areaName:s(r.area_name),regionName:s(r.region_name),categoryCode:n(r.category_code),priceMinVnd:n(r.price_min_vnd),priceMaxVnd:n(r.price_max_vnd),areaMinM2:n(r.area_min_m2),areaMaxM2:n(r.area_max_m2),minScore:n(r.min_score),dealTypes:Array.isArray(r.deal_types)?r.deal_types:[],ngoPOnly:Boolean(r.ngop_only),status:r.status==="PAUSED"?"PAUSED":"ACTIVE",createdAt:String(r.created_at),updatedAt:String(r.updated_at),coverage:mapCoverage(r),newMatchCount:Number(r.new_match_count??0),lastScanCount:n(r.last_scan_count),lastScanError:s(r.last_scan_error)};}

export async function getRadar(db:SupabaseClient,userId:string,id:string){const {data,error}=await db.from("radars").select("*").eq("id",id).eq("user_id",userId).maybeSingle();if(error)throw error;return data?mapRadar(data):null;}
export async function listRadars(db:SupabaseClient,userId:string){const {data,error}=await db.from("radars").select("*").eq("user_id",userId).order("updated_at",{ascending:false});if(error)throw error;return(data??[]).map(mapRadar);}
/** Radar đang chạy, quét lâu nhất trước (chưa quét lên đầu) — dùng cho cron. */
export async function listActiveRadars(db:SupabaseClient,limit:number):Promise<RadarSummary[]>{const {data,error}=await db.from("radars").select("*").eq("status","ACTIVE").order("checked_at",{ascending:true,nullsFirst:true}).limit(limit);if(error)throw error;return(data??[]).map(mapRadar);}
export async function getRadarAreas(db:SupabaseClient):Promise<RadarAreaOption[]>{const {data,error}=await db.from("market_listings").select("area_v2,area_name,region_name").not("area_v2","is",null).not("region_name","is",null).limit(5000);if(error)throw error;const seen=new Map<number,RadarAreaOption>();for(const r of data??[]){const a=n(r.area_v2),an=s(r.area_name),rn=s(r.region_name);if(a!=null&&an&&rn&&!seen.has(a))seen.set(a,{areaV2:a,areaName:an,regionName:rn});}return[...seen.values()].sort((a,b)=>a.regionName.localeCompare(b.regionName,"vi")||a.areaName.localeCompare(b.areaName,"vi"));}
export async function getAreaCoverage(db:SupabaseClient,areaV2:number):Promise<RadarCoverage>{const [all,eligible,latest]=await Promise.all([
 db.from("market_listings").select("id",{count:"exact",head:true}).eq("area_v2",areaV2),
 db.from("market_listings").select("id",{count:"exact",head:true}).eq("area_v2",areaV2).eq("is_rent",false).eq("is_promoted",false).eq("is_price_valid",true),
 db.from("market_listings").select("last_seen_at,area_name,region_name").eq("area_v2",areaV2).eq("is_rent",false).eq("is_promoted",false).eq("is_price_valid",true).order("last_seen_at",{ascending:false}).limit(1)
]);if(all.error||eligible.error||latest.error)throw all.error??eligible.error??latest.error;const count=eligible.count??0;const last=s(latest.data?.[0]?.last_seen_at);return{status:count===0?"none":count<MIN_SAMPLE_SIZE?"thin":"ok",lastSeenAt:last,freshness:rel(last),staleness:stale(last),listingCount:count,checkedAt:null,source:SOURCE,description:s(latest.data?.[0]?.area_name)?String(latest.data![0].area_name)+", "+String(latest.data![0].region_name??"Khu vực"):null,excludedCount:Math.max(0,(all.count??0)-count)};}

function pickStats(rows:Row[],size:number|null,rooms:number|null){if(size==null)return null;return rows.filter(r=>n(r.median_ppm2)!=null&&Number(r.trimmed_size??0)>=MIN_SAMPLE_SIZE).filter(r=>(n(r.size_min_m2)==null||size>=n(r.size_min_m2)!)&&(n(r.size_max_m2)==null||size<=n(r.size_max_m2)!)).sort((a,b)=>{const ar=rooms!=null&&n(a.rooms)===rooms?0:1,br=rooms!=null&&n(b.rooms)===rooms?0:1;if(ar!==br)return ar-br;return((n(a.size_max_m2)??1e9)-(n(a.size_min_m2)??0))-((n(b.size_max_m2)??1e9)-(n(b.size_min_m2)??0));})[0]??null;}
function comparison(stats:Row|null,ppm2:number|null):RadarComparison|null{if(!stats||ppm2==null)return null;const median=n(stats.median_ppm2);if(median==null)return null;return{medianPpm2:median,differencePercent:Math.round(((ppm2-median)/median)*1000)/10,confidence:confidenceFrom({scopeLevel:String(stats.scope_level) as "ward"|"district"|"province",trimmed:Number(stats.trimmed_size??0)}) as PriceConfidence,scopeDescription:s(stats.scope_description)};}
async function statsFor(db:SupabaseClient,radar:RadarCriteria){if(radar.categoryCode==null)return[];const d=await db.from("market_price_stats").select("scope_key,scope_level,scope_description,area_name,region_name,category_code,size_min_m2,size_max_m2,rooms,trimmed_size,median_ppm2").eq("scope_level","district").like("scope_key","district:"+radar.areaV2+"|cat:"+radar.categoryCode+"|size:%").order("stat_date",{ascending:false}).limit(200);if(!d.error&&(d.data??[]).some(r=>n(r.median_ppm2)!=null))return d.data??[];if(!radar.regionName)return[];const p=await db.from("market_price_stats").select("scope_key,scope_level,scope_description,area_name,region_name,category_code,size_min_m2,size_max_m2,rooms,trimmed_size,median_ppm2").eq("scope_level","province").eq("region_name",radar.regionName).eq("category_code",radar.categoryCode).order("stat_date",{ascending:false}).limit(200);return p.data??[];}
/** Nối listing -> Check mới nhất. URL Check là SEO slug nên phải bóc số id ở đuôi .htm.
 *  `checks` không có cột listing_id nên không lọc `.in` theo id được: chỉ lấy
 *  SIGNAL_WINDOW Check mới nhất rồi lọc theo tập ứng viên.
 *  Đọc qua service role và CỐ Ý không lọc `user_id`: score/deal_type/is_ngop là
 *  thuộc tính CỦA TIN (tính từ giá + đối chiếu thị trường), không phải dữ liệu
 *  riêng của người chấm — và Check mới nhất là bản chấm điện nhất nên đúng hơn.
 *  Chỉ cột điểm được chọn ra, không đọc `original_text` (nội dung riêng tư). */
async function signalIndexFor(db:SupabaseClient,externalIds:string[]):Promise<Map<string,ListingSignal>>{if(!externalIds.length)return new Map();const {data,error}=await db.from("checks").select("listing_url,score,deal_type,is_ngop,created_at").not("score","is",null).order("created_at",{ascending:false}).limit(SIGNAL_WINDOW);if(error)throw error;const want=new Set(externalIds);return new Map([...buildSignalIndex(data??[])].filter(([id])=>want.has(id)));}
function mapMatch(r:Row,c:RadarCriteria):RadarMatch{const autoFrom=(r.enrichment_status?String(r.enrichment_status):null) as string|null;const autoEnrichment=autoFrom?{status:(['pending','processing','completed','insufficient_data','low_confidence','failed'].includes(autoFrom)?autoFrom:'not_started') as AutoEnrollmentStatus,score:n(r.enrichment_score),dealType:s(r.enrichment_deal_type),isNgoP:n(r.enrichment_is_ngop),source:(s(r.enrichment_source)==='manual_check'?'manual_check':'auto_enrichment') as "auto_enrichment"|"manual_check",confidence:normalizeConfidenceColumn(r.enrichment_confidence),checkedAt:s(r.enrichment_checked_at),fingerprint:s(r.enrichment_fingerprint)}: null;return{externalId:String(r.external_id),url:s(r.url),title:s(r.title),areaName:s(r.area_name),regionName:s(r.region_name),categoryCode:n(r.category_code),priceVnd:n(r.price_vnd),sizeM2:n(r.size_m2),pricePerM2:n(r.price_per_m2),listedAt:s(r.listed_at),lastSeenAt:s(r.last_seen_at),score:n(r.score),dealType:s(r.deal_type),isNgoP:n(r.is_ngop),scoringAvailable:Boolean(r.scoring_available),comparison:n(r.median_ppm2)!=null?{medianPpm2:n(r.median_ppm2),differencePercent:n(r.difference_percent),confidence:(s(r.confidence) as PriceConfidence|null),scopeDescription:s(r.scope_description)}:null,firstMatchedAt:String(r.first_matched_at),lastMatchedAt:String(r.last_matched_at),currentMatch:listingMatchesCriteria({categoryCode:n(r.category_code),priceVnd:n(r.price_vnd),sizeM2:n(r.size_m2)},c),auto_enrichment:autoEnrichment};}
/** Danh sách external_id vừa được enqueue, để scanRadar ghi kèm vào upsert
 *  radar_matches. Row MỚI không có ở DB nên update trước upsert là no-op ->
 *  pending phải nằm trong chính payload upsert. */
export type QueuedEnrichment = { externalId: string; fingerprint: string };
export async function syncEnrichmentJobs(db:SupabaseClient, radar:RadarSummary, rows:(Record<string,unknown>&{score?:unknown;scoring_available?:unknown})[]):Promise<QueuedEnrichment[]> {
  if (process.env.AUTO_ENRICHMENT_KILL_SWITCH === '1' || process.env.AUTO_ENRICHMENT_COST_GUARD === '1' || !radar.userId) return [];
  try {
    const { data: profile, error: profileError } = await db.from("users").select("plan,plan_expires_at").eq("id", radar.userId).maybeSingle();
    if (profileError) throw profileError;
    const plan = effectivePlan(profile?.plan, profile?.plan_expires_at);
    if (plan !== 'pro') return [];
    const eligibleRows = rows.filter((r) => r.score == null && r.scoring_available !== true);
    if (!eligibleRows.length) return [];

    const ids = eligibleRows.map((r) => String(r.external_id));
    const existingJobs = await db
      .from("auto_enrichment_jobs")
      .select("id,external_id,status,material_input_hash,created_at,updated_at,dispatch_started_at")
      .eq("radar_id", radar.id)
      .in("external_id", ids);
    if (existingJobs.error) throw existingJobs.error;
    const byExternal: Record<string, { id?: string; status?: unknown; material_input_hash?: unknown; created_at?: unknown; updated_at?: unknown; dispatch_started_at?: unknown }[]> = {};
    for (const j of existingJobs.data ?? []) {
      const k = String(j.external_id); byExternal[k] = byExternal[k] ?? []; byExternal[k].push(j);
    }
    // Allowance đếm theo NGÀY DISPATCH (không phải ngày tạo job): job tạo hôm qua
    // nhưng dispatch hôm nay phải tính vào hôm nay, khớp bảng allowance của RPC.
    const consumed = await db
      .from("auto_enrichment_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", radar.userId)
      .gte("dispatch_started_at", vnDayStartISO());
    const allowanceRemaining = Math.max(0, AUTO_ENRICHMENT_DAILY_LIMIT - (consumed.count ?? 0));
    const existingStatusById: Record<string, { status: AutoEnrollmentStatus | null | undefined; hash: string | null | undefined; updatedAt: string | null | undefined }> = {};
    for (const row of rows) {
      const rawJobs = byExternal[String(row.external_id)] ?? [];
      const sameHash = rawJobs.find((j) => j.material_input_hash === materialFingerprint(materialInputFromRow(row)));
      existingStatusById[String(row.external_id)] = sameHash
        ? {
          status: (sameHash.status as AutoEnrollmentStatus | undefined) ?? null,
          hash: typeof sameHash.material_input_hash === "string" ? sameHash.material_input_hash : null,
          updatedAt: typeof sameHash.updated_at === "string" ? sameHash.updated_at : null,
        }
        : { status: null, hash: null, updatedAt: null };
    }

    const toCreate = planAutoEnrollmentForRows({
      plan,
      killSwitch: false,
      costGuard: false,
      existingStatus: existingStatusById,
      rows: eligibleRows,
      allowanceRemaining,
      nowMs: Date.now(),
    });
    // Job terminal quá hạn TTL -> TÁI SỬ DỤNG dòng đó (giữ 1 dòng / (radar,listing,hash)).
    // Dòng mới -> insert. Gom insert 1 lần để không N+1.
    const resetCols = { claim_token: null, processing_started_at: null, next_attempt_at: null, error_kind: null };
    // Trạng thái terminal: chỉ những trạng thái này được tái sử dụng.
    const RECYCLEABLE = ["completed", "insufficient_data", "low_confidence", "failed"];
    const fresh: Record<string, unknown>[] = [];
    const queued: QueuedEnrichment[] = [];
    for (const item of toCreate) {
      const existSame = (byExternal[String(item.row.external_id)] ?? []).find((j) => j.material_input_hash === item.hash);
      const isStaleTerminal =
        existSame && typeof existSame.updated_at === "string" && Date.parse(existSame.updated_at) > 0 &&
        ["completed", "insufficient_data", "low_confidence", "failed"].includes(String(existSame.status))
          ? Date.now() - Date.parse(existSame.updated_at) >= AUTO_ENRICHMENT_TTL_MS
          : false;
      if (existSame && !isStaleTerminal) continue;
      const payload = {
        radar_id: radar.id,
        user_id: radar.userId,
        external_id: String(item.row.external_id),
        material_input_hash: item.hash,
        material_input: item.input,
        status: "pending" as const,
        attempts: 0,
        dispatch_started_at: null,
        allowance_consumed: false,
        ...resetCols,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queued.push({ externalId: String(item.row.external_id), fingerprint: item.hash });
      if (existSame && isStaleTerminal) {
        // TÁI SỬ DỤNG chỉ khi job VẪN terminal VÀ chưa ai claim lúc ghi.
        // `existSame`/`isStaleTerminal` đọc từ SNAPSHOT trước khi ghi: job có thể
        // đã được scan khác tái sử dụng (về pending) và worker claim + charge
        // allowance trong khoảng giữa hai thời điểm. Nếu UPDATE chỉ khoá theo id,
        // nó xoá dispatch_started_at -> guard "charge đúng 1 lần" của
        // begin_auto_enrichment_dispatch bị mở khoá -> cùng một (radar, tin, hash)
        // bị charge LẦN THỨ HAI. Hai predicate dưới đây (terminal + claim_token
        // null) chặn đúng race đó. KHÔNG lọc `dispatch_started_at is null`: job
        // terminal bình thường (đã dispatch xong) LÀ đối tượng cần tái sử dụng —
        // lọc thêm điều kiện đó sẽ triệt tiêu TTL reuse.
        const u = await db
          .from("auto_enrichment_jobs")
          .update(payload)
          .eq("id", existSame.id)
          .in("status", RECYCLEABLE)
          .is("claim_token", null)
          .select("id");
        if (u.error) console.error("[auto-enrollment:update]", u.error.code);
      } else {
        fresh.push(payload);
      }
    }
    if (fresh.length) {
      const ins = await db.from("auto_enrichment_jobs").insert(fresh);
      // 23505 = scan khác đã tạo job active cùng fingerprint -> bỏ qua, không phải lỗi.
      if (ins.error && ins.error.code !== "23505") console.error("[auto-enrollment:insert]", ins.error.code);
    }
    // Row ĐÃ TỒN TẠI mà vừa được enqueue lại (job terminal quá TTL được tái sử
    // dụng) thì upsert của scan sẽ ghi đè cột enrichment_* cũ, nên phải trả về danh
    // sách để scan bỏ qua: trạng thái cuối cho các row này do worker lo, không
    // phải reset về pending ở đây. Row MỚI thì ngược lại: upsert sẽ mang pending.
    // Việc lọc "job đang processing" ở đây cũng tránh việc scan lật ngược trạng
    // thái của job mà worker vừa claim (FIX 5: không dựa trên snapshot cũ —
    // snapshot này đọc ngay trước bước enqueue, và job mới chỉ có thể là
    // chính job vừa tạo nên không cần đọc lại).
    return queued.filter((q) => !(byExternal[q.externalId] ?? []).some((j) => String(j.status) === "processing"));
  } catch (e) {
    console.error("[auto-enrollment:scan]", e);
    return [];
  }
}
function normalizeConfidenceColumn(v:unknown):'low'|'medium'|'high'|null{return v==='low'||v==='medium'||v==='high'?v:null;}

export async function scanRadar(db:SupabaseClient,radar:RadarSummary){
 const scanAt=new Date().toISOString();
 const q=db.from("market_listings").select("external_id,url,title,area_name,region_name,category_code,price_vnd,size_m2,price_per_m2,listed_at,last_seen_at,rooms").eq("area_v2",radar.areaV2).eq("is_rent",false).eq("is_promoted",false).eq("is_price_valid",true).order("last_seen_at",{ascending:false}).limit(1000);
 if(radar.categoryCode!=null)q.eq("category_code",radar.categoryCode);if(radar.priceMinVnd!=null)q.gte("price_vnd",radar.priceMinVnd);if(radar.priceMaxVnd!=null)q.lte("price_vnd",radar.priceMaxVnd);if(radar.areaMinM2!=null)q.gte("size_m2",radar.areaMinM2);if(radar.areaMaxM2!=null)q.lte("size_m2",radar.areaMaxM2);
const [matchRes,coverage,stats]=await Promise.all([q,getAreaCoverage(db,radar.areaV2),statsFor(db,radar)]);if(matchRes.error)throw matchRes.error;const found=matchRes.data??[];
  const candidates=found.map(r=>({...r,score:null,deal_type:null,is_ngop:null} as Row));
  // Lọc tín hiệu TRƯỚC khi đếm mới/upsert: tin chưa chấm điểm không bị loại.
  const rows=attachSignals<Row>(candidates,await signalIndexFor(db,candidates.map(r=>String(r.external_id))),{minScore:radar.minScore,dealTypes:radar.dealTypes,ngoPOnly:radar.ngoPOnly});
  // Enqueue TRƯỚC khi upsert để biết row nào cần mang enrichment_status='pending'
  // ngay trong payload upsert. Update trước upsert sẽ là no-op với row mới.
  let queued:QueuedEnrichment[]=[];
  if (radar.userId) { try { queued = await syncEnrichmentJobs(db, radar, rows as unknown as Record<string, unknown>[]); } catch (e) { console.error("[auto-enrollment:scan]", e); } }
  const pendingByExternal=new Map(queued.map(q=>[q.externalId,q.fingerprint]));
  const ids=rows.map(r=>String(r.external_id));let existingRows:Row[]=[];if(ids.length){const e=await db.from("radar_matches").select("external_id,first_matched_at,enrichment_status").eq("radar_id",radar.id).in("external_id",ids);if(e.error)throw e.error;existingRows=e.data??[];}
  const existing=new Map(existingRows.map(r=>[String(r.external_id),r]));let newCount=0;
  const mapped:Row[]=rows.map(r=>{const id=String(r.external_id),ppm=n(r.price_per_m2),cmp=comparison(pickStats(stats,n(r.size_m2),n(r.rooms)),ppm);const prev=existing.get(id);if(!prev)newCount++;
    // Row có job ĐANG processing (worker đã dispatch) thì không được đưa về pending.
    const liveProcessing=prev?.enrichment_status==='processing' && !pendingByExternal.has(id);
    // Row vừa enqueue -> pending; row khác giữ nguyên trạng thái đọc được (undefined
    // => không đụng cột, giá trị cũ của DB được giữ khi upsert).
    const enr:Row|undefined=pendingByExternal.has(id)&&!liveProcessing?{enrichment_status:'pending' as const,enrichment_source:'auto_enrichment' as const}:liveProcessing?{enrichment_status:'processing' as const}:undefined;
    const base:Row={radar_id:radar.id,external_id:id,url:s(r.url),title:s(r.title),area_name:s(r.area_name),region_name:s(r.region_name),category_code:n(r.category_code),price_vnd:n(r.price_vnd),size_m2:n(r.size_m2),price_per_m2:ppm,listed_at:s(r.listed_at),last_seen_at:s(r.last_seen_at),score:n(r.score),deal_type:s(r.deal_type),is_ngop:n(r.is_ngop),scoring_available:Boolean(r.scoring_available),median_ppm2:cmp?.medianPpm2??null,difference_percent:cmp?.differencePercent??null,confidence:cmp?.confidence??null,scope_description:cmp?.scopeDescription??null,first_matched_at:prev?String(prev.first_matched_at):scanAt,last_matched_at:scanAt};
    return enr?{...base,...enr}:base;});
  if(mapped.length){
    // Row đã tồn tại mà vừa enqueue lại (job terminal quá TTL được tái sử dụng) giữ cột
    // enrichment cũ trong DB. Bỏ 2 cột khỏi payload ở CẢ 2 lần upsert, nếu không
    // lần upsert đầy đủ sẽ ghi đè kết quả cũ bằng pending trước khi worker có kết quả mới.
    const keepExisting=(r:Row):Row=>{const id=String(r.external_id);if(!pendingByExternal.has(id)||!existing.has(id))return r;const copy:Row={...r};delete copy.enrichment_status;delete copy.enrichment_source;return copy;};
    const patchable:Row[]=mapped.filter(r=>pendingByExternal.has(String(r.external_id))&&existing.has(String(r.external_id))).map(keepExisting);
    if(patchable.length){const pu=await db.from("radar_matches").upsert(patchable,{onConflict:"radar_id,external_id"});if(pu.error)throw pu.error;}
    const u=await db.from("radar_matches").upsert(mapped.map(keepExisting),{onConflict:"radar_id,external_id"});if(u.error)throw u.error;
  }
 const finalCoverage={...coverage,checkedAt:scanAt};
 const u=await db.from("radars").update({checked_at:scanAt,last_seen_at:coverage.lastSeenAt,new_match_count:newCount,coverage_status:coverage.status,coverage_listing_count:coverage.listingCount,coverage_freshness:coverage.freshness,coverage_staleness:coverage.staleness,coverage_source:coverage.source,coverage_description:coverage.description,excluded_count:coverage.excludedCount,last_scan_count:rows.length,last_scan_error:null,updated_at:scanAt}).eq("id",radar.id);if(u.error)throw u.error;
 return{coverage:finalCoverage,matches:mapped.map(r=>mapMatch(r,radar)),newMatchCount:newCount};
}
export async function getRadarMatches(db:SupabaseClient,radar:RadarSummary){const {data,error}=await db.from("radar_matches").select("*").eq("radar_id",radar.id).order("last_matched_at",{ascending:false}).limit(100);if(error)throw error;return(data??[]).map(r=>mapMatch(r,radar));}
