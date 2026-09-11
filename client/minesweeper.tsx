"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MinesState, MinesView } from "../server/minesweeper";
import type { Profile } from "../server/types";

export function MinesBoard({
  data,
  profiles,
  me,
  active = false,
  connected = false,
  pending = false,
  onReveal,
}: {
  data: MinesView;
  profiles: Profile[];
  me: number;
  active?: boolean;
  connected?: boolean;
  pending?: boolean;
  onReveal?: (cell: number, turn: number, requestId: string) => void;
}) {
  const [flash, setFlash] = useState<number | null>(null);
  const retry = useRef<{
    cell: number;
    turn: number;
    requestId: string;
  } | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending, data.moveCount]);
  useEffect(() => {
    if (!data.lastMove?.mine) return;
    setFlash(data.lastMove.cell);
    const timer = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(timer);
  }, [data.moveCount]);
  const myTurn = active && data.currentPlayer === me;
  const last = data.lastMove;
  const actor =
    last?.player === me
      ? "You"
      : profiles.find((p) => p.id === last?.player)?.name || "Your opponent";
  const feedback = !last
    ? "The first tile and its neighbors are safe. Player 1 starts."
    : last.mine
      ? `${actor} hit a mine! ${data.lives[last.player]} lives remaining.`
      : `${actor}: Safe! ${last.adjacent} mines nearby.${last.opened > 1 ? ` ${last.opened} tiles opened.` : ""}`;
  return (
    <div className="mines-surface">
      <div className="mines-header">
        {profiles.map((p) => (
          <div
            key={p.id}
            className={`mines-player ${p.color} ${active && data.currentPlayer === p.id ? "turn-player" : ""}`}
          >
            <strong>{p.name}</strong>
            <span
              aria-label={`${p.name}: ${data.lives[p.id]} lives`}
              className="mines-lives"
            >
              {"♥".repeat(data.lives[p.id])}
              <span className="lost-lives">
                {"♡".repeat(3 - data.lives[p.id])}
              </span>
            </span>
          </div>
        ))}
      </div>
      <p className="mines-meta">
        💣 Minesweeper · <span>{data.difficulty}</span> · {data.mineCount} mines
        · {data.rows} × {data.columns}
      </p>
      <h3 className="mines-turn" aria-live="polite">
        {active
          ? !connected
            ? "Reconnecting…"
            : myTurn
              ? "Your turn"
              : "Opponent’s turn"
          : "Final board"}
      </h3>
      <p className="mines-feedback" role="status">
        {feedback}
      </p>
      <div
        className="mines-scroll"
        tabIndex={0}
        aria-label="Shared Minesweeper board; scroll horizontally on smaller screens"
      >
        <div
          className="mines-grid"
          style={{ "--columns": data.columns } as CSSProperties}
        >
          {data.cells.map((value, cell) => {
            const hidden = value === null;
            return (
              <button
                key={cell}
                type="button"
                className={`mine-cell ${hidden ? "hidden-cell" : value === -1 ? "revealed-mine" : "safe-cell"} ${flash === cell ? "mine-flash" : ""}`}
                data-number={value}
                aria-label={`Row ${Math.floor(cell / data.columns) + 1}, column ${(cell % data.columns) + 1}: ${hidden ? "hidden" : value === -1 ? "mine" : value === 0 ? "empty" : `${value} nearby mines`}`}
                disabled={!hidden || !myTurn || !connected || pending}
                onClick={() => {
                  if (busy.current || !onReveal) return;
                  busy.current = true;
                  if (
                    !retry.current ||
                    retry.current.cell !== cell ||
                    retry.current.turn !== data.moveCount
                  )
                    retry.current = {
                      cell,
                      turn: data.moveCount,
                      requestId: crypto.randomUUID(),
                    };
                  onReveal(cell, retry.current.turn, retry.current.requestId);
                }}
              >
                {hidden
                  ? ""
                  : value === -1
                    ? flash === cell
                      ? "💥"
                      : "💣"
                    : value || ""}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mines-help">
        {data.moveCount} moves · One tile per turn · Three mine hits loses
        {data.columns > 8 ? " · Swipe the board if needed" : ""}
      </p>
    </div>
  );
}

// History is authenticated and contains finished layouts. Derive display values
// only for that revealed result; live play always uses the server-filtered view.
export function MinesHistory({
  data,
  profiles,
  me,
}: {
  data: MinesState;
  profiles: Profile[];
  me: number;
}) {
  const mines = new Set(data.layout || []);
  const cells = Array.from({ length: data.rows * data.columns }, (_, i) => {
    if (!data.layout) return null;
    if (mines.has(i)) return -1;
    let count = 0;
    const row = Math.floor(i / data.columns),
      col = i % data.columns;
    for (
      let y = Math.max(0, row - 1);
      y <= Math.min(data.rows - 1, row + 1);
      y++
    )
      for (
        let x = Math.max(0, col - 1);
        x <= Math.min(data.columns - 1, col + 1);
        x++
      )
        if (mines.has(y * data.columns + x)) count++;
    return count;
  });
  return (
    <MinesBoard
      data={{ ...data, moveCount: data.moves.length, cells }}
      profiles={profiles}
      me={me}
    />
  );
}
