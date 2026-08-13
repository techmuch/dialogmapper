import { CLIENT_ID } from "./api";
import type { ServerEvent } from "./types";

/**
 * WebSocket client with reconnect.
 *
 * The socket is read-only by design: every mutation goes through the REST API
 * so that validation lives in exactly one place in the Go layer. The socket's
 * only job is to tell this tab that the world changed.
 */

type Handler = (e: ServerEvent) => void;

export interface WSClient {
  close(): void;
}

export function connectWS(onEvent: Handler, onStatus: (up: boolean) => void): WSClient {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: number | undefined;

  const url = () => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws?clientId=${encodeURIComponent(CLIENT_ID)}`;
  };

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url());

    ws.onopen = () => {
      attempt = 0;
      onStatus(true);
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
  };
}
