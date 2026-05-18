CREATE TABLE users (
  mc_uuid     TEXT PRIMARY KEY,
  mc_name     TEXT NOT NULL,
  elo         REAL NOT NULL DEFAULT 1000,
  matches     INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE matches (
  match_id    TEXT PRIMARY KEY,
  target_item TEXT NOT NULL,
  winner_uuid TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

CREATE TABLE match_players (
  match_id    TEXT NOT NULL REFERENCES matches(match_id),
  mc_uuid     TEXT NOT NULL REFERENCES users(mc_uuid),
  elo_before  REAL NOT NULL,
  elo_after   REAL,
  placement   INTEGER,
  PRIMARY KEY (match_id, mc_uuid)
);

CREATE INDEX idx_users_elo ON users (elo DESC);
CREATE INDEX idx_matches_ended_at ON matches (ended_at DESC);
CREATE INDEX idx_match_players_uuid ON match_players (mc_uuid, match_id);
