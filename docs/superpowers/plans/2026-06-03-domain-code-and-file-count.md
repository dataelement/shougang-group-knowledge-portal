# 业务域文件编码配置 与 首页知识数量改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让业务域可在后台配置「业务域编码」（编码第 3 段，如 `PP`），首页业务域卡片「知识数量」改为统计 BiSheng 全部知识库中编码匹配且解析成功的文件数，并用三级缓存 + stale-while-revalidate 兜性能。

**Architecture:** 后端给 `DomainConfig` 加 `code` 字段、给 `SiteConfig` 加缓存 TTL；新增 `DomainFileCountService`（进程内内存缓存 → SQLite 持久化缓存 → BiSheng 聚合接口三级回源，返旧值 + FastAPI BackgroundTasks 异步刷新）；新增门户路由 `GET /knowledge/domain-file-counts`。前端后台表单加编码/TTL 输入，首页改为按 `domain.code` 取计数。文件编码的**生成**不在本计划内（仅消费已有 `file_encoding`）。

**Tech Stack:** FastAPI + Pydantic + SQLite（`SQLiteConfigStore` 单行 JSON 文档）/ React + TypeScript（Vite）；后端测试 `pytest`，前端测试 `node --test`（经 `npm test` 编译）。

**关联规范：** [docs/prd-domain-code-and-file-count.md](../../prd-domain-code-and-file-count.md)

**前置事实（实现前必读）：**
- BiSheng 需新增聚合接口 `POST /api/v1/knowledge/shougang-portal/domain-file-counts`，请求 `{"codes": ["PP","QM"]}`，响应 `{"status_code":200,"data":{"counts":{"PP":12,"QM":0}}}`。统计口径见 PRD §5（全部知识库、解析成功、编码第 3 段匹配、与登录态无关）。**本计划的后端按此契约对接，BiSheng 侧实现并行进行；联调前用假数据/单测覆盖门户侧。**
- `frontend/tests/adminDomains.test.ts` 当前**已失败**（期望 `public_label`/`professional_*` 等已被删除的字段）。Task 7 会一并把它修正为当前真实结构 + 覆盖 `code`。

---

## 后端

### Task 1: `DomainConfig` 增加 `code` 字段

**Files:**
- Modify: `backend/app/schemas/portal_config.py:27-34`
- Modify: `backend/app/config/portal_config.py:230-241`（默认业务域预填编码）
- Test: `backend/tests/test_portal_config_service.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_portal_config_service.py` 末尾追加：

```python
def test_domain_config_round_trips_code(tmp_path):
    from app.schemas.portal_config import DomainsConfigUpdate
    from app.services.portal_config_service import PortalConfigService

    service = PortalConfigService(config_path=tmp_path / "portal.json")
    service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {
                    "name": "生产",
                    "space_ids": [],
                    "color": "#2563eb",
                    "bg": "#eff6ff",
                    "icon": "Factory",
                    "background_image": "",
                    "enabled": True,
                    "code": "PP",
                }
            ]
        )
    )
    domains = service.get_config().domains
    assert domains[0].code == "PP"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_portal_config_service.py::test_domain_config_round_trips_code -v`
Expected: FAIL（`DomainConfig` 无 `code` 字段，校验/取值报错或 AttributeError）

- [ ] **Step 3: 实现 schema 字段**

`backend/app/schemas/portal_config.py`，`DomainConfig` 改为：

```python
class DomainConfig(BaseModel):
    name: str
    space_ids: list[int] = Field(default_factory=list)
    color: str
    bg: str
    icon: str
    background_image: str = ""
    enabled: bool = True
    code: str = ""
```

- [ ] **Step 4: 默认业务域预填编码（按名称映射）**

`backend/app/config/portal_config.py` 的 `"domains"` 列表，给每条加 `"code"`（其余字段保持原样）：营销→`SD`、财务→`FI`、设备→`PM`、安全→`SA`、环保→`EN`、人力→`HR`、信息→`IT`、能源→`EM`、质量→`QM`、管理→`AD`。例如第一条：

```python
        {"name": "营销", "space_ids": [], "color": "#d97706", "bg": "#fef3c7", "icon": "CheckCircle", "background_image": "/domain-covers/marketing.png", "enabled": True, "code": "SD"},
```

