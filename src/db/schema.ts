/**
 * Database schema, applied in order. Each entry is one migration; never edit
 * a shipped migration, append a new one instead.
 */
export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE properties (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    page_name        TEXT NOT NULL,
    booking_url      TEXT NOT NULL,
    booking_hotel_id INTEGER,
    booking_name     TEXT,
    address          TEXT
  );

  -- One row per guest review. The id is Booking.com's own review key
  -- ("bkg:<reviewUrl>") so the same review seen twice is updated, not duplicated.
  CREATE TABLE reviews (
    id                 TEXT PRIMARY KEY,
    property_id        TEXT NOT NULL REFERENCES properties(id),
    source             TEXT NOT NULL CHECK (source IN ('featured', 'review_list', 'import')),
    booking_review_id  TEXT,
    score              REAL NOT NULL CHECK (score >= 1 AND score <= 10),
    title              TEXT,
    positive_text      TEXT,
    negative_text      TEXT,
    language           TEXT,
    reviewed_at        TEXT NOT NULL,
    reviewed_date      TEXT NOT NULL,
    stay_month         TEXT,
    nights             INTEGER,
    room_type          TEXT,
    traveller_type     TEXT,
    trip_purpose       TEXT,
    guest_name         TEXT,
    guest_country      TEXT,
    hotel_reply        TEXT,
    content_hash       TEXT NOT NULL,
    text_quality       TEXT NOT NULL DEFAULT 'ok',
    classifier_version TEXT,
    first_seen_at      TEXT NOT NULL,
    last_seen_at       TEXT NOT NULL,
    updated_at         TEXT
  );
  CREATE INDEX idx_reviews_property_date ON reviews (property_id, reviewed_date);
  CREATE INDEX idx_reviews_date ON reviews (reviewed_date);
  CREATE INDEX idx_reviews_hash ON reviews (content_hash);

  CREATE TABLE review_topics (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    topic     TEXT NOT NULL,
    polarity  TEXT NOT NULL CHECK (polarity IN ('praise', 'complaint')),
    terms     TEXT NOT NULL,
    PRIMARY KEY (review_id, topic, polarity)
  );
  CREATE INDEX idx_review_topics_topic ON review_topics (topic, polarity);

  CREATE TABLE collection_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    status          TEXT NOT NULL,
    trigger         TEXT NOT NULL,
    reviews_new     INTEGER NOT NULL DEFAULT 0,
    reviews_updated INTEGER NOT NULL DEFAULT 0,
    notes           TEXT
  );

  CREATE TABLE collection_run_items (
    run_id           INTEGER NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    property_id      TEXT NOT NULL REFERENCES properties(id),
    status           TEXT NOT NULL,
    method           TEXT NOT NULL,
    reviews_seen     INTEGER NOT NULL DEFAULT 0,
    reviews_new      INTEGER NOT NULL DEFAULT 0,
    reviews_updated  INTEGER NOT NULL DEFAULT 0,
    reviews_rejected INTEGER NOT NULL DEFAULT 0,
    full_list_status TEXT,
    error            TEXT,
    attempts         INTEGER NOT NULL DEFAULT 1,
    duration_ms      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, property_id)
  );

  -- Booking.com's headline numbers for a property at the time of each run.
  -- Kept as a time series so score movement is visible even between reviews.
  CREATE TABLE property_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id     TEXT NOT NULL REFERENCES properties(id),
    run_id          INTEGER REFERENCES collection_runs(id) ON DELETE SET NULL,
    captured_at     TEXT NOT NULL,
    overall_score   REAL,
    review_count    INTEGER,
    categories_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_snapshots_property ON property_snapshots (property_id, captured_at);
  `,
];
