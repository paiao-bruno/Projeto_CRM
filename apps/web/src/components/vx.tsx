"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";

export function formatCents(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function toDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="vx-page-title">{title}</h1>
        {subtitle ? <p className="text-sm vx-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="vx-label">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: "rgba(23,32,51,.45)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="vx-card max-h-full w-full max-w-lg overflow-auto p-5">
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ErrorAlert({ message }: { message: string | null }) {
  return message ? (
    <div role="alert" className="vx-alert vx-alert-error mb-3">
      {message}
    </div>
  ) : null;
}

/** Carrega um recurso autenticado das rotas /api e expõe reload; erro e vazio são estados distintos. */
export function useResource<T>(path: string | null) {
  const { token } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!token || !path) return;
    try {
      setData(await api.get<T>(path, token));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, [token, path]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { data, error, loading, reload, token };
}

export const statusLabels: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  OVERDUE: "Inadimplente",
  CHURNED: "Cancelado",
  PROSPECT: "Prospect",
  SUSPENDED: "Suspenso",
  CANCELED: "Cancelado",
  UNKNOWN: "Indefinido",
  OPEN: "Em aberto",
  PAID: "Paga",
};
