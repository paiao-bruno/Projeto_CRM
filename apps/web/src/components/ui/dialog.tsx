"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950 p-0 text-slate-100 shadow-2xl outline-none",
          className,
        )}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-5 top-5 rounded-full p-2 text-slate-500 transition hover:bg-slate-900 hover:text-white">
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="border-b border-slate-800 p-6 pr-14">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <DialogPrimitive.Title className="text-xl font-semibold text-white">{children}</DialogPrimitive.Title>;
}

export function DialogDescription({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Description className="mt-1 text-sm text-slate-400">
      {children}
    </DialogPrimitive.Description>
  );
}