其余 9 条同样在结尾加上对应 `"code"`。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_portal_config_service.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/app/schemas/portal_config.py backend/app/config/portal_config.py backend/tests/test_portal_config_service.py
git commit -m "feat(domain): add business-domain code field to DomainConfig"
```

---

### Task 2: `SiteConfig` 增加缓存 TTL 配置

**Files:**
- Modify: `backend/app/schemas/portal_config.py`（`SiteConfig`）
- Modify: `backend/app/config/portal_config.py:405-412`（`site` 默认值）
- Test: `backend/tests/test_portal_config_service.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
def test_site_config_has_default_cache_ttl(tmp_path):
    from app.services.portal_config_service import PortalConfigService

    service = PortalConfigService(config_path=tmp_path / "portal.json")
    assert service.get_config().site.domain_count_cache_ttl_seconds == 43200
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_portal_config_service.py::test_site_config_has_default_cache_ttl -v`
Expected: FAIL（`SiteConfig` 无该字段）

- [ ] **Step 3: 实现**

`backend/app/schemas/portal_config.py` 的 `SiteConfig` 末尾加字段：

```python
    favicon_url: str = "/site-favicon-horizontal-v2.png"
    domain_count_cache_ttl_seconds: int = 43200
```

`backend/app/config/portal_config.py` 的 `"site"` 块加键：

```python
    "site": {
        "header_brand_name": "首钢股份知库",
        "header_logo_url": "/site-logo-new.png",
        "login_brand_name": "首钢股份知库",
        "login_logo_url": "/shougang-stock-logo.png",
        "browser_title": "首钢股份知库",
        "favicon_url": "/site-favicon-horizontal-v2.png",
        "domain_count_cache_ttl_seconds": 43200,
    },
```

> 注：`get_config()` 已有 site 缺键合并逻辑（[portal_config_service.py:76-87](../../../backend/app/services/portal_config_service.py#L76-L87)），旧部署升级后会自动补上该默认值。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_portal_config_service.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/schemas/portal_config.py backend/app/config/portal_config.py backend/tests/test_portal_config_service.py
git commit -m "feat(site): add domain_count_cache_ttl_seconds config (default 12h)"
```

---

### Task 3: SQLite 缓存表 + 配置服务读写口

**Files:**
- Modify: `backend/app/services/config_store.py:11`
- Modify: `backend/app/services/portal_config_service.py`（新增两个方法）
- Test: `backend/tests/test_sqlite_config_storage.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_sqlite_config_storage.py` 末尾追加：

```python
def test_domain_count_cache_read_write(tmp_path):
    from app.services.portal_config_service import PortalConfigService

    service = PortalConfigService(config_path=tmp_path / "portal.json")
    assert service.read_domain_count_cache() == {}

    doc = {"PP": {"count": 12, "fetched_at": 1000.0}}
    service.write_domain_count_cache(doc)
    assert service.read_domain_count_cache() == doc
    # 缓存表与主配置表互不影响
    assert service.get_config().domains is not None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_sqlite_config_storage.py::test_domain_count_cache_read_write -v`
Expected: FAIL（无 `read_domain_count_cache` 方法）

- [ ] **Step 3: 白名单加表名**

`backend/app/services/config_store.py`：

```python
    _ALLOWED_TABLES = {"portal_config", "bisheng_runtime_config", "domain_count_cache"}
```

- [ ] **Step 4: 配置服务加读写口**

`backend/app/services/portal_config_service.py`，在 `PortalConfigService` 类常量区（`_TABLE_NAME` 附近）加：

```python
    _DOMAIN_COUNT_CACHE_TABLE = "domain_count_cache"
```

并新增方法（放在 `update_domains` 之后即可）：

```python
    def read_domain_count_cache(self) -> dict[str, Any]:
        return self._store.get_document(self._DOMAIN_COUNT_CACHE_TABLE) or {}

    def write_domain_count_cache(self, doc: dict[str, Any]) -> None:
        self._store.upsert_document(self._DOMAIN_COUNT_CACHE_TABLE, doc)
```

（`Any` 已在该文件 import。）

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_sqlite_config_storage.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/app/services/config_store.py backend/app/services/portal_config_service.py backend/tests/test_sqlite_config_storage.py
git commit -m "feat(cache): add domain_count_cache sqlite table + config-service accessors"
```

---

### Task 4: `DomainFileCountService`（三级缓存 + SWR 核心）

**Files:**
- Create: `backend/app/services/domain_file_count_service.py`
- Test: `backend/tests/test_domain_file_count_service.py`

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_domain_file_count_service.py`：

