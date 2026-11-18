/**
 * Fonte única de marca e tema do Vértice (nome provisório).
 * Trocar nome, tagline ou paleta aqui e em `theme.css` (os valores são verificados por teste).
 */
export const BRAND = {
  name: "Vértice",
  tagline: "Atendimento, CRM e automação",
  initial: "V",
} as const;

export const THEME = {
  background: "#081C2F",
  surface: "#102A43",
  text: "#F8F5E6",
  textMuted: "#C4BFA8",
  primary: "#D4AF37",
  secondary: "#243B53",
  border: "#243B53",
  success: "#3D7A5A",
  danger: "#C45B5B",
} as const;

export type ThemeToken = keyof typeof THEME;

export const THEME_CSS_VARS: Record<ThemeToken, string> = {
  background: "--vx-bg",
  surface: "--vx-surface",
  text: "--vx-text",
  textMuted: "--vx-muted",
  primary: "--vx-primary",
  secondary: "--vx-secondary",
  border: "--vx-border",
  success: "--vx-success",
  danger: "--vx-danger",
};
