"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useRequireAuth } from "@/components/auth-provider";
import { BRAND } from "@/lib/brand";
import { inboxApi } from "@/lib/inbox-client";
import { isWebOnlyMode } from "@/lib/runtime-config";

type Presence = "ONLINE" | "AWAY" | "OFFLINE";
const HEARTBEAT_MS = 30_000;

export function VerticeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, token, loading, logout } = useRequireAuth();
  const [presence, setPresence] = useState<Presence>("ONLINE");

  useEffect(() => {
    if (!token || !isWebOnlyMode()) return;
    const send = (status: Presence) => void inboxApi.presence(token, status).catch(() => undefined);
    send(presence);
    if (presence === "OFFLINE") return;
    const timer = setInterval(() => send(presence), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [token, presence]);

  if (loading || !user || !token) {
    return <div className="flex h-full items-center justify-center vx-muted">Carregando...</div>;
  }

  async function signOut() {
    if (token && isWebOnlyMode()) await inboxApi.presence(token, "OFFLINE").catch(() => undefined);
    logout();
  }

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r p-4 md:flex" style={{ borderColor: "var(--vx-border)", background: "var(--vx-surface)" }}>
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ background: "var(--vx-primary)" }}>
            {BRAND.initial}
          </span>
          <div>
            <p className="font-bold leading-tight">{BRAND.name}</p>
            <p className="text-xs vx-muted">{BRAND.tagline}</p>
          </div>
        </div>
        <nav className="space-y-1">
          <Link
            href="/inbox"
            aria-current={pathname === "/inbox" ? "page" : undefined}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
            style={pathname === "/inbox" ? { background: "#EAF0FF", color: "var(--vx-primary)" } : { color: "var(--vx-muted)" }}
          >
            <Inbox size={17} /> Caixa de entrada
          </Link>
        </nav>
        <div className="mt-auto space-y-2 text-xs vx-muted">
          <Link className="underline" href="/sales-funnel">
            Voltar aos módulos atuais (Funil, CRM)
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--vx-border)", background: "var(--vx-surface)" }}>
          <p className="text-sm font-semibold">{user.tenantName}</p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="vx-muted">Presença</span>
              <select
                className="vx-input"
                style={{ width: 130 }}
                value={presence}
                onChange={(event) => setPresence(event.target.value as Presence)}
                aria-label="Minha presença"
              >
                <option value="ONLINE">Online</option>
                <option value="AWAY">Ausente</option>
                <option value="OFFLINE">Offline</option>
              </select>
            </label>
            <span className="hidden text-sm sm:inline">{user.name}</span>
            <button className="vx-btn" onClick={() => void signOut()} type="button">
              <LogOut size={15} /> Sair
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
