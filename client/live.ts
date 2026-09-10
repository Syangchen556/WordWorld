import type { Game } from "../server/game";
type State = ReturnType<Game["snapshot"]> & { revision: number };
type Callback = (...args: any[]) => void;
export class LiveClient {
  connected = false;
  private closed = false;
  private handlers = new Map<string, Callback[]>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = -1;
  private timeoutMs = 10000;
  private tabId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
  constructor() {
    queueMicrotask(() => void this.poll());
    window.addEventListener("pagehide", this.leave);
  }
  on(event: string, callback: Callback) {
    this.handlers.set(event, [...(this.handlers.get(event) || []), callback]);
    return this;
  }
  private dispatch(event: string, ...args: any[]) {
    for (const cb of this.handlers.get(event) || []) cb(...args);
  }
  private update(state: State) {
    if (this.closed || state.revision < this.revision) return;
    this.revision = state.revision;
    this.dispatch("state", state);
  }
  private async request(path: string, payload: unknown = {}, timeout = 10000) {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(payload as object), tabId: this.tabId }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json();
    if (res.status === 401) {
      this.closed = true;
      this.connected = false;
      this.dispatch("disconnect", "io server disconnect");
      throw Error("Private access required.");
    }
    if (res.status >= 500) throw Error(data.error || "Connection lost.");
    if (data.state) {
      if (!this.connected && !this.closed) {
        this.connected = true;
        this.dispatch("connect");
      }
      this.update(data.state);
    }
    return data;
  }
  private async poll() {
    if (this.closed) return;
    try {
      const data = await this.request("/api/state");
      if (data.error) throw Error(data.error);
    } catch (e) {
      if (this.connected) {
        this.connected = false;
        this.dispatch("disconnect", "network");
      }
      this.dispatch("connect_error", e);
    } finally {
      if (!this.closed) this.timer = setTimeout(() => void this.poll(), 1000);
    }
  }
  timeout(ms: number) {
    this.timeoutMs = ms;
    return this;
  }
  emit(
    _event: string,
    payload: { event: string; payload: unknown },
    callback: (error: Error | null, result?: any) => void,
  ) {
    void this.request("/api/action", payload, this.timeoutMs)
      .then((result) => callback(null, result))
      .catch((error) => callback(error));
    return this;
  }
  private leave = () => {
    void fetch("/api/leave", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabId: this.tabId }),
      keepalive: true,
    }).catch(() => {});
  };
  disconnect() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearTimeout(this.timer);
    window.removeEventListener("pagehide", this.leave);
    this.leave();
  }
}
