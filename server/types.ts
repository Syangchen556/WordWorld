import type { MinesState, Difficulty } from "./minesweeper";
import type { RpsState } from "./rps";
export type Mode = "race" | "swap" | "minesweeper" | "rps";
export type Format = "single" | "series" | "first5";
export type Mark = "correct" | "present" | "absent";
export type Guess = {
  word: string;
  marks: Mark[];
  at: number;
  requestId: string;
};
export type Profile = {
  id: number;
  name: string;
  avatar: string;
  color: "purple" | "yellow";
};
export type Room = {
  difficulty?: Difficulty;
  name: string;
  description: string;
  icon: string;
  mode: Mode;
  format: Format;
};
export type Round = {
  rps?: RpsState;
  mines?: MinesState;
  id: string;
  number: number;
  phase: "preparing" | "countdown" | "playing" | "ended" | "abandoned";
  answers: Record<number, string>;
  locked: number[];
  ready: number[];
  guesses: Record<number, Guess[]>;
  start: number;
  deadline: number;
  end: number;
  winner: number | null;
  reason: string;
};
export type Match = {
  id: string;
  mode: Mode;
  format: Format;
  start: number;
  end: number;
  status: "active" | "completed" | "abandoned";
  score: Record<number, number>;
  winner: number | null;
  reason: string;
  rounds: Round[];
};
export function score(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(5).fill("absent");
  const remaining: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) marks[i] = "correct";
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++)
    if (marks[i] !== "correct" && remaining[guess[i]] > 0) {
      marks[i] = "present";
      remaining[guess[i]]--;
    }
  return marks;
}
