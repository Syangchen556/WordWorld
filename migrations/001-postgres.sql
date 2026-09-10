-- WordWorld PostgreSQL migration 001. One transactionally locked private room.
-- The JSON document holds the two profiles, hashed access/session records,
-- match/round/guess records, and shared live state. It is never sent to clients.
CREATE TABLE IF NOT EXISTS wordworld_state (
 id SMALLINT PRIMARY KEY CHECK (id = 1),
 revision BIGINT NOT NULL DEFAULT 0,
 data JSONB NOT NULL CHECK (data->>'version' = '1'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK (jsonb_typeof(data->'profiles') = 'array'),
 CHECK (jsonb_array_length(data->'profiles') IN (0,2))
);