```python
import asyncio

import pytest

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
    # 写回了 SQLite
    assert config_service.read_domain_count_cache()["PP"]["count"] == 12


def test_read_cached_fresh_hit_no_bisheng(tmp_path):
    now = [1000.0]
    service, bisheng, _ = _service(tmp_path, {"PP": 12}, now)
    asyncio.run(service.refresh(["PP"]))

    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 12}
    assert stale is False
    assert bisheng.calls == 1  # 未再调用


def test_read_cached_marks_expired_as_stale(tmp_path):
    now = [1000.0]
    service, _, _ = _service(tmp_path, {"PP": 12}, now)
    asyncio.run(service.refresh(["PP"]))

    now[0] = 1000.0 + 43200 + 1  # 超过默认 TTL
    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 12}  # 仍返回旧值
    assert stale is True


def test_read_cached_missing_returns_zero_and_stale(tmp_path):
    now = [1000.0]
    service, _, _ = _service(tmp_path, {}, now)
    counts, stale = service.read_cached(["PP"])
    assert counts == {"PP": 0}
    assert stale is True


def test_cold_load_from_store(tmp_path):
    now = [1000.0]
    service, bisheng, config_service = _service(tmp_path, {"PP": 5}, now)
    asyncio.run(service.refresh(["PP"]))

    # 模拟新进程：清空内存缓存，但 SQLite 仍在
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
    # 并发去重：两次并发最多触发一次回源（实现里 inflight 标记）
    assert bisheng.calls <= 1 or bisheng.calls == 1
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_domain_file_count_service.py -v`
Expected: FAIL（模块不存在，ImportError）

- [ ] **Step 3: 实现服务**

新建 `backend/app/services/domain_file_count_service.py`：

```python
from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable

DOMAIN_FILE_COUNTS_PATH = "/api/v1/knowledge/shougang-portal/domain-file-counts"
_DEFAULT_TTL_SECONDS = 43200


@dataclass
class _CountEntry:
    count: int
    fetched_at: float


_MEMORY_CACHE: dict[str, _CountEntry] = {}
_INFLIGHT: set[frozenset[str]] = set()
_LOADED = False
_LOCK = Lock()


def reset_domain_file_count_cache() -> None:
    """测试辅助：清空进程内缓存与加载标记。"""
    global _LOADED
    with _LOCK:
        _MEMORY_CACHE.clear()
        _INFLIGHT.clear()
        _LOADED = False


class DomainFileCountService:
    def __init__(
        self,
        bisheng_client,
        config_service,
        now_fn: Callable[[], float] = time.time,
    ):
        self._bisheng = bisheng_client
        self._config_service = config_service
        self._now = now_fn

    def _ttl_seconds(self) -> int:
        ttl = self._config_service.get_config().site.domain_count_cache_ttl_seconds
        return ttl if isinstance(ttl, int) and ttl > 0 else _DEFAULT_TTL_SECONDS

    def _ensure_loaded(self) -> None:
        global _LOADED
        with _LOCK:
            if _LOADED:
                return
            doc = self._config_service.read_domain_count_cache() or {}
            for code, entry in doc.items():
                if isinstance(entry, dict):
                    _MEMORY_CACHE[code] = _CountEntry(
                        count=int(entry.get("count") or 0),
                        fetched_at=float(entry.get("fetched_at") or 0.0),
                    )
            _LOADED = True

    def read_cached(self, codes: list[str]) -> tuple[dict[str, int], bool]:
        self._ensure_loaded()
        now = self._now()
        ttl = self._ttl_seconds()
        counts: dict[str, int] = {}
        stale = False
        with _LOCK:
            for code in codes:
                entry = _MEMORY_CACHE.get(code)
                if entry is None:
                    counts[code] = 0
                    stale = True
                else:
                    counts[code] = entry.count
                    if now - entry.fetched_at > ttl:
                        stale = True
        return counts, stale

    async def refresh(self, codes: list[str]) -> dict[str, int]:
        if not codes:
            return {}
        response = await self._bisheng.post_json(DOMAIN_FILE_COUNTS_PATH, json={"codes": codes})
        data = response.get("data") or {}
        raw = data.get("counts") if isinstance(data, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
        now = self._now()
        result: dict[str, int] = {}
        with _LOCK:
            for code in codes:
                count = int(raw.get(code) or 0)
                _MEMORY_CACHE[code] = _CountEntry(count=count, fetched_at=now)
                result[code] = count
            doc: dict[str, Any] = {
                code: {"count": entry.count, "fetched_at": entry.fetched_at}
                for code, entry in _MEMORY_CACHE.items()
            }
        self._config_service.write_domain_count_cache(doc)
        return result

    async def refresh_in_background(self, codes: list[str]) -> None:
        if not codes:
            return
        key = frozenset(codes)
        with _LOCK:
            if key in _INFLIGHT:
                return
            _INFLIGHT.add(key)
        try:
            await self.refresh(codes)
        except Exception:
            pass
        finally:
            with _LOCK:
                _INFLIGHT.discard(key)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_domain_file_count_service.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/domain_file_count_service.py backend/tests/test_domain_file_count_service.py
git commit -m "feat(domain-counts): three-tier cache service with stale-while-revalidate"
```

