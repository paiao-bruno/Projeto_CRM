import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variants = {
  green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  blue: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  red: "border-red-400/30 bg-red-400/10 text-red-300",
  slate: "border-slate-600 bg-slate-800/70 text-slate-300",
};

export function Badge({
  className,
  variant = "slate",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
