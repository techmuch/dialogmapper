import type { ReactNode } from "react";
import { Link } from "../router";
import { Mark, REPO } from "./bits";

/**
 * The shell every page sits in.
 *
 * The navigation names the reader's questions — what it is, how to start, how
 * to do a thing, what the words mean — rather than the codebase's parts. The
 * previous site's nav read "Features / UI Buttons Guide / Architecture / CLI
 * Commands", which is a table of contents for the implementation and asks the
 * reader to already know what they are looking for.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header">
        <div className="wrap site-header__inner">
          <Link to="/" className="brand">
            <Mark />
            dialogmapper
          </Link>
          <nav className="site-nav" aria-label="Main">
            <Link to="/walkthrough">A real session</Link>
            <Link to="/start">Get started</Link>
            <Link to="/how-to" match="/how-to">
              How to
            </Link>
            <Link to="/ibis">What is IBIS?</Link>
            <Link to="/reference">Reference</Link>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="site-footer">
        <div className="wrap site-footer__inner">
          <span>
            dialogmapper — dialogue mapping that runs on your own machine. MIT licensed.
          </span>
          <span>
            <a href={REPO}>Source</a> · <a href={`${REPO}/issues`}>Report a problem</a> ·{" "}
            <a href={`${REPO}/releases`}>Releases</a>
          </span>
        </div>
      </footer>
    </>
  );
}

/** A page with a heading, a standfirst and a bounded measure. */
export function Page({
  eyebrow,
  title,
  lede,
  children,
  wide,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="wrap section">
      <div className={wide ? undefined : "narrow"}>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {lede && <p className="lede" style={{ marginTop: "var(--sp-3)" }}>{lede}</p>}
      </div>
      <div style={{ marginTop: "var(--sp-5)" }}>{children}</div>
    </div>
  );
}

/** Links to the next thing worth reading, so no page is a dead end. */
export function Pager({ links }: { links: { to: string; label: string }[] }) {
  return (
    <div className="pager">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="btn">
          {l.label} →
        </Link>
      ))}
    </div>
  );
}
