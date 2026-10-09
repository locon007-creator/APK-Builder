-- Quarry storage schema (SQLite).
-- Time columns are intentionally distinct:
--   period_of_report  : reporting-period end (13F quarter end, Form 4 period)
--   transaction_date  : when an insider transaction happened (when disclosed)
--   event_date        : date of the reported corporate event
--   filing_date       : EDGAR filing date (calendar date)
--   accepted_at       : EDGAR acceptance timestamp (UTC) — the disclosure time
--   ingested_at       : when this application obtained the record
--   observed_at / as_of : market-data observation times
-- Records are never silently overwritten: amendments are separate filings and
-- every (re)parse is recorded in parse_runs.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  cik         TEXT PRIMARY KEY,         -- 10-digit zero-padded SEC CIK
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('manager','issuer','person','filer')),
  tracked     INTEGER NOT NULL DEFAULT 0,
  ticker      TEXT,                     -- current ticker only; never used as historical identity
  sector      TEXT,
  market_cap  REAL,
  market_cap_as_of TEXT,
  description TEXT,
  origin      TEXT NOT NULL DEFAULT 'sec' CHECK (origin IN ('sec','demo')),
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_ticker ON entities(ticker);

-- CUSIP is the historical identity key for 13F securities.
CREATE TABLE IF NOT EXISTS securities (
  cusip       TEXT PRIMARY KEY,
  issuer_cik  TEXT REFERENCES entities(cik),
  ticker      TEXT,
  name        TEXT NOT NULL,
  title_of_class TEXT,
  mapping_source TEXT NOT NULL DEFAULT 'universe', -- universe | name_match | unmapped
  origin      TEXT NOT NULL DEFAULT 'sec'
);
CREATE INDEX IF NOT EXISTS idx_securities_issuer ON securities(issuer_cik);

CREATE TABLE IF NOT EXISTS filings (
  accession        TEXT PRIMARY KEY,     -- 0001234567-25-000123
  filer_cik        TEXT NOT NULL,
  subject_cik      TEXT,                 -- issuer for Forms 4 / 8-K / 13D / 13G
  form_type        TEXT NOT NULL,        -- as filed, e.g. 13F-HR/A, SC 13D/A
  base_form        TEXT NOT NULL,        -- normalised: 13F-HR, 4, 8-K, SC 13D, SC 13G
  is_amendment     INTEGER NOT NULL DEFAULT 0,
  amendment_type   TEXT,                 -- 13F: RESTATEMENT | NEW HOLDINGS
  amends_accession TEXT,
  period_of_report TEXT,
  filing_date      TEXT NOT NULL,
  accepted_at      TEXT NOT NULL,
  event_date       TEXT,
  items            TEXT,                 -- 8-K item codes, comma separated
  primary_document TEXT,
  source_url       TEXT,
  index_url        TEXT,
  ingested_at      TEXT NOT NULL,
  parse_status     TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','parsed','partial','failed','header_only')),
  parse_error      TEXT,
  parser_version   TEXT NOT NULL,
  content_hash     TEXT,
  origin           TEXT NOT NULL DEFAULT 'sec' CHECK (origin IN ('sec','demo'))
);
CREATE INDEX IF NOT EXISTS idx_filings_accepted ON filings(accepted_at);
CREATE INDEX IF NOT EXISTS idx_filings_filer ON filings(filer_cik, base_form, period_of_report);
CREATE INDEX IF NOT EXISTS idx_filings_subject ON filings(subject_cik, base_form);

CREATE TABLE IF NOT EXISTS parse_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  accession      TEXT NOT NULL REFERENCES filings(accession),
  parser_version TEXT NOT NULL,
  content_hash   TEXT,
  status         TEXT NOT NULL,
  row_count      INTEGER NOT NULL DEFAULT 0,
  message        TEXT,
  ran_at         TEXT NOT NULL,
  superseded_rows INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS holdings_13f (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  accession      TEXT NOT NULL REFERENCES filings(accession),
  row_index      INTEGER NOT NULL,
  manager_cik    TEXT NOT NULL,
  period         TEXT NOT NULL,
  cusip          TEXT NOT NULL,
  name_of_issuer TEXT NOT NULL,
  title_of_class TEXT,
  value_usd      REAL NOT NULL,          -- normalised to whole dollars
  shares         REAL NOT NULL,
  sh_prn_type    TEXT NOT NULL,          -- SH | PRN
  put_call       TEXT,                   -- PUT | CALL | NULL
  investment_discretion TEXT,
  voting_sole    REAL, voting_shared REAL, voting_none REAL,
  UNIQUE (accession, row_index)
);
CREATE INDEX IF NOT EXISTS idx_holdings_mgr ON holdings_13f(manager_cik, period);
CREATE INDEX IF NOT EXISTS idx_holdings_cusip ON holdings_13f(cusip, period);

