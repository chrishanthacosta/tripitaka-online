-- Tripitaka.Online local mirror — PostgreSQL schema
-- Run via:  psql "$DATABASE_URL" -f db/schema.sql   (idempotent)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- One row per sutta on tripitaka.online
CREATE TABLE IF NOT EXISTS suttas (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- local pk
    source_id  integer NOT NULL UNIQUE,   -- tripitaka.online /sutta/{id}
    link       text,                      -- canonical ref, e.g. 'dn1_1' (may be NULL)
    book       text,                      -- derived: 'dn1','mn3','sn2','an6','kn4',… (NULL if link NULL)
    label      text NOT NULL,             -- Sinhala title exactly as served
    url        text NOT NULL,             -- https://tripitaka.online/sutta/{id}
    raw_json   jsonb NOT NULL,            -- verbatim API payload (source of truth)
    checksum   text NOT NULL,             -- sha256 of raw_json (change detection)
    fetched_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per text block (heading or paragraph) inside a sutta
CREATE TABLE IF NOT EXISTS blocks (
    id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sutta_id bigint NOT NULL REFERENCES suttas(id) ON DELETE CASCADE,
    seq      integer NOT NULL,            -- order within the sutta (0-based)
    tag      text NOT NULL,               -- h1 | h2 | h3 | p
    class    text NOT NULL DEFAULT '',    -- 'pali-text' | 'sinhala-text' | 'sutta-title' | …
    lang     text,                        -- 'pali' | 'sinhala' | NULL (derived from class)
    content  text NOT NULL,
    UNIQUE (sutta_id, seq)
);

CREATE INDEX IF NOT EXISTS blocks_sutta_id_idx ON blocks (sutta_id);
-- Substring search for Sinhala/Pali (PG default FTS tokenizes these poorly)
CREATE INDEX IF NOT EXISTS blocks_content_trgm_idx ON blocks USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS suttas_link_idx ON suttas (link);
CREATE INDEX IF NOT EXISTS suttas_book_idx ON suttas (book);

-- Convenience view: full text of a sutta, blocks in order
CREATE OR REPLACE VIEW v_sutta_full AS
SELECT s.id, s.source_id, s.link, s.book, s.label, s.url,
       b.seq, b.tag, b.class, b.lang, b.content
FROM suttas s
JOIN blocks b ON b.sutta_id = s.id
ORDER BY s.id, b.seq;
