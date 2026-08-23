# Prefer the project venv when present, else system python.
# (On hosts without python3-venv: create it via
#  `python3 -m venv --without-pip .venv && .venv/bin/python /tmp/get-pip.py && .venv/bin/pip install -r requirements.txt`)
PYTHON := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

# Web server port (override: PORT=8081 make web).
# Note: avoid ports on browsers' restricted list (e.g. 6000 = X11, 6665-6669).
PORT ?= 8080

.PHONY: venv crawl load export verify up down psql all api web-install web-dev web-build web dict-download dict-build

# --- data pipeline ---------------------------------------------------------
venv:           ## create a venv (auto-bootstraps pip if ensurepip is missing)
	python3 -m venv --without-pip .venv; \
	curl -sSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && .venv/bin/python /tmp/get-pip.py -q; \
	.venv/bin/pip install -r requirements.txt

crawl:          ## download all suttas -> data/raw/  (resumable; ~15-30 min)
	$(PYTHON) scripts/crawl.py

load:           ## raw JSON -> PostgreSQL (creates schema on first run)
	$(PYTHON) scripts/load.py --create-schema

export:         ## DB -> data/texts/ (plain text mirror)
	$(PYTHON) scripts/export.py

verify:         ## consistency: sitemap vs raw vs db vs texts
	$(PYTHON) scripts/verify.py

dict-download:  ## download all dictionaries -> data/dicts/raw/
	$(PYTHON) scripts/dict_download.py

dict-build:     ## build unified dictionary db (data/dicts/dicts.sqlite)
	$(PYTHON) scripts/dict_build.py

all: crawl load export verify

# --- database --------------------------------------------------------------
up:             ## start postgres via docker compose
	docker compose up -d db

down:
	docker compose down

psql:
	docker compose exec db psql -U tripitaka -d tripitaka

# --- web app ---------------------------------------------------------------
# Bind 0.0.0.0 so the app is reachable through the WSL/VM localhost relay and
# from the LAN, not just from inside the workspace.
api:            ## run FastAPI backend (serves API + built frontend on :$(PORT))
	$(PYTHON) -m uvicorn api.main:app --host 0.0.0.0 --port $(PORT) --reload

web-install:    ## install frontend dependencies
	cd web && pnpm install

web-dev:        ## Vite dev server on :5173 (proxies /api -> :8080)
	cd web && pnpm dev

web-build:      ## production build -> web/dist (served by the API on :8080)
	cd web && pnpm build

web:            ## one-shot: build frontend then serve everything on :$(PORT)
	cd web && pnpm build
	$(PYTHON) -m uvicorn api.main:app --host 0.0.0.0 --port $(PORT)