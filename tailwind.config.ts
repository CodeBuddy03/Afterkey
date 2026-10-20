import type { Config } from "tailwindcss";

/**
 * AfterKey premium glass design system.
 *
 * Deep midnight foundation, translucent glass surfaces, fine silver borders,
 * restrained blue-violet accents, muted white typography. Existing class names
 * (navy/ivory/champagne/line/…) are preserved; their VALUES define the dark
 * glass language so every surface reskins consistently:
 *
 *   navy   → primary text / headings (light on dark) + tints
 *   ivory  → page + panel backgrounds (deep, layered)
 *   champagne → blue-violet accent family
 *   line   → fine silver borders
 *   surface → translucent glass fill
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary text + tinted surfaces (light values for dark canvas).
        navy: {
          DEFAULT: "#F5F6FA",
          50: "rgba(255,255,255,0.05)",
          100: "rgba(255,255,255,0.10)",
          200: "#39404F", // disabled / inert
          300: "#4A5165",
          400: "#5D6478",
          500: "#727A90",
          600: "#8F96AB",
          700: "#C9CDD8", // banner text on tint
          800: "#E4E7EF",
          900: "#0B0D14", // ink (text on light accents)
        },
        // Page + panel backgrounds.
        ivory: {
          DEFAULT: "#07080C",
          100: "#0D1017",
          200: "#141824",
        },
        charcoal: "#C9CDD8", // body text
        muted: "#A2A7B4", // secondary text
        // Blue-violet accent family.
        champagne: {
          DEFAULT: "#B6A2FF",
          600: "#9BB8FF",
          700: "#CFC2FF",
        },
        accent: {
          DEFAULT: "#9BB8FF",
          violet: "#B6A2FF",
        },
        confirmed: {
          DEFAULT: "#5FCF95",
          50: "rgba(95,207,149,0.12)",
          700: "#8FE0B6",
        },
        warn: {
          DEFAULT: "#E3B34C",
          50: "rgba(227,179,76,0.12)",
          700: "#F0CC84",
        },
        danger: {
          DEFAULT: "#F08080",
          50: "rgba(240,128,128,0.12)",
          700: "#F5A9A9",
        },
        // Fine silver borders + glass fills.
        line: "rgba(255,255,255,0.09)",
        "line-dark": "rgba(255,255,255,0.16)",
        surface: "rgba(255,255,255,0.045)",
        "surface-2": "rgba(255,255,255,0.08)",
        ink: "#0B0D14",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["var(--font-serif)", "Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.35), 0 10px 30px rgba(0,0,0,0.22)",
        pop: "0 12px 40px rgba(0,0,0,0.45)",
        glow: "0 0 0 1px rgba(155,184,255,0.25), 0 8px 30px rgba(155,184,255,0.12)",
      },
      borderRadius: {
        card: "14px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-slow": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "fade-in-slow": "fade-in-slow 700ms ease-out both",
        "rise-in": "rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
