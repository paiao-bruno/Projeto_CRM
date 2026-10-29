import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

/** Moldura única das telas públicas (login, recuperação): mesma marca e tema do restante do site. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6" style={{ background: "var(--vx-bg)" }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ background: "var(--vx-primary)" }} aria-hidden>
            {BRAND.initial}
          </span>
          <div>
            <p className="text-lg font-bold leading-tight">{BRAND.name}</p>
            <p className="text-sm vx-muted">{BRAND.tagline}</p>
          </div>
        </div>
        <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: "var(--vx-border)" }}>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm vx-muted">{subtitle}</p> : null}
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </main>
  );
}
