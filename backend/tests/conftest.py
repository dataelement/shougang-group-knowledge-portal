from pathlib import Path

import pytest

from app.settings import get_settings


@pytest.fixture(autouse=True)
def isolate_app_config_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("PORTAL_PORTAL_CONFIG_PATH", str(tmp_path / "portal_config.json"))
    monkeypatch.setenv("PORTAL_BISHENG_RUNTIME_CONFIG_PATH", str(tmp_path / "bisheng_runtime.json"))
    monkeypatch.setenv("PORTAL_PORTAL_DATABASE_PATH", str(tmp_path / "portal.sqlite3"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