---

### Task 5: 门户路由 `GET /knowledge/domain-file-counts`

**Files:**
- Modify: `backend/app/api/routes/knowledge.py`
- Test: `backend/tests/test_domain_file_counts_api.py`

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_domain_file_counts_api.py`：

```python
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.routes.knowledge import get_knowledge_service, get_domain_file_count_service
from app.api.dependencies import get_portal_config_service
from app.main import app
from app.schemas.portal_config import DomainsConfigUpdate
from app.services.domain_file_count_service import DomainFileCountService, reset_domain_file_count_cache
from app.services.portal_config_service import PortalConfigService


class FakeBisheng:
    def __init__(self, counts):
        self.counts = counts

    async def post_json(self, path, json=None):
        codes = (json or {}).get("codes", [])
        return {"status_code": 200, "data": {"counts": {c: self.counts.get(c, 0) for c in codes}}}


def test_domain_file_counts_route(tmp_path):
    reset_domain_file_count_cache()
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {"name": "生产", "space_ids": [], "color": "#1", "bg": "#2", "icon": "Factory",
                 "background_image": "", "enabled": True, "code": "PP"},
                {"name": "质量", "space_ids": [], "color": "#1", "bg": "#2", "icon": "CheckCircle",
                 "background_image": "", "enabled": True, "code": "QM"},
            ]
        )
    )
    bisheng = FakeBisheng({"PP": 12, "QM": 3})

    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    app.dependency_overrides[get_domain_file_count_service] = lambda: DomainFileCountService(
        bisheng_client=bisheng, config_service=config_service
    )
    try:
        client = TestClient(app)
        # 首次冷缓存：返回 0，并在响应后台刷新（TestClient 同步执行 BackgroundTasks）
        first = client.get("/api/v1/knowledge/domain-file-counts")
        assert first.status_code == 200
        assert set(first.json()["data"]["counts"].keys()) == {"PP", "QM"}
        # 二次：后台已回源，返回真实值
        second = client.get("/api/v1/knowledge/domain-file-counts")
        assert second.json()["data"]["counts"] == {"PP": 12, "QM": 3}
    finally:
        app.dependency_overrides.clear()
        reset_domain_file_count_cache()
```

> 说明：`TestClient` 会在响应发出后同步执行 `BackgroundTasks`，所以第二次请求能拿到已刷新的值，断言确定无竞态。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_domain_file_counts_api.py -v`
Expected: FAIL（无 `get_domain_file_count_service` / 路由）

- [ ] **Step 3: 实现 provider + 路由**

`backend/app/api/routes/knowledge.py`：
- 顶部 `from fastapi import ...` 行加入 `BackgroundTasks`。
- import 服务：

```python
from app.services.domain_file_count_service import DomainFileCountService
```

- 在 `get_knowledge_service` 附近新增 provider：

```python
def get_domain_file_count_service(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
) -> DomainFileCountService:
    return DomainFileCountService(
        bisheng_client=bisheng_client,
        config_service=portal_config_service,
    )
```

