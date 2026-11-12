import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  presets: ["@pandacss/preset-base"],
  preflight: true,
  include: ["./src/**/*.{ts,tsx}"],
  outdir: "styled-system",
  globalCss: {
    ":root": {
      colorScheme: "dark",
      fontFamily: '"Inter Variable", -apple-system, "Segoe UI", sans-serif',
      fontFeatureSettings: '"cv11", "ss01"',
      fontSize: "15px",
      color: "fg",
      background: "canvas",
      WebkitFontSmoothing: "antialiased",
      textRendering: "optimizeLegibility",
    },
    body: { background: "canvas", minHeight: "100vh" },
    "button, a, summary": { WebkitTapHighlightColor: "transparent" },
    "button:not(:disabled), summary": { cursor: "pointer" },
    "button:disabled": { cursor: "not-allowed", opacity: 0.45 },
    ":focus-visible": {
      outline: "2px solid {colors.focus}",
      outlineOffset: "2px",
    },
    "code, pre, kbd": { fontFamily: "mono" },
    "@media (prefers-reduced-motion: reduce)": {
      "*, *::before, *::after": {
        transition: "none !important",
        animation: "none !important",
      },
    },
  },
  theme: {
    extend: {
      breakpoints: { sm: "640px", md: "900px", lg: "1280px" },
      tokens: {
        colors: {
          canvas: { value: "#000000" },
          card: { value: "#0f0f10" },
          raised: { value: "#18181a" },
          hover: { value: "#202023" },
          active: { value: "#2a2a2e" },
          line: { value: "#1f1f22" },
          edge: { value: "#2c2c30" },
          fg: { value: "#ededef" },
          dim: { value: "#9b9ba1" },
          faint: { value: "#68686e" },
          focus: { value: "#8aa4ff" },
          claude: { value: "#e8835f" },
          codex: { value: "#7d9ef5" },
          ok: { value: "#4fbf7f" },
          warn: { value: "#e0b34f" },
          bad: { value: "#ef6b63" },
        },
        fonts: {
          mono: {
            value:
              '"SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
          },
        },
        radii: {
          card: { value: "16px" },
          control: { value: "10px" },
          full: { value: "9999px" },
        },
      },
      recipes: {
        button: {
          className: "button",
          base: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            height: "40px",
            paddingInline: "16px",
            borderRadius: "control",
            fontSize: "15px",
            fontWeight: 500,
            whiteSpace: "nowrap",
            transition: "background 0.12s, color 0.12s",
          },
          variants: {
            variant: {
              primary: {
                background: "fg",
                color: "#0b0b0c",
                _hover: { background: "#ffffff" },
              },
              secondary: {
                background: "raised",
                color: "fg",
                _hover: { background: "hover" },
              },
              ghost: {
                color: "dim",
                _hover: { color: "fg", background: "raised" },
              },
              danger: {
                background: "bad",
                color: "#140606",
                _hover: { background: "#ff8079" },
              },
            },
            size: {
              md: {},
              sm: {
                height: "32px",
                paddingInline: "12px",
                fontSize: "14px",
                borderRadius: "8px",
              },
            },
          },
          defaultVariants: { variant: "secondary", size: "md" },
        },
        iconButton: {
          className: "icon-button",
          base: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            color: "dim",
            flexShrink: 0,
            transition: "background 0.12s, color 0.12s",
            _hover: { color: "fg", background: "raised" },
          },
        },
        field: {
          className: "field",
          base: {
            width: "100%",
            height: "40px",
            paddingInline: "12px",
            borderRadius: "control",
            background: "raised",
            border: "1px solid transparent",
            color: "fg",
            fontSize: "15px",
            _placeholder: { color: "faint" },
            _hover: { borderColor: "edge" },
            _focusVisible: { outline: "none", borderColor: "focus" },
          },
        },
      },
      keyframes: {
        spin: { to: { transform: "rotate(360deg)" } },
      },
    },
  },
});
