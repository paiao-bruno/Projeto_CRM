"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  GitBranch,
  Hash,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Plug,
  RadioTower,
  Search,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useRequireAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ai-agents", label: "Agents", icon: Bot },
  { href: "/flows", label: "Flows", icon: GitBranch },
  { href: "/integrations", label: "Integrations", icon: Plug },
  {
    href: "/chat",
    label: "Chat",
    icon: MessageCircle,
    children: [{ href: "/team-chat", label: "Team", icon: Hash }],
  },
  { href: "/customers", label: "CRM", icon: Users },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, badge: "Acquire" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, logout } = useRequireAuth();
  const isTeamChat = pathname === "/team-chat";

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-300">
        Carregando aplicacao...
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-screen lg:grid lg:grid-cols-[280px_1fr]",
        isTeamChat && "bg-slate-50 text-slate-950",
      )}
    >
      <aside
        className={cn(
          "hidden border-r p-5 lg:flex lg:flex-col",
          isTeamChat
            ? "border-slate-200 bg-white text-slate-700"
            : "border-slate-800/80 bg-slate-950/70",
        )}
      >
        <div
          className={cn(
            "mb-8 flex items-center gap-3 rounded-2xl",
            isTeamChat && "border border-slate-200 bg-white p-2 shadow-sm",
          )}
        >
          {isTeamChat ? (
            <div className="flex h-14 flex-1 items-center justify-center rounded-xl bg-blue-950 text-2xl font-bold tracking-tight text-white">
              Web<span className="text-orange-400">+</span>
            </div>
          ) : (
            <>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
                <RadioTower size={22} />
              </span>
              <div>
                <p className="font-bold text-white">ISP CRM</p>
                <p className="text-xs text-slate-500">SaaS multitenant</p>
              </div>
            </>
          )}
        </div>

        <nav className="space-y-2">
          {navItems.map((item, index) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <div key={item.href}>
                {isTeamChat && index === 1 ? (
                  <p className="px-3 pb-2 pt-4 text-[11px] font-bold uppercase tracking-[0.28em] text-slate-400">
                    Core API
                  </p>
                ) : null}
                <Link
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition",
                    isTeamChat
                      ? active
                        ? "bg-violet-50 text-slate-900 ring-1 ring-violet-100"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      : active
                        ? "bg-emerald-400 text-slate-950"
                        : "text-slate-400 hover:bg-slate-900 hover:text-white",
                  )}
                  href={item.href}
                >
                  <Icon size={18} />
                  <span className="flex-1">{item.label}</span>
                  {"badge" in item && item.badge ? (
                    <Badge className="border-cyan-200 bg-cyan-50 text-[10px] text-cyan-500">
                      {item.badge}
                    </Badge>
                  ) : null}
                </Link>
                {item.children ? (
                  <div className="mt-1 space-y-1 pl-6">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      const childActive = pathname === child.href;
                      return (
                        <Link
                          className={cn(
                            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                            isTeamChat
                              ? childActive
                                ? "bg-violet-100 text-slate-900 ring-1 ring-violet-200"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                              : childActive
                                ? "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/20"
                                : "text-slate-500 hover:bg-slate-900 hover:text-white",
                          )}
                          href={child.href}
                          key={child.href}
                        >
                          <ChildIcon size={16} />
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div
          className={cn(
            "mt-auto rounded-2xl border p-4",
            isTeamChat
              ? "border-slate-200 bg-violet-50/60"
              : "border-slate-800 bg-slate-900/60",
          )}
        >
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold",
                isTeamChat
                  ? "bg-lime-100 text-slate-900"
                  : "bg-slate-950 text-slate-200",
              )}
            >
              L
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
            </span>
            <div>
              <p className={cn("text-sm font-semibold", isTeamChat ? "text-slate-900" : "text-white")}>
                {isTeamChat ? "Lucca" : user.tenantName}
              </p>
              <Badge className={cn(isTeamChat ? "border-violet-200 bg-violet-100 text-[10px] text-violet-600" : "")}>
                {isTeamChat ? "Manager" : user.role}
              </Badge>
            </div>
          </div>
          {isTeamChat ? (
            <button
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-50"
              onClick={logout}
              type="button"
            >
              <LogOut size={15} />
              Logout
            </button>
          ) : null}
        </div>
      </aside>

      <main className="min-w-0">
        <header
          className={cn(
            "sticky top-0 z-20 border-b px-4 py-4 backdrop-blur-xl lg:px-8",
            isTeamChat
              ? "border-slate-200 bg-white/90"
              : "border-slate-800/80 bg-slate-950/70",
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div
              className={cn(
                "hidden items-center gap-3 rounded-xl border px-3 py-2 md:flex",
                isTeamChat
                  ? "border-slate-200 bg-slate-50 text-slate-400"
                  : "border-slate-800 bg-slate-900/60 text-slate-500",
              )}
            >
              <Search size={17} />
              <span className="text-sm">Buscar conversas, clientes e agentes...</span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className={cn("text-sm font-semibold", isTeamChat ? "text-slate-900" : "text-white")}>
                  {user.name}
                </p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={logout}>
                <LogOut size={16} />
                Sair
              </Button>
            </div>
          </div>
        </header>

        <div className={cn("p-4 lg:p-8", isTeamChat && "bg-slate-50")}>{children}</div>
      </main>
    </div>
  );
}