- 在 `/config` 路由（[knowledge.py:174](../../../backend/app/api/routes/knowledge.py#L174)）之后新增：

```python
@router.get("/domain-file-counts")
async def get_domain_file_counts(
    background_tasks: BackgroundTasks,
    service: DomainFileCountService = Depends(get_domain_file_count_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    domains = portal_config_service.get_config().domains
    codes = sorted({d.code.strip().upper() for d in domains if d.code and d.code.strip()})
    counts, stale = service.read_cached(codes)
    if stale and codes:
        background_tasks.add_task(service.refresh_in_background, codes)
    return response_ok({"counts": counts})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_domain_file_counts_api.py -v`
Expected: PASS

- [ ] **Step 5: 跑整体后端测试确保无回归**

Run: `cd backend && ./.venv/bin/python -m pytest -q`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add backend/app/api/routes/knowledge.py backend/tests/test_domain_file_counts_api.py
git commit -m "feat(api): GET /knowledge/domain-file-counts with background refresh"
```

---

## 前端

### Task 6: 类型定义（`DomainConfig.code` / `SiteConfig` TTL）

**Files:**
- Modify: `frontend/src/api/adminConfig.ts:10-18`（DomainConfig）、`181-188`（SiteConfig）

- [ ] **Step 1: 加字段**

`DomainConfig` 接口加：

```typescript
export interface DomainConfig {
  name: string;
  space_ids: number[];
  color: string;
  bg: string;
  icon: string;
  background_image: string;
  enabled: boolean;
  code: string;
}
```

`SiteConfig` 接口加：

```typescript
export interface SiteConfig {
  header_brand_name: string;
  header_logo_url: string;
  login_brand_name: string;
  login_logo_url: string;
  browser_title: string;
  favicon_url: string;
  domain_count_cache_ttl_seconds: number;
}
```

- [ ] **Step 2: 类型闸校验**

Run: `cd frontend && npx tsc -b`
Expected: 此时其它文件可能因缺字段报错（adminDomains/AdminPage），属预期 —— 后续任务修复。可先只确认 `adminConfig.ts` 本身无语法错。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/adminConfig.ts
git commit -m "feat(types): add domain code and site cache-ttl fields"
```

---

### Task 7: `adminDomains.ts` 编码字段 + 修正失效测试

**Files:**
- Modify: `frontend/src/utils/adminDomains.ts`
- Modify (rewrite): `frontend/tests/adminDomains.test.ts`

- [ ] **Step 1: 重写测试（修正旧失败 + 覆盖 code）**

把 `frontend/tests/adminDomains.test.ts` 全文替换为：

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainDraft, isSelectedDomainColor, validateDomainDraft, DOMAIN_CODE_OPTIONS } from '../src/utils/adminDomains';

test('createDomainDraft maps existing domain values incl. code', () => {
  const draft = createDomainDraft({
    name: '轧线',
    space_ids: [12],
    color: '#059669',
    bg: '#d1fae5',
    icon: 'Factory',
    background_image: '/rolling-domain-bg.jpg',
    enabled: false,
    code: 'PP',
  });

  assert.deepEqual(draft, {
    name: '轧线',
    spaceId: '12',
    icon: 'Factory',
    backgroundImage: '/rolling-domain-bg.jpg',
    color: '#059669',
    bg: '#d1fae5',
    enabled: false,
    code: 'PP',
  });
});

test('validateDomainDraft returns a domain config incl. uppercased code', () => {
  const result = validateDomainDraft({
    name: '冷轧',
    spaceId: '18',
    icon: 'Snowflake',
    backgroundImage: '/cold-domain-bg.jpg',
    color: '#6366f1',
    bg: '#ede9fe',
    enabled: true,
    code: 'pp',
  }, [
    { id: 18, name: '冷轧技术手册', file_count: 10, tag_count: 0, enabled: true },
  ]);

  assert.deepEqual(result, {
    domain: {
      name: '冷轧',
      space_ids: [18],
      icon: 'Snowflake',
      background_image: '/cold-domain-bg.jpg',
      color: '#6366f1',
      bg: '#ede9fe',
      enabled: true,
      code: 'PP',
    },
  });
});

test('validateDomainDraft allows empty code', () => {
  const result = validateDomainDraft({
    name: '能源',
    spaceId: '',
    icon: 'Zap',
    backgroundImage: '/energy-domain-bg.jpg',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: '',
  }, []);

  assert.deepEqual(result.domain?.code, '');
  assert.deepEqual(result.domain?.space_ids, []);
});

test('validateDomainDraft still rejects unknown spaces', () => {
  const unknown = validateDomainDraft({
    name: '能源',
    spaceId: '30',
    icon: 'Zap',
    backgroundImage: '',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: '',
  }, [
    { id: 12, name: '轧线技术案例库', file_count: 10, tag_count: 0, enabled: true },
  ]);

  assert.equal(unknown.error, '绑定空间不存在');
});

test('DOMAIN_CODE_OPTIONS covers the 14 business-domain codes', () => {
  assert.equal(DOMAIN_CODE_OPTIONS.length, 14);
  assert.ok(DOMAIN_CODE_OPTIONS.some((o) => o.code === 'PP' && o.label === '生产'));
});

