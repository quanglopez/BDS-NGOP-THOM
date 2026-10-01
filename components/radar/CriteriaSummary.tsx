import { criteriaSummary } from "@/lib/radar/format";
import type { RadarCriteria } from "@/lib/radar/types";
export function CriteriaSummary({radar}:{radar:RadarCriteria}){const text=criteriaSummary(radar);return <p className="truncate text-small text-ink-600" title={text}>{text}</p>;}