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
  background: "#1E2024",
  surface: "#32363B",
  text: "#F1F3F5",
  textMuted: "#A4ADB8",
  primary: "#2271B1",
  secondary: "#D4A04D",
  border: "#454B52",
  success: "#46A775",
  danger: "#D96B70",
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
