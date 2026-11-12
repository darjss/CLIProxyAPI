import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Check,
  CircleAlert,
  Copy,
  Ellipsis,
  LoaderCircle,
  X,
} from "lucide-react";
import { css, cx } from "../styled-system/css";
import { button, iconButton } from "../styled-system/recipes";

export function PageHeader({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header
      className={css({
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "16px",
        marginBottom: "28px",
      })}
    >
      <div
        className={css({
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          columnGap: "20px",
          rowGap: "4px",
        })}
      >
        <h1
          className={css({
            fontSize: "29px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          })}
        >
          {title}
        </h1>
        {meta && (
          <span className={css({ color: "dim", fontSize: "17px" })}>
            {meta}
          </span>
        )}
      </div>
      {children && (
        <div
          className={css({ display: "flex", gap: "10px", flexWrap: "wrap" })}
        >
          {children}
        </div>
      )}
    </header>
  );
}

export const card = css({
  background: "card",
  borderRadius: "card",
  padding: "26px",
  minWidth: 0,
  smDown: { padding: "18px" },
});

export const muted = css({ color: "dim" });
export const caption = css({
  color: "dim",
  fontSize: "14px",
  lineHeight: 1.55,
});

export type Option<T extends string> = {
  value: T;
  label: ReactNode;
  count?: number;
};

/** Pill-style single choice. With `panel`, it is a tab list controlling that element. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  plain,
  panel,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  plain?: boolean;
  panel?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function move(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (
    <div
      role={panel ? "tablist" : "radiogroup"}
      aria-label={label}
      className={cx(
        css({
          display: "inline-flex",
          alignItems: "center",
          gap: "2px",
          padding: "3px",
          borderRadius: "12px",
          maxWidth: "100%",
          overflowX: "auto",
          scrollbarWidth: "none",
        }),
        !plain && css({ background: "card" }),
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role={panel ? "tab" : "radio"}
            id={panel ? panel + "-" + option.value : undefined}
            aria-controls={panel}
            aria-selected={panel ? selected : undefined}
            aria-checked={panel ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              height: "36px",
              paddingInline: "14px",
              borderRadius: "9px",
              fontSize: "15px",
              whiteSpace: "nowrap",
              color: "dim",
              transition: "background 0.12s, color 0.12s",
              _hover: { color: "fg" },
              "&[aria-checked=true], &[aria-selected=true]": {
                background: "active",
                color: "fg",
                fontWeight: 500,
              },
            })}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={css({ color: "faint", fontWeight: 400 })}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      className={css({
        display: "flex",
        alignItems: "center",
        gap: "10px",
        color: "dim",
        padding: "28px 0",
      })}
    >
      <LoaderCircle
        size={16}
        className={css({ animation: "spin 0.9s linear infinite" })}
      />
      {label}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cx(
        card,
        css({ display: "flex", gap: "14px", alignItems: "flex-start" }),
      )}
    >
      <CircleAlert size={18} className={css({ color: "bad", mt: "2px" })} />
      <div className={css({ display: "grid", gap: "4px" })}>
        <strong className={css({ fontWeight: 500 })}>
          Couldn’t load this view
        </strong>
        <p className={caption}>{error.message}</p>
        {retry && (
          <button
            className={cx(
              button({ size: "sm" }),
              css({ mt: "8px", w: "fit-content" }),
            )}
            onClick={retry}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={css({
        display: "grid",
        justifyItems: "start",
        gap: "6px",
        padding: "32px 0 8px",
      })}
    >
      <h3 className={css({ fontSize: "17px", fontWeight: 500 })}>{title}</h3>
      <p className={cx(caption, css({ maxWidth: "520px" }))}>{description}</p>
      {children && <div className={css({ mt: "12px" })}>{children}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "bad";
}) {
  return (
    <div className={css({ display: "grid", gap: "3px", minWidth: 0 })}>
      <span className={css({ color: "dim", fontSize: "15px" })}>{label}</span>
      <strong
        className={cx(
          css({
            fontSize: "17px",
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }),
          tone === "bad" && css({ color: "bad" }),
        )}
      >
        {value}
      </strong>
    </div>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setError("");
    } catch {
      setError("Copy is unavailable. Select the text and copy it manually.");
    }
  }
  return { copied, error, copy };
}

export function CodeBlock({ label, value }: { label: string; value: string }) {
  const { copied, error, copy } = useCopy();
  const done = copied === value;
  return (
    <div
      className={css({
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "8px",
        minWidth: 0,
      })}
    >
      <div
        className={css({
          position: "relative",
          background: "canvas",
          borderRadius: "12px",
          border: "1px solid token(colors.line)",
        })}
      >
        <pre
          tabIndex={0}
          aria-label={label}
          className={css({
            margin: 0,
            padding: "18px 110px 18px 18px",
            maxHeight: "420px",
            overflow: "auto",
            fontSize: "13px",
            lineHeight: 1.65,
            color: "#c9c9cf",
            whiteSpace: "pre",
            smDown: { paddingRight: "18px", paddingTop: "56px" },
          })}
        >
          <code>{value}</code>
        </pre>
        <button
          type="button"
          aria-label={"Copy " + label}
          onClick={() => void copy(value)}
          className={cx(
            button({ size: "sm" }),
            css({ position: "absolute", top: "10px", right: "10px" }),
          )}
        >
          {done ? <Check size={14} /> : <Copy size={14} />}
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <p role="status" className={cx(caption, css({ minHeight: "1em" }))}>
        {error || (done ? "Copied to clipboard." : "")}
      </p>
    </div>
  );
}

/** Raw palette for charts and tinted chips; matches the Panda color tokens. */
export const palette = {
  claude: "#e8835f",
  codex: "#7d9ef5",
  blue: "#8aa4ff",
  violet: "#b48cff",
  teal: "#4fc1b5",
  pink: "#f07ab3",
  ok: "#4fbf7f",
  warn: "#e0b34f",
  bad: "#ef6b63",
  gray: "#9b9ba1",
};

export const tiers = [
  { value: "light", label: "Light", color: palette.teal },
  { value: "standard", label: "Standard", color: palette.blue },
  { value: "unlimited", label: "Unlimited", color: palette.violet },
] as const;

/** A small status label tinted with one palette color. */
/** A ⋯ button that opens a small list of actions. Closes on pick, outside click, or Escape. */
export function Menu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={ref} className={css({ position: "relative" })}>
      <button
        className={iconButton()}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className={css({
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 20,
            minWidth: "190px",
            padding: "4px",
            borderRadius: "10px",
            background: "raised",
            border: "1px solid token(colors.edge)",
          })}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={css({
                display: "block",
                width: "100%",
                padding: "8px 10px",
                borderRadius: "7px",
                textAlign: "left",
                fontSize: "14px",
                _hover: { background: "active" },
              })}
              style={{ color: item.danger ? palette.bad : undefined }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Chip({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return (
    <span
      className={css({
        display: "inline-flex",
        alignItems: "center",
        height: "24px",
        paddingInline: "9px",
        borderRadius: "full",
        fontSize: "13px",
        fontWeight: 500,
        whiteSpace: "nowrap",
      })}
      style={{
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          onClose();
      }}
      className={css({
        margin: "auto",
        width: wide
          ? "min(1100px, calc(100vw - 32px))"
          : "min(480px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 48px)",
        padding: "24px",
        borderRadius: "card",
        background: "card",
        color: "fg",
        border: "1px solid token(colors.edge)",
        "&::backdrop": { background: "rgba(0,0,0,0.7)" },
        "& form": { display: "grid", gap: "16px" },
      })}
    >
      <div
        className={css({
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        })}
      >
        <h2
          id="dialog-title"
          className={css({ fontSize: "19px", fontWeight: 600 })}
        >
          {title}
        </h2>
        <button
          className={iconButton()}
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export const actions = css({
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "8px",
});

export const label = css({
  display: "grid",
  gap: "8px",
  fontSize: "14px",
  color: "dim",
});

export const formError = css({ color: "bad", fontSize: "14px" });

export const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "15px",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  "& th": {
    textAlign: "left",
    fontWeight: 400,
    color: "faint",
    fontSize: "14px",
    padding: "0 18px 14px",
  },
  "& td": {
    padding: "16px 18px",
    borderTop: "1px solid token(colors.line)",
    color: "dim",
  },
  "& th:first-child, & td:first-child": { paddingLeft: 0 },
  "& th:last-child, & td:last-child": { paddingRight: 0 },
});

export const tableScroll = css({ overflowX: "auto", minWidth: 0 });

export const primaryCell = css({ color: "fg", fontWeight: 500 });

export const note = css({
  display: "block",
  color: "faint",
  fontSize: "13px",
  fontWeight: 400,
  marginTop: "3px",
});

export function ProviderIcon({
  provider,
  size = 18,
}: {
  provider: string;
  size?: number;
}) {
  if (provider === "claude")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <g stroke="#e8835f" strokeWidth="2.3" strokeLinecap="round">
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            const r = i % 2 ? 8.6 : 10.4;
            return (
              <line
                key={i}
                x1={12 + Math.cos(a) * 2.2}
                y1={12 + Math.sin(a) * 2.2}
                x2={12 + Math.cos(a) * r}
                y2={12 + Math.sin(a) * r}
              />
            );
          })}
        </g>
      </svg>
    );
  if (provider === "codex")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="codex-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9db7ff" />
            <stop offset="1" stopColor="#5a6ff0" />
          </linearGradient>
        </defs>
        <rect
          x="1.5"
          y="1.5"
          width="21"
          height="21"
          rx="6"
          fill="url(#codex-mark)"
        />
        <path
          d="M8 9.5 10.5 12 8 14.5M12.5 15h4"
          stroke="#fff"
          strokeWidth="1.9"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <span
      aria-hidden="true"
      className={css({
        display: "inline-block",
        borderRadius: "full",
        background: "faint",
      })}
      style={{ width: size * 0.6, height: size * 0.6 }}
    />
  );
}

function avatarURL(avatar: string, pixels: number) {
  const url = new URL(avatar);
  url.searchParams.set("s", String(pixels));
  return url.href;
}

/** GitHub avatar and handle; falls back to a name until the person signs in again. */
export function Person({
  person,
  size = 24,
}: {
  person: { login: string; name: string; avatar: string };
  size?: number;
}) {
  return (
    <span
      className={css({
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
      })}
    >
      {person.avatar ? (
        <img
          src={avatarURL(person.avatar, size * 2)}
          alt=""
          width={size}
          height={size}
          className={css({ borderRadius: "full", flexShrink: 0 })}
        />
      ) : (
        <span
          aria-hidden="true"
          className={css({
            borderRadius: "full",
            background: "raised",
            flexShrink: 0,
          })}
          style={{ width: size, height: size }}
        />
      )}
      {person.login ? "@" + person.login : person.name || "Unknown member"}
    </span>
  );
}

export const providerName = (provider: string) =>
  provider === "claude" ? "Claude" : provider === "codex" ? "Codex" : provider;
