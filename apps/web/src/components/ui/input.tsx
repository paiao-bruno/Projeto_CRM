import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-slate-700 bg-[var(--vx-input)] px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[var(--vx-primary)] focus:ring-2 focus:ring-[color:var(--vx-primary)]/20",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
