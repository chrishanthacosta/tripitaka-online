# Tripitaka.Online — Local Mirror & Reader

A complete **local mirror of every sutta on [tripitaka.online](https://www.tripitaka.online/)**
— the Sinhala Tipiṭaka from Mahamevnawa Buddhist Monastery, with **Pali text and
Sinhala translation paired block by block** — plus a **web reader** to browse,
read and search it.

The source site publishes a sitemap and its `robots.txt` allows crawling. The
sutta pages are client-rendered, but the site serves the full text as clean
JSON from `/api/sutta/{id}` — that is what this project consumes.

```
┌─────────────┐   crawl    ┌──────────────────┐   load    ┌────────────┐
│ tripitaka.  │ ─────────▶ │ data/raw/{id}.json│ ────────▶ │ PostgreSQL │
│ online API  │  (4,154)   │ (immutable JSON)  │           │ suttas+    │
└─────────────┘            └────────┬─────────┘           │ blocks     │
                                    │                     └─────┬──────┘
                                    │ export                   │ serve
                                    ▼                           ▼
                            ┌───────────────┐          ┌─────────────────┐
                            │ data/texts/   │          │ web app (React  │
                            │ plain text    │          │ SPA served by   │
                            │ mirror        │          │ FastAPI :8080)  │
                            └───────────────┘          └─────────────────┘
```

**Three storage layers**, each re-derivable from the one before it:

| Layer | Location | Purpose |
|---|---|---|
| Raw JSON | `data/raw/{source_id:06d}.json` | Verbatim API responses — the source of truth |
| PostgreSQL | `suttas` + `blocks` tables | Querying, search, the web app's backend |
| Plain text | `data/texts/{book}/*.txt` | Portable, greppable, diffable archive |

---

## Features

- **Complete dataset** — 4,154 suttas, 114,196 text blocks, 23 book groups
  (Dīgha, Majjhima, Saṃyutta, Aṅguttara, Khuddaka Nikāyas + unlinked).
- **Web reader** — browse by nikāya/book, read suttas **Pali | Sinhala
  side-by-side** (or interleaved), prev/next navigation, dark mode.
- **Search** — block-level substring search over Pali and Sinhala text
  (Postgres `pg_trgm`), grouped by sutta with highlighting.
- **Resumable, idempotent pipeline** — re-running any step only processes what
  changed (sha256 checksums); safe to re-run at any time.
- **Polite crawler** — concurrency 5, retries with backoff, custom User-Agent.

---

## Project structure

```
.
├── Makefile                  # everything: make up / crawl / load / export / web …
├── docker-compose.yml        # PostgreSQL 16 container (host port 5434)
├── db/schema.sql             # suttas + blocks tables, pg_trgm index, view
├── requirements.txt          # Python deps for the data pipeline
├── scripts/                  # data pipeline
│   ├── common.py             # shared config/helpers
│   ├── crawl.py              # sitemap → data/raw/*.json
│   ├── load.py               # raw JSON → PostgreSQL
│   ├── export.py             # DB/raw → data/texts/*.txt
│   └── verify.py             # consistency: sitemap ↔ raw ↔ DB ↔ texts
├── api/                      # FastAPI backend
│   ├── main.py               # JSON API + serves the built frontend
│   └── db.py                 # connection pool
└── web/                      # React frontend (Vite + TS + Tailwind)
    └── src/{pages,components,api.ts}
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker (with compose) | any recent | for PostgreSQL — `docker compose version` |
| Python | 3.11+ | `python3 --version` |
| Node.js + pnpm | Node 20+, pnpm 9+ | only needed for the web app — `node -v`, `pnpm -v` |

---

## Quickstart — how to start

### A. Already-mirrored dataset (fastest path: just run the web app)

```bash
docker compose up -d db      # start PostgreSQL (already has the data)
make web                     # builds the frontend, then serves on :8080
```

Open **http://127.0.0.1:8080/** (or `http://<your-lan-ip>:8080/` — the server
binds `0.0.0.0`; see *Troubleshooting* if the browser can't connect).

### B. Full mirror from scratch

```bash
# 1. Dependencies
make venv                    # project venv (auto-bootstraps pip if needed)
make up                      # PostgreSQL via Docker

# 2. Download every sutta (~15–30 min, resumable)
make crawl

# 3. Load into Postgres (creates the schema on first run)
make load

# 4. Export plain-text mirror
make export

# 5. Verify everything is consistent
make verify

# 6. Build + run the web app
make web                     # → http://127.0.0.1:8080/
```

Equivalent plain commands:

```bash
python3 scripts/crawl.py && python3 scripts/load.py --create-schema \
  && python3 scripts/export.py && python3 scripts/verify.py
```

### C. Development mode (hot reload)

```bash
make api        # terminal 1: FastAPI on :8080 (--reload)
make web-dev    # terminal 2: Vite dev server on :5173, proxies /api → :8080
```

## Live website (GitHub Pages)

The mirror is published as a **static website** — no server needed:

### **https://chrishanthacosta.github.io/tripitaka-online/**

All 4,154 suttas, both translations, dictionary word popups and word search
work in the browser (client-side data). Rebuild + republish:

```bash
make site           # VITE_STATIC build + export -> site/  (needs db up)
make site-publish   # push site/ to the gh-pages branch (Pages auto-builds)
```

For the **full-stack** version (server-side search + live updates) instead:
sign up at [Render](https://render.com) → New Web Service → your GitHub repo
→ Render builds and runs FastAPI + Postgres automatically.

---

## Makefile targets

| Target | What it does |
|---|---|
| `make venv` | Create `.venv` and install Python deps (bootstraps pip if `ensurepip` is missing) |
| `make up` / `make down` | Start / stop the PostgreSQL container |
| `make crawl` | Download all suttas → `data/raw/` (skips existing) |
| `make load` | Raw JSON → PostgreSQL (incremental, sha256-based) |
| `make export` | DB → plain-text files in `data/texts/` |
| `make verify` | Consistency check across all layers |
| `make api` | Run FastAPI backend on :8080 (reload on) |
| `make web-install` | `pnpm install` in `web/` |
| `make web-dev` | Vite dev server on :5173 |
| `make web-build` | Production build → `web/dist` |
| `make web` | Build frontend, then serve everything on :8080 |

---

## Web app

**Stack:** FastAPI (Python) + React 18 / Vite / TypeScript + Tailwind CSS 4.
The API reads PostgreSQL directly; search uses the `pg_trgm` GIN index.

| Route | What it does |
|---|---|
| `/` | Dataset stats + nikāya/book grid |
| `/book/{book}` | Sutta list for a book (e.g. `/book/dn1`), filterable by title/reference |
| `/sutta/{id}` | Reader — **Pali \| Sinhala side-by-side**, interleaved toggle, prev/next, dark mode |
| `/search?q=…` | Block-level substring search, grouped by sutta, matches highlighted |
| `/api/…` | JSON API (see below) |

### JSON API

| Endpoint | Returns |
|---|---|
| `GET /api/stats` | Dataset counts |
| `GET /api/books` | Book groups with sutta counts |
| `GET /api/suttas?book=&q=&limit=&offset=` | Sutta list (filter by book, title/reference) |
| `GET /api/suttas/{id}` | One sutta with ordered blocks (tag/class/lang/content) |
| `GET /api/suttas/{id}/neighbors` | Prev/next sutta within the same book |
| `GET /api/search?q=&lang=&book=&limit=&offset=` | Block-level search hits (Pali/Sinhala) |

```bash
curl http://127.0.0.1:8080/api/search?q=සුතං&lang=pali
```

> Search matches the **Sinhala-script text** as served by the source site
> (Pali is romanized into Sinhala script there) — a query like "metta" in
> Latin letters will not match; use Sinhala, e.g. `සුතං` or `බුද්ධ`.

---

## Data pipeline details

### Crawl — `scripts/crawl.py`

```bash
python3 scripts/crawl.py                # everything (resumable)
python3 scripts/crawl.py --limit 20     # smoke test
python3 scripts/crawl.py --ids 17,122   # specific suttas
python3 scripts/crawl.py --force        # re-download everything
python3 scripts/crawl.py --concurrency 3 --retries 5
```

### Load — `scripts/load.py`

```bash
python3 scripts/load.py --create-schema   # first run (idempotent)
python3 scripts/load.py --limit 100       # partial load
DATABASE_URL=postgresql://u:p@host:5432/db python3 scripts/load.py
```

### Export — `scripts/export.py`

```bash
python3 scripts/export.py                 # DB → data/texts/ (default)
python3 scripts/export.py --source raw    # raw JSON → texts (no DB needed)
python3 scripts/export.py --format md     # also write .md variants
```

Text-file layout per sutta (keyed by canonical reference, `misc/` when absent):

```
data/texts/dn1/dn1_1.txt           # full: headings + Pali/Sinhala in order
data/texts/dn1/dn1_1.pali.txt      # Pali paragraphs only
data/texts/dn1/dn1_1.sinhala.txt   # Sinhala paragraphs only
```

### Verify — `scripts/verify.py`

```bash
python3 scripts/verify.py           # sitemap ↔ raw ↔ DB ↔ texts
python3 scripts/verify.py --no-db   # skip the database check
```

## Dictionaries & word lookup

Click any **Pāli word** in the reader → a popup shows its entry from **every
loaded dictionary** (grouped by source, with POS, definitions, IPA/grammar
detail) plus **all sutta references** where the word occurs in the corpus.

Sources (all free to download; fetched by `scripts/dict_download.py` and
normalized into one SQLite database by `scripts/dict_build.py`):

| Source | Language | Entries | Where it lives |
|---|---|---|---|
| Digital Pāḷi Dictionary (DPD) — **indexed from the full `dpd.db`** | Pali→English | 89,280 headwords | [digitalpalidictionary/dpd-db](https://github.com/digitalpalidictionary/dpd-db) — `dpd.db.tar.xz` (165 MB → 2.3 GB sqlite) + `dpd-txt.zip` fallback |
| NCPED (Buddhadatta, concise) | Pali→English | 23,860 | [SuttaCentral sc-data](https://github.com/suttacentral/sc-data) — `dictionaries/simple/en/pli2en_ncped.json` |
| PTS Pāli-English (PED) | Pali→English | 15,702 | [vpnry/ptsped](https://github.com/vpnry/ptsped) — SQL export |
| Buddhadatta | Pali→Sinhala | 19,003 | [pnfo/pali-sinhala-dictionary](https://github.com/pnfo/pali-sinhala-dictionary) |
| Sumangala | Pali→Sinhala | 23,124 | same repo |
| Sinhala↔English | Sinhala↔English | 96,016 | [DPD other-dictionaries](https://github.com/digitalpalidictionary/other-dictionaries) — `sin-eng-sin` |

**266,985 entries + 5.4M inflection aliases** in `data/dicts/dicts.sqlite`
(~570 MB). DPD entries additionally carry **root with meaning** (√mett→√mitt:
“be friendly”), **Sanskrit** equivalents, **example sentences with sutta
references**, and **Sinhala-script declensions** — those inflected forms are
indexed as aliases, so clicking an inflected corpus word like `සුතං` finds
DPD's `suta` directly, no stem-guessing needed.

```bash
make dict-download        # fetch sources into data/dicts/raw/  (--full also grabs dpd.db)
make dict-build           # build data/dicts/dicts.sqlite (unified index; uses dpd.db when present)
```

How matching works: the corpus is Pali in **Sinhala script**, while DPD/NCPED/
PED headwords are Roman script. `scripts/dict_common.py` transliterates
Sinhala→IAST (`මෙත්තා` → `mettā`) and matches on diacritic-insensitive keys,
plus prefix matching both directions (so `භගවා` finds `bhagavato`,
`bhagavant`, …). Because DPD's Sinhala-script declensions are indexed as
aliases, inflected corpus forms (`සුතං`, `මෙත්තාය`) hit their headwords
(`suta`, `mettā`) directly.

> **Attribution / licenses:** the texts are © Mahamevnawa Buddhist Monastery;
> PED states "Creative Commons Licence by-nc/3.0" (PTS); DPD and the
> Sinhala↔English data are from the DPD project (verify their license before
> redistribution); the Pali-Sinhala JSON files carry no explicit license in
> the source repos. This mirror is for personal/local use.

## Multiple translations

Inside a sutta, the reader shows a **Translation** selector. Besides the
default **Mahamevnawa** translation, alternative Sinhala translations are
downloaded and selectable:

| Translation | Coverage | Source |
|---|---|---|
| Mahamevnawa (default) | all 4,154 suttas | tripitaka.online API (built-in) |
| **Buddha Jayanthi Tripitaka** (1957) | 3,592 suttas | [pathnirvana/tipitaka.lk](https://github.com/pathnirvana/tipitaka.lk) — `data.zip` (BJT Pali + Sinhala SQLite) |
| **De Zoysa (Soyza)** | — (no online text found; button is wired for future data) | book scans only, e.g. National Library of Sri Lanka |

```bash
make translations-download   # fetch data.zip (~180 MB) -> data/translations/
make translations-import     # align by Pali text + import into PostgreSQL
```

`translations_import.py` matches each of our suttas to the BJT edition by
anchoring its Pali text (transliterated to a diacritic-insensitive Roman key,
scoped to the right book file) and storing the BJT Sinhala segments in the
`translations` table. The two editions differ slightly in how paragraphs are
split, so counts can vary a little between translations.

> **De Zoysa / "Soyza"**: the first complete Sinhala Tripitaka translation
> (A. P. de Zoysa) exists only as scanned books online — no structured text
> was found to download. The button and storage are ready; as soon as a text
> source appears, drop it into `scripts/translations_import.py` (or a new
> importer) with `source='soyza'`.

---

## AI Pāli grammar chat

In the dictionary popup, **✦ AI** opens a chat about the clicked word, powered
by DeepSeek. It sends the word, the paragraph it came from and the dictionary
entries along with each question. The assistant only answers questions about
the Pāli language; the system prompt that enforces this lives on the server
(`api/ai.py`). You can save a whole chat or single messages, and download them
as Markdown. They are kept in the browser (localStorage) and listed under 🔖
(`#/saved`).

The DeepSeek key stays on the server and is never put in the frontend bundle:

- **Full-stack:** `POST /api/ai/chat` is part of `api.main`. Set
  `DEEPSEEK_API_KEY` in the environment before running `make api`.
- **Static site:** run just the proxy,
  `DEEPSEEK_API_KEY=... uvicorn api.ai_app:app --host 127.0.0.1 --port 8091`,
  and have the web server proxy `/api/ai/` to it. On a host with no backend,
  such as GitHub Pages, the AI panel says the service is unavailable. To call a
  proxy on another origin, set `VITE_AI_URL` at build time.

## Database schema

```sql
suttas (id PK, source_id UNIQUE, link, book, label, url,
        raw_json jsonb, checksum, fetched_at, updated_at)
blocks (id PK, sutta_id FK → suttas, seq, tag, class, lang, content)
-- + GIN index on blocks.content (pg_trgm) for substring search
-- + v_sutta_full view: suttas joined with ordered blocks
```

- `link` is the canonical reference: `dn1_1`, `mn3_3-5-8`, `sn3_1-2-4-9`,
  `an6_10-2-1-4`, `kn2_4`, … `book` is its prefix (`dn1`, `mn3`, …).
- `lang` is derived from `class` (`pali-text` / `sinhala-text`).
- PostgreSQL's default full-text search tokenizes Sinhala poorly, so search
  uses `pg_trgm` substring matching:

```sql
SELECT s.link, s.label, b.seq, b.content
FROM blocks b JOIN suttas s ON s.id = b.sutta_id
WHERE b.lang = 'pali' AND b.content ILIKE '%සුතං%'
ORDER BY b.id LIMIT 20;
```

---

## Keeping the mirror fresh

The source site is stable, but to re-sync later:

```bash
python3 scripts/crawl.py   # downloads only what's new/changed
python3 scripts/load.py    # updates only changed suttas (checksum)
python3 scripts/export.py  # re-renders text files
python3 scripts/verify.py  # confirm nothing drifted
```

Or as a cron job (weekly):

```
0 3 * * 1  cd /path/to/tripitaka-online && make crawl && make load && make export >> logs/sync.log 2>&1
```

---

## Backups

```bash
# PostgreSQL
docker compose exec db pg_dump -U tripitaka tripitaka > backup.sql
# or with a custom DSN:  pg_dump "$DATABASE_URL" > backup.sql

# Text mirror
tar czf texts.tgz data/texts/

# Raw JSON (the true source of truth — back this up if you keep anything)
tar czf raw.tgz data/raw/
```

Restore: `docker compose exec -T db psql -U tripitaka tripitaka < backup.sql`
(after `docker compose down && docker compose up -d db`).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser shows `ERR_UNSAFE_PORT` | You used a port from browsers' restricted list (e.g. **6000** = X11, 6665–6669, 10080). Chrome/Firefox refuse them by design. Use a normal port — the default is **8080** (`PORT=8081 make web` to override). |
| Browser can't reach `http://127.0.0.1:8080/` | Server binds `0.0.0.0`. If the workspace is in WSL2/a VM, use your LAN IP: `ip -4 addr` → `http://<ip>:8080/`. On Windows, the WSL localhost relay needs the service bound to `0.0.0.0` (it is). |
| Port 8080 already in use | `PORT=8081 make web` (the `PORT` env var is honored), or edit the port in `Makefile` / `api/main.py`. |
| `psycopg` connection refused | Run `make up` and wait a few seconds; the container listens on host port **5434** (5432/5433 are used by other projects). Override with `DATABASE_URL=postgresql://tripitaka:tripitaka@localhost:5434/tripitaka`. |
| `The virtual environment was not created successfully` / no pip | `make venv` auto-bootstraps pip via get-pip.py. Alternatively `python3 -m pip install --user -r requirements.txt`. |
| `verify` reports 3 missing sitemap ids (`4632`, `5871`, `12294`) | Expected — they are stale sitemap entries (API 404s). `verify.py` labels them "dead" and the check still passes. |
| Search returns nothing for Latin words | The corpus is Sinhala-script text; search in Sinhala (see *Web app* note). |

---

## Data notes

- **4,157** ids in the sitemap; **3** are dead entries (removed on the source
  site). The canonical dataset is **4,154 suttas / 114,196 blocks**.
- ~9% of suttas have an empty `link` (no canonical reference) → stored under
  `misc/` in the text files.
- 217 suttas are vagga/chapter header pages with an empty body; they keep a
  file containing the title so the section structure survives.
- The Pali/Sinhala pairing is ~97% clean; unpaired paragraphs render on their
  own in the reader.

## License / attribution

The content is © 1999–2026 **Mahamevnawa Buddhist Monastery**
(contact: info@tripitaka.online). The source site's `robots.txt` permits
crawling and it publishes the sitemap used here. This mirror is intended for
**personal/local use** — keep the attribution if you redistribute any of the
text. The pipeline code in this repository is provided as-is.
