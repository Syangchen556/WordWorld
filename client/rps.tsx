"use client";
import { useRef, useState } from "react";
import { choices, type Choice, type RpsView } from "../server/rps";
import type { Profile, Round } from "../server/types";

export function ChoiceIcon({ choice }: { choice: Choice }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {choice === "rock" ? (
        <>
          <path d="m12 45-2-17 13-15 22 3 10 17-7 18-24 3Z" />
          <path d="m10 28 20 5 15-17M30 33l-6 21m6-21 25 0" />
        </>
      ) : choice === "paper" ? (
        <>
          <path d="M16 7h23l11 12v38H16Z" />
          <path d="M39 7v13h11M24 29h18M24 38h18M24 47h12" />
        </>
      ) : (
        <>
          <circle cx="17" cy="46" r="8" />
          <circle cx="47" cy="46" r="8" />
          <path d="m22 40 28-30-13 24 5 6M42 40 14 10l13 24-5 6" />
          <circle cx="32" cy="30" r="2" />
        </>
      )}
    </svg>
  );
}
export function RpsResult({
  data,
  profiles,
  me,
  winner,
  reason,
  score,
}: {
  data: RpsView;
  profiles: Profile[];
  me: number;
  winner: number | null;
  reason: string;
  score?: Record<number, number>;
}) {
  const one = data.choices[1],
    two = data.choices[2];
  const winnerName = profiles.find((p) => p.id === winner)?.name;
  const explanation =
    reason === "rps_timeout"
      ? `${winnerName} wins by timeout: the other player did not lock a choice.`
      : reason === "inactivity"
        ? "Neither player locked a choice. Match abandoned; no win awarded."
        : reason !== "rps_normal"
          ? "Match ended before both choices were resolved."
          : one === two
            ? "Identical choices — no point awarded."
            : [one, two].includes("rock") && [one, two].includes("scissors")
              ? "Rock crushes scissors."
              : [one, two].includes("paper") && [one, two].includes("rock")
                ? "Paper covers rock."
                : "Scissors cut paper.";
  return (
    <div className="rps-result">
      <h3>
        {reason === "inactivity" ||
        reason === "both_disconnected" ||
        reason === "server_restart"
          ? "Match abandoned"
          : winner === null
            ? "Draw"
            : winner === me
              ? "You win"
              : "You lose"}
      </h3>
      <div className="rps-reveal">
        {profiles.map((p) => (
          <div key={p.id} className={`rps-revealed-choice ${p.color}`}>
            <strong>{p.name}</strong>
            {data.choices[p.id] ? (
              <ChoiceIcon choice={data.choices[p.id]} />
            ) : (
              <span className="rps-missing">—</span>
            )}
            <span>{data.choices[p.id] || "Not locked"}</span>
          </div>
        ))}
      </div>
      <p>{explanation}</p>
      {score && (
        <p className="muted">
          Running score: {profiles[0].name} {score[1]} : {score[2]}{" "}
          {profiles[1].name}
        </p>
      )}
    </div>
  );
}
export function RpsPlay({
  data,
  phase,
  me,
  partner,
  connected,
  pending,
  serverNow,
  start,
  deadline,
  onLock,
}: {
  data: RpsView;
  phase: Round["phase"];
  me: Profile;
  partner: Profile & { online?: boolean };
  connected: boolean;
  pending: boolean;
  serverNow: number;
  start: number;
  deadline: number;
  onLock: (choice: Choice, requestId: string) => void;
}) {
  const [selected, setSelected] = useState<Choice | null>(null);
  const request = useRef<{ choice: Choice; id: string } | null>(null);
  const locked = data.choices[me.id];
  const canSelect = connected && phase === "playing" && !locked && !pending;
  return (
    <div className="rps-surface">
      <div className="rps-status">
        <span>{connected ? "Connected" : "Reconnecting…"}</span>
        <span>
          {partner.online
            ? `${partner.name} online`
            : `${partner.name} offline`}
        </span>
      </div>
      <h2>
        {phase === "countdown"
          ? "Rock. Paper. Scissors."
          : locked
            ? `Waiting for ${partner.name}`
            : "Make your move."}
      </h2>
      <p className="rps-timer" role="status">
        {phase === "countdown"
          ? `Starts in ${Math.max(0, Math.ceil((start - serverNow) / 1000))}`
          : `${Math.max(0, Math.ceil((deadline - serverNow) / 1000))} seconds to lock`}
      </p>
      <div className="rps-options" aria-label="Choose rock, paper or scissors">
        {choices.map((choice) => (
          <button
            key={choice}
            className={`rps-choice ${choice === (locked || selected) ? "chosen" : ""}`}
            aria-pressed={choice === (locked || selected)}
            disabled={!canSelect}
            onClick={() => setSelected(choice)}
          >
            <ChoiceIcon choice={choice} />
            <span>{choice}</span>
          </button>
        ))}
      </div>
      <button
        className="primary rps-lock"
        disabled={!canSelect || !selected}
        onClick={() => {
          if (!selected) return;
          if (!request.current || request.current.choice !== selected)
            request.current = { choice: selected, id: crypto.randomUUID() };
          onLock(selected, request.current.id);
        }}
      >
        {locked ? `Locked: ${locked}` : "Lock Choice"}
      </button>
      <p className="muted">
        {locked
          ? "Your locked choice is final."
          : "Change your selection freely, then lock it. Only locked choices count."}
      </p>
    </div>
  );
}
