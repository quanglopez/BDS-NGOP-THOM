import type { PriceConfidence } from "@/lib/price/types";
export type RadarStatus="ACTIVE"|"PAUSED";
export type CoverageStatus="ok"|"thin"|"none"|"unknown";
export type Staleness="fresh"|"stale"|"unknown";
export type AutoEnrollmentStatus="not_started"|"pending"|"processing"|"completed"|"insufficient_data"|"low_confidence"|"failed";
export interface RadarAutoEnrichment{status:AutoEnrollmentStatus;score:number|null;dealType:string|null;isNgoP:number|null;source:"auto_enrichment"|"manual_check";confidence:"low"|"medium"|"high"|null;checkedAt:string|null;fingerprint:string|null;}

export interface RadarCriteria{name:string;areaV2:number;areaName:string|null;regionName:string|null;categoryCode:number|null;priceMinVnd:number|null;priceMaxVnd:number|null;areaMinM2:number|null;areaMaxM2:number|null;minScore:number|null;dealTypes:string[];ngoPOnly:boolean;status:RadarStatus;}
export interface RadarCoverage{status:CoverageStatus;lastSeenAt:string|null;freshness:string|null;staleness:Staleness;listingCount:number|null;checkedAt:string|null;source:string;description:string|null;excludedCount:number|null;}
export interface RadarComparison{medianPpm2:number|null;differencePercent:number|null;confidence:PriceConfidence|null;scopeDescription:string|null;}
export interface RadarMatch{externalId:string;url:string|null;title:string|null;areaName:string|null;regionName:string|null;categoryCode:number|null;priceVnd:number|null;sizeM2:number|null;pricePerM2:number|null;listedAt:string|null;lastSeenAt:string|null;score:number|null;dealType:string|null;isNgoP:number|null;scoringAvailable:boolean;comparison:RadarComparison|null;firstMatchedAt:string;lastMatchedAt:string;currentMatch:boolean;auto_enrichment?:RadarAutoEnrichment|null;}
export interface RadarSummary extends RadarCriteria{id:string;userId?:string|null;createdAt:string;updatedAt:string;coverage:RadarCoverage;newMatchCount:number;lastScanCount:number|null;lastScanError:string|null;}
export interface RadarAreaOption{areaV2:number;areaName:string;regionName:string;}