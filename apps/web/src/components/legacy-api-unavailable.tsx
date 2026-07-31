"use client";

import { isWebOnlyMode, LEGACY_API_UNAVAILABLE_MESSAGE } from "@/lib/runtime-config";

export function LegacyApiUnavailableAlert() {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
      {LEGACY_API_UNAVAILABLE_MESSAGE}
    </div>
  );
}

/** Retorna true quando a página legada deve exibir aviso e não chamar a API NestJS. */
export function isLegacyApiUnavailableInWebOnly(): boolean {
  return isWebOnlyMode();
}

type LegacyApiPageShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

/** Exibe aviso controlado no modo web-only; renderiza children no modo completo. */
export function LegacyApiPageShell({ title, description, children }: LegacyApiPageShellProps) {
  if (isWebOnlyMode()) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-white">{title}</h1>
          {description ? <p className="mt-1 text-slate-400">{description}</p> : null}
        </div>
        <LegacyApiUnavailableAlert />
      </div>
    );
  }

  return <>{children}</>;
}