test('isSelectedDomainColor matches preset color pairs exactly', () => {
  assert.equal(isSelectedDomainColor({ color: '#2563eb', bg: '#eff6ff' }, { color: '#2563eb', bg: '#eff6ff' }), true);
  assert.equal(isSelectedDomainColor({ color: '#2563eb', bg: '#eff6ff' }, { color: '#059669', bg: '#d1fae5' }), false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm test`
Expected: FAIL（`DOMAIN_CODE_OPTIONS` 未导出、`code` 字段不存在）

- [ ] **Step 3: 实现 utils**

`frontend/src/utils/adminDomains.ts`：

在 `DOMAIN_COLOR_OPTIONS` 之后加编码候选常量：

```typescript
export const DOMAIN_CODE_OPTIONS = [
  { code: 'PP', label: '生产' },
  { code: 'QM', label: '质量' },
  { code: 'PM', label: '设备' },
  { code: 'EM', label: '能源' },
  { code: 'SA', label: '安全' },
  { code: 'EN', label: '环保' },
  { code: 'IM', label: '投资' },
  { code: 'RD', label: '研发' },
  { code: 'MM', label: '采购' },
  { code: 'SD', label: '营销' },
  { code: 'FI', label: '财务' },
  { code: 'HR', label: '人力' },
  { code: 'IT', label: '信息' },
  { code: 'AD', label: '管理' },
] as const;
```

`DomainDraft` 接口加 `code: string;`。

`createDomainDraft` 返回对象加 `code: current?.code ?? '',`。

`validateDomainDraft`：在 `const bg = draft.bg.trim();` 校验之后、`return` 之前加：

```typescript
  const code = draft.code.trim().toUpperCase();
```

并把返回的 `domain` 对象加上 `code,`：

```typescript
  return {
    domain: {
      name,
      space_ids: spaceIds,
      icon,
      background_image: draft.backgroundImage.trim(),
      color,
      bg,
      enabled: true,
      code,
    },
  };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npm test`
Expected: PASS（adminDomains 全绿；其余测试不受影响）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/utils/adminDomains.ts frontend/tests/adminDomains.test.ts
git commit -m "feat(admin): domain code field + presets in adminDomains util"
```

---

### Task 8: 后台业务域弹窗 —— 编码输入

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`（import、域弹窗表单、统计口径提示）

- [ ] **Step 1: 引入编码候选常量**

在 AdminPage 顶部从 `adminDomains` 的 import 里加入 `DOMAIN_CODE_OPTIONS`（与 `DOMAIN_ICON_OPTIONS`、`createDomainDraft` 同处）。

- [ ] **Step 2: 弹窗加「编码」输入（带候选）**

在域弹窗「名称」字段 `</label>`（[AdminPage.tsx:1681](../../../frontend/src/pages/AdminPage.tsx#L1681)）之后插入：

```tsx
          <label className={s.formField}>
            <span className={s.fieldLabel}>业务域编码</span>
            <input
              className={s.formInput}
              value={draft.code}
              list="domain-code-options"
              onChange={(event) => onChange({ code: event.target.value })}
              placeholder="例如：PP（生产）"
            />
            <datalist id="domain-code-options">
              {DOMAIN_CODE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{`${option.code} ${option.label}`}</option>
              ))}
            </datalist>
            <span className={s.fieldHint}>对应文件编码第 3 段（如 SGGF-STD-PP-… 中的 PP）。可从候选快速选择，也可手动填写；留空则该业务域知识数量按 0 计。保存时统一转大写。</span>
          </label>
```

- [ ] **Step 3: 更新「首页统计口径」提示文案**

把 [AdminPage.tsx:1698-1704](../../../frontend/src/pages/AdminPage.tsx#L1698-L1704) 的说明文字替换为：

```tsx
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>首页统计口径</span>
            <div className={s.emptyState}>首页业务域卡片「知识数量」来自全部知识库中文件编码第 3 段等于该业务域编码、且解析成功的文档数。</div>
            <span className={s.fieldHint}>
              数量口径由「业务域编码」决定，与绑定空间无关；未配编码则显示 0。统计结果带缓存（见站点配置的缓存有效期）。
            </span>
          </div>
```

- [ ] **Step 4: 类型闸校验**

Run: `cd frontend && npx tsc -b`
Expected: 与 domain 弹窗相关的报错消失（site TTL 相关报错在 Task 9 修复）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(admin): business-domain code input with presets in domain dialog"
```

---

### Task 9: 后台站点配置 —— 缓存 TTL 输入

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`（`SiteDraft`、`createSiteDraft`、`validateSiteDraft`、`SiteConfigTable`、站点弹窗）

- [ ] **Step 1: `SiteDraft` 加字段**

[AdminPage.tsx:166-173](../../../frontend/src/pages/AdminPage.tsx#L166-L173)：

```typescript
interface SiteDraft {
  header_brand_name: string;
  header_logo_url: string;
  login_brand_name: string;
  login_logo_url: string;
  browser_title: string;
  favicon_url: string;
  domain_count_cache_ttl_seconds: string;
}
```

- [ ] **Step 2: `createSiteDraft` 映射**

[AdminPage.tsx:4044-4053](../../../frontend/src/pages/AdminPage.tsx#L4044-L4053) 返回对象加：

```typescript
    favicon_url: current?.favicon_url ?? '/site-favicon-horizontal-v2.png',
    domain_count_cache_ttl_seconds: String(current?.domain_count_cache_ttl_seconds ?? 43200),
```

- [ ] **Step 3: `validateSiteDraft` 校验 + 输出**

[AdminPage.tsx:4055-4076](../../../frontend/src/pages/AdminPage.tsx#L4055-L4076)：在构造 `site` 前解析 TTL，校验为 ≥60 的整数，并放入 `site`：

```typescript
function validateSiteDraft(draft: SiteDraft): { site?: SiteConfig; error?: string } {
  const ttl = Number(draft.domain_count_cache_ttl_seconds.trim());
  if (!Number.isInteger(ttl) || ttl < 60) {
    return { error: '业务域计数缓存有效期需为不小于 60 的整数（秒）' };
  }
  const site: SiteConfig = {
    header_brand_name: draft.header_brand_name.trim(),
    header_logo_url: normalizeAssetUrl(draft.header_logo_url),
    login_brand_name: draft.login_brand_name.trim(),
    login_logo_url: normalizeAssetUrl(draft.login_logo_url),
    browser_title: draft.browser_title.trim(),
    favicon_url: normalizeAssetUrl(draft.favicon_url),
    domain_count_cache_ttl_seconds: ttl,
  };
  if (!site.header_brand_name) return { error: '请输入顶部品牌名' };
  if (!site.login_brand_name) return { error: '请输入登录页品牌名' };
  if (!site.browser_title) return { error: '请输入浏览器标签页文字' };
  for (const [label, value] of [
    ['顶部 Header Logo', site.header_logo_url],
    ['登录页 Logo', site.login_logo_url],
    ['浏览器标签页图标', site.favicon_url],
  ] as const) {
    if (!value) return { error: `请输入${label}` };
    if (!isValidAssetUrl(value)) return { error: `${label} 需填写站内本地路径或 http(s) 线上图片地址` };
  }
  return { site };
}
```

- [ ] **Step 4: 站点弹窗加输入**

在站点弹窗「浏览器标签页图标」字段 `</label>`（[AdminPage.tsx:3183](../../../frontend/src/pages/AdminPage.tsx#L3183)）之后插入：

```tsx
          <label className={s.formField}>
            <span className={s.fieldLabel}>业务域计数缓存有效期（秒）</span>
            <input
              className={s.formInput}
              type="number"
              min={60}
              value={draft.domain_count_cache_ttl_seconds}
              onChange={(event) => onChange({ ...draft, domain_count_cache_ttl_seconds: event.target.value })}
              placeholder="例如：43200（12 小时）"
            />
          </label>
```

- [ ] **Step 5: 站点配置表格加一行展示**

在 `SiteConfigTable` 浏览器标签页图标行 `</tr>`（[AdminPage.tsx:2866](../../../frontend/src/pages/AdminPage.tsx#L2866)）之后插入：

```tsx
          <tr>
            <td>业务域计数缓存有效期</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.domain_count_cache_ttl_seconds} 秒</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
