"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  FileText,
  GitBranch,
  Hash,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Plug,
  RadioTower,
  Receipt,
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
  { href: "/contracts", label: "Contratos", icon: FileText },
  { href: "/invoices", label: "Faturas", icon: Receipt },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/schedule", label: "Schedule", icon: CalendarDays, badge: "Acquire" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, logout } = useRequireAuth();

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-300">
        Carregando aplicacao...
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_1fr]">
      <aside className="hidden border-r border-slate-800/80 bg-slate-950/70 p-5 lg:flex lg:flex-col">
        <div className="mb-8 flex items-center gap-3 rounded-2xl">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
            <RadioTower size={22} />
          </span>
          <div>
            <p className="font-bold text-white">ISP CRM</p>
            <p className="text-xs text-slate-500">SaaS multitenant</p>
          </div>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <div key={item.href}>
                <Link
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition",
                    active
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
                            childActive
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

        <div className="mt-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-sm font-bold text-slate-200">
              L
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">{user.tenantName}</p>
              <Badge>{user.role}</Badge>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/70 px-4 py-4 backdrop-blur-xl lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="hidden items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-slate-500 md:flex">
              <Search size={17} />
              <span className="text-sm">Buscar conversas, clientes e agentes...</span>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-semibold text-white">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={logout}>
                <LogOut size={16} />
                Sair
              </Button>
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
