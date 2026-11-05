/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          raised: "rgb(var(--color-surface-raised) / <alpha-value>)",
          overlay: "rgb(var(--color-surface-overlay) / <alpha-value>)",
          soft: "rgb(var(--color-surface-soft) / <alpha-value>)",
          border: "var(--color-border)",
        },
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          muted: "rgb(var(--color-accent-muted) / <alpha-value>)",
          dim: "rgb(var(--color-accent) / 0.14)",
          glow: "rgb(var(--color-accent) / 0.35)",
        },
        secondary: {
          DEFAULT: "rgb(var(--color-secondary, 139 92 246) / <alpha-value>)",
          dim: "rgb(var(--color-secondary, 139 92 246) / 0.14)",
        },
        success: {
          DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
          dim: "rgb(var(--color-success) / 0.12)",
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          dim: "rgb(var(--color-danger) / 0.12)",
        },
        warn: {
          DEFAULT: "rgb(var(--color-warn) / <alpha-value>)",
          dim: "rgb(var(--color-warn) / 0.12)",
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          muted: "rgb(var(--color-ink-muted) / <alpha-value>)",
          faint: "rgb(var(--color-ink-faint) / <alpha-value>)",
        },
        hover: {
          DEFAULT: "rgb(var(--color-hover) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        display: ['"Inter"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        soft: "var(--shadow-soft)",
        glow: "var(--shadow-glow)",
      },
      borderRadius: {
        card: "14px",
      },
      transitionDuration: {
        fast: "160ms",
        base: "200ms",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-6px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-in": "slide-in 200ms ease-out",
      },
    },
  },
  plugins: [],
};
