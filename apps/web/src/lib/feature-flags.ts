export type FeatureFlagKey = "campaigns" | "flows" | "schedule" | "teamChat";

const FEATURE_ENV: Record<FeatureFlagKey, string> = {
  campaigns: "NEXT_PUBLIC_ENABLE_CAMPAIGNS",
  flows: "NEXT_PUBLIC_ENABLE_FLOWS",
  schedule: "NEXT_PUBLIC_ENABLE_SCHEDULE",
  teamChat: "NEXT_PUBLIC_ENABLE_TEAM_CHAT",
};

export function isFeatureEnabled(
  feature: FeatureFlagKey,
  env: Record<string, string | undefined> = process.env,
) {
  return env[FEATURE_ENV[feature]] === "true";
}

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Permissão exigida para exibir o item (mesmo mapeamento usado pelas rotas /api). */
  permission?: string;
  feature?: FeatureFlagKey;
};

export const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", permission: "dashboard.read" },
  { href: "/inbox", label: "Caixa de entrada", icon: "Inbox", permission: "chat.read" },
  { href: "/sales-funnel", label: "Funil de vendas", icon: "Kanban", permission: "sales_funnel.read" },
  { href: "/customers", label: "CRM / Clientes", icon: "Users", permission: "customers.manage" },
  { href: "/contracts", label: "Contratos", icon: "FileText", permission: "customers.manage" },
  { href: "/invoices", label: "Faturas", icon: "Receipt", permission: "customers.manage" },
  { href: "/ai-agents", label: "Agentes", icon: "Bot", permission: "ai_agents.manage" },
  { href: "/integrations", label: "Integrações", icon: "Plug", permission: "crm.manage" },
  { href: "/flows", label: "Flows", icon: "GitBranch", feature: "flows" },
  { href: "/campaigns", label: "Campanhas", icon: "Megaphone", feature: "campaigns" },
  { href: "/schedule", label: "Agenda", icon: "CalendarDays", feature: "schedule" },
  { href: "/team-chat", label: "Chat interno", icon: "Hash", feature: "teamChat" },
];

export function buildNavItems(
  env: Record<string, string | undefined> = process.env,
  permissions?: readonly string[],
) {
  const granted = permissions ? new Set(permissions) : null;
  return ALL_NAV_ITEMS.filter((item) => {
    if (item.feature && !isFeatureEnabled(item.feature, env)) return false;
    if (granted && item.permission && !granted.has(item.permission)) return false;
    return true;
  });
}

/** Primeira rota permitida: destino padrão após login e na raiz do site. */
export function defaultLandingPath(permissions: readonly string[] | undefined): string {
  const first = buildNavItems({}, permissions ?? []).find((item) => item.permission);
  return first?.href ?? "/inbox";
}

export const MOCK_FEATURE_ROUTES: Record<FeatureFlagKey, string> = {
  campaigns: "/campaigns",
  flows: "/flows",
  schedule: "/schedule",
  teamChat: "/team-chat",
};

export function isMockRouteEnabled(pathname: string, env: Record<string, string | undefined> = process.env) {
  for (const [feature, route] of Object.entries(MOCK_FEATURE_ROUTES) as Array<[FeatureFlagKey, string]>) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return isFeatureEnabled(feature, env);
    }
  }

  return true;
}
