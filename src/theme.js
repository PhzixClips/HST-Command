// Shared style constants – Clean Dark theme
// One accent color, soft backgrounds, system font for UI, mono for output only

export const T = {
  // Backgrounds
  bg: "#121218",
  cardBg: "#1a1a24",
  inputBg: "#16161e",
  border: "#2a2a36",
  borderHover: "#3a3a48",

  // Text
  text: "#d4d4dc",
  textDim: "#6b6b7b",
  textMuted: "#4a4a58",

  // Single accent + semantic colors (less is more)
  accent: "#6b8afd",       // primary actions, active states, links
  accentDim: "#4a6acc",    // secondary/hover states
  green: "#6b8afd",        // alias → accent (keeps existing refs working)
  blue: "#6b8afd",         // alias → accent
  purple: "#6b8afd",       // alias → accent

  warn: "#d4a040",         // warnings, AI-filled badges (muted gold)
  amber: "#d4a040",        // alias → warn

  danger: "#e05555",       // denied fees, errors, delete
  red: "#e05555",          // alias → danger

  success: "#4ade80",      // brief confirmations (copied!, saved!)
  orange: "#d4a040",       // alias → warn

  // Typography
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
};

export const inputStyle = {
  background: T.inputBg,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  color: T.text,
  fontFamily: T.font,
  fontSize: 13,
  padding: "9px 12px",
  width: "100%",
  outline: "none",
  transition: "border-color 0.15s",
};

export const labelStyle = {
  color: T.textDim,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  marginBottom: 4,
  display: "block",
  fontFamily: T.font,
};

export const btnStyle = (color = T.accent, small = false) => ({
  background: `${color}12`,
  border: `1px solid ${color}33`,
  color: color,
  fontFamily: T.font,
  fontSize: small ? 11 : 12,
  fontWeight: 500,
  letterSpacing: 0.5,
  padding: small ? "5px 12px" : "8px 18px",
  borderRadius: 6,
  cursor: "pointer",
  textTransform: "uppercase",
  transition: "all 0.15s",
});
