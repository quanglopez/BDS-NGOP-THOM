import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
export function FieldError({id,children}:{id:string;children:ReactNode}){return <p id={id} role="alert" className="mt-1 flex items-start gap-1.5 text-small text-risk-high"><AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0"/>{children}</p>;}