import { useState } from "react";
import type { ReactNode } from "react";

/** Small pieces shared across pages. */

export function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/**
 * A terminal block whose prompts cannot be copied.
 *
 * The `$` is drawn with CSS rather than written into the text, because a reader
 * who selects three lines and pastes them should get three runnable commands,
 * not three shell errors.
 */
export function Term({
  lines,
  title = "Terminal",
  copy,
}: {
  /** `[command, ...output]` per entry. */
  lines: { cmd: string; out?: string[] }[];
  title?: string;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Commands only. Copying the output back into a shell is never what anyone
  // wanted, and it is the reason the prompt is drawn in CSS rather than typed.
  const text = lines
    .map((l) => l.cmd)
    .filter(Boolean)
    .join("\n");

  return (
    <div className="term">
      <div className="term__bar">
        <span>{title}</span>
        {copy !== false && (
          <button
            type="button"
            className="copy"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <div className="term__body">
        {lines.map((l, i) => (
          <div key={i}>
            {/* An empty cmd means "output only" — printing a bare prompt for it
                would show a `$` on a line with nothing after it. */}
            {l.cmd !== "" && <div className="term__line">{l.cmd}</div>}
            {l.out?.map((o, j) => (
              <div key={j} className="term__out">
                {o}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export type IbisType = "question" | "idea" | "pro" | "con" | "note";

export const GLYPH: Record<IbisType, string> = {
  question: "?",
  idea: "!",
  pro: "+",
  con: "−",
  note: "·",
};

export function Chip({ type, children }: { type: IbisType; children?: ReactNode }) {
  return (
    <span className={`chip chip--${type}`}>
      <span aria-hidden="true">{GLYPH[type]}</span>
      {children ?? type[0].toUpperCase() + type.slice(1)}
    </span>
  );
}

export interface TreeRow {
  depth: number;
  type: IbisType;
  text: string;
  /** Renders as the committed answer. */
  decided?: boolean;
}

/**
 * A map drawn as text.
 *
 * Screenshots show what the tool looks like; this shows what the *shape* is,
 * and it stays readable on a phone, in a search result and with a screen
 * reader — none of which is true of a 4000px-wide picture of a canvas.
 */
export function Tree({ rows, label }: { rows: TreeRow[]; label?: string }) {
  return (
    <div className="tree" role="img" aria-label={label ?? "IBIS map"}>
      {rows.map((r, i) => (
        <div key={i}>
          <span className="t-rail">{r.depth > 0 ? `${"   ".repeat(r.depth - 1)}└─ ` : ""}</span>
          <span className={`t-${r.type}`}>{GLYPH[r.type]} </span>
          <span className={r.decided ? "t-decided" : undefined}>{r.text}</span>
          {r.decided && <span className="t-decided"> ← decided</span>}
        </div>
      ))}
    </div>
  );
}

export function Figure({
  src,
  alt,
  caption,
  bleed,
}: {
  src: string;
  alt: string;
  caption: ReactNode;
  bleed?: boolean;
}) {
  return (
    <figure className={bleed ? "bleed" : undefined}>
      <img src={src} alt={alt} loading="lazy" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export const REPO = "https://github.com/techmuch/dialogmapper";
export const RELEASES = `${REPO}/releases/latest`;
