import React from "react";
import { createRoot } from "react-dom/client";
import DesktopApp from "./desktop/DesktopApp";
import MobileApp from "./mobile/MobileApp";
import "./styles.css";

/**
 * The two surfaces are genuinely different products, not a responsive layout:
 * the desktop is a canvas built for a facilitator typing during a live
 * conversation, and the mobile view is an asynchronous capture form. Sharing a
 * component tree between them would compromise both.
 *
 * The server redirects mobile user agents to /m; this check makes the choice
 * survive a shared link, and lets either surface be forced for testing.
 */
function pickSurface(): "desktop" | "mobile" {
  const forced = new URLSearchParams(location.search).get("ui");
  if (forced === "mobile" || forced === "desktop") return forced;
  if (location.pathname.startsWith("/m")) return "mobile";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return coarse && window.innerWidth < 900 ? "mobile" : "desktop";
}

const surface = pickSurface();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {surface === "mobile" ? <MobileApp /> : <DesktopApp />}
  </React.StrictMode>,
);
