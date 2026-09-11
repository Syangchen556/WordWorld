import type { Match } from "./types";
export abstract class Records {
  abstract history(): Match[];
  personalBests() {
    const best: Record<number, number> = { 1: Infinity, 2: Infinity };
    const records: Record<string, number[]> = {};
    for (const m of [...this.history()]
      .reverse()
      .filter((m) => m.mode !== "minesweeper"))
      for (const r of m.rounds) {
        if (r.phase !== "ended" || !r.start || r.end < r.start) continue;
        for (const id of [1, 2]) {
          const g = r.guesses[id].find((g) => g.word === r.answers[id]);
          if (g && g.at - r.start < best[id]) {
            best[id] = g.at - r.start;
            (records[r.id] ||= []).push(id);
          }
        }
      }
    return records;
  }
  stats(mode?: string) {
    const all = this.history().filter((m) => !mode || m.mode === mode);
    const matches = all.filter((m) => m.status === "completed");
    return [1, 2].map((id) => {
      const wins = matches.filter((m) => m.winner === id).length,
        draws = matches.filter((m) => m.winner === null).length;
      const rounds = all
        .filter((m) => m.mode !== "minesweeper")
        .flatMap((m) => m.rounds)
        .filter((r) => r.start > 0 && r.end >= r.start && r.phase === "ended");
      const solved = rounds.flatMap((r) => {
        const g = r.guesses[id].find((g) => g.word === r.answers[id]);
        return g
          ? [{ time: g.at - r.start, guesses: r.guesses[id].indexOf(g) + 1 }]
          : [];
      });
      let streak = 0,
        bestStreak = 0,
        currentStreak = 0;
      for (const m of [...matches].reverse()) {
        streak = m.winner === id ? streak + 1 : 0;
        bestStreak = Math.max(bestStreak, streak);
      }
      currentStreak = streak;
      return {
        id,
        played: matches.length,
        wins,
        losses: matches.length - wins - draws,
        draws,
        winRate: matches.length ? wins / matches.length : 0,
        currentStreak,
        bestStreak,
        rounds: rounds.length,
        solved: solved.length,
        solveRate: rounds.length ? solved.length / rounds.length : 0,
        fastest: solved.length ? Math.min(...solved.map((s) => s.time)) : null,
        averageGuesses: solved.length
          ? solved.reduce((a, s) => a + s.guesses, 0) / solved.length
          : null,
        averageTime: solved.length
          ? solved.reduce((a, s) => a + s.time, 0) / solved.length
          : null,
      };
    });
  }
}