CREATE TABLE IF NOT EXISTS insider_transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  accession        TEXT NOT NULL REFERENCES filings(accession),
  row_index        INTEGER NOT NULL,
  issuer_cik       TEXT NOT NULL,
  owner_cik        TEXT NOT NULL,
  owner_name       TEXT NOT NULL,
  owner_role       TEXT NOT NULL,
  security_title   TEXT NOT NULL,
  is_derivative    INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  code             TEXT NOT NULL,
  acquired_disposed TEXT NOT NULL,
  shares           REAL NOT NULL,
  price            REAL,
  shares_owned_after REAL,
  direct_indirect  TEXT NOT NULL,
  is_10b5_1        INTEGER NOT NULL DEFAULT 0,
  footnotes        TEXT,
  UNIQUE (accession, row_index)
);
CREATE INDEX IF NOT EXISTS idx_insider_issuer ON insider_transactions(issuer_cik, transaction_date);

CREATE TABLE IF NOT EXISTS ownership_disclosures (
  accession       TEXT PRIMARY KEY REFERENCES filings(accession),
  issuer_cik      TEXT NOT NULL,
  filer_cik       TEXT NOT NULL,
  schedule        TEXT NOT NULL,          -- 13D | 13G
  percent_of_class REAL,
  shares          REAL,
  event_date      TEXT,
  purpose_excerpt TEXT
);

CREATE TABLE IF NOT EXISTS prices (
  ticker      TEXT NOT NULL,
  date        TEXT NOT NULL,
  open REAL, high REAL, low REAL,
  close       REAL NOT NULL,
  volume      REAL NOT NULL,
  adjusted    INTEGER NOT NULL DEFAULT 1,
  provider    TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  origin      TEXT NOT NULL DEFAULT 'demo',
  PRIMARY KEY (ticker, date, provider)
);

CREATE TABLE IF NOT EXISTS ingestion_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  source      TEXT NOT NULL,
  status      TEXT NOT NULL,
  filings_seen INTEGER NOT NULL DEFAULT 0,
  filings_new  INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  message     TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_errors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER REFERENCES ingestion_log(id),
  at         TEXT NOT NULL,
  url        TEXT,
  accession  TEXT,
  message    TEXT NOT NULL
);

-- ---- User workspace (scoped server-side by an httpOnly workspace cookie) ----
CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  visit_started_at TEXT,
  previous_visit_at TEXT,
  last_seen_at     TEXT
);

CREATE TABLE IF NOT EXISTS watch_items (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('stock','manager','category')),
  item_id      TEXT NOT NULL,
  label        TEXT NOT NULL,
  added_at     TEXT NOT NULL,
  PRIMARY KEY (workspace_id, kind, item_id)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  target_kind  TEXT NOT NULL,
  target_id    TEXT,
  threshold    REAL,
  event_items  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  rule_id       INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  dedupe_key    TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  source        TEXT NOT NULL,
  accession     TEXT,
  source_url    TEXT,
  filing_accepted_at TEXT,
  detected_at   TEXT NOT NULL,
  delivery      TEXT NOT NULL,          -- JSON array of {channel,status,detail}
  limitations   TEXT NOT NULL,          -- JSON array
  read_at       TEXT,
  origin        TEXT NOT NULL,
  UNIQUE (workspace_id, rule_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS preferences (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

-- Selected XBRL company facts (data.sec.gov/api/xbrl/companyfacts). "filed"
-- is the date the value became public, used for look-ahead-safe queries.
CREATE TABLE IF NOT EXISTS fundamentals (
  issuer_cik TEXT NOT NULL,
  concept    TEXT NOT NULL,     -- e.g. Revenues, NetIncomeLoss
  label      TEXT NOT NULL,
  unit       TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT NOT NULL,
  fiscal_period TEXT,           -- FY, Q1..Q4
  value      REAL NOT NULL,
  accession  TEXT NOT NULL,
  form       TEXT NOT NULL,
  filed      TEXT NOT NULL,
  origin     TEXT NOT NULL DEFAULT 'sec',
  PRIMARY KEY (issuer_cik, concept, period_end, accession, fiscal_period)
);
