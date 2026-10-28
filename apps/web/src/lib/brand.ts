/**
 * Fonte única de marca e tema do Vértice (nome provisório).
 * Trocar nome, tagline ou paleta aqui e em `vertice.css` (os valores são verificados por teste).
 */
export const BRAND = {
  name: "Vértice",
  tagline: "Atendimento, CRM e automação",
  initial: "V",
} as const;

export const THEME = {
  background: "#F5F7FB",
  surface: "#FFFFFF",
  text: "#172033",
  textMuted: "#64748B",
  primary: "#365CF5",
  secondary: "#F28C6F",
  border: "#E2E8F0",
  success: "#15803D",
  danger: "#DC2626",
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