```

- [ ] **Step 6: 类型闸 + 测试**

Run: `cd frontend && npx tsc -b && npm test`
Expected: 编译通过、测试全绿

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/AdminPage.tsx
git commit -m "feat(admin): domain-count cache TTL field in site config"
```

---

### Task 10: 内容 API `fetchDomainFileCounts`

**Files:**
- Modify: `frontend/src/api/content.ts`

- [ ] **Step 1: 新增函数**

在 `fetchHomeContent`（[content.ts:393](../../../frontend/src/api/content.ts#L393) 附近）之后加：

```typescript
export async function fetchDomainFileCounts(): Promise<Record<string, number>> {
  const data = await request<{ counts: Record<string, number> }>('/api/v1/knowledge/domain-file-counts');
  return data.counts ?? {};
}
```

- [ ] **Step 2: 类型闸**

Run: `cd frontend && npx tsc -b`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/content.ts
git commit -m "feat(api): fetchDomainFileCounts client"
```

---

### Task 11: 首页卡片改用编码计数

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`

- [ ] **Step 1: import**

把 `fetchDomainFileCounts` 加入 `from '../api/content'` 的 import（[HomePage.tsx:15](../../../frontend/src/pages/HomePage.tsx#L15)）。

- [ ] **Step 2: 新增计数 state + 拉取**

在组件内（其它 `useState`/`useEffect` 附近，如 [HomePage.tsx:325](../../../frontend/src/pages/HomePage.tsx#L325) 之后）加：

```tsx
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const counts = await fetchDomainFileCounts();
        if (active) setDomainCounts(counts);
      } catch {
        /* 失败时保持空对象，卡片显示 0，不阻断首页 */
      }
    })();
    return () => {
      active = false;
    };
  }, []);
```

（确保文件已 import `useState`/`useEffect` —— [HomePage.tsx:1](../../../frontend/src/pages/HomePage.tsx#L1) 已有。）

- [ ] **Step 3: 改 `domainTotals` 口径**

把 [HomePage.tsx:470-476](../../../frontend/src/pages/HomePage.tsx#L470-L476) 替换为：

```tsx
  const domainTotals = isUsingMockDomains ? MOCK_DOMAIN_STATS : new Map(homeDomains.map((domain) => {
    const code = (domain.code || '').trim().toUpperCase();
    return [domain.name, code ? (domainCounts[code] ?? 0) : 0] as [string, number];
  }));
```

> `spaceById`（[HomePage.tsx:469](../../../frontend/src/pages/HomePage.tsx#L469)）若仅服务于旧 `domainTotals` 计算且无其它引用，可一并删除以免 tsc 报未使用；若仍被别处使用则保留。实现时按 tsc 报错决定。

- [ ] **Step 4: 类型闸 + 测试**

Run: `cd frontend && npx tsc -b && npm test`
Expected: 编译通过、测试全绿

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/HomePage.tsx
git commit -m "feat(home): domain card count from code-based file counts"
```

---

## 收尾验证

### Task 12: 全量测试 + 构建 + 手动验收

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && ./.venv/bin/python -m pytest -q`
Expected: 全绿

- [ ] **Step 2: 前端测试 + 类型构建**

Run: `cd frontend && npm test && npx tsc -b`
Expected: 全绿、构建通过

- [ ] **Step 3: 手动验收（按 PRD §10，浏览器实测）**

参照 [deploy-test-env.md](../../deploy-test-env.md) 部署测试环境后：
1. 后台业务域设置编码（候选选 + 手输各一次），保存回显大写正确。
2. 首页业务域卡片数量 = 全库该编码解析成功文档数；未配编码显示 0。
3. 连续访问首页，TTL 窗口内 BiSheng 聚合接口最多回源一次（看后端日志）。
4. 模拟 BiSheng 失败：首页展示缓存旧值或 0，不报错。
5. 重启后端进程后首页数量来自 SQLite 缓存（不立即打 BiSheng）。
6. 后台站点配置改小 TTL → 过期判定按新值生效。

> ⚠️ 第 2/3/4 项依赖 BiSheng 聚合接口已就绪；接口未就绪前，后端单测（Task 4/5）已用假数据覆盖逻辑，可先合并门户侧，待 BiSheng 接口上线再做端到端验收。

---

## Self-Review 记录

- **Spec 覆盖**：R1→Task 1/7/8；R2→Task 6（`code` 随公共配置下发，无需额外接口）；R3→Task 11；R4→Task 4；R5→Task 2/9；BiSheng 聚合(§5)→Task 5 对接契约 + 前置说明；门户接口(§6)→Task 5/10。全部有对应任务。
- **占位符**：无 TBD/TODO；每个代码步骤均给出完整代码。
- **类型一致**：`read_cached`/`refresh`/`refresh_in_background` 在 Task 4 定义、Task 5 调用签名一致；`fetchDomainFileCounts` 无参，Task 10 定义、Task 11 调用一致；`DOMAIN_CODE_OPTIONS` Task 7 定义、Task 8 使用一致；`domain_count_cache_ttl_seconds` 后端 int / 前端 SiteConfig number / SiteDraft string，转换在 createSiteDraft/validateSiteDraft 显式处理。
- **已知前置**：`adminDomains.test.ts` 原本失败，Task 7 重写修正。
