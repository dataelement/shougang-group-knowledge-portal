import asyncio

from app.services.domain_file_count_service import (
    DomainFileCountService,
    reset_domain_file_count_cache,
)
from app.services.portal_config_service import PortalConfigService


class FakeBisheng:
    def __init__(self, counts):
        self.counts = counts
        self.calls = 0

    async def post_json(self, path, json=None):
        self.calls += 1
        # Yield control so concurrent callers interleave while the inflight key is held,
        # exercising the stale-while-revalidate dedup guard deterministically.
        await asyncio.sleep(0)
        codes = (json or {}).get("codes", [])
        return {"status_code": 200, "data": {"counts": {c: self.counts.get(c, 0) for c in codes}}}


def _service(tmp_path, counts, now):
    reset_domain_file_count_cache()
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    bisheng = FakeBisheng(counts)
    service = DomainFileCountService(bisheng_client=bisheng, config_service=config_service, now_fn=lambda: now[0])
    return service, bisheng, config_service


def test_refresh_calls_bisheng_and_persists(tmp_path):
    now = [1000.0]
    service, bisheng, config_service = _service(tmp_path, {"PP": 12, "QM": 3}, now)
    result = asyncio.run(service.refresh(["PP", "QM"]))
    assert result == {"PP": 12, "QM": 3}
    assert bisheng.calls == 1
    assert config_service.read_domain_count_cache()["PP"]["count"] == 12


def test_read_cached_fresh_hit_no_bisheng(tmp_path):
    now = [1000.0]
    service, bisheng, _ = _service(tmp_path, {"PP": 12}, now)
    asyncio.run(service.refresh(["PP"]))
    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 12}
    assert stale is False
    assert bisheng.calls == 1


def test_read_cached_marks_expired_as_stale(tmp_path):
    now = [1000.0]
    service, _, _ = _service(tmp_path, {"PP": 12}, now)
    asyncio.run(service.refresh(["PP"]))
    now[0] = 1000.0 + 43200 + 1
    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 12}
    assert stale is True


def test_read_cached_missing_returns_zero_and_stale(tmp_path):
    now = [1000.0]
    service, _, _ = _service(tmp_path, {}, now)
    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 0}
    assert stale is True


def test_cold_load_from_store(tmp_path):
    now = [1000.0]
    service, bisheng, _ = _service(tmp_path, {"PP": 5}, now)
    asyncio.run(service.refresh(["PP"]))
    reset_domain_file_count_cache()
    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 5}
    assert stale is False


def test_refresh_in_background_dedups(tmp_path):
    now = [1000.0]
    service, bisheng, _ = _service(tmp_path, {"PP": 1}, now)

    async def run_two():
        await asyncio.gather(
            service.refresh_in_background(["PP"]),
            service.refresh_in_background(["PP"]),
        )

    asyncio.run(run_two())
    assert bisheng.calls == 1
