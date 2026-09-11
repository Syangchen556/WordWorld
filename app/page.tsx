"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveClient } from "../client/live";
import { MinesBoard, MinesHistory } from "../client/minesweeper";
import type { Game } from "../server/game";
import type { Guess, Match, Profile, Room } from "../server/types";
type State = ReturnType<Game["snapshot"]>;
type Tab = "room" | "history" | "stats" | "settings";
const modeName = (mode: string) =>
  mode === "race"
    ? "Same Word Race"
    : mode === "minesweeper"
      ? "Minesweeper"
      : "Word Swap";
const duration = (ms: number | null | undefined) =>
  ms == null
    ? "—"
    : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const labelReason = (s: string) =>
  ({
    solved: "Solved",
    time_up: "Time ran out",
    attempts_exhausted: "All guesses used",
    conceded: "Conceded",
    disconnect: "Disconnect forfeit",
    both_disconnected: "Both players disconnected",
    server_restart: "Server restarted",
    three_mines: "Three mines hit — no lives remaining",
    safe_cleared: "All safe tiles cleared — remaining lives decide",
  })[s] || s;
function Avatar({
  player,
  small = false,
}: {
  player: Profile;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${player.color} ${small ? "small" : ""}`}>
      {player.avatar === "initials"
        ? player.name.slice(0, 2).toUpperCase()
        : player.avatar}
    </span>
  );
}
function Board({
  guesses,
  draft = "",
  compact = false,
}: {
  guesses: Guess[];
  draft?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`board ${compact ? "compact" : ""}`}
      aria-label="Guessing board"
    >
      {Array.from({ length: 6 }, (_, row) => (
        <div className="board-row" key={row}>
          {Array.from({ length: 5 }, (_, col) => {
            const g = guesses[row],
              letter =
                g?.word[col] || (row === guesses.length ? draft[col] : "");
            return (
              <div
                key={col}
                className={`tile ${g?.marks[col] || ""} ${letter ? "filled" : ""}`}
                style={{ animationDelay: `${col * 65}ms` }}
                aria-label={`Row ${row + 1}, letter ${col + 1}: ${letter || "empty"}${g ? ", " + g.marks[col] : ""}`}
              >
                {letter}
                {g && (
                  <span className="mark-symbol">
                    {g.marks[col] === "correct"
                      ? "✓"
                      : g.marks[col] === "present"
                        ? "•"
                        : "−"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
export default function Page() {
  const [state, setState] = useState<State | null>(null),
    [access, setAccess] = useState<
      "loading" | "private" | "setup" | "invite" | "invalid" | "room"
    >("loading");
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invite, setInvite] = useState(""),
    [connected, setConnected] = useState(false),
    [tab, setTab] = useState<Tab>("room"),
    [draft, setDraft] = useState(""),
    [secret, setSecret] = useState(""),
    [showSecret, setShowSecret] = useState(false),
    [pending, setPending] = useState(false);
  const [history, setHistory] = useState<{
      matches: Match[];
      total: number;
      page: number;
    }>({ matches: [], total: 0, page: 1 }),
    [detail, setDetail] = useState<Match | null>(null),
    [statsMode, setStatsMode] = useState("all");
  const [prefs, setPrefs] = useState({
    sound: false,
    motion: false,
    contrast: false,
  });
  const socket = useRef<LiveClient | null>(null),
    request = useRef<{
      word: string;
      roundId: string;
      requestId: string;
    } | null>(null),
    lastRound = useRef(""),
    lastPhase = useRef("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ww-preferences");
      if (saved) setPrefs(JSON.parse(saved));
    } catch {}
    const raw = new URLSearchParams(location.hash.slice(1)).get("access");
    if (raw) {
      setToken(raw);
      window.history.replaceState(null, "", location.pathname);
      fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: raw }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) {
            setError(d.error);
            setAccess("invalid");
          } else setAccess(d.kind === "setup" ? "setup" : "invite");
        })
        .catch(() => {
          setError("Could not connect. Refresh to try again.");
          setAccess("private");
        });
    } else
      fetch("/api/session")
        .then((r) => r.json())
        .then((d) => {
          if (d.error) setError(d.error);
          setAccess(d.player ? "room" : "private");
        })
        .catch(() => {
          setAccess("private");
          setError("Could not reach WordWorld. Please try again.");
        });
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", prefs.contrast);
    document.documentElement.classList.toggle("reduced-motion", prefs.motion);
    localStorage.setItem("ww-preferences", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    if (access !== "room") return;
    const s = new LiveClient();
    socket.current = s;
    s.on("connect", () => {
      setConnected(true);
      setError("");
    });
    s.on("disconnect", (reason) => {
      setConnected(false);
      if (reason === "io server disconnect")
        setError(
          "Your session has ended. Open a replacement private access link.",
        );
    });
    s.on("connect_error", (e) => {
      setConnected(false);
      setError(
        e.message === "Private access required."
          ? "Your session has ended. Open a replacement private access link."
          : "Reconnecting to your room…",
      );
    });
    s.on("state", (data: State) => {
      setState(data);
      const r = data.match?.round;
      if (r?.id !== lastRound.current) {
        setDraft("");
        setSecret("");
        request.current = null;
        lastRound.current = r?.id || "";
      }
      if (r?.phase !== lastPhase.current) {
        setNotice(
          r?.phase === "playing"
            ? "The round has started. Good luck!"
            : r?.phase === "ended"
              ? "Round complete. Answers are revealed."
              : "",
        );
        lastPhase.current = r?.phase || "";
      }
    });
    return () => {
      s.disconnect();
      socket.current = null;
    };
  }, [access]);
  const act = useCallback(
    (event: string, payload: unknown = {}, done?: () => void) => {
      if (!socket.current?.connected) {
        setError("You are offline. Your board will return when you reconnect.");
        return;
      }
      setError("");
      setPending(true);
      socket.current
        .timeout(15000)
        .emit(
          "action",
          { event, payload },
          (err: Error | null, result: { error?: string }) => {
            setPending(false);
            if (err)
              setError(
                "No confirmation yet. Try again; guesses are safe to retry.",
              );
            else if (result?.error) setError(result.error);
            else done?.();
          },
        );
    },
    [],
  );
  const me = state?.profiles.find((p) => p.id === state.me),
    partner = state?.profiles.find((p) => p.id !== state.me),
    match = state?.match,
    round = match?.round;
  const myGuesses = round?.guesses[state?.me || 1] || [];
  useEffect(() => {
    const g = myGuesses.at(-1);
    if (g)
      setNotice(
        `Guess ${myGuesses.length}: ${[...g.word].map((c, i) => c + " " + g.marks[i]).join(", ")}.`,
      );
  }, [myGuesses.length, round?.id]);
  const canGuess = !!(
    match?.mode !== "minesweeper" &&
    connected &&
    round?.phase === "playing" &&
    myGuesses.length < 6 &&
    !pending
  );
  const key = useCallback(
    (letter: string) => {
      if (!canGuess) return;
      if (letter === "ENTER") {
        if (draft.length !== 5) {
          setError("Use all five letters.");
          return;
        }
        const roundId = round!.id;
        if (
          !request.current ||
          request.current.word !== draft ||
          request.current.roundId !== roundId
        )
          request.current = {
            word: draft,
            roundId,
            requestId:
              typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
                    x.toString(16).padStart(2, "0"),
                  ).join(""),
          };
        act("guess", request.current, () => {
          setDraft("");
          request.current = null;
        });
      } else if (letter === "⌫" || letter === "BACKSPACE")
        setDraft((s) => s.slice(0, -1));
      else if (/^[A-Z]$/.test(letter))
        setDraft((s) => (s.length < 5 ? s + letter : s));
    },
    [canGuess, draft, round, act, myGuesses.length],
  );
  const keyboardHandler = useRef({ key, tab });
  keyboardHandler.current = { key, tab };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest("input,textarea,select") ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        keyboardHandler.current.tab !== "room"
      )
        return;
      if (
        e.key === "Enter" ||
        e.key === "Backspace" ||
        /^[a-z]$/i.test(e.key)
      ) {
        e.preventDefault();
        keyboardHandler.current.key(e.key.toUpperCase());
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!prefs.sound || !notice) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.frequency.value = 660;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      osc.onended = () => void ctx.close();
    } catch {}
  }, [notice, prefs.sound]);
  const loadHistory = useCallback((page = 1) => {
    fetch(`/api/history?page=${page}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setHistory(d);
      })
      .catch(() => setError("Could not load match history."));
  }, []);
  useEffect(() => {
    if (state && (tab === "history" || tab === "room")) loadHistory();
  }, [tab, match?.status, !!state, loadHistory]);
  async function accept(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const response = await fetch("/api/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          names: [form.get("player1"), form.get("player2")],
          roomName: form.get("roomName"),
        }),
      });
      const d = await response.json();
      if (d.error) setError(d.error);
      else {
        setInvite(d.invitation || "");
        setToken("");
        setAccess("room");
      }
    } catch {
      setError("Could not accept the invitation. Try again.");
    } finally {
      setPending(false);
    }
  }
  const brand = (
    <a className="brand" href="/" aria-label="WordWorld home">
      <span className="brand-icon">
        w<span>✦</span>
      </span>
      <span>
        word<span className="brand-light">world</span>
        <small>JUST US TWO</small>
      </span>
    </a>
  );
  if (access !== "room")
    return (
      <div className="access-page">
        <header>
          {brand}
          <span className="private-badge">⌑ A world for two</span>
        </header>
        <main className="access-card">
          <div className="access-art" aria-hidden="true">
            <span>W</span>
            <span>O</span>
            <span>R</span>
            <span>D</span>
            <span>♡</span>
          </div>
          <p className="eyebrow">YOUR LITTLE CORNER OF THE INTERNET</p>
          <h1>
            Two minds.
            <br />
            One word world.
          </h1>
          <p className="intro">
            A little rivalry. A shared ritual.
            <br />A private place to play, just for the two of you.
          </p>
          {access === "loading" ? (
            <p className="muted">Opening your world…</p>
          ) : ["setup", "invite"].includes(access) ? (
            <form onSubmit={accept}>
              <div className="access-note">
                {access === "setup"
                  ? "Let’s make this place yours."
                  : "Your place is saved. Accept your private invitation to join your partner."}
              </div>
              {access === "setup" && (
                <>
                  <label>
                    Your name
                    <input
                      name="player1"
                      maxLength={24}
                      required
                      placeholder="Player 1"
                      autoComplete="given-name"
                    />
                  </label>
                  <label>
                    Your partner’s name
                    <input
                      name="player2"
                      maxLength={24}
                      required
                      placeholder="Player 2"
                    />
                  </label>
                  <label>
                    Our room name
                    <input
                      name="roomName"
                      maxLength={40}
                      required
                      defaultValue="Our little word world"
                    />
                  </label>
                </>
              )}
              <button className="primary" disabled={pending}>
                {pending
                  ? "Opening…"
                  : access === "setup"
                    ? "Create our world ↗"
                    : "Accept invitation ↗"}
              </button>
            </form>
          ) : (
            <div className="access-note">
              <span className="lock-icon">⌑</span>
              <h2>
                {access === "invalid"
                  ? "This door needs a new key."
                  : "Just the two of you."}
              </h2>
              <p>
                {access === "invalid"
                  ? "Ask for a replacement private access link to come back in."
                  : "Open your private invitation or saved access link to enter. Already joined? Use the browser where you accepted it."}
              </p>
              {access === "private" && (
                <small>
                  Setting up for the first time? Your server’s setup command
                  creates your private setup link.
                </small>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <footer>Five letters. Endless “one more round.”</footer>
        </main>
        <span className="access-bottom">
          PRIVATE BY DESIGN · MADE FOR YOUR FAVORITE PERSON
        </span>
      </div>
    );
  if (!state || !me || !partner)
    return (
      <div className="loading">
        {brand}
        <p>{error || "Connecting to your shared room…"}</p>
      </div>
    );
  const records = state.stats,
    record = records.find((s) => s.id === me.id)!;
  const active = match?.status === "active";
  const ended = round && ["ended", "abandoned"].includes(round.phase);
  const recordRow = (
    <div className="record-row">
      <div>
        <strong className="purple-text">{records[0].wins}</strong>
        <span>{state.profiles[0].name}’s wins</span>
      </div>
      <span className="record-divider">:</span>
      <div>
        <strong className="yellow-text">{records[1].wins}</strong>
        <span>{state.profiles[1].name}’s wins</span>
      </div>
      <div className="draw-record">
        <strong>{records[0].draws}</strong>
        <span>draws</span>
      </div>
    </div>
  );
  return (
    <div className={`app ${active ? "active-match" : ""} theme-${me.color}`}>
      <header className="topbar">
        {brand}
        <nav aria-label="Main navigation">
          {(["room", "history", "stats"] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => {
                setTab(t);
                setDetail(null);
              }}
            >
              {t === "room"
                ? "Our room"
                : t === "history"
                  ? "Match history"
                  : "Our stats"}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="private-badge">⌑ Private room</span>
          <button
            className={`profile-button ${tab === "settings" ? "selected" : ""}`}
            onClick={() => setTab("settings")}
            aria-label="Open settings"
          >
            <Avatar player={me} small />
            <span>{me.name}</span>
            <span>⌄</span>
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="room-heading">
          <div>
            <p className="eyebrow">
              <span className={`status-dot ${connected ? "online" : ""}`} />
              {connected ? "OUR PERMANENT HANGOUT" : "RECONNECTING…"}
            </p>
            <h1>
              {tab === "history"
                ? "The story so far."
                : tab === "stats"
                  ? "A little healthy competition."
                  : tab === "settings"
                    ? "Make it ours."
                    : state.room?.name}
            </h1>
            <p className="muted">
              {tab === "room"
                ? `${state.room?.icon} ${state.room?.description}`
                : tab === "history"
                  ? "The close calls, the clever guesses, and the “again?” moments."
                  : tab === "stats"
                    ? "Every round adds a little more to our story."
                    : "Your profiles, your room, your little preferences."}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={() => setTab(tab === "settings" ? "room" : "settings")}
            aria-label="Room settings"
          >
            ⚙
          </button>
        </div>
        {invite && (
          <div className="invitation-banner">
            <div>
              <strong>Your partner’s invitation is ready.</strong>
              <p>
                Single-use · expires in 24 hours. Copy it before leaving this
                page.
              </p>
              <input
                aria-label="Partner invitation link"
                readOnly
                value={invite}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <button
              onClick={() => {
                (
                  navigator.clipboard?.writeText(invite) ??
                  Promise.reject(new Error("Clipboard unavailable"))
                )
                  .then(() => setNotice("Invitation copied."))
                  .catch(() =>
                    setError("Select and copy the invitation above."),
                  );
              }}
            >
              Copy link ↗
            </button>
            <button
              className="icon-button"
              onClick={() => setInvite("")}
              aria-label="Dismiss invitation"
            >
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <div role="status" aria-live="polite" className="sr-only">
          {notice}
        </div>
        {notice && /copied|saved/.test(notice) && (
          <div className="notice">✓ {notice}</div>
        )}
        {tab === "room" && (
          <div className="room-grid">
            <section className="main-panel">
              {!match ? (
                <>
                  <div className="panel-heading">
                    <span className="eyebrow">THE TWO OF US</span>
                    <span className="pill">
                      {state.profiles.filter((p) => p.online).length}/2 here
                    </span>
                  </div>
                  <div className="players">
                    {state.profiles.map((p) => (
                      <article key={p.id} className={`player-card ${p.color}`}>
                        <span className="player-tag">
                          {p.id === me.id ? "THAT’S YOU" : "YOUR PARTNER"}
                        </span>
                        <Avatar player={p} />
                        <h2>{p.name}</h2>
                        <p>
                          <span
                            className={`status-dot ${p.online ? "online" : ""}`}
                          />
                          {p.ready
                            ? "Ready to play"
                            : p.online
                              ? "Here & ready for a challenge"
                              : "Taking a little break"}
                        </p>
                        <div className="player-bottom">
                          <span>
                            {records.find((s) => s.id === p.id)!.wins} match
                            wins
                          </span>
                          <span>{p.id === me.id ? "✧" : "♡"}</span>
                        </div>
                      </article>
                    ))}
                    <span className="versus">vs</span>
                  </div>
                  <div className="game-picker">
                    <div className="section-title">
                      <h2>What are we playing?</h2>
                      <span>01 — PICK A MODE</span>
                    </div>
                    <div className="mode-options">
                      {(["race", "swap", "minesweeper"] as const).map(
                        (mode) => (
                          <button
                            key={mode}
                            disabled={pending || !connected}
                            className={`mode-card ${state.room?.mode === mode ? "chosen" : ""}`}
                            onClick={() =>
                              act("settings", { ...state.room, mode })
                            }
                          >
                            <span className="mode-symbol">
                              {mode === "race"
                                ? "⚡"
                                : mode === "minesweeper"
                                  ? "💣"
                                  : "⇄"}
                            </span>
                            <span>
                              <strong>{modeName(mode)}</strong>
                              <small>
                                {mode === "race"
                                  ? "One word. Two minds. First to solve wins."
                                  : mode === "minesweeper"
                                    ? "One shared board. Three lives. Take turns."
                                    : "Pick a secret word for each other."}
                              </small>
                            </span>
                            <span className="radio-dot" />
                          </button>
                        ),
                      )}
                    </div>
                    {state.room?.mode === "minesweeper" ? (
                      <div className="mines-setup">
                        <div className="section-title">
                          <h3>Choose your difficulty</h3>
                          <span>02 — SET UP</span>
                        </div>
                        <div className="mines-difficulties">
                          {(["easy", "medium", "hard"] as const).map(
                            (difficulty, index) => (
                              <button
                                key={difficulty}
                                className={
                                  (state.room?.difficulty || "easy") ===
                                  difficulty
                                    ? "chosen"
                                    : ""
                                }
                                aria-pressed={
                                  (state.room?.difficulty || "easy") ===
                                  difficulty
                                }
                                disabled={pending || !connected}
                                onClick={() =>
                                  act("settings", { ...state.room, difficulty })
                                }
                              >
                                <strong>{difficulty}</strong>
                                <span>
                                  {[8, 12, 16][index]} × {[8, 12, 16][index]}
                                </span>
                                <small>{[10, 25, 50][index]} mines</small>
                              </button>
                            ),
                          )}
                        </div>
                        <p className="muted">
                          One match · Three lives each · Player 1 starts · No
                          time limit
                        </p>
                      </div>
                    ) : (
                      <div className="format-row">
                        <div>
                          <h3>Make it a…</h3>
                          <p>
                            {state.room?.format === "single"
                              ? "A quick little showdown."
                              : "First to three wins takes the crown."}
                          </p>
                        </div>
                        <div className="segmented">
                          {(["single", "series"] as const).map((format) => (
                            <button
                              key={format}
                              className={
                                state.room?.format === format ? "chosen" : ""
                              }
                              onClick={() =>
                                act("settings", { ...state.room, format })
                              }
                            >
                              {format === "single"
                                ? "Single round"
                                : "First to 3"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="ready-area">
                    <button
                      className="primary"
                      disabled={
                        pending || state.ready.includes(me.id) || !connected
                      }
                      onClick={() => act("ready")}
                    >
                      {state.ready.includes(me.id) ? (
                        "✓ You’re ready"
                      ) : (
                        <>
                          Ready to play <span>↗</span>
                        </>
                      )}
                    </button>
                    <p>
                      <span
                        className={`status-dot ${partner.online ? "online" : ""}`}
                      />
                      {!partner.online
                        ? `Waiting for ${partner.name}.`
                        : partner.ready
                          ? `${partner.name} is ready. Let’s play!`
                          : state.ready.includes(me.id)
                            ? `Waiting for ${partner.name} to ready up.`
                            : "Both ready? Let the friendly rivalry begin."}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="panel-heading">
                    <span className="eyebrow">
                      {modeName(match.mode).toUpperCase()} · ROUND{" "}
                      {round?.number}
                    </span>
                    <span className="pill">
                      {match.format === "series"
                        ? "FIRST TO 3"
                        : "SINGLE ROUND"}
                    </span>
                  </div>
                  <div className="match-score">
                    <div>
                      <Avatar player={me} small />
                      <strong>{me.name}</strong>
                    </div>
                    <b>
                      {match.score[me.id]} <span>:</span>{" "}
                      {match.score[partner.id]}
                    </b>
                    <div>
                      <strong>{partner.name}</strong>
                      <Avatar player={partner} small />
                    </div>
                  </div>
                  {round?.mines && (
                    <MinesBoard
                      key={round.id}
                      data={round.mines}
                      profiles={state.profiles}
                      me={me.id}
                      active={!!active}
                      connected={connected}
                      pending={pending}
                      onReveal={(cell, turn, requestId) =>
                        act("reveal", {
                          matchId: match.id,
                          roundId: round.id,
                          cell,
                          turn,
                          requestId,
                        })
                      }
                    />
                  )}
                  {round?.phase === "preparing" && (
                    <div className="word-selection">
                      <span className="large-symbol">⇄</span>
                      <h2>A word, just for {partner.name}.</h2>
                      <p>
                        Choose a five-letter word. Once it’s locked, your secret
                        is safe.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          act("lock", { roundId: round.id, word: secret });
                        }}
                      >
                        <label className="sr-only" htmlFor="secret">
                          Secret word for your partner
                        </label>
                        <div className="secret-input">
                          <input
                            id="secret"
                            value={secret}
                            onChange={(e) =>
                              setSecret(
                                e.target.value
                                  .replace(/[^a-z]/gi, "")
                                  .toUpperCase(),
                              )
                            }
                            type={showSecret ? "text" : "password"}
                            maxLength={5}
                            autoComplete="off"
                            disabled={round.locked.includes(me.id)}
                            placeholder="•••••"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSecret(!showSecret)}
                          >
                            {showSecret ? "Hide" : "Show"}
                          </button>
                        </div>
                        <button
                          className="primary"
                          disabled={
                            pending ||
                            secret.length !== 5 ||
                            round.locked.includes(me.id)
                          }
                        >
                          {round.locked.includes(me.id)
                            ? "✓ Your word is locked"
                            : "Lock my word ⌑"}
                        </button>
                      </form>
                      <p className="muted">
                        {round.locked.includes(partner.id)
                          ? `✓ ${partner.name} has locked a word for you.`
                          : `${partner.name} is choosing your word…`}
                      </p>
                    </div>
                  )}
                  {match.mode !== "minesweeper" &&
                    (round?.phase === "countdown" ||
                      round?.phase === "playing") && (
                      <div className="play-surface">
                        <div className="play-status">
                          <span>{myGuesses.length}/6 guesses</span>
                          <span
                            className={`timer ${round.deadline - state.serverNow < 30000 ? "urgent" : ""}`}
                          >
                            {round.phase === "countdown"
                              ? `Starts in ${Math.max(1, Math.ceil((round.start - state.serverNow) / 1000))}`
                              : duration(
                                  Math.max(0, round.deadline - state.serverNow),
                                )}
                          </span>
                          <span>
                            <span
                              className={`status-dot ${partner.online ? "online" : ""}`}
                            />
                            {partner.name}: {round.counts[partner.id]}/6
                          </span>
                        </div>
                        <Board guesses={myGuesses} draft={draft} />
                        {round.phase === "countdown" && (
                          <p className="countdown-note">
                            Same moment. Fresh possibilities. Get ready!
                          </p>
                        )}
                        {myGuesses.length === 6 && (
                          <p className="countdown-note">
                            Your six guesses are in. {partner.name} can still
                            solve.
                          </p>
                        )}
                        <div
                          className="keyboard"
                          aria-label="On-screen keyboard"
                        >
                          {["QWERTYUIOP", "ASDFGHJKL", "↵ZXCVBNM⌫"].map(
                            (row, i) => (
                              <div key={i}>
                                {[...row].map((l) => {
                                  const marks = myGuesses.flatMap((g) =>
                                    [...g.word].flatMap((c, j) =>
                                      c === l ? [g.marks[j]] : [],
                                    ),
                                  );
                                  const mark = marks.includes("correct")
                                    ? "correct"
                                    : marks.includes("present")
                                      ? "present"
                                      : marks.includes("absent")
                                        ? "absent"
                                        : "";
                                  return (
                                    <button
                                      key={l}
                                      aria-label={
                                        l === "↵"
                                          ? "Enter guess"
                                          : l === "⌫"
                                            ? "Delete letter"
                                            : `${l}${mark ? ", " + mark : ""}`
                                      }
                                      className={`${mark} ${l === "↵" || l === "⌫" ? "wide" : ""}`}
                                      disabled={!canGuess}
                                      onClick={() =>
                                        key(l === "↵" ? "ENTER" : l)
                                      }
                                    >
                                      {l === "↵" ? "ENTER" : l}
                                    </button>
                                  );
                                })}
                              </div>
                            ),
                          )}
                        </div>
                        <div className="tile-legend">
                          <span>✓ Correct spot</span>
                          <span>• Wrong spot</span>
                          <span>− Not in word</span>
                        </div>
                      </div>
                    )}
                  {ended && (
                    <div className="results">
                      <span className="large-symbol">
                        {match.status === "abandoned"
                          ? "☾"
                          : (match.status === "completed"
                                ? match.winner
                                : round.winner) === me.id
                            ? "✦"
                            : (match.status === "completed"
                                  ? match.winner
                                  : round.winner) === null
                              ? "♡"
                              : "✧"}
                      </span>
                      <h2>
                        {match.status === "abandoned"
                          ? "We’ll call this a pause."
                          : (match.status === "completed"
                                ? match.winner
                                : round.winner) === null
                            ? "Great minds, same result."
                            : (match.status === "completed"
                                  ? match.winner
                                  : round.winner) === me.id
                              ? "This one’s yours!"
                              : `${partner.name} takes this one!`}
                      </h2>
                      <p>
                        {labelReason(
                          match.status === "active"
                            ? round.reason
                            : match.reason,
                        )}{" "}
                        ·{" "}
                        {match.status === "active"
                          ? "The series continues"
                          : match.status === "abandoned"
                            ? "No win awarded"
                            : "Match complete"}
                      </p>
                      {match.mode !== "minesweeper" && (
                        <div className="result-boards">
                          {state.profiles.map((p) => {
                            const guesses = round.guesses[p.id] || [],
                              solved = guesses.find(
                                (g) => g.word === round.answers?.[p.id],
                              );
                            const best = records.find(
                              (s) => s.id === p.id,
                            )?.fastest;
                            return (
                              <div key={p.id}>
                                <h3>
                                  {p.name}{" "}
                                  <span className={`${p.color}-text`}>
                                    {round.answers?.[p.id] || "—"}
                                  </span>
                                </h3>
                                <Board guesses={guesses} compact />
                                <p>
                                  {guesses.length}/6 guesses ·{" "}
                                  {solved
                                    ? duration(solved.at - round.start)
                                    : "Unsolved"}
                                </p>
                                {solved &&
                                  state.personalBests[round.id]?.includes(
                                    p.id,
                                  ) && (
                                    <span className="best-badge">
                                      ✦ Personal best · {duration(best)}
                                    </span>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="result-actions">
                        {match.status === "active" ? (
                          <button
                            className="primary"
                            disabled={pending || round.ready.includes(me.id)}
                            onClick={() => act("ready", { roundId: round.id })}
                          >
                            {round.ready.includes(me.id)
                              ? `Waiting for ${partner.name}…`
                              : "Ready for next round ↗"}
                          </button>
                        ) : (
                          <>
                            <button
                              className="primary"
                              disabled={
                                pending || state.rematch.includes(me.id)
                              }
                              onClick={() =>
                                act("rematch", { matchId: match.id })
                              }
                            >
                              {state.rematch.includes(me.id)
                                ? `Waiting for ${partner.name}…`
                                : "One more? Rematch ↗"}
                            </button>
                            <button
                              className="secondary"
                              onClick={() => act("return")}
                            >
                              Back to our room
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {active && (
                    <button
                      className="concede"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Concede this match? Your partner will win the match.",
                          )
                        )
                          act("concede", { matchId: match.id });
                      }}
                    >
                      Concede match
                    </button>
                  )}
                </>
              )}
            </section>
            <aside className="sidebar">
              <section className="record-card">
                <div className="section-title">
                  <h2>Our little rivalry</h2>
                  <span>♜</span>
                </div>
                <p className="muted">All-time match record</p>
                {recordRow}
                <div className="record-foot">
                  {record.played === 0
                    ? "A clean slate. Who’s taking the first win?"
                    : `${record.played} ${record.played === 1 ? "match" : "matches"}, and counting.`}
                </div>
              </section>
              <section className="how-card">
                <span className="eyebrow">
                  {match ? "A LITTLE REMINDER" : "THE SHORT & SWEET VERSION"}
                </span>
                <h2>{modeName(match?.mode || state.room!.mode)}</h2>
                {(match?.mode || state.room?.mode) === "minesweeper" ? (
                  <>
                    <div className="rule">
                      <span>01</span>
                      <p>
                        Take turns revealing one tile on the same board. The
                        first tile and its neighbors are safe.
                      </p>
                    </div>
                    <div className="rule">
                      <span>02</span>
                      <p>
                        Numbers count adjacent mines. Empty areas open
                        automatically as one move.
                      </p>
                    </div>
                    <div className="rule">
                      <span>03</span>
                      <p>
                        Three lives each. Hit three mines and lose. Clear every
                        safe tile: more lives wins, equal lives draws.
                      </p>
                    </div>
                    <small>
                      Revealed tiles are shared. Hidden mines stay secret until
                      the match ends.
                    </small>
                  </>
                ) : (
                  <>
                    <div className="rule">
                      <span>01</span>
                      <p>
                        {(match?.mode || state.room?.mode) === "race"
                          ? "You both get the same secret word."
                          : "Choose a secret word for each other."}
                      </p>
                    </div>
                    <div className="rule">
                      <span>02</span>
                      <p>
                        Five letters. Six guesses.
                        <br />
                        Three minutes on the clock.
                      </p>
                    </div>
                    <div className="rule">
                      <span>03</span>
                      <p>
                        First to solve wins.
                        <br />
                        Bragging rights included.
                      </p>
                    </div>
                    <div className="mini-tiles" aria-hidden="true">
                      <b className="correct">W</b>
                      <b className="present">O</b>
                      <b>R</b>
                      <b className="correct">D</b>
                      <b className="present">S</b>
                    </div>
                    <small>
                      Your partner’s board stays a secret until the round ends.
                    </small>
                  </>
                )}
              </section>
              <section className="recent-card">
                <div className="section-title">
                  <h2>Recently, with you</h2>
                  <button onClick={() => setTab("history")}>View all ↗</button>
                </div>
                {history.matches.length ? (
                  history.matches.slice(0, 3).map((m) => (
                    <button
                      className="recent-match"
                      key={m.id}
                      onClick={() => {
                        setDetail(m);
                        setTab("history");
                      }}
                    >
                      <span className="recent-icon">
                        {m.mode === "race"
                          ? "⚡"
                          : m.mode === "minesweeper"
                            ? "💣"
                            : "⇄"}
                      </span>
                      <span>
                        <strong>
                          {m.status === "abandoned"
                            ? "Paused"
                            : m.winner
                              ? `${state.profiles.find((p) => p.id === m.winner)?.name} won`
                              : "A draw"}
                        </strong>
                        <small>
                          {modeName(m.mode)} ·{" "}
                          {m.format === "single" ? "Single" : "Series"}
                        </small>
                      </span>
                      <b>
                        {m.score[1]}–{m.score[2]}
                      </b>
                    </button>
                  ))
                ) : (
                  <div className="empty-small">
                    <span>↺</span>
                    <p>Our first match is still unwritten.</p>
                    <small>Let’s change that.</small>
                  </div>
                )}
              </section>
              <p className="aside-note">
                A shared room. A favorite person.
                <br />
                Always a reason to come back. ♡
              </p>
            </aside>
          </div>
        )}
        {tab === "history" && (
          <section className="history-panel">
            {detail ? (
              <>
                <button className="text-button" onClick={() => setDetail(null)}>
                  ← All matches
                </button>
                <h2>
                  {modeName(detail.mode)} ·{" "}
                  {detail.format === "single"
                    ? "Single round"
                    : "First to three"}
                </h2>
                <p className="muted">
                  {new Date(detail.start).toLocaleString()} ·{" "}
                  {duration(detail.end - detail.start)} ·{" "}
                  {labelReason(detail.reason)}
                </p>
                <h3>
                  {detail.status === "abandoned"
                    ? "Abandoned · no win awarded"
                    : detail.winner
                      ? `${state.profiles.find((p) => p.id === detail.winner)?.name} won`
                      : "Draw"}{" "}
                  · {detail.score[1]}–{detail.score[2]}
                </h3>
                {detail.rounds.map((r) => (
                  <article className="history-round" key={r.id}>
                    <div className="section-title">
                      <h3>Round {r.number}</h3>
                      <span>{labelReason(r.reason)}</span>
                    </div>
                    {r.mines ? (
                      <MinesHistory
                        data={r.mines}
                        profiles={state.profiles}
                        me={me.id}
                      />
                    ) : (
                      <div className="result-boards">
                        {state.profiles.map((p) => {
                          const solved = r.guesses[p.id].find(
                            (g) => g.word === r.answers[p.id],
                          );
                          return (
                            <div key={p.id}>
                              <h3>
                                {p.name} · {r.answers[p.id] || "Not chosen"}
                              </h3>
                              <Board guesses={r.guesses[p.id]} compact />
                              <p>
                                {r.guesses[p.id].length} guesses ·{" "}
                                {solved
                                  ? duration(solved.at - r.start)
                                  : "Unsolved"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                ))}
              </>
            ) : (
              <>
                <div className="section-title">
                  <h2>Our matchbook</h2>
                  <span>{history.total} saved matches</span>
                </div>
                {history.matches.length ? (
                  history.matches.map((m) => (
                    <button
                      key={m.id}
                      className="history-row"
                      onClick={() => setDetail(m)}
                    >
                      <span className="recent-icon">
                        {m.mode === "race"
                          ? "⚡"
                          : m.mode === "minesweeper"
                            ? "💣"
                            : "⇄"}
                      </span>
                      <span>
                        <strong>{modeName(m.mode)}</strong>
                        <small>
                          {new Date(m.start).toLocaleString()} ·{" "}
                          {m.format === "single"
                            ? "Single round"
                            : "First to three"}
                        </small>
                      </span>
                      <span className="history-result">
                        {m.status === "abandoned"
                          ? "Abandoned"
                          : m.winner
                            ? `${state.profiles.find((p) => p.id === m.winner)?.name} won`
                            : "Draw"}
                        <small>
                          {labelReason(m.reason)} · {duration(m.end - m.start)}
                        </small>
                      </span>
                      <b>
                        {m.score[1]}–{m.score[2]} ↗
                      </b>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    <span>✎</span>
                    <h2>Here’s to our first game.</h2>
                    <p>Your matches will be saved here, letter by letter.</p>
                    <button className="primary" onClick={() => setTab("room")}>
                      Back to our room ↗
                    </button>
                  </div>
                )}
                <div className="pagination">
                  <button
                    disabled={history.page === 1}
                    onClick={() => loadHistory(history.page - 1)}
                  >
                    ← Previous
                  </button>
                  <span>
                    Page {history.page} of{" "}
                    {Math.max(1, Math.ceil(history.total / 10))}
                  </span>
                  <button
                    disabled={history.page * 10 >= history.total}
                    onClick={() => loadHistory(history.page + 1)}
                  >
                    Next →
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {tab === "stats" && (
          <section className="stats-panel">
            <div className="section-title">
              <h2>Head to head</h2>
              <div className="segmented">
                {["all", "race", "swap", "minesweeper"].map((mode) => (
                  <button
                    key={mode}
                    className={statsMode === mode ? "chosen" : ""}
                    onClick={() => setStatsMode(mode)}
                  >
                    {mode === "all" ? "All games" : modeName(mode)}
                  </button>
                ))}
              </div>
            </div>
            <div className="stats-grid">
              {(statsMode === "all"
                ? state.stats
                : state.modeStats[statsMode as "race" | "swap" | "minesweeper"]
              ).map((s) => {
                const p = state.profiles.find((p) => p.id === s.id)!;
                return (
                  <article className={`stat-player ${p.color}`} key={s.id}>
                    <Avatar player={p} />
                    <h2>{p.name}</h2>
                    <div className="stat-hero">
                      <strong>{s.wins}</strong>
                      <span>match wins</span>
                    </div>
                    <dl>
                      {[
                        ["Matches played", s.played],
                        ["Losses / draws", `${s.losses} / ${s.draws}`],
                        ["Win rate", `${Math.round(s.winRate * 100)}%`],
                        [
                          "Current / best win streak",
                          `${s.currentStreak} / ${s.bestStreak}`,
                        ],
                        ...(statsMode === "minesweeper"
                          ? []
                          : [
                              [
                                "Word rounds played / solved",
                                `${s.rounds} / ${s.solved}`,
                              ],
                              [
                                "Solve rate",
                                `${Math.round(s.solveRate * 100)}%`,
                              ],
                              ["Fastest solve", duration(s.fastest)],
                              [
                                "Average guesses",
                                s.averageGuesses?.toFixed(1) || "—",
                              ],
                              ["Average solve time", duration(s.averageTime)],
                            ]),
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                );
              })}
            </div>
            <p className="muted stats-note">
              Win rate includes draws. Forfeits count as match wins and losses.
              Abandoned matches and rounds are excluded. Solve averages use
              correctly solved rounds only. Word-solving metrics exclude
              Minesweeper.
            </p>
          </section>
        )}
        {tab === "settings" && (
          <div className="settings-grid">
            <section className="settings-card">
              <h2>Our room</h2>
              <p className="muted">
                One permanent address. Make yourself at home.
              </p>
              <form
                key={state.room?.name}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  act(
                    "settings",
                    {
                      ...state.room,
                      name: f.get("name"),
                      description: f.get("description"),
                      icon: f.get("icon"),
                    },
                    () => setNotice("Room settings saved."),
                  );
                }}
              >
                <label>
                  Room name
                  <input
                    name="name"
                    maxLength={40}
                    required
                    defaultValue={state.room?.name}
                    disabled={active}
                  />
                </label>
                <label>
                  A little description
                  <textarea
                    name="description"
                    maxLength={120}
                    defaultValue={state.room?.description}
                    disabled={active}
                  />
                </label>
                <label>
                  Room icon
                  <select
                    name="icon"
                    defaultValue={state.room?.icon}
                    disabled={active}
                  >
                    {["✦", "♡", "☾", "✿"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={active || pending}>
                  Save room
                </button>
              </form>
              <button
                className="secondary"
                onClick={() =>
                  (
                    navigator.clipboard?.writeText(location.origin) ??
                    Promise.reject(new Error("Clipboard unavailable"))
                  )
                    .then(() => setNotice("Room link copied."))
                    .catch(() =>
                      setError(
                        "Copy your browser’s address to share this room.",
                      ),
                    )
                }
              >
                Copy permanent room link ↗
              </button>
              <small>Only the two of you can enter using this link.</small>
            </section>
            <section className="settings-card">
              <h2>Your corner</h2>
              <form
                key={me.name}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  act(
                    "profile",
                    { name: f.get("name"), avatar: f.get("avatar") },
                    () => setNotice("Profile saved."),
                  );
                }}
              >
                <label>
                  Your name
                  <input
                    name="name"
                    maxLength={24}
                    required
                    defaultValue={me.name}
                    disabled={active}
                  />
                </label>
                <label>
                  Your avatar
                  <select
                    name="avatar"
                    defaultValue={me.avatar}
                    disabled={active}
                  >
                    {["✦", "✿", "☾", "♡", "initials"].map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={active || pending}>
                  Save profile
                </button>
              </form>
              <div className="color-swap">
                <h3>A change of colors?</h3>
                <p>Your scores stay yours. Both players need to agree.</p>
                <button
                  className="secondary"
                  disabled={active || pending}
                  onClick={() => act("swapColors")}
                >
                  {state.swapRequest === me.id
                    ? "Cancel color-swap request"
                    : state.swapRequest === partner.id
                      ? `Accept ${partner.name}’s color swap`
                      : "Request a color swap ⇄"}
                </button>
              </div>
            </section>
            <section className="settings-card preferences">
              <h2>Just on this device</h2>
              {(
                [
                  ["sound", "Little game sounds"],
                  ["motion", "Reduce animations"],
                  ["contrast", "High-contrast tiles"],
                ] as const
              ).map(([k, label]) => (
                <label className="toggle-row" key={k}>
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={prefs[k]}
                    onChange={(e) =>
                      setPrefs({ ...prefs, [k]: e.target.checked })
                    }
                  />
                </label>
              ))}
              {active && (
                <p className="muted">
                  Room and profile changes will be available after this match.
                </p>
              )}
            </section>
          </div>
        )}
        <footer className="app-footer">
          <span>
            <span className="footer-spark">✦</span> OUR WORDS. OUR WORLD.
          </span>
          <span>
            Made for two. Always. <span className="yellow-text">♡</span>
          </span>
        </footer>
      </main>
    </div>
  );
}
