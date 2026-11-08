/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./site.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
        // Text on filled accent/status surfaces (dark navy in dark theme, white in light).
        "on-accent": "rgb(var(--color-on-accent, 255 255 255) / <alpha-value>)",
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
        control: "10px",
      },
      // Motion system: one easing family, three speeds. Keep animations to transform/opacity.
      transitionDuration: {
        fast: "140ms", // hovers, presses, toggles
        base: "220ms", // component enter/exit, expand/collapse
        slow: "420ms", // page-level reveals, progress fills
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.22, 1, 0.36, 1)", // decelerate: things arriving
        "in-out": "cubic-bezier(0.65, 0, 0.35, 1)", // moving between states
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-6px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.12)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
        float: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -14px, 0)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" },
        },
        "status-ping": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-up": "fade-up 420ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in": "slide-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "toast-in": "toast-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        pop: "pop 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        float: "float 9s ease-in-out infinite",
        "float-slow": "float 13s ease-in-out infinite",
        "gradient-pan": "gradient-pan 16s ease-in-out infinite",
        shimmer: "shimmer 1.4s ease-in-out infinite",
        "status-ping": "status-ping 900ms cubic-bezier(0, 0, 0.2, 1) 1",
      },
    },
  },
  plugins: [],
};
