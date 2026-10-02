import { CATEGORY } from "@/lib/price/scope";
import type { RadarCriteria, RadarStatus } from "./types";
export const DEAL_TYPES=["ngop_ngon","thom_dau_tu","gia_cao","rui_ro_phap_ly","binh_thuong"] as const;
export type RadarFieldError="name"|"areaV2"|"price"|"area"|"categoryCode";
export interface RadarInput{name?:unknown;areaV2?:unknown;areaName?:unknown;regionName?:unknown;categoryCode?:unknown;priceMinVnd?:unknown;priceMaxVnd?:unknown;areaMinM2?:unknown;areaMaxM2?:unknown;minScore?:unknown;dealTypes?:unknown;ngoPOnly?:unknown;status?:unknown;}
export interface RadarValidation{ok:boolean;errors:Partial<Record<RadarFieldError,string>>;value:RadarCriteria|null;}
function num(v:unknown):number|null{if(v===null||v===undefined||v==="")return null;const n=typeof v==="number"?v:typeof v==="string"?Number(v.trim().replace(/,/g,".")):NaN;return Number.isFinite(n)?n:null;}
function int(v:unknown){const n=num(v);return n==null?null:Math.trunc(n);}
function category(v:unknown){const n=int(v);return n===CATEGORY.dat||n===CATEGORY.can_ho||n===CATEGORY.nha_o?n:null;}
function deals(v:unknown){if(!Array.isArray(v))return [];return [...new Set(v.filter((x):x is string=>typeof x==="string"&&(DEAL_TYPES as readonly string[]).includes(x)) )];}
export function validateRadarInput(i:RadarInput):RadarValidation{
 const errors:Partial<Record<RadarFieldError,string>>={};const name=typeof i.name==="string"?i.name.trim():"";const areaV2=int(i.areaV2);const categoryCode=category(i.categoryCode);
 const pmin=num(i.priceMinVnd),pmax=num(i.priceMaxVnd),amin=num(i.areaMinM2),amax=num(i.areaMaxM2);
 const priceMinVnd=pmin==null?null:Math.round(pmin),priceMaxVnd=pmax==null?null:Math.round(pmax);
 if(!name||name.length>60)errors.name="Đặt tên để bạn nhận ra Radar này.";
 if(areaV2==null||areaV2<=0)errors.areaV2="Chọn khu vực bạn muốn theo dõi.";
 if(priceMinVnd==null&&priceMaxVnd==null)errors.price="Đặt ít nhất một trong hai: giá tối thiểu hoặc giá tối đa.";
 else if(priceMinVnd!=null&&priceMaxVnd!=null&&priceMaxVnd<=priceMinVnd)errors.price="Giá tối đa phải lớn hơn giá tối thiểu.";
 if(amin==null&&amax==null)errors.area="Đặt ít nhất một trong hai: giá tối thiểu hoặc giá tối đa.".replace("giá","diện tích");
 else if(amin!=null&&amax!=null&&amax<=amin)errors.area="Diện tích tối đa phải lớn hơn diện tích tối thiểu.";
 const rawScore=num(i.minScore);const minScore=rawScore==null?null:Math.min(100,Math.max(0,Math.round(rawScore)));
 if(Object.keys(errors).length)return{ok:false,errors,value:null};
 return{ok:true,errors:{},value:{name,areaV2:areaV2!,areaName:typeof i.areaName==="string"&&i.areaName.trim()?i.areaName.trim():null,regionName:typeof i.regionName==="string"&&i.regionName.trim()?i.regionName.trim():null,categoryCode,priceMinVnd,priceMaxVnd,areaMinM2:amin,areaMaxM2:amax,minScore,dealTypes:deals(i.dealTypes),ngoPOnly:i.ngoPOnly===true,status:i.status==="PAUSED"?"PAUSED":"ACTIVE" as RadarStatus}};
}
export function listingMatchesCriteria(l:{categoryCode:number|null;priceVnd:number|null;sizeM2:number|null},c:Pick<RadarCriteria,"categoryCode"|"priceMinVnd"|"priceMaxVnd"|"areaMinM2"|"areaMaxM2">){
 if(c.categoryCode!=null&&l.categoryCode!==c.categoryCode)return false;if(c.priceMinVnd!=null&&(l.priceVnd==null||l.priceVnd<c.priceMinVnd))return false;if(c.priceMaxVnd!=null&&(l.priceVnd==null||l.priceVnd>c.priceMaxVnd))return false;if(c.areaMinM2!=null&&(l.sizeM2==null||l.sizeM2<c.areaMinM2))return false;if(c.areaMaxM2!=null&&(l.sizeM2==null||l.sizeM2>c.areaMaxM2))return false;return true;
}