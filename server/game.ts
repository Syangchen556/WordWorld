import { randomUUID, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import wordListPath from "word-list";
import { score, type Match, type Round, type Mode, type Format } from "./types";
import type { GameStore } from "./state-store";
import { rpsWinner, rpsView, validChoice } from "./rps";
import {
  createMines,
  difficulties,
  minesView,
  reveal,
  type Difficulty,
} from "./minesweeper";
// Hand-curated everyday answers. Never imported by the browser.
const answers =
  "ABOVE ACORN ACTOR ADAPT ADORE AFTER AGENT AGILE AGLOW ALBUM ALERT ALIVE ALLOW ALONE AMBER ANGEL APPLE APRIL ARROW ASIDE AUDIO AVOID AWAKE AWARD BAKER BEACH BEAST BEGIN BERRY BIRCH BIRTH BLACK BLADE BLANK BLEND BLINK BLOOM BOARD BOOST BRAIN BRAVE BREAD BREAK BRICK BRIDE BRIEF BRING BROOK BRUSH BUILD CABIN CANDY CARRY CATCH CHAIR CHARM CHASE CHEEK CHESS CHIEF CHIME CHOIR CIVIC CLEAN CLEAR CLIMB CLOCK CLOUD COAST COMET CORAL COUNT COURT COVER CRAFT CRANE CREAM CREEK CRISP CROWN DANCE DELAY DEPTH DREAM DRESS DRIFT DRINK DRIVE EARLY EARTH EIGHT ELBOW EMBER ENJOY ENTER EQUAL EVERY EXTRA FAITH FANCY FEAST FIELD FINAL FIRST FLAME FLASH FLOAT FLOOR FLORA FLOUR FOCUS FORCE FORGE FRESH FRONT FROST FRUIT GIANT GIVEN GLASS GLEAM GLIDE GLOBE GLORY GLOVE GRACE GRAIN GRAPE GRASS GREAT GREEN GROVE GROWN GUESS GUIDE HAPPY HEART HONEY HORSE HOUSE HUMAN HUMOR IMAGE INDEX INNER INPUT IVORY JELLY JEWEL JOINT JOLLY JUICE KAYAK KNIFE KNOCK LABEL LARGE LASER LATER LAUGH LAYER LEARN LEMON LEVEL LIGHT LILAC LIMIT LINEN LIVER LOCAL LODGE LOGIC LOOSE LUCKY LUNAR MAGIC MAJOR MANGO MAPLE MARCH MATCH MAYBE MEDAL MELON MERIT MERRY METAL MIGHT MINOR MODEL MONEY MONTH MOTOR MOUNT MOUSE MOVIE MUSIC NEVER NIGHT NOBLE NORTH NOVEL OCEAN OLIVE ONION OPERA ORBIT ORDER OTHER OTTER OUGHT OUTER PAINT PANEL PAPER PARTY PATCH PEACE PEACH PEARL PENNY PETAL PHONE PHOTO PIANO PIECE PILOT PITCH PIZZA PLACE PLAIN PLANE PLANT PLATE PLAZA PLUCK POINT POLAR POUND POWER PRESS PRICE PRIDE PRIME PRINT PRIZE PROUD PUPPY QUEEN QUEST QUICK QUIET QUILT RADIO RAISE RALLY RANCH RANGE RATIO REACH READY REPLY RHYME RIDGE RIGHT RIVER ROAST ROBIN ROBOT ROCKY ROUND ROUTE ROYAL RURAL SALAD SALSA SANDY SAUCE SCALE SCARF SCENE SCENT SCORE SCOUT SEVEN SHADE SHARE SHARP SHEEP SHEET SHELF SHELL SHINE SHIRT SHORE SHORT SHOUT SIGHT SILLY SINCE SKILL SLEEP SLICE SLIDE SMALL SMART SMILE SMOKE SNAIL SNOWY SOLAR SOLID SOLVE SOUND SOUTH SPACE SPARK SPEAK SPELL SPICE SPIKE SPINE SPOON SPORT SPRAY STACK STAGE STAIR STAND STARE START STEAM STEEL STILL STONE STORE STORM STORY STOVE STRAW STUDY STYLE SUGAR SUNNY SUPER SWEET SWIFT SWING TABLE TASTE TEACH THANK THEIR THEME THERE THICK THING THINK THIRD THORN THREE THROW TIGER TITLE TOAST TODAY TOKEN TOOTH TOPIC TORCH TOTAL TOUCH TOWER TRACE TRACK TRADE TRAIL TRAIN TREAT TREND TRIAL TRIBE TRICK TULIP TWICE TWIST UNDER UNION UNITY UNTIL UPPER URBAN USUAL VALID VALUE VIDEO VISIT VITAL VOICE VOTER WAGON WATER WHEEL WHERE WHICH WHILE WHITE WHOLE WHOSE WIDEN WINDS WOMAN WORLD WORRY WORTH WOULD WRITE YACHT YEARN YOUNG YOUTH ZEBRA".split(
    " ",
  );
const dictionary = new Set(
  readFileSync(wordListPath, "utf8")
    .split("\n")
    .filter((w) => /^[a-z]{5}$/.test(w))
    .map((w) => w.toUpperCase()),
);
for (const word of answers) dictionary.add(word);
export const validWord = (word: unknown): word is string =>
  typeof word === "string" && /^[A-Z]{5}$/.test(word) && dictionary.has(word);
export class Game {
  match: Match | null = null;
  ready: number[] = [];
  rematch: number[] = [];
  swapRequest: number | null = null;
  online = new Map<number, number>();
  offlineAt = new Map<number, number>();
  constructor(
    public store: GameStore,
    public now = () => Date.now(),
    public pick = () => answers[randomInt(answers.length)],
  ) {}
  get round() {
    return this.match?.rounds.at(-1);
  }
  connect(id: number) {
    this.online.set(id, (this.online.get(id) || 0) + 1);
    this.offlineAt.delete(id);
  }
  disconnect(id: number) {
    this.online.set(id, Math.max(0, (this.online.get(id) || 0) - 1));
    if (!this.online.get(id)) {
      this.ready = this.ready.filter((p) => p !== id);
      this.offlineAt.set(id, this.now());
    }
  }
  start(
    mode: Mode,
    format: Format,
    difficulty: Difficulty = this.store.room()?.difficulty || "easy",
  ) {
    this.match = {
      id: randomUUID(),
      mode,
      format:
        mode === "minesweeper"
          ? "single"
          : mode !== "rps" && format === "first5"
            ? "series"
            : format,
      start: this.now(),
      end: 0,
      status: "active",
      score: { 1: 0, 2: 0 },
      winner: null,
      reason: "",
      rounds: [],
    };
    this.ready = [];
    this.rematch = [];
    this.newRound();
    if (mode === "minesweeper") {
      this.round!.mines = createMines(difficulty);
      this.persist();
    }
  }
  newRound() {
    const m = this.match!;
    const r: Round = {
      id: randomUUID(),
      number: m.rounds.length + 1,
      phase: "preparing",
      answers: {},
      locked: [],
      ready: [1, 2],
      guesses: { 1: [], 2: [] },
      start: 0,
      deadline: 0,
      end: 0,
      winner: null,
      reason: "",
    };
    m.rounds.push(r);
    if (m.mode === "rps") {
      r.rps = { choices: {}, requests: {}, nextAt: 0 };
      this.countdown();
    }
    if (m.mode === "minesweeper") {
      r.mines = createMines(this.store.room()?.difficulty || "easy");
      r.phase = "playing";
      r.start = this.now();
    }
    if (m.mode === "race") {
      const word = this.pick();
      r.answers = { 1: word, 2: word };
      r.locked = [1, 2];
      this.countdown();
    }
    this.persist();
  }
  countdown() {
    const r = this.round!;
    r.phase = "countdown";
    r.start = this.now() + 3000;
    r.deadline = r.start + (this.match!.mode === "rps" ? 10000 : 180000);
  }
  persist() {
    if (this.match) this.store.saveMatch(this.match);
  }
  finishRound(winner: number | null, reason: string) {
    const m = this.match!,
      r = this.round!;
    if (m.status !== "active" || ["ended", "abandoned"].includes(r.phase))
      return;
    r.phase = "ended";
    r.end = this.now();
    r.winner = winner;
    r.reason = reason;
    r.ready = [];
    if (winner) m.score[winner]++;
    if (
      m.format === "single" ||
      (winner && m.score[winner] >= (m.format === "first5" ? 5 : 3))
    ) {
      m.status = "completed";
      m.winner = winner;
      m.end = r.end;
      m.reason = reason;
    }
    if (r.rps) {
      r.rps.scoreAfter = { ...m.score };
      r.rps.nextAt = m.status === "active" ? r.end + 3000 : 0;
    }
    this.persist();
  }
  finishMatch(winner: number | null, reason: string) {
    const m = this.match;
    if (!m || m.status !== "active") return;
    const r = this.round!;
    if (!["ended", "abandoned"].includes(r.phase)) {
      r.phase = winner ? "ended" : "abandoned";
      r.end = this.now();
      r.reason = reason;
      r.winner = winner;
    }
    m.status = winner ? "completed" : "abandoned";
    m.winner = winner;
    m.end = this.now();
    m.reason = reason;
    this.persist();
  }
  tick() {
    const m = this.match,
      r = this.round;
    if (!m || m.status !== "active" || !r) return;
    // Deadline/round completion precedes disconnect evaluation. A completed match is immutable.
    if (r.phase === "countdown" && this.now() >= r.start) {
      r.phase = "playing";
      this.persist();
    }
    if (
      m.mode !== "minesweeper" &&
      r.phase === "playing" &&
      this.now() >= r.deadline
    ) {
      if (r.rps) {
        const locked = [1, 2].filter((id) => r.rps!.choices[id]);
        if (locked.length === 1) this.finishRound(locked[0], "rps_timeout");
        else if (!locked.length) this.finishMatch(null, "inactivity");
      } else this.finishRound(null, "time_up");
    }
    if (m.status !== "active") return;
    const expired = [1, 2].find(
      (id) =>
        !this.online.get(id) &&
        this.offlineAt.has(id) &&
        this.now() - this.offlineAt.get(id)! >= 30000,
    );
    if (expired) {
      if (!this.online.get(1) && !this.online.get(2))
        this.finishMatch(null, "both_disconnected");
      else this.finishMatch(expired === 1 ? 2 : 1, "disconnect");
    }
    if (
      m.status === "active" &&
      r.rps &&
      r.phase === "ended" &&
      r.rps.nextAt &&
      this.now() >= r.rps.nextAt &&
      this.online.get(1) &&
      this.online.get(2)
    )
      this.newRound();
  }
  action(id: number, event: string, p: any = {}) {
    if (id !== 1 && id !== 2) throw Error("Unauthorized.");
    this.tick();
    const m = this.match,
      r = this.round;
    const partner = id === 1 ? 2 : 1;
    if (event === "rpsLock") {
      if (
        !m ||
        !r?.rps ||
        m.mode !== "rps" ||
        p.matchId !== m.id ||
        p.roundId !== r.id
      )
        throw Error("This round has changed.");
      if (!validChoice(p.choice))
        throw Error("Choose rock, paper, or scissors.");
      if (
        typeof p.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{8,80}$/.test(p.requestId)
      )
        throw Error("Invalid request ID.");
      if (r.rps.requests[id] === p.requestId && r.rps.choices[id] === p.choice)
        return;
      if (m.status !== "active" || r.phase !== "playing")
        throw Error("The selection window is closed.");
      if (r.rps.choices[id]) throw Error("Your choice is already locked.");
      r.rps.choices[id] = p.choice;
      r.rps.requests[id] = p.requestId;
      r.locked.push(id);
      if (r.locked.length === 2)
        this.finishRound(
          rpsWinner(r.rps.choices[1], r.rps.choices[2]),
          "rps_normal",
        );
      else this.persist();
      return;
    }
    if (event === "reveal") {
      if (
        !m ||
        !r?.mines ||
        m.mode !== "minesweeper" ||
        p.matchId !== m.id ||
        p.roundId !== r.id
      )
        throw Error("This match has changed.");
      if (m.status !== "active" || r.phase !== "playing")
        throw Error("The match has ended.");
      const result = reveal(r.mines, id, p.cell, p.turn, p.requestId);
      if (result) this.finishRound(result.winner, result.reason);
      else this.persist();
      return;
    }
    if (event === "ready") {
      if (!this.online.get(partner))
        throw Error("Your partner needs to be online before you can start.");
      if (!m) {
        if (!this.ready.includes(id)) this.ready.push(id);
        if (this.ready.length === 2) {
          const room = this.store.room()!;
          this.start(room.mode, room.format);
        }
      } else if (m.status === "active" && r?.phase === "ended") {
        if (m.mode === "rps")
          throw Error(
            "The next round starts automatically when both players are online.",
          );
        if (p.roundId !== r.id) throw Error("This round has changed.");
        if (!r.ready.includes(id)) r.ready.push(id);
        if (r.ready.length === 2) this.newRound();
        else this.persist();
      } else throw Error("You cannot ready up right now.");
      return;
    }
    if (event === "lock") {
      if (
        !m ||
        m.status !== "active" ||
        !r ||
        r.phase !== "preparing" ||
        m.mode !== "swap" ||
        p.roundId !== r.id
      )
        throw Error("Word selection is closed.");
      if (r.locked.includes(id)) throw Error("Your word is already locked.");
      const word = typeof p.word === "string" ? p.word.toUpperCase() : "";
      if (!validWord(word))
        throw Error("Choose a five-letter word from the dictionary.");
      r.answers[partner] = word;
      r.locked.push(id);
      if (r.locked.length === 2) this.countdown();
      this.persist();
      return;
    }
    if (event === "guess") {
      if (m?.mode === "minesweeper") throw Error("Select a tile instead.");
      if (m?.mode === "rps") throw Error("Lock a choice instead.");
      if (!r || !m || p.roundId !== r.id)
        throw Error("This round has changed.");
      if (
        typeof p.requestId !== "string" ||
        !/^[a-zA-Z0-9-]{8,80}$/.test(p.requestId)
      )
        throw Error("Invalid request ID.");
      if (r.guesses[id].some((g) => g.requestId === p.requestId)) return;
      if (m.status !== "active" || r.phase !== "playing")
        throw Error("The round is not accepting guesses.");
      if (r.guesses[id].length >= 6)
        throw Error("You have used all six guesses.");
      const word = typeof p.word === "string" ? p.word.toUpperCase() : "";
      if (!validWord(word))
        throw Error("That word is not in our dictionary. Try another.");
      r.guesses[id].push({
        word,
        marks: score(word, r.answers[id]),
        at: this.now(),
        requestId: p.requestId,
      });
      if (word === r.answers[id]) this.finishRound(id, "solved");
      else if (r.guesses[1].length === 6 && r.guesses[2].length === 6)
        this.finishRound(null, "attempts_exhausted");
      else this.persist();
      return;
    }
    if (event === "concede") {
      if (!m || m.status !== "active" || p.matchId !== m.id)
        throw Error("No active match.");
      this.finishMatch(partner, "conceded");
      return;
    }
    if (event === "rematch") {
      if (!m || m.status === "active" || p.matchId !== m.id)
        throw Error("Finish your match first.");
      if (!this.online.get(partner))
        throw Error("Waiting for your partner to reconnect.");
      if (!this.rematch.includes(id)) this.rematch.push(id);
      if (this.rematch.length === 2)
        this.start(m.mode, m.format, r?.mines?.difficulty);
      return;
    }
    if (event === "return") {
      if (m?.status === "active")
        throw Error("Finish or concede the match first.");
      this.match = null;
      this.ready = [];
      this.rematch = [];
      return;
    }
    if (event === "settings") {
      if (m?.status === "active")
        throw Error("Settings can be changed between matches.");
      const room = this.store.room()!;
      if (
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 40 ||
        typeof p.description !== "string" ||
        p.description.length > 120 ||
        !["✦", "♡", "☾", "✿"].includes(p.icon) ||
        !["race", "swap", "minesweeper", "rps"].includes(p.mode) ||
        (p.difficulty !== undefined &&
          !Object.hasOwn(difficulties, p.difficulty)) ||
        !["single", "series", "first5"].includes(p.format)
      )
        throw Error("Check your room settings.");
      this.store.saveRoom({
        ...room,
        name: p.name.trim(),
        description: p.description,
        icon: p.icon,
        mode: p.mode,
        format: p.mode !== "rps" && p.format === "first5" ? "series" : p.format,
        difficulty: p.difficulty || room.difficulty || "easy",
      });
      this.ready = [];
      return;
    }
    if (event === "profile") {
      if (m?.status === "active")
        throw Error("Edit your profile between matches.");
      if (
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 24 ||
        !["✦", "✿", "☾", "♡", "initials"].includes(p.avatar)
      )
        throw Error("Check your profile.");
      this.store.saveProfile(id, p.name.trim(), p.avatar);
      this.ready = [];
      return;
    }
    if (event === "swapColors") {
      if (m?.status === "active") throw Error("Swap colors between matches.");
      if (this.swapRequest === partner) {
        this.store.swapColors();
        this.swapRequest = null;
      } else this.swapRequest = this.swapRequest === id ? null : id;
      this.ready = [];
      return;
    }
    throw Error("Unknown action.");
  }
  snapshot(id: number) {
    const m = this.match,
      r = this.round;
    const over = r && ["ended", "abandoned"].includes(r.phase);
    return {
      me: id,
      serverNow: this.now(),
      room: this.store.room(),
      profiles: this.store.profiles().map((p) => ({
        ...p,
        online: !!this.online.get(p.id),
        ready: this.ready.includes(p.id),
      })),
      ready: this.ready,
      rematch: this.rematch,
      swapRequest: this.swapRequest,
      personalBests: this.store.personalBests(),
      stats: this.store.stats(),
      modeStats: {
        race: this.store.stats("race"),
        swap: this.store.stats("swap"),
        minesweeper: this.store.stats("minesweeper"),
        rps: this.store.stats("rps"),
      },
      rpsStats: this.store.rpsStats(),
      match: m
        ? {
            ...m,
            rounds: undefined,
            round: r
              ? {
                  ...r,
                  rps: r.rps ? rpsView(r.rps, id, !!over) : undefined,
                  mines: r.mines ? minesView(r.mines, !!over) : undefined,
                  answers: over ? r.answers : undefined,
                  guesses: over ? r.guesses : { [id]: r.guesses[id] },
                  counts: {
                    1: r.guesses[1].length,
                    2: r.guesses[2].length,
                  } as Record<number, number>,
                }
              : null,
          }
        : null,
    };
  }
}
