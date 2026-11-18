import { TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-28 w-full rounded-xl border border-slate-700 bg-[var(--vx-input)] px-3 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[var(--vx-primary)] focus:ring-2 focus:ring-[color:var(--vx-primary)]/20",
      className,
    )}
    {...props}
  />
));

Textarea.displayName = "Textarea";
