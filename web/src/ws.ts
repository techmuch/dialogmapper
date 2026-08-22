import { CLIENT_ID } from "./api";
import type { ServerEvent } from "./types";

/**
 * WebSocket client with reconnect.
 *
 * Every mutation still goes through the REST API, so validation lives in
 * exactly one place in the Go layer. The socket carries state changes down and
 * *presence* up — who has what selected, and who is holding a node open. That
 * is deliberately the only thing sent this way: presence describes a moment
 * rather than the map, so it has no business in the database or in a request
 * that would be journaled and undoable.
 */

type Handler = (e: ServerEvent) => void;

/** What this tab tells the server about itself. */
export type PresenceMessage =
  | { type: "select"; nodes: string[]; mapId?: string }
  | { type: "viewing"; mapId: string }
  | { type: "editing"; nodeId: string }
  | { type: "done" }
  | { type: "rename"; name: string };

export interface WSClient {
  close(): void;
  /** Reports presence, silently dropped while the socket is down. */
  send(msg: PresenceMessage): void;
}

export function connectWS(
  onEvent: Handler,
  onStatus: (up: boolean) => void,
  surface: "desktop" | "mobile" = "desktop",
): WSClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | undefined;
  // The last presence sent, replayed on reconnect so a dropped connection does
  // not leave everyone else believing this tab is still holding a node open.
  let last: PresenceMessage | null = null;

  const url = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return (
      `${proto}//${location.host}/ws` +
      `?clientId=${encodeURIComponent(CLIENT_ID)}&surface=${surface}`
    );
  };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url());

    ws.onopen = () => {
      attempt = 0;
      onStatus(true);
      if (last) ws?.send(JSON.stringify(last));
    };

    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as ServerEvent);
      } catch {
        // A frame we cannot parse is a bug on the server side; dropping it is
        // better than tearing down a working connection.
      }
    };

    ws.onclose = () => {
      onStatus(false);
      if (closed) return;
      // Exponential backoff, capped: the server is on localhost, so a long
      // wait is almost always wrong, but a hot loop during a rebuild is worse.
      const delay = Math.min(300 * 2 ** attempt++, 5000);
      timer = window.setTimeout(open, delay);
    };

    ws.onerror = () => ws?.close();
  };

  open();

  return {
    close() {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    },
    send(msg) {
      last = msg.type === "done" ? null : msg;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
}
