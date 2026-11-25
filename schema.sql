-- IDs are text; the app generates them (e.g. uuid4).

CREATE TABLE IF NOT EXISTS users (
    user_id       TEXT NOT NULL PRIMARY KEY,
    -- Filled at signup
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,              -- never the plain password
    -- Filled on the profile completion page
    user_name     TEXT,
    roll_no       TEXT UNIQUE COLLATE NOCASE,
    year          INTEGER,
    phone         TEXT
);

CREATE TABLE IF NOT EXISTS items (
    item_id     TEXT NOT NULL PRIMARY KEY,
    item        TEXT NOT NULL,
    colour      TEXT NOT NULL,
    brand       TEXT NOT NULL,
    description TEXT NOT NULL,
    image_id    TEXT                          -- optional
);

-- Connects a user to the item they reported.
CREATE TABLE IF NOT EXISTS reports (
    report_id   TEXT NOT NULL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users (user_id),
    item_id     TEXT NOT NULL UNIQUE REFERENCES items (item_id),
    report_type TEXT NOT NULL CHECK (report_type IN ('lost', 'found')),
    place       TEXT NOT NULL,
    -- Both nullable. The frontend requires from_time for "found",
    -- and from_time + to_time for "lost".
    from_time   TEXT,
    to_time     TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reunited'))
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id);
CREATE INDEX IF NOT EXISTS idx_reports_type_status ON reports (report_type, status);

-- Tokens that were logged out before they expired.
CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_id   TEXT NOT NULL PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

-- Cached search vectors for the chatbot.
CREATE TABLE IF NOT EXISTS embeddings (
    report_id TEXT NOT NULL PRIMARY KEY REFERENCES reports (report_id) ON DELETE CASCADE,
    model     TEXT NOT NULL,
    vector    TEXT NOT NULL
);

-- CNN features of each report's photo, used for image matching.
CREATE TABLE IF NOT EXISTS image_features (
    report_id TEXT NOT NULL PRIMARY KEY REFERENCES reports (report_id) ON DELETE CASCADE,
    model     TEXT NOT NULL,
    features  TEXT NOT NULL
);
