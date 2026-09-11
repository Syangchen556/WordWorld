export const choices = ["rock", "paper", "scissors"] as const;
export type Choice = (typeof choices)[number];
export type RpsState = {
  choices: Record<number, Choice>;
  requests: Record<number, string>;
  nextAt: number;
  scoreAfter?: Record<number, number>;
};
export type RpsView = Omit<RpsState, "requests">;
export function validChoice(value: unknown): value is Choice {
  return typeof value === "string" && choices.includes(value as Choice);
}
export function rpsWinner(one: Choice, two: Choice): number | null {
  if (one === two) return null;
  return (one === "rock" && two === "scissors") ||
    (one === "scissors" && two === "paper") ||
    (one === "paper" && two === "rock")
    ? 1
    : 2;
}
export function rpsView(state: RpsState, id: number, over: boolean): RpsView {
  return {
    nextAt: state.nextAt,
    scoreAfter: state.scoreAfter,
    choices: over
      ? { ...state.choices }
      : state.choices[id]
        ? { [id]: state.choices[id] }
        : {},
  };
}
