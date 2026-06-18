# Shougang Knowledge Portal Backend

This service is the BFF layer between the portal frontend and BiSheng.

## Scope

- Expose portal-facing APIs under `/api/v1`
- Translate BiSheng responses into portal schemas
- Hold portal-side static configuration for the first phase
- Proxy streaming chat requests to BiSheng

## Quick Start

1. Create a Python 3.11+ virtualenv.
2. Install dependencies:

```bash
./.venv/bin/pip install -e ".[dev]"
```

3. Run the app:

```bash
./.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8010
```

4. Run tests:

```bash
./.venv/bin/python -m pytest
```

The current workspace has been verified with Python 3.13. Running tests with the macOS system Python 3.9 will fail because the project uses Python 3.11+ features.

## Environment Variables

- `PORTAL_APP_ENV`
- `PORTAL_APP_NAME`
- `PORTAL_BISHENG_BASE_URL`
- `PORTAL_BISHENG_TIMEOUT_SECONDS`
- `PORTAL_BISHENG_API_TOKEN`
- `PORTAL_BISHENG_USERNAME`
- `PORTAL_BISHENG_PASSWORD`
- `PORTAL_BISHENG_DEFAULT_MODEL`
- `PORTAL_BISHENG_PAGE_SIZE_LIMIT`

The app loads `backend/.env` automatically when present.

## Local Persistence

Portal-side runtime data is stored in:

- `app/config/data/portal_config.json`
- `app/config/data/bisheng_runtime.json`
- `app/config/data/portal.sqlite3`

## BiSheng Auth

The portal backend can use a runtime BiSheng service account for system data
source requests.

Configure `PORTAL_BISHENG_USERNAME` and `PORTAL_BISHENG_PASSWORD` to allow token
refresh before expiry and one automatic relogin after a BiSheng 401 / login
expired response. `PORTAL_BISHENG_API_TOKEN` can still seed an initial token.
The client sends the active token as both:

- `Authorization: Bearer <token>`
- Cookie `access_token_cookie=<token>`

When the admin page saves a service account password, the backend stores it in
plain text inside `app/config/data/portal.sqlite3` so later token refresh and
automatic relogin can run without extra environment configuration. Restrict file
permissions for the runtime data directory and do not commit runtime database
files.
