"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  FileText,
  GitBranch,
  Hash,
  Inbox,
  Kanban,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Plug,
  Receipt,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRequireAuth } from "@/components/auth-provider";
import { BRAND } from "@/lib/brand";
import { buildNavItems, ALL_NAV_ITEMS } from "@/lib/feature-flags";
import { inboxApi } from "@/lib/inbox-client";

const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  Inbox,
  Kanban,
  Users,
  FileText,
  Receipt,
  Bot,
  Plug,
  GitBranch,
  Megaphone,
  CalendarDays,
  Hash,
};

type Presence = "ONLINE" | "AWAY" | "OFFLINE";
const HEARTBEAT_MS = 30_000;

/** Layout único do site: menu, sessão, organização e presença compartilhados por todas as telas. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, token, loading, logout } = useRequireAuth();
  const [presence, setPresence] = useState<Presence>("ONLINE");
  const canChat = Boolean(user?.permissions?.includes("chat.read"));

  useEffect(() => {
    if (!token || !canChat) return;
    const send = (status: Presence) => void inboxApi.presence(token, status).catch(() => undefined);
    send(presence);
    if (presence === "OFFLINE") return;
    const timer = setInterval(() => send(presence), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [token, canChat, presence]);

  if (loading || !user || !token) {
    return <div className="flex min-h-screen items-center justify-center vx-muted">Carregando...</div>;
  }

  const navItems = buildNavItems(process.env, user.permissions ?? []);
  const current = ALL_NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const forbidden = Boolean(current?.permission && !user.permissions?.includes(current.permission));

  async function signOut() {
    if (token && canChat) await inboxApi.presence(token, "OFFLINE").catch(() => undefined);
    logout();
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r p-4 md:flex"
        style={{ borderColor: "var(--vx-border)", background: "var(--vx-surface)" }}
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ background: "var(--vx-primary)", color: "#fff" }}>
            {BRAND.initial}
          </span>
          <div>
            <p className="font-bold leading-tight">{BRAND.name}</p>
            <p className="text-xs vx-muted">{BRAND.tagline}</p>
          </div>
        </div>
        <nav aria-label="Principal" className="space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon] ?? LayoutDashboard;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
                style={active ? { background: "#EAF0FF", color: "var(--vx-primary)" } : { color: "var(--vx-muted)" }}
              >
                <Icon size={17} /> {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto text-xs vx-muted">
          <p className="font-semibold" style={{ color: "var(--vx-text)" }}>{user.tenantName}</p>
          <p>{user.role}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--vx-border)", background: "var(--vx-surface)" }}
        >
          <p className="text-sm font-semibold">{user.tenantName}</p>
          <div className="flex items-center gap-3">
            {canChat ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="vx-muted hidden sm:inline">Presença</span>
                <select
                  className="vx-input"
                  style={{ width: 120 }}
                  value={presence}
                  onChange={(event) => setPresence(event.target.value as Presence)}
                  aria-label="Minha presença"
                >
                  <option value="ONLINE">Online</option>
                  <option value="AWAY">Ausente</option>
                  <option value="OFFLINE">Offline</option>
                </select>
              </label>
            ) : null}
            <span className="hidden text-sm sm:inline">{user.name}</span>
            <button className="vx-btn" onClick={() => void signOut()} type="button">
              <LogOut size={15} /> Sair
            </button>
          </div>
        </header>
        <nav
          aria-label="Principal (mobile)"
          className="flex gap-1 overflow-x-auto border-b px-2 py-2 md:hidden"
          style={{ borderColor: "var(--vx-border)", background: "var(--vx-surface)" }}
        >
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold"
                style={active ? { background: "#EAF0FF", color: "var(--vx-primary)" } : { color: "var(--vx-muted)" }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <main className="min-h-0 flex-1 p-4 lg:p-6">
          {forbidden ? (
            <div className="vx-card mx-auto max-w-xl p-6">
              <h1 className="text-lg font-bold">Sem permissão</h1>
              <p className="mt-2 text-sm vx-muted">Seu perfil não tem acesso a esta área. Fale com o administrador da organização.</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
