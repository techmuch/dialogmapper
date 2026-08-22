import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

/**
 * A hash router, in about sixty lines.
 *
 * Hash routing rather than real paths, and no router library, for one reason
 * each.
 *
 * Hashes because this deploys to GitHub Pages with `base: './'`, which means
 * the site works whatever path it is served from — a project page today, a
 * custom domain tomorrow, a local `file://` preview in between. Real paths
 * would need the base baked in at build time plus a 404.html rewrite trick, and
 * would break silently the day the URL changes. A hash is ugly in the address
 * bar and correct everywhere.
 *
 * No library because seven static routes do not need one, and a documentation
 * site should not ship 60kB of routing to render prose.
 */

interface RouterValue {
  path: string;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterValue>({ path: "/", navigate: () => {} });

/** The current route, normalised to a leading slash and no trailing one. */
function readHash(): string {
  const raw = window.location.hash.replace(/^#/, "");
  const path = raw.split("?")[0] || "/";
  const clean = path.startsWith("/") ? path : `/${path}`;
  return clean.length > 1 ? clean.replace(/\/+$/, "") : "/";
}

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(readHash);

  useEffect(() => {
    const onChange = () => setPath(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  // Land at the top of a new page, but leave in-page anchors alone — jumping to
  // the top after clicking a table-of-contents link is maddening.
  useEffect(() => {
    if (!window.location.hash.includes("#", 1)) window.scrollTo(0, 0);
  }, [path]);

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export const useRoute = () => useContext(RouterContext);

interface LinkProps {
  to: string;
  children: ReactNode;
  className?: string;
  /** Also match nested paths, for highlighting a section in the nav. */
  match?: string;
}

export function Link({ to, children, className, match }: LinkProps) {
  const { path } = useRoute();
  const active = match ? path === match || path.startsWith(`${match}/`) : path === to;
  return (
    <a
      href={`#${to}`}
      className={[className, active ? "is-current" : ""].filter(Boolean).join(" ")}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </a>
  );
}
