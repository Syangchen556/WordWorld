import { transact } from "./database";
import { resumeGame, heartbeat, saveLive } from "./live";
import { hash } from "./state-store";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const reply = (
  status: number,
  data: unknown,
  extra: Record<string, string> = {},
) => Response.json(data, { status, headers: { ...headers, ...extra } });
export async function handleApi(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/health") return reply(200, { ok: true });
  const configured =
    process.env.APP_ORIGIN ||
    (!process.env.VERCEL ? "http://localhost:3000" : "");
  let origin: string;
  try {
    const parsed = new URL(configured);
    origin = parsed.origin;
    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    )
      throw Error();
  } catch {
    return reply(503, {
      error: "The owner needs to configure APP_ORIGIN for this deployment.",
    });
  }
  if (request.method !== "GET" && request.headers.get("origin") !== origin)
    return reply(403, { error: "Request origin is not allowed." });
  let payload: any = {};
  if (request.method === "POST") {
    if (Number(request.headers.get("content-length")) > 4096)
      return reply(413, { error: "Request too large." });
    try {
      const reader = request.body?.getReader();
      let raw = "";
      if (reader) {
        const decoder = new TextDecoder();
        let bytes = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 4096) {
            await reader.cancel();
            return reply(413, { error: "Request too large." });
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      payload = JSON.parse(raw || "{}");
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw Error();
    } catch {
      return reply(400, { error: "Invalid request." });
    }
  }
  const session =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("ww_session="))
      ?.slice(11) || "";
  try {
    return await transact((store, revision) => {
      const id = store.session(session);
      if (request.method === "GET" && path === "/api/session")
        return reply(200, { player: id || null, configured: !!store.room() });
      if (
        request.method === "POST" &&
        ["/api/inspect", "/api/accept"].includes(path)
      ) {
        if (!store.limit("access", 30))
          return reply(429, {
            error: "Too many access attempts. Please wait a minute.",
          });
        if (typeof payload.token !== "string" || payload.token.length > 128)
          return reply(400, { error: "Invalid access link." });
        if (path === "/api/inspect") {
          const token = store.inspect(payload.token);
          return token
            ? reply(200, { kind: token.kind })
            : reply(410, {
                error:
                  "This link has expired or has already been used. Ask for a replacement link.",
              });
        }
        try {
          const result = store.accept(
            payload.token,
            payload.names,
            payload.roomName,
          );
          return reply(
            200,
            {
              invitation: result.invitation
                ? `${origin}/#access=${result.invitation}`
                : null,
            },
            {
              "Set-Cookie": `ww_session=${result.session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7776000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
            },
          );
        } catch (e) {
          return reply(400, { error: (e as Error).message });
        }
      }
      if (!id) return reply(401, { error: "Private access required." });
      const game = resumeGame(store);
      let result: Response;
      if (request.method === "GET" && path === "/api/history") {
        const page = Math.max(
          1,
          Math.min(
            100000,
            Math.floor(
              Number(new URL(request.url).searchParams.get("page")) || 1,
            ),
          ),
        );
        const all = store.history().filter((m) => m.status !== "active");
        result = reply(200, {
          matches: all.slice((page - 1) * 10, page * 10),
          total: all.length,
          page,
        });
      } else if (
        request.method === "POST" &&
        ["/api/state", "/api/action", "/api/leave"].includes(path)
      ) {
        if (
          typeof payload.tabId !== "string" ||
          !/^[a-zA-Z0-9-]{8,80}$/.test(payload.tabId)
        )
          result = reply(400, { error: "Invalid tab identifier." });
        else if (!store.limit(`updates:${id}`, 600))
          result = reply(429, {
            error: "Too many updates. Close extra tabs and try again.",
          });
        else {
          heartbeat(
            store,
            game,
            id,
            payload.tabId,
            session,
            path === "/api/leave",
          );
          let error: string | undefined;
          if (path === "/api/action")
            try {
              if (
                !store.limit(`actions:${id}`, 150) ||
                (payload.event === "guess" &&
                  !store.limit(`guesses:${id}`, 5, 1000))
              )
                throw Error("Please wait a moment before trying again.");
              if (
                typeof payload.event !== "string" ||
                !payload.payload ||
                typeof payload.payload !== "object" ||
                Array.isArray(payload.payload)
              )
                throw Error("Invalid action.");
              game.action(id, payload.event, payload.payload);
            } catch (e) {
              error = (e as Error).message;
            }
          result = reply(error ? 400 : 200, {
            ok: !error,
            error,
            state: { ...game.snapshot(id), revision },
          });
        }
      } else result = reply(404, { error: "Not found." });
      saveLive(store, game);
      return result;
    });
  } catch {
    // Connection failures must never disclose a database URL or secret.
    return reply(503, {
      error:
        "WordWorld could not reach its database. Please try again shortly.",
    });
  }
}
