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
  badge?: string;
  feature?: FeatureFlagKey;
  children?: Array<{
    href: string;
    label: string;
    icon: string;
    feature?: FeatureFlagKey;
  }>;
};

export const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/ai-agents", label: "Agents", icon: "Bot" },
  { href: "/flows", label: "Flows", icon: "GitBranch", feature: "flows" },
  { href: "/integrations", label: "Integrations", icon: "Plug" },
  {
    href: "/chat",
    label: "Chat",
    icon: "MessageCircle",
    children: [{ href: "/team-chat", label: "Team", icon: "Hash", feature: "teamChat" }],
  },
  { href: "/customers", label: "CRM", icon: "Users" },
  { href: "/contracts", label: "Contratos", icon: "FileText" },
  { href: "/invoices", label: "Faturas", icon: "Receipt" },
  { href: "/campaigns", label: "Campaigns", icon: "Megaphone", feature: "campaigns" },
  {
    href: "/schedule",
    label: "Schedule",
    icon: "CalendarDays",
    badge: "Acquire",
    feature: "schedule",
  },
];

export function buildNavItems(env: Record<string, string | undefined> = process.env) {
  return ALL_NAV_ITEMS.flatMap((item) => {
    if (item.feature && !isFeatureEnabled(item.feature, env)) {
      return [];
    }

    const children = item.children?.filter(
      (child) => !child.feature || isFeatureEnabled(child.feature, env),
    );

    if (item.children && item.children.length > 0 && (!children || children.length === 0)) {
      return [{ ...item, children: undefined }];
    }

    return [{ ...item, children }];
  });
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
