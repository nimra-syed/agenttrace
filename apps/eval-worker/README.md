# apps/eval-worker

A stateless FastAPI service that scores a trace's execution evidence
using an LLM as judge. It never touches Postgres — `apps/api` owns
authorization and persistence; this service only scores what it's
given. See ADR-0016.

## Setup

```bash
cd apps/eval-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in EVAL_WORKER_SECRET (must match apps/api's) and GEMINI_API_KEY
```

## Run

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Fails fast at startup (before accepting any traffic) if
`EVAL_WORKER_SECRET` or `GEMINI_API_KEY` is missing or invalid — same
discipline as `apps/api`'s own `CSRF_SECRET`/`EVAL_WORKER_SECRET`
validation in `main.ts`.

## Test

```bash
source .venv/bin/activate
python3 -m pytest
```

Never makes a real Gemini call — `app.judge.evaluate` is mocked in
every test, same reasoning as `apps/reference-agent` never running a
real LLM call in CI (ADR-0010): real, paid, network-dependent calls
don't belong in an automated test suite.

## Lint

```bash
source .venv/bin/activate
ruff check .
```
