-- Version 1. A single permanent room and exactly two fixed player identities.
CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY CHECK(id IN (1,2)), name TEXT NOT NULL, avatar TEXT NOT NULL, color TEXT NOT NULL CHECK(color IN ('purple','yellow')));
CREATE TABLE IF NOT EXISTS room(id INTEGER PRIMARY KEY CHECK(id=1), settings TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('setup','access')), player_id INTEGER REFERENCES players(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')), started INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participants(match_id TEXT REFERENCES matches(id), player_id INTEGER REFERENCES players(id), PRIMARY KEY(match_id,player_id));
CREATE TABLE IF NOT EXISTS rounds(id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id), number INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(match_id,number));
CREATE TABLE IF NOT EXISTS guesses(round_id TEXT NOT NULL REFERENCES rounds(id), player_id INTEGER NOT NULL REFERENCES players(id), request_id TEXT NOT NULL, word TEXT NOT NULL, feedback TEXT NOT NULL, received INTEGER NOT NULL, PRIMARY KEY(round_id,player_id,request_id));
CREATE INDEX IF NOT EXISTS matches_started ON matches(started DESC);
PRAGMA user_version=1;
