"use client";

import { isWebOnlyMode, LEGACY_API_UNAVAILABLE_MESSAGE } from "@/lib/runtime-config";

export function LegacyApiUnavailableAlert() {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100">
      {LEGACY_API_UNAVAILABLE_MESSAGE}
    </div>
  );
}

/** Banner discreto no topo — não substitui a página inteira. */
export function WebOnlyApiBanner() {
  if (!isWebOnlyMode()) return null;

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <span className="font-medium">Modo web-only:</span>{" "}
      esta página está visível, mas ações que dependem da API NestJS (porta 4000) estão
      temporariamente desativadas. Use o Funil de Vendas para operações ativas.
    </div>
  );
}

export function WebOnlyDisabledHint({ action }: { action: string }) {
  if (!isWebOnlyMode()) return null;
  return (
    <p className="text-xs text-amber-200/90">
      {action} indisponível no modo web-only — API NestJS desligada.
    </p>
  );
}

/** Retorna true quando a página legada deve bloquear chamadas à API NestJS. */
export function isLegacyApiUnavailableInWebOnly(): boolean {
  return isWebOnlyMode();
}

type LegacyApiPageShellProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

/** Usado por CRM/Contratos/Faturas — preserva estrutura existente com aviso. */
export function LegacyApiPageShell({ title, description, children }: LegacyApiPageShellProps) {
  if (isWebOnlyMode()) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-white">{title}</h1>
          {description ? <p className="mt-1 text-slate-400">{description}</p> : null}
        </div>
        <WebOnlyApiBanner />
        {children}
      </div>
    );
  }

  return <>{children}</>;
}
