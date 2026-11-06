import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  presets: ["@pandacss/preset-base", "@pandacss/preset-panda"],
  preflight: false,
  include: ["./src/**/*.{ts,tsx}"],
  outdir: "styled-system",
  globalCss: {
    ":root": {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: "fg.default",
      background: "canvas",
      fontSynthesis: "none",
      textRendering: "optimizeLegibility",
      WebkitFontSmoothing: "antialiased",
      colorScheme: "dark",
    },
    "*": {
      boxSizing: "border-box",
      "@media (prefers-reduced-motion: reduce)": {
        animation: "none !important",
        transition: "none !important",
      },
    },
    body: {
      margin: "0",
    },
    button: {
      font: "inherit",
      WebkitTapHighlightColor: "transparent",
      cursor: "pointer",
      outlineOffset: "4px",
      color: "inherit",
    },
    input: {
      font: "inherit",
      WebkitTapHighlightColor: "transparent",
      outlineOffset: "4px",
      border: "1px solid #303037",
      borderRadius: "6px",
      background: "#121215",
      color: "#d5d5df",
      minHeight: "34px",
      padding: "8px 10px",
      fontSize: "11px",
    },
    select: {
      font: "inherit",
      WebkitTapHighlightColor: "transparent",
      outlineOffset: "4px",
      border: "1px solid #303037",
      borderRadius: "6px",
      background: "#121215",
      color: "#d5d5df",
      minHeight: "34px",
      padding: "8px 10px",
      fontSize: "11px",
      cursor: "pointer",
    },
    a: {
      WebkitTapHighlightColor: "transparent",
      outlineOffset: "4px",
      color: "inherit",
      textDecoration: "none",
    },
    "button:disabled": {
      cursor: "not-allowed",
      opacity: 0.45,
    },
    "button:focus-visible": {
      outline: "2px solid #b3b6dc",
    },
    "a:focus-visible": {
      outline: "2px solid #b3b6dc",
    },
    "input:focus-visible": {
      outline: "2px solid #b3b6dc",
    },
    "select:focus-visible": {
      outline: "2px solid #b3b6dc",
    },
    h1: {
      margin: "0",
      fontSize: "25px",
      lineHeight: 1.35,
      fontWeight: 600,
      letterSpacing: "-0.8px",
    },
    h2: {
      margin: "0",
      fontSize: "14px",
      fontWeight: 550,
      letterSpacing: "-0.2px",
    },
    h3: {
      margin: "0",
      fontSize: "14px",
      fontWeight: 550,
    },
    p: {
      margin: "0",
      lineHeight: 1.6,
    },
    code: {
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      fontSize: "11px",
      color: "#aaaab5",
    },
    strong: {
      fontWeight: 550,
    },
    table: {
      borderCollapse: "collapse",
      width: "100%",
      fontSize: "11px",
      textAlign: "left",
      whiteSpace: "nowrap",
    },
    th: {
      padding: "13px 20px",
      fontSize: "10px",
      fontWeight: 400,
      color: "#73737f",
      borderBottom: "1px solid {colors.border}",
      background: "#141417",
      "@media (max-width: 720px)": {
        padding: "12px 15px",
      },
    },
    td: {
      padding: "17px 20px",
      borderBottom: "1px solid #212126",
      color: "#b1b1bd",
      verticalAlign: "middle",
      "@media (max-width: 720px)": {
        padding: "15px",
      },
    },
    "tr:last-child td": {
      borderBottom: "0",
    },
    "*:before": {
      "@media (prefers-reduced-motion: reduce)": {
        animation: "none !important",
        transition: "none !important",
      },
    },
    "*:after": {
      "@media (prefers-reduced-motion: reduce)": {
        animation: "none !important",
        transition: "none !important",
      },
    },
  },
  theme: {
    extend: {
      tokens: {
        colors: {
          canvas: {
            value: "#09090b",
          },
          surface: {
            value: "#111114",
          },
          chrome: {
            value: "#0c0c0e",
          },
          border: {
            value: "#242429",
          },
          fg: {
            default: {
              value: "#e9e9ed",
            },
            muted: {
              value: "#8a8a96",
            },
          },
          claude: {
            value: "#d79479",
          },
          codex: {
            value: "#a4b6df",
          },
        },
        radii: {
          panel: {
            value: "10px",
          },
        },
      },
      recipes: {
        button: {
          className: "pool-button",
          base: {
            display: "inline-flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "7px",
            whiteSpace: "nowrap",
            minHeight: "34px",
            padding: "8px 12px",
            border: "1px solid #35353e",
            background: "#19191e",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: 500,
            lineHeight: 1.2,
            "&:hover": {
              background: "#25252d",
              borderColor: "#454550",
            },
          },
          variants: {
            variant: {
              primary: {
                background: "#e4e4ec",
                color: "#151519",
                borderColor: "#e4e4ec",
                "&:hover": {
                  background: "#fff",
                },
              },
              danger: {
                background: "#b94646",
                borderColor: "#b94646",
                color: "#fff",
              },
              default: {},
            },
          },
          defaultVariants: {
            variant: "default",
          },
        },
        iconButton: {
          className: "pool-icon-button",
          base: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "29px",
            height: "29px",
            border: "0",
            background: "transparent",
            color: "#92929e",
            borderRadius: "5px",
            flexShrink: 0,
            "&:hover": {
              background: "#24242a",
              color: "fg.default",
            },
          },
          variants: {
            danger: {
              true: {
                "&:hover": {
                  color: "#e18f8f",
                  background: "#302024",
                },
              },
            },
          },
        },
        panel: {
          className: "pool-panel",
          base: {
            padding: "21px",
            border: "1px solid {colors.border}",
            borderRadius: "{radii.panel}",
            background: "{colors.surface}",
            marginBottom: "20px",
            "@media (max-width: 720px)": {
              padding: "17px",
            },
          },
          variants: {
            table: {
              true: {
                padding: "0",
                overflow: "hidden",
                "@media (max-width: 720px)": {
                  padding: "0",
                },
              },
            },
          },
        },
        sidebar: {
          className: "pool-sidebar",
          base: {
            width: "220px",
            flexShrink: 0,
            padding: "26px 14px 14px",
            borderRight: "1px solid {colors.border}",
            display: "flex",
            flexDirection: "column",
            position: "fixed",
            inset: "0 auto 0 0",
            background: "chrome",
            zIndex: 20,
            "& nav": {
              display: "grid",
              gap: "4px",
            },
            "@media (max-width: 1100px)": {
              width: "190px",
            },
            "@media (max-width: 720px)": {
              display: "none",
              transform: "translateX(-100%)",
              transition: "transform 0.15s ease",
              width: "240px",
            },
          },
          variants: {
            open: {
              true: {
                "@media (max-width: 720px)": {
                  display: "flex",
                  transform: "translateX(0)",
                },
              },
            },
          },
        },
        tokenStatus: {
          className: "pool-token-status",
          base: {
            fontSize: "10px",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            color: "#777784",
            "&:before": {
              content: '""',
              width: "4px",
              height: "4px",
              borderRadius: "50%",
              background: "#666674",
            },
          },
          variants: {
            state: {
              active: {
                color: "#96b09c",
                "&::before": {
                  background: "#90aa96",
                },
              },
              failed: {
                color: "#cc8b88",
                "&::before": {
                  background: "#cc8b88",
                },
              },
              inactive: {},
            },
          },
        },
        providerSymbol: {
          className: "pool-provider-symbol",
          base: {
            fontSize: "22px",
            lineHeight: 1,
            color: "#aaaac3",
          },
          variants: {
            provider: {
              claude: {
                color: "claude",
              },
              codex: {
                color: "codex",
              },
              other: {},
            },
          },
        },
        rank: {
          className: "pool-rank",
          base: {
            fontFamily: "monospace",
            color: "#5b5b69",
            fontSize: "11px",
          },
          variants: {
            top: {
              true: {
                color: "#c4bba0",
              },
            },
          },
        },
      },
      keyframes: {
        spin: {
          to: {
            transform: "rotate(360deg)",
          },
        },
      },
    },
  },
});
