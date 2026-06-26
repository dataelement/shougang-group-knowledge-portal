# 我的收藏功能迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"收藏"从"弹窗选库+复制副本"重构为"一键收藏到固定的『我的收藏』知识库，存引用而非副本，并在所有入口提供已收藏/未收藏两态切换"。

**Architecture:** 三子系统按依赖顺序实现：
1. **Phase A — bisheng_2 后端（契约下游真源）**：每用户一个特殊 PERSONAL 知识库（`is_favorite=True`）承载收藏；每条收藏是一条"引用型 `KnowledgeFile` 行"（不拷贝内容，`file_source='favorite_reference'`，`user_metadata` 指向源文件）；提供 添加/取消/批量状态查询/列表（含 valid|invalid 状态）端点；收藏库禁止删除/重命名/上传等写操作。
2. **Phase B — portal 后端 BFF**：新增/调整 `/api/v1/knowledge/favorites*` 代理端点，透传到 bisheng_2，统一登录校验与错误码。
3. **Phase C — portal 前端**：收藏按钮改为两态 toggle、批量状态拉取、未登录隐藏、"我的收藏"只读视图与"已失效"展示。

**Tech Stack:** 后端 Python / FastAPI / SQLModel(SQLAlchemy) / Alembic / pytest；BFF Python / FastAPI / httpx / pytest；前端 React + TypeScript + Vite + Vitest。

## Global Constraints

- 收藏库名称固定为 `我的收藏`；每个用户至多一个；系统默认存在（懒创建），不可删除、不可重命名。
- 收藏存**引用**：`source_space_id` + `source_file_id` + `user_id`，唯一约束 `(user_id, source_space_id, source_file_id)` 防重复。
- 收藏项状态：`valid`（源文件存在）/ `invalid`（源文件已删）。失效项仅允许"取消收藏"。
- 未登录：前端隐藏收藏按钮；所有收藏写/查接口要求登录态，未登录返回 401。
- bisheng_2 收藏端点前缀 `/api/v1/knowledge/shougang-portal/`；portal 前端调用 `/api/v1/knowledge/`，由 BFF 转发。
- 不改动现有 `share-links`、`personal-spaces`、`telemetry` 等无关端点行为。
- 提交粒度：每个 Task 自带测试闭环，独立可评审；遵循 DRY / YAGNI / TDD / 频繁提交。

## API 契约（锁定，三端共用）

前端 ↔ BFF（portal `/api/v1/knowledge/`），BFF ↔ bisheng_2（`/api/v1/knowledge/shougang-portal/`）镜像同形：

| 能力 | 方法 & 路径 | 请求体 | 响应 `data` |
| --- | --- | --- | --- |
| 添加收藏（幂等） | `POST /favorites` | `{source_space_id:int, source_file_id:int}` | `{favorite_file_id:int, space_id:int, source_space_id:int, source_file_id:int, title:str}` |
| 取消收藏（幂等） | `POST /favorites/remove` | `{source_space_id:int, source_file_id:int}` | `{removed:bool}` |
| 批量收藏状态 | `POST /favorites/status` | `{items:[{space_id:int, file_id:int}]}` | `{data:[{space_id:int, file_id:int, favorited:bool}]}` |
| 我的收藏库信息 | `GET /favorites/space` | — | `{space_id:int, name:str}` |
| 我的收藏列表 | `GET /favorites/files?page=&page_size=` | — | `{data:[{favorite_file_id:int, source_space_id:int, source_file_id:int, title:str, file_name:str, status:"valid"\|"invalid", updated_at:str}], total:int, page:int, page_size:int}` |

> 说明：`POST /favorites/remove` 用 POST 而非 DELETE，以便统一带 JSON body 且兼容现有 BFF `request` 封装；取消收藏不依赖 `favorite_file_id`，按 `(source_space_id, source_file_id)` 定位，便于列表/搜索页 toggle。

---

# Phase A — bisheng_2 后端

仓库根：`/Users/zhangguoqing/works/bisheng_2`。后端代码根：`src/backend/bisheng`。测试根：`src/backend/test`（pytest）。

**Phase A 文件结构**

- 修改 `src/backend/bisheng/knowledge/domain/models/knowledge.py` — `Knowledge` 增加 `is_favorite: bool` 字段。
- 修改 `src/backend/bisheng/knowledge/domain/schemas/knowledge_space_schema.py` — 新增收藏相关 Req/Resp schema。
- 修改 `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py` — 新增收藏库懒创建、引用式添加、取消、批量状态、列表方法；改造 `delete_space`/`update_knowledge_space` 保护收藏库。
- 修改 `src/backend/bisheng/knowledge/api/endpoints/shougang_portal.py` — 新增 4 个端点（add 改造、remove、status、files），保留 `space` 由 personal-spaces 暴露。
- 新增 Alembic 迁移 `src/backend/bisheng/core/database/alembic/versions/<rev>_add_knowledge_is_favorite.py`。
- 新增/修改测试 `src/backend/test/test_shougang_portal_endpoint.py`。

> 执行约定：每个后端 Task 开始前先用编辑器打开"Files"列出的现有函数，确认 DAO/Service 方法的真实签名（本计划已基于真实代码 `knowledge_space_service.py:2189-2299`、`:4253-4402` 撰写，但 DAO 细节以仓库现状为准）。

---

### Task A1: `Knowledge` 模型增加 `is_favorite` 字段 + 迁移

**Files:**
- Modify: `src/backend/bisheng/knowledge/domain/models/knowledge.py`（`Knowledge` 模型字段块，约 `:50-100`）
- Create: `src/backend/bisheng/core/database/alembic/versions/<rev>_add_knowledge_is_favorite.py`
- Test: `src/backend/test/test_knowledge_model_favorite.py`

**Interfaces:**
- Produces: `Knowledge.is_favorite: bool`（默认 `False`），数据库列 `knowledge.is_favorite BOOLEAN NOT NULL DEFAULT 0`。

- [ ] **Step 1: 写失败测试**

```python
# src/backend/test/test_knowledge_model_favorite.py
from bisheng.knowledge.domain.models.knowledge import Knowledge


def test_knowledge_has_is_favorite_default_false():
    k = Knowledge(name="x", user_id=1, type=3)
    assert hasattr(k, "is_favorite")
    assert k.is_favorite is False


def test_knowledge_is_favorite_settable():
    k = Knowledge(name="我的收藏", user_id=1, type=3, is_favorite=True)
    assert k.is_favorite is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_knowledge_model_favorite.py -v`
Expected: FAIL（`is_favorite` 不存在 / 不被接受）

- [ ] **Step 3: 在 `Knowledge` 模型增加字段**

在 `knowledge.py` 的 `Knowledge` 字段定义块内（紧邻 `is_released` 字段，保持风格一致）加入：

```python
    is_favorite: bool = Field(default=False, description="是否为用户的『我的收藏』固定知识库")
```

- [ ] **Step 4: 新增 Alembic 迁移**

先查最新 revision：`cd src/backend && python -m alembic heads`，记下 `<down_revision>`。新建迁移文件（rev id 用 `alembic revision` 生成或手填唯一串）：

```python
"""add knowledge.is_favorite

Revision ID: <rev>
Revises: <down_revision>
"""
from alembic import op
import sqlalchemy as sa

revision = "<rev>"
down_revision = "<down_revision>"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "knowledge",
        sa.Column("is_favorite", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade():
    op.drop_column("knowledge", "is_favorite")
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_knowledge_model_favorite.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/domain/models/knowledge.py \
        src/backend/bisheng/core/database/alembic/versions/ \
        src/backend/test/test_knowledge_model_favorite.py
git commit -m "feat(knowledge): add is_favorite flag to Knowledge model"
```

---

### Task A2: 收藏相关 Schema 定义

**Files:**
- Modify: `src/backend/bisheng/knowledge/domain/schemas/knowledge_space_schema.py`（在现有 `ShougangPortalFavoriteCreateReq/Resp` 附近）
- Test: `src/backend/test/test_favorite_schema.py`

**Interfaces:**
- Produces:
  - `ShougangPortalFavoriteCreateReq{ source_space_id:int>0, source_file_id:int>0 }`（移除 `target_space_id`）
  - `ShougangPortalFavoriteCreateResp{ favorite_file_id:int, space_id:int, source_space_id:int, source_file_id:int, title:str="" }`
  - `ShougangPortalFavoriteRemoveReq{ source_space_id:int>0, source_file_id:int>0 }`
  - `ShougangPortalFavoriteRemoveResp{ removed:bool }`
  - `ShougangPortalFavoriteStatusItem{ space_id:int, file_id:int }`
  - `ShougangPortalFavoriteStatusReq{ items:list[ShougangPortalFavoriteStatusItem] }`
  - `ShougangPortalFavoriteStatusResultItem{ space_id:int, file_id:int, favorited:bool }`
  - `ShougangPortalFavoriteStatusResp{ data:list[ShougangPortalFavoriteStatusResultItem] }`
  - `ShougangPortalFavoriteFileItem{ favorite_file_id:int, source_space_id:int, source_file_id:int, title:str, file_name:str, status:Literal["valid","invalid"], updated_at:str }`
  - `ShougangPortalFavoriteFilesResp{ data:list[ShougangPortalFavoriteFileItem], total:int, page:int=1, page_size:int=20 }`
  - `ShougangPortalFavoriteSpaceResp{ space_id:int, name:str }`

- [ ] **Step 1: 写失败测试**

```python
# src/backend/test/test_favorite_schema.py
import pytest
from pydantic import ValidationError
from bisheng.knowledge.domain.schemas.knowledge_space_schema import (
    ShougangPortalFavoriteCreateReq,
    ShougangPortalFavoriteRemoveReq,
    ShougangPortalFavoriteStatusReq,
    ShougangPortalFavoriteFileItem,
)


def test_create_req_drops_target_space_id():
    req = ShougangPortalFavoriteCreateReq(source_space_id=1, source_file_id=2)
    assert req.source_space_id == 1 and req.source_file_id == 2
    assert not hasattr(req, "target_space_id")


def test_create_req_rejects_non_positive():
    with pytest.raises(ValidationError):
        ShougangPortalFavoriteCreateReq(source_space_id=0, source_file_id=2)


def test_status_req_parses_items():
    req = ShougangPortalFavoriteStatusReq(items=[{"space_id": 1, "file_id": 9}])
    assert req.items[0].file_id == 9


def test_file_item_status_literal():
    item = ShougangPortalFavoriteFileItem(
        favorite_file_id=5, source_space_id=1, source_file_id=2,
        title="t", file_name="t.pdf", status="invalid", updated_at="",
    )
    assert item.status == "invalid"
    with pytest.raises(ValidationError):
        ShougangPortalFavoriteFileItem(
            favorite_file_id=5, source_space_id=1, source_file_id=2,
            title="t", file_name="t.pdf", status="weird", updated_at="",
        )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_favorite_schema.py -v`
Expected: FAIL（新 schema 不存在 / 旧 Req 仍要求 `target_space_id`）

- [ ] **Step 3: 实现 schema**

在 `knowledge_space_schema.py` 顶部确认 `from typing import Literal` 已导入（否则补充）。替换旧 `ShougangPortalFavoriteCreateReq`，并新增其余类：

```python
class ShougangPortalFavoriteCreateReq(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)


class ShougangPortalFavoriteCreateResp(BaseModel):
    favorite_file_id: int
    space_id: int
    source_space_id: int
    source_file_id: int
    title: str = ""


class ShougangPortalFavoriteRemoveReq(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)


class ShougangPortalFavoriteRemoveResp(BaseModel):
    removed: bool = False


class ShougangPortalFavoriteStatusItem(BaseModel):
    space_id: int = Field(..., gt=0)
    file_id: int = Field(..., gt=0)


class ShougangPortalFavoriteStatusReq(BaseModel):
    items: list[ShougangPortalFavoriteStatusItem] = Field(default_factory=list)


class ShougangPortalFavoriteStatusResultItem(BaseModel):
    space_id: int
    file_id: int
    favorited: bool = False


class ShougangPortalFavoriteStatusResp(BaseModel):
    data: list[ShougangPortalFavoriteStatusResultItem] = Field(default_factory=list)


class ShougangPortalFavoriteFileItem(BaseModel):
    favorite_file_id: int
    source_space_id: int
    source_file_id: int
    title: str = ""
    file_name: str = ""
    status: Literal["valid", "invalid"] = "valid"
    updated_at: str = ""


class ShougangPortalFavoriteFilesResp(BaseModel):
    data: list[ShougangPortalFavoriteFileItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class ShougangPortalFavoriteSpaceResp(BaseModel):
    space_id: int
    name: str = "我的收藏"
```

> 旧 `ShougangPortalFavoriteCreateResp` 若已存在，按上面新结构覆盖（增加 `favorite_file_id/source_*` 字段）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_favorite_schema.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/domain/schemas/knowledge_space_schema.py \
        src/backend/test/test_favorite_schema.py
git commit -m "feat(knowledge): add favorite request/response schemas"
```

---

### Task A3: 收藏库懒创建 `_ensure_favorite_space`

**Files:**
- Modify: `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py`（新增私有方法，建议紧邻 `get_shougang_portal_personal_spaces`，约 `:2208` 之后）
- Test: `src/backend/test/test_favorite_service.py`

**Interfaces:**
- Produces: `async def _ensure_favorite_space(self) -> Knowledge` — 返回当前 `self.login_user.user_id` 的 `is_favorite=True` 个人知识库；不存在则创建（type=SPACE，PERSONAL scope，名称`我的收藏`，`is_favorite=True`）并返回。幂等：并发/重复调用只保留一个。
- Consumes: `self.login_user.user_id`、现有"创建个人空间"的内部能力（参考 `create_*` 空间方法）、`KnowledgeDao`。

- [ ] **Step 1: 写失败测试**

```python
# src/backend/test/test_favorite_service.py
import pytest
from unittest.mock import AsyncMock, patch
from bisheng.knowledge.domain.models.knowledge import Knowledge
from bisheng.knowledge.domain.services.knowledge_space_service import KnowledgeSpaceService


def _make_service(user_id=7):
    svc = KnowledgeSpaceService.__new__(KnowledgeSpaceService)
    svc.login_user = type("U", (), {"user_id": user_id, "user_name": "u", "tenant_id": 1})()
    return svc


@pytest.mark.asyncio
async def test_ensure_favorite_space_returns_existing():
    svc = _make_service()
    existing = Knowledge(id=100, name="我的收藏", user_id=7, type=3, is_favorite=True)
    with patch.object(KnowledgeSpaceService, "_find_favorite_space",
                      new=AsyncMock(return_value=existing)) as finder, \
         patch.object(KnowledgeSpaceService, "_create_favorite_space",
                      new=AsyncMock()) as creator:
        space = await svc._ensure_favorite_space()
        assert space.id == 100
        creator.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_favorite_space_creates_when_missing():
    svc = _make_service()
    created = Knowledge(id=101, name="我的收藏", user_id=7, type=3, is_favorite=True)
    with patch.object(KnowledgeSpaceService, "_find_favorite_space",
                      new=AsyncMock(return_value=None)), \
         patch.object(KnowledgeSpaceService, "_create_favorite_space",
                      new=AsyncMock(return_value=created)) as creator:
        space = await svc._ensure_favorite_space()
        assert space.id == 101
        creator.assert_awaited_once()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_favorite_service.py -v`
Expected: FAIL（`_ensure_favorite_space`/`_find_favorite_space`/`_create_favorite_space` 不存在）

- [ ] **Step 3: 实现方法**

在 `KnowledgeSpaceService` 内新增（`_create_favorite_space` 复用现有创建 PERSONAL 空间的内部流程——执行时打开本服务里现有的"创建空间"方法，按其真实签名调用并把 `is_favorite=True` 落库）：

```python
    FAVORITE_SPACE_NAME = "我的收藏"

    async def _find_favorite_space(self) -> Optional[Knowledge]:
        return await KnowledgeDao.aget_user_favorite_space(self.login_user.user_id)

    async def _create_favorite_space(self) -> Knowledge:
        # 复用现有个人空间创建路径；落 is_favorite=True、PERSONAL scope。
        # 注意：执行时对照本文件已有的 create_knowledge_space / 个人空间创建方法签名。
        return await KnowledgeDao.acreate_favorite_space(
            user_id=self.login_user.user_id,
            tenant_id=getattr(self.login_user, "tenant_id", 1),
            name=self.FAVORITE_SPACE_NAME,
        )

    async def _ensure_favorite_space(self) -> Knowledge:
        existing = await self._find_favorite_space()
        if existing:
            return existing
        try:
            return await self._create_favorite_space()
        except Exception:
            # 并发下另一个请求已创建，回查兜底，保证幂等
            again = await self._find_favorite_space()
            if again:
                return again
            raise
```

并在 `KnowledgeDao` 中实现 `aget_user_favorite_space(user_id)`（查询 `is_favorite=True AND user_id=? AND type=SPACE`，返回单条）与 `acreate_favorite_space(...)`（创建 Knowledge 行 + PERSONAL `KnowledgeSpaceScope` + 必要的成员/权限初始化，参考现有创建个人空间的实现）。`KnowledgeDao` 路径：`src/backend/bisheng/knowledge/domain/dao/`（执行时定位真实文件）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_favorite_service.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py \
        src/backend/bisheng/knowledge/domain/dao/ \
        src/backend/test/test_favorite_service.py
git commit -m "feat(knowledge): lazily ensure per-user favorite space"
```

---

### Task A4: 引用式添加收藏（改造 `create_shougang_portal_favorite`）

**Files:**
- Modify: `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py:2238-2299`（替换复制逻辑为引用逻辑）
- Modify: `src/backend/bisheng/knowledge/api/endpoints/shougang_portal.py:56-66`（响应字段对齐新 Resp）
- Test: `src/backend/test/test_favorite_service.py`（追加）

**Interfaces:**
- Consumes: `_ensure_favorite_space()`（A3）、新 `ShougangPortalFavoriteCreateReq/Resp`（A2）。
- Produces: `async def create_shougang_portal_favorite(req) -> ShougangPortalFavoriteCreateResp` — 幂等：已收藏同一 `(user, source_space, source_file)` 返回既有引用；否则在收藏库创建一条引用型 `KnowledgeFile`（`file_source='favorite_reference'`，`user_metadata={'favorite_reference': {'source_space_id','source_file_id'}}`，不拷贝内容/不进向量库），返回引用信息。

- [ ] **Step 1: 写失败测试（追加到 test_favorite_service.py）**

```python
@pytest.mark.asyncio
async def test_create_favorite_is_idempotent():
    from bisheng.knowledge.domain.schemas.knowledge_space_schema import ShougangPortalFavoriteCreateReq
    from bisheng.knowledge.domain.models.knowledge_file import KnowledgeFile
    svc = _make_service()
    fav_space = Knowledge(id=200, name="我的收藏", user_id=7, type=3, is_favorite=True)
    existing_ref = KnowledgeFile(id=999, knowledge_id=200, user_id=7, file_name="doc.pdf",
                                 user_metadata={"favorite_reference": {"source_space_id": 1, "source_file_id": 2}})
    with patch.object(KnowledgeSpaceService, "_ensure_favorite_space", new=AsyncMock(return_value=fav_space)), \
         patch.object(KnowledgeSpaceService, "_find_favorite_reference", new=AsyncMock(return_value=existing_ref)), \
         patch.object(KnowledgeSpaceService, "_require_permission_id", new=AsyncMock()), \
         patch("bisheng.knowledge.domain.services.knowledge_space_service.KnowledgeFileDao.query_by_id",
               new=AsyncMock(return_value=KnowledgeFile(id=2, knowledge_id=1, user_id=3, file_name="doc.pdf"))), \
         patch.object(KnowledgeSpaceService, "_create_favorite_reference", new=AsyncMock()) as creator:
        resp = await svc.create_shougang_portal_favorite(
            ShougangPortalFavoriteCreateReq(source_space_id=1, source_file_id=2))
        assert resp.favorite_file_id == 999
        assert resp.space_id == 200
        creator.assert_not_called()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_favorite_service.py::test_create_favorite_is_idempotent -v`
Expected: FAIL

- [ ] **Step 3: 改造实现**

将 `create_shougang_portal_favorite` 重写为引用式（删除 `_copy_shougang_portal_favorite_file` 调用路径；该私有方法若不再被任何处引用则一并删除）：

```python
    async def create_shougang_portal_favorite(
        self,
        req: ShougangPortalFavoriteCreateReq,
    ) -> ShougangPortalFavoriteCreateResp:
        source_space = await KnowledgeDao.aquery_by_id(req.source_space_id)
        if not source_space or source_space.type != KnowledgeTypeEnum.SPACE.value:
            raise SpaceNotFoundError()
        source_file = await KnowledgeFileDao.query_by_id(req.source_file_id)
        source_file = self._ensure_space_file(source_file, req.source_space_id)
        await self._require_permission_id(
            'knowledge_file', req.source_file_id, 'view_file', space_id=req.source_space_id)

        fav_space = await self._ensure_favorite_space()

        existing = await self._find_favorite_reference(
            fav_space.id, req.source_space_id, req.source_file_id)
        if existing:
            title = Path(existing.file_name or source_file.file_name or '').stem
            return ShougangPortalFavoriteCreateResp(
                favorite_file_id=int(existing.id), space_id=int(fav_space.id),
                source_space_id=req.source_space_id, source_file_id=req.source_file_id, title=title)

        ref_file = await self._create_favorite_reference(
            fav_space=fav_space, source_space=source_space, source_file=source_file)
        await KnowledgeDao.async_update_knowledge_update_time_by_id(fav_space.id)
        title = Path(ref_file.file_name or source_file.file_name or '').stem
        return ShougangPortalFavoriteCreateResp(
            favorite_file_id=int(ref_file.id), space_id=int(fav_space.id),
            source_space_id=req.source_space_id, source_file_id=req.source_file_id, title=title)
```

新增辅助方法：

```python
    @staticmethod
    def _favorite_ref_meta(source_space_id: int, source_file_id: int) -> dict:
        return {'favorite_reference': {'source_space_id': source_space_id, 'source_file_id': source_file_id}}

    async def _find_favorite_reference(self, fav_space_id, source_space_id, source_file_id):
        return await KnowledgeFileDao.aget_favorite_reference(
            knowledge_id=fav_space_id, source_space_id=source_space_id, source_file_id=source_file_id)

    async def _create_favorite_reference(self, fav_space, source_space, source_file):
        ref = KnowledgeFile(
            knowledge_id=int(fav_space.id),
            user_id=self.login_user.user_id,
            file_name=source_file.file_name,
            file_type=source_file.file_type,
            md5=source_file.md5,
            status=KnowledgeFileStatus.SUCCESS.value,
            file_source='favorite_reference',
            user_metadata=self._favorite_ref_meta(int(source_space.id), int(source_file.id)),
        )
        return await KnowledgeFileDao.ainsert(ref)
```

`KnowledgeFileDao.aget_favorite_reference(...)`：按 `knowledge_id` + `user_metadata->favorite_reference.source_space_id/source_file_id` 查询单条（SQLite/MySQL JSON 查询；若 JSON 查询不便，可在引用行落一个可索引列或对该空间下文件逐条匹配 metadata——执行时按仓库 DAO 习惯实现）。`ainsert` 用现有插入方法名（若不同，对齐真实 DAO）。

并更新端点 `shougang_portal.py:56-66`：`ShougangPortalFavoriteCreateResp(**raw)` 已自动对齐新字段，无需结构性改动；确认 import 仍有效。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_favorite_service.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py \
        src/backend/bisheng/knowledge/domain/dao/ \
        src/backend/test/test_favorite_service.py
git commit -m "feat(knowledge): store favorites as references instead of copies"
```

---

### Task A5: 取消收藏 + 批量状态 + 列表（含失效判定）服务方法

**Files:**
- Modify: `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py`
- Test: `src/backend/test/test_favorite_service.py`（追加）

**Interfaces:**
- Produces:
  - `async def remove_shougang_portal_favorite(req: ShougangPortalFavoriteRemoveReq) -> ShougangPortalFavoriteRemoveResp` — 删除当前用户收藏库中匹配 `(source_space_id, source_file_id)` 的引用行；不存在返回 `removed=False`，存在删除后 `removed=True`（幂等）。
  - `async def get_shougang_portal_favorite_status(req: ShougangPortalFavoriteStatusReq) -> ShougangPortalFavoriteStatusResp` — 批量返回每个 `(space_id,file_id)` 是否已被当前用户收藏；用户无收藏库时全部 `favorited=False`。
  - `async def list_shougang_portal_favorites(page:int, page_size:int) -> ShougangPortalFavoriteFilesResp` — 列出收藏库引用行；对每行解析 `favorite_reference`，校验源文件是否存在以判定 `status`。
- Consumes: A2 schema、A3 `_ensure_favorite_space`/`_find_favorite_space`。

- [ ] **Step 1: 写失败测试（追加）**

```python
@pytest.mark.asyncio
async def test_status_marks_favorited():
    from bisheng.knowledge.domain.schemas.knowledge_space_schema import ShougangPortalFavoriteStatusReq
    svc = _make_service()
    fav_space = Knowledge(id=200, name="我的收藏", user_id=7, type=3, is_favorite=True)
    with patch.object(KnowledgeSpaceService, "_find_favorite_space", new=AsyncMock(return_value=fav_space)), \
         patch("bisheng.knowledge.domain.services.knowledge_space_service.KnowledgeFileDao.alist_favorite_pairs",
               new=AsyncMock(return_value={(1, 2)})):
        resp = await svc.get_shougang_portal_favorite_status(
            ShougangPortalFavoriteStatusReq(items=[{"space_id": 1, "file_id": 2}, {"space_id": 1, "file_id": 3}]))
        by_file = {(d.space_id, d.file_id): d.favorited for d in resp.data}
        assert by_file[(1, 2)] is True
        assert by_file[(1, 3)] is False


@pytest.mark.asyncio
async def test_status_no_space_all_false():
    from bisheng.knowledge.domain.schemas.knowledge_space_schema import ShougangPortalFavoriteStatusReq
    svc = _make_service()
    with patch.object(KnowledgeSpaceService, "_find_favorite_space", new=AsyncMock(return_value=None)):
        resp = await svc.get_shougang_portal_favorite_status(
            ShougangPortalFavoriteStatusReq(items=[{"space_id": 1, "file_id": 2}]))
        assert resp.data[0].favorited is False


@pytest.mark.asyncio
async def test_list_marks_invalid_when_source_deleted():
    svc = _make_service()
    from bisheng.knowledge.domain.models.knowledge_file import KnowledgeFile
    fav_space = Knowledge(id=200, name="我的收藏", user_id=7, type=3, is_favorite=True)
    ref = KnowledgeFile(id=999, knowledge_id=200, user_id=7, file_name="doc.pdf",
                        user_metadata={"favorite_reference": {"source_space_id": 1, "source_file_id": 2}})
    with patch.object(KnowledgeSpaceService, "_find_favorite_space", new=AsyncMock(return_value=fav_space)), \
         patch("bisheng.knowledge.domain.services.knowledge_space_service.KnowledgeFileDao.alist_by_knowledge_id",
               new=AsyncMock(return_value=([ref], 1))), \
         patch("bisheng.knowledge.domain.services.knowledge_space_service.KnowledgeFileDao.aexists_active",
               new=AsyncMock(return_value=False)):
        resp = await svc.list_shougang_portal_favorites(page=1, page_size=20)
        assert resp.data[0].status == "invalid"
        assert resp.total == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_favorite_service.py -k "status or invalid" -v`
Expected: FAIL

- [ ] **Step 3: 实现方法**

```python
    async def remove_shougang_portal_favorite(
        self, req: ShougangPortalFavoriteRemoveReq) -> ShougangPortalFavoriteRemoveResp:
        fav_space = await self._find_favorite_space()
        if not fav_space:
            return ShougangPortalFavoriteRemoveResp(removed=False)
        ref = await self._find_favorite_reference(fav_space.id, req.source_space_id, req.source_file_id)
        if not ref:
            return ShougangPortalFavoriteRemoveResp(removed=False)
        await KnowledgeFileDao.adelete_by_id(int(ref.id))
        await KnowledgeDao.async_update_knowledge_update_time_by_id(fav_space.id)
        return ShougangPortalFavoriteRemoveResp(removed=True)

    async def get_shougang_portal_favorite_status(
        self, req: ShougangPortalFavoriteStatusReq) -> ShougangPortalFavoriteStatusResp:
        fav_space = await self._find_favorite_space()
        favored: set[tuple[int, int]] = set()
        if fav_space:
            favored = await KnowledgeFileDao.alist_favorite_pairs(fav_space.id)
        data = [
            ShougangPortalFavoriteStatusResultItem(
                space_id=it.space_id, file_id=it.file_id,
                favorited=(it.space_id, it.file_id) in favored)
            for it in req.items
        ]
        return ShougangPortalFavoriteStatusResp(data=data)

    async def list_shougang_portal_favorites(
        self, page: int = 1, page_size: int = 20) -> ShougangPortalFavoriteFilesResp:
        fav_space = await self._find_favorite_space()
        if not fav_space:
            return ShougangPortalFavoriteFilesResp(data=[], total=0, page=page, page_size=page_size)
        rows, total = await KnowledgeFileDao.alist_by_knowledge_id(fav_space.id, page=page, page_size=page_size)
        data: list[ShougangPortalFavoriteFileItem] = []
        for ref in rows:
            meta = (ref.user_metadata or {}).get('favorite_reference') or {}
            src_space = int(meta.get('source_space_id') or 0)
            src_file = int(meta.get('source_file_id') or 0)
            alive = await KnowledgeFileDao.aexists_active(src_file, src_space)
            data.append(ShougangPortalFavoriteFileItem(
                favorite_file_id=int(ref.id), source_space_id=src_space, source_file_id=src_file,
                title=Path(ref.file_name or '').stem, file_name=str(ref.file_name or ''),
                status='valid' if alive else 'invalid',
                updated_at=self._serialize_datetime(getattr(ref, 'update_time', None))))
        return ShougangPortalFavoriteFilesResp(data=data, total=total, page=page, page_size=page_size)
```

需要的 `KnowledgeFileDao` 方法（按仓库现状对齐命名/实现）：`adelete_by_id`、`alist_favorite_pairs(knowledge_id) -> set[(source_space_id, source_file_id)]`、`alist_by_knowledge_id(knowledge_id, page, page_size) -> (rows, total)`、`aexists_active(file_id, space_id) -> bool`（源文件存在且未删除：依据现有删除约定——若按 `status`/物理删除，`aexists_active` 用 `query_by_id` 是否为 None 判断即可）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_favorite_service.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py \
        src/backend/bisheng/knowledge/domain/dao/ \
        src/backend/test/test_favorite_service.py
git commit -m "feat(knowledge): add remove/status/list favorite service methods"
```

---

### Task A6: 保护收藏库不可删除/重命名

**Files:**
- Modify: `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py:4253-4315`（`delete_space`）与 `:4317-4402`（`update_knowledge_space`）
- Test: `src/backend/test/test_favorite_protection.py`

**Interfaces:**
- Produces: `delete_space` 在目标 `space.is_favorite` 时抛保护错误；`update_knowledge_space` 在目标 `is_favorite` 且请求修改 `name` 时抛保护错误。
- 错误类型：复用现有错误码体系，新增 `FavoriteSpaceProtectedError`（继承现有 `BaseErrorCode`，见 `src/backend/bisheng/common/errcode/`）。

- [ ] **Step 1: 写失败测试**

```python
# src/backend/test/test_favorite_protection.py
import pytest
from unittest.mock import AsyncMock, patch
from bisheng.knowledge.domain.models.knowledge import Knowledge
from bisheng.knowledge.domain.services.knowledge_space_service import KnowledgeSpaceService


def _svc():
    s = KnowledgeSpaceService.__new__(KnowledgeSpaceService)
    s.login_user = type("U", (), {"user_id": 7, "user_name": "u", "tenant_id": 1})()
    return s


@pytest.mark.asyncio
async def test_delete_favorite_space_blocked():
    svc = _svc()
    fav = Knowledge(id=200, name="我的收藏", user_id=7, type=3, is_favorite=True)
    with patch("bisheng.knowledge.domain.services.knowledge_space_service.KnowledgeDao.aquery_by_id",
               new=AsyncMock(return_value=fav)):
        with pytest.raises(Exception) as ei:
            await svc.delete_space(200)
        assert "收藏" in str(ei.value) or "favorite" in str(ei.value).lower()


@pytest.mark.asyncio
async def test_rename_favorite_space_blocked():
    svc = _svc()
    fav = Knowledge(id=200, name="我的收藏", user_id=7, type=3, is_favorite=True)
    with patch("bisheng.knowledge.domain.services.knowledge_space_service.KnowledgeDao.aquery_by_id",
               new=AsyncMock(return_value=fav)):
        with pytest.raises(Exception):
            await svc.update_knowledge_space(space_id=200, name="改个名")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_favorite_protection.py -v`
Expected: FAIL（当前无保护，删除/改名会走正常逻辑）

- [ ] **Step 3: 加保护**

新增错误码 `src/backend/bisheng/common/errcode/knowledge.py`（或现有收藏/知识库错误码文件）：

```python
class FavoriteSpaceProtectedError(BaseErrorCode):
    Code: int = <按现有错误码段取值>
    Msg: str = "『我的收藏』为系统知识库，不可删除或重命名"
```

在 `delete_space` 取到 `space`（现有 `:4254-4256` 已查 `space` 并校验 `type==SPACE`）后立即加：

```python
        if getattr(space, 'is_favorite', False):
            raise FavoriteSpaceProtectedError()
```

在 `update_knowledge_space` 取到 `space` 后（现有 `:4330-4332`），仅当本次会修改名称时拦截：

```python
        if getattr(space, 'is_favorite', False) and name is not None and name != space.name:
            raise FavoriteSpaceProtectedError()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_favorite_protection.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py \
        src/backend/bisheng/common/errcode/ \
        src/backend/test/test_favorite_protection.py
git commit -m "feat(knowledge): protect favorite space from delete/rename"
```

---

### Task A7: 新增收藏端点（remove / status / files）+ personal-spaces 暴露 is_favorite

**Files:**
- Modify: `src/backend/bisheng/knowledge/api/endpoints/shougang_portal.py`（新增 3 端点）
- Modify: `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py:2189-2208`（`get_shougang_portal_personal_spaces` 增加 `is_favorite` 字段、收藏库排首位）
- Modify: `src/backend/bisheng/knowledge/domain/schemas/knowledge_space_schema.py`（`ShougangPortalPersonalSpaceItemResp` 增加 `is_favorite: bool=False`）
- Test: `src/backend/test/test_shougang_portal_endpoint.py`

**Interfaces:**
- Produces 端点：`POST /favorites/remove`、`POST /favorites/status`、`GET /favorites/files`；`GET /personal-spaces` 每项新增 `is_favorite`。
- Consumes：A5 服务方法、A2 schema。

- [ ] **Step 1: 写失败测试（端点级，沿用本文件现有 TestClient/mock 风格）**

```python
def test_favorite_status_endpoint(client, mock_service):
    mock_service.get_shougang_portal_favorite_status.return_value = type(
        "R", (), {"model_dump": lambda self: {"data": [{"space_id": 1, "file_id": 2, "favorited": True}]}})()
    r = client.post("/api/v1/knowledge/shougang-portal/favorites/status",
                    json={"items": [{"space_id": 1, "file_id": 2}]})
    assert r.status_code == 200
    assert r.json()["data"]["data"][0]["favorited"] is True


def test_favorite_remove_endpoint(client, mock_service):
    mock_service.remove_shougang_portal_favorite.return_value = type(
        "R", (), {"model_dump": lambda self: {"removed": True}})()
    r = client.post("/api/v1/knowledge/shougang-portal/favorites/remove",
                    json={"source_space_id": 1, "source_file_id": 2})
    assert r.status_code == 200
    assert r.json()["data"]["removed"] is True
```

> 若本测试文件用的是别的 fixture 命名，按现状对齐；保持与现有 `favorites` 端点测试同形。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src/backend && python -m pytest test/test_shougang_portal_endpoint.py -k favorite -v`
Expected: FAIL（端点不存在 404）

- [ ] **Step 3: 实现端点**

在 `shougang_portal.py` 的 import 块补充 `ShougangPortalFavoriteRemoveReq/Resp, ShougangPortalFavoriteStatusReq/Resp, ShougangPortalFavoriteFilesResp`，并在 `create_shougang_portal_favorite` 端点后新增：

```python
@router.post('/favorites/remove')
async def remove_shougang_portal_favorite(
        req: ShougangPortalFavoriteRemoveReq,
        svc: Any = Depends(get_knowledge_space_service),
) -> Any:
    try:
        result = await svc.remove_shougang_portal_favorite(req)
        raw = result.model_dump() if hasattr(result, 'model_dump') else result
        return resp_200(ShougangPortalFavoriteRemoveResp(**raw).model_dump(mode='json'))
    except BaseErrorCode as exc:
        return exc.return_resp_instance()


@router.post('/favorites/status')
async def get_shougang_portal_favorite_status(
        req: ShougangPortalFavoriteStatusReq,
        svc: Any = Depends(get_knowledge_space_service),
) -> Any:
    result = await svc.get_shougang_portal_favorite_status(req)
    raw = result.model_dump() if hasattr(result, 'model_dump') else result
    return resp_200(ShougangPortalFavoriteStatusResp(**raw).model_dump(mode='json'))


@router.get('/favorites/files')
async def list_shougang_portal_favorites(
        page: int = 1,
        page_size: int = 20,
        svc: Any = Depends(get_knowledge_space_service),
) -> Any:
    result = await svc.list_shougang_portal_favorites(page=page, page_size=page_size)
    raw = result.model_dump() if hasattr(result, 'model_dump') else result
    return resp_200(ShougangPortalFavoriteFilesResp(**raw).model_dump(mode='json'))
```

`get_shougang_portal_personal_spaces`：在构造 `ShougangPortalPersonalSpaceItemResp` 时加 `is_favorite=bool(getattr(space, 'is_favorite', False))`，并把 `is_favorite=True` 的项排在列表首位（`items.sort(key=lambda x: (not x.is_favorite))`）。同时调用 `_ensure_favorite_space()` 确保收藏库存在后再返回（保证个人库列表里始终有"我的收藏"）。`ShougangPortalPersonalSpaceItemResp` 增加字段 `is_favorite: bool = False`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src/backend && python -m pytest test/test_shougang_portal_endpoint.py -k favorite -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/bisheng_2
git add src/backend/bisheng/knowledge/api/endpoints/shougang_portal.py \
        src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py \
        src/backend/bisheng/knowledge/domain/schemas/knowledge_space_schema.py \
        src/backend/test/test_shougang_portal_endpoint.py
git commit -m "feat(knowledge): expose favorite remove/status/files endpoints"
```

---

# Phase B — portal 后端 BFF

仓库根：`/Users/zhangguoqing/works/shougang-group-knowledge-portal`。后端根：`backend/app`。测试根：`backend/tests`（pytest；执行时确认实际目录）。

**Phase B 文件结构**

- 修改 `backend/app/schemas/knowledge.py` — 调整 `FavoriteDocumentRequest`（去 `target_space_id`），新增 remove/status/files schema 与 `PersonalKnowledgeSpaceItem.is_favorite`。
- 修改 `backend/app/services/knowledge_service.py` — `create_favorite` 改造 + 新增 `remove_favorite/favorite_status/list_favorites`。
- 修改 `backend/app/api/routes/knowledge.py` — `POST /favorites` 调整 + 新增 `POST /favorites/remove`、`POST /favorites/status`、`GET /favorites/files`。
- 修改/新增测试 `backend/tests/...`。

---

### Task B1: BFF schema 调整

**Files:**
- Modify: `backend/app/schemas/knowledge.py:102-125`
- Test: `backend/tests/test_knowledge_favorite_schema.py`

**Interfaces:**
- Produces:
  - `FavoriteDocumentRequest{ source_space_id:int>0, source_file_id:int>0 }`（去 `target_space_id`）
  - `FavoriteDocumentData{ favorite_file_id:int, space_id:int, source_space_id:int, source_file_id:int, title:str="" }`
  - `FavoriteRemoveRequest{ source_space_id:int>0, source_file_id:int>0 }`，`FavoriteRemoveData{ removed:bool }`
  - `FavoriteStatusItem{ space_id:int, file_id:int }`，`FavoriteStatusRequest{ items:list[FavoriteStatusItem] }`，`FavoriteStatusResultItem{ space_id:int, file_id:int, favorited:bool }`，`FavoriteStatusData{ data:list[FavoriteStatusResultItem] }`
  - `FavoriteFileItem{ favorite_file_id:int, source_space_id:int, source_file_id:int, title:str, file_name:str, status:Literal["valid","invalid"], updated_at:str }`，`FavoriteFilesData{ data:list[FavoriteFileItem], total:int, page:int=1, page_size:int=20 }`
  - `PersonalKnowledgeSpaceItem` 增加 `is_favorite: bool=False`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_knowledge_favorite_schema.py
import pytest
from pydantic import ValidationError
from app.schemas.knowledge import (
    FavoriteDocumentRequest, FavoriteStatusRequest, FavoriteFileItem, PersonalKnowledgeSpaceItem,
)


def test_request_has_no_target_space_id():
    req = FavoriteDocumentRequest(source_space_id=1, source_file_id=2)
    assert not hasattr(req, "target_space_id")


def test_status_request_parses():
    req = FavoriteStatusRequest(items=[{"space_id": 1, "file_id": 2}])
    assert req.items[0].space_id == 1


def test_personal_space_has_is_favorite_default_false():
    item = PersonalKnowledgeSpaceItem(id=1, name="x")
    assert item.is_favorite is False


def test_file_item_rejects_bad_status():
    with pytest.raises(ValidationError):
        FavoriteFileItem(favorite_file_id=1, source_space_id=1, source_file_id=2,
                         title="t", file_name="t", status="nope", updated_at="")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_knowledge_favorite_schema.py -v`
Expected: FAIL

- [ ] **Step 3: 实现 schema**

在 `backend/app/schemas/knowledge.py` 顶部确认 `from typing import Literal` 已导入。修改 `FavoriteDocumentRequest`、`FavoriteDocumentData`、`PersonalKnowledgeSpaceItem`，并追加新类：

```python
class PersonalKnowledgeSpaceItem(BaseModel):
    id: int
    name: str
    description: str = ""
    file_count: int = 0
    updated_at: str = ""
    is_favorite: bool = False


class FavoriteDocumentRequest(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)


class FavoriteDocumentData(BaseModel):
    favorite_file_id: int = 0
    space_id: int = 0
    source_space_id: int = 0
    source_file_id: int = 0
    title: str = ""


class FavoriteRemoveRequest(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)


class FavoriteRemoveData(BaseModel):
    removed: bool = False


class FavoriteStatusItem(BaseModel):
    space_id: int = Field(..., gt=0)
    file_id: int = Field(..., gt=0)


class FavoriteStatusRequest(BaseModel):
    items: list[FavoriteStatusItem] = Field(default_factory=list)


class FavoriteStatusResultItem(BaseModel):
    space_id: int
    file_id: int
    favorited: bool = False


class FavoriteStatusData(BaseModel):
    data: list[FavoriteStatusResultItem] = Field(default_factory=list)


class FavoriteFileItem(BaseModel):
    favorite_file_id: int
    source_space_id: int
    source_file_id: int
    title: str = ""
    file_name: str = ""
    status: Literal["valid", "invalid"] = "valid"
    updated_at: str = ""


class FavoriteFilesData(BaseModel):
    data: list[FavoriteFileItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_knowledge_favorite_schema.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add backend/app/schemas/knowledge.py backend/tests/test_knowledge_favorite_schema.py
git commit -m "feat(bff): adjust favorite schemas for reference model"
```

---

### Task B2: BFF service 方法（透传 bisheng_2）

**Files:**
- Modify: `backend/app/services/knowledge_service.py:280-310`（`create_favorite` 改造）及其后新增方法
- Test: `backend/tests/test_knowledge_service_favorite.py`

**Interfaces:**
- Consumes: B1 schema、`self._bisheng`（httpx 封装，已有 `get_json/post_json`）、`self._extract_success_data`。
- Produces:
  - `create_favorite(req: FavoriteDocumentRequest) -> FavoriteDocumentData`（POST `/api/v1/knowledge/shougang-portal/favorites`）
  - `remove_favorite(req: FavoriteRemoveRequest) -> FavoriteRemoveData`（POST `.../favorites/remove`）
  - `favorite_status(req: FavoriteStatusRequest) -> FavoriteStatusData`（POST `.../favorites/status`）
  - `list_favorites(page:int, page_size:int) -> FavoriteFilesData`（GET `.../favorites/files`）

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_knowledge_service_favorite.py
import pytest
from unittest.mock import AsyncMock
from app.services.knowledge_service import KnowledgeService
from app.schemas.knowledge import (
    FavoriteDocumentRequest, FavoriteRemoveRequest, FavoriteStatusRequest,
)


def _svc(payload):
    svc = KnowledgeService.__new__(KnowledgeService)
    svc._bisheng = AsyncMock()
    svc._bisheng.post_json = AsyncMock(return_value={"status_code": 200, "data": payload})
    svc._bisheng.get_json = AsyncMock(return_value={"status_code": 200, "data": payload})
    return svc


@pytest.mark.asyncio
async def test_create_favorite_maps_response():
    svc = _svc({"favorite_file_id": 9, "space_id": 200, "source_space_id": 1,
                "source_file_id": 2, "title": "doc"})
    out = await svc.create_favorite(FavoriteDocumentRequest(source_space_id=1, source_file_id=2))
    assert out.favorite_file_id == 9 and out.space_id == 200 and out.title == "doc"


@pytest.mark.asyncio
async def test_favorite_status_maps_response():
    svc = _svc({"data": [{"space_id": 1, "file_id": 2, "favorited": True}]})
    out = await svc.favorite_status(FavoriteStatusRequest(items=[{"space_id": 1, "file_id": 2}]))
    assert out.data[0].favorited is True


@pytest.mark.asyncio
async def test_remove_favorite_maps_response():
    svc = _svc({"removed": True})
    out = await svc.remove_favorite(FavoriteRemoveRequest(source_space_id=1, source_file_id=2))
    assert out.removed is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_knowledge_service_favorite.py -v`
Expected: FAIL

- [ ] **Step 3: 实现 service**

替换 `create_favorite`（去掉 `target_space_id`，映射新字段），并新增三方法：

```python
    async def create_favorite(self, req: FavoriteDocumentRequest) -> FavoriteDocumentData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites", json=req.model_dump())
        data = self._extract_success_data(response)
        return FavoriteDocumentData(
            favorite_file_id=int(data.get("favorite_file_id") or 0),
            space_id=int(data.get("space_id") or 0),
            source_space_id=int(data.get("source_space_id") or req.source_space_id),
            source_file_id=int(data.get("source_file_id") or req.source_file_id),
            title=str(data.get("title") or ""))

    async def remove_favorite(self, req: FavoriteRemoveRequest) -> FavoriteRemoveData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites/remove", json=req.model_dump())
        data = self._extract_success_data(response)
        return FavoriteRemoveData(removed=bool(data.get("removed")))

    async def favorite_status(self, req: FavoriteStatusRequest) -> FavoriteStatusData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites/status", json=req.model_dump())
        data = self._extract_success_data(response)
        raw = data.get("data") if isinstance(data, dict) else []
        items = [FavoriteStatusResultItem(
            space_id=int(it.get("space_id") or 0), file_id=int(it.get("file_id") or 0),
            favorited=bool(it.get("favorited"))) for it in (raw or []) if isinstance(it, dict)]
        return FavoriteStatusData(data=items)

    async def list_favorites(self, page: int = 1, page_size: int = 20) -> FavoriteFilesData:
        response = await self._bisheng.get_json(
            f"/api/v1/knowledge/shougang-portal/favorites/files?page={page}&page_size={page_size}")
        data = self._extract_success_data(response)
        raw = data.get("data") if isinstance(data, dict) else []
        items = [FavoriteFileItem(
            favorite_file_id=int(it.get("favorite_file_id") or 0),
            source_space_id=int(it.get("source_space_id") or 0),
            source_file_id=int(it.get("source_file_id") or 0),
            title=str(it.get("title") or ""), file_name=str(it.get("file_name") or ""),
            status=str(it.get("status") or "valid"),
            updated_at=str(it.get("updated_at") or "")) for it in (raw or []) if isinstance(it, dict)]
        return FavoriteFilesData(data=items, total=int(data.get("total") or len(items)),
                                 page=int(data.get("page") or page), page_size=int(data.get("page_size") or page_size))
```

并更新 `knowledge_service.py` 顶部 import：加入 `FavoriteRemoveRequest, FavoriteRemoveData, FavoriteStatusRequest, FavoriteStatusData, FavoriteStatusResultItem, FavoriteFilesData, FavoriteFileItem`。同时把 `list_personal_spaces` 中构造 `PersonalKnowledgeSpaceItem` 处补 `is_favorite=bool(item.get("is_favorite"))`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_knowledge_service_favorite.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add backend/app/services/knowledge_service.py backend/tests/test_knowledge_service_favorite.py
git commit -m "feat(bff): proxy favorite reference endpoints to bisheng"
```

---

### Task B3: BFF 路由（登录校验 + 4 端点）

**Files:**
- Modify: `backend/app/api/routes/knowledge.py:433-471`（`POST /favorites` 改造）及其后新增 3 路由
- Test: `backend/tests/test_knowledge_routes_favorite.py`

**Interfaces:**
- Consumes: B2 service 方法、现有 `auth_service.require_session`（未登录抛 `PortalAuthError`→HTTP 401）。
- Produces 端点：`POST /api/v1/knowledge/favorites`、`POST /favorites/remove`、`POST /favorites/status`、`GET /favorites/files`。全部要求登录态。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_knowledge_routes_favorite.py
# 使用现有 TestClient fixture（参考仓库其它 routes 测试）。验证未登录 401 与已登录透传。
def test_favorites_status_requires_login(client_anonymous):
    r = client_anonymous.post("/api/v1/knowledge/favorites/status",
                              json={"items": [{"space_id": 1, "file_id": 2}]})
    assert r.status_code == 401


def test_favorites_status_ok(client_logged_in, mock_knowledge_service):
    r = client_logged_in.post("/api/v1/knowledge/favorites/status",
                              json={"items": [{"space_id": 1, "file_id": 2}]})
    assert r.status_code == 200
```

> 若仓库尚无 `client_anonymous/client_logged_in` fixture，按现有 `knowledge` 路由测试的登录态构造方式对齐（沿用 `auth_service` 的 mock/依赖覆盖）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_knowledge_routes_favorite.py -v`
Expected: FAIL（端点不存在）

- [ ] **Step 3: 实现路由**

`POST /favorites` 改造：去掉对 `target_space_id` 的引用与遥测里的 `target_space_id` 字段；其余沿用现有 `require_session` + 遥测结构。新增 3 路由（沿用现有 `create_favorite` 的 session/异常处理骨架）：

```python
@router.post("/favorites/remove")
async def remove_favorite(req: FavoriteRemoveRequest, request: Request,
                          auth_service: PortalAuthService = Depends(get_portal_auth_service),
                          portal_config_service: PortalConfigService = Depends(get_portal_config_service)):
    try:
        session = auth_service.require_session(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(bisheng_client=bisheng_client, portal_config_service=portal_config_service)
        return response_ok(await service.remove_favorite(req))
    finally:
        await bisheng_client.aclose()


@router.post("/favorites/status")
async def favorite_status(req: FavoriteStatusRequest, request: Request,
                          auth_service: PortalAuthService = Depends(get_portal_auth_service),
                          portal_config_service: PortalConfigService = Depends(get_portal_config_service)):
    try:
        session = auth_service.require_session(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(bisheng_client=bisheng_client, portal_config_service=portal_config_service)
        return response_ok(await service.favorite_status(req))
    finally:
        await bisheng_client.aclose()


@router.get("/favorites/files")
async def list_favorites(request: Request, page: int = 1, page_size: int = 20,
                         auth_service: PortalAuthService = Depends(get_portal_auth_service),
                         portal_config_service: PortalConfigService = Depends(get_portal_config_service)):
    try:
        session = auth_service.require_session(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(bisheng_client=bisheng_client, portal_config_service=portal_config_service)
        return response_ok(await service.list_favorites(page=page, page_size=page_size))
    finally:
        await bisheng_client.aclose()
```

更新 `knowledge.py` 顶部 import：加入 `FavoriteRemoveRequest, FavoriteStatusRequest`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_knowledge_routes_favorite.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add backend/app/api/routes/knowledge.py backend/tests/test_knowledge_routes_favorite.py
git commit -m "feat(bff): add favorite remove/status/files routes with auth"
```

---

# Phase C — portal 前端

仓库根：`/Users/zhangguoqing/works/shougang-group-knowledge-portal`。前端根：`frontend/src`。测试：Vitest（执行时确认 `frontend/package.json` 的 test 脚本与既有测试位置）。

**Phase C 文件结构**

- 修改 `frontend/src/api/content.ts` — `favoriteDocument` 改签名，新增 `removeFavorite/fetchFavoriteStatus/fetchFavoriteFiles`，`PersonalKnowledgeSpace` 增 `isFavorite`，新增 `FavoriteFile` 类型。
- 重写 `frontend/src/hooks/useFavoriteDocument.ts` — 改为两态 toggle + 批量状态管理（去弹窗主流程）。
- 修改 `frontend/src/components/FileListItem.tsx:113-126` — 收藏按钮两态、未登录隐藏。
- 修改 `frontend/src/pages/ListPage.tsx`、`frontend/src/pages/SearchPage.tsx` — 接入批量状态、toggle。
- 新增 `frontend/src/pages/FavoritesPage.tsx`（或在 ListPage 内分支）— "我的收藏"只读视图 + 失效态。
- 删除主流程对 `FavoriteDocumentModal.tsx` 的依赖（文件可保留但不再挂载）。
- 登录态来源：复用现有判定（执行时定位，如 `useAuth`/user context；若无则以"收藏接口 401"作为未登录信号）。

---

### Task C1: 前端 API 客户端调整

**Files:**
- Modify: `frontend/src/api/content.ts:669-696`（及 `PersonalKnowledgeSpace` 定义 `:83-89`）
- Test: `frontend/src/api/content.favorite.test.ts`

**Interfaces:**
- Produces:
  - `favoriteDocument({sourceSpaceId, sourceFileId}) -> {favoriteFileId, spaceId, sourceSpaceId, sourceFileId, title}`
  - `removeFavorite({sourceSpaceId, sourceFileId}) -> {removed:boolean}`
  - `fetchFavoriteStatus(items:{spaceId,fileId}[]) -> Map<string,boolean>`（key=`${spaceId}:${fileId}`）
  - `fetchFavoriteFiles({page,pageSize}) -> {data:FavoriteFile[], total, page, pageSize}`
  - `FavoriteFile{ favoriteFileId, sourceSpaceId, sourceFileId, title, fileName, status:'valid'|'invalid', updatedAt }`
  - `PersonalKnowledgeSpace` 增 `isFavorite:boolean`
  - 工具函数 `favoriteKey(spaceId, fileId): string`

- [ ] **Step 1: 写失败测试**

```ts
// frontend/src/api/content.favorite.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as content from './content';

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn();
});

describe('favorite api', () => {
  it('favoriteKey builds stable key', () => {
    expect(content.favoriteKey(1, 2)).toBe('1:2');
  });

  it('fetchFavoriteStatus maps to key->bool', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { data: [{ space_id: 1, file_id: 2, favorited: true }] } }),
    });
    const map = await content.fetchFavoriteStatus([{ spaceId: 1, fileId: 2 }]);
    expect(map.get('1:2')).toBe(true);
  });
});
```

> 若仓库 `request` 封装不直接用 `global.fetch`，按现有 content.ts 测试的 mock 方式对齐。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/api/content.favorite.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 api**

在 `content.ts` 改造/新增：

```ts
export interface FavoriteFile {
  favoriteFileId: number;
  sourceSpaceId: number;
  sourceFileId: number;
  title: string;
  fileName: string;
  status: 'valid' | 'invalid';
  updatedAt: string;
}

export function favoriteKey(spaceId: number, fileId: number): string {
  return `${spaceId}:${fileId}`;
}

export async function favoriteDocument(params: { sourceSpaceId: number; sourceFileId: number }) {
  const data = await request<any>('/api/v1/knowledge/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_space_id: params.sourceSpaceId, source_file_id: params.sourceFileId }),
  });
  return {
    favoriteFileId: data.favorite_file_id ?? 0,
    spaceId: data.space_id ?? 0,
    sourceSpaceId: data.source_space_id ?? params.sourceSpaceId,
    sourceFileId: data.source_file_id ?? params.sourceFileId,
    title: data.title ?? '',
  };
}

export async function removeFavorite(params: { sourceSpaceId: number; sourceFileId: number }) {
  const data = await request<any>('/api/v1/knowledge/favorites/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_space_id: params.sourceSpaceId, source_file_id: params.sourceFileId }),
  });
  return { removed: Boolean(data.removed) };
}

export async function fetchFavoriteStatus(items: { spaceId: number; fileId: number }[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (!items.length) return map;
  const data = await request<any>('/api/v1/knowledge/favorites/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.map((it) => ({ space_id: it.spaceId, file_id: it.fileId })) }),
  });
  for (const it of data.data ?? []) map.set(favoriteKey(it.space_id, it.file_id), Boolean(it.favorited));
  return map;
}

export async function fetchFavoriteFiles(params: { page?: number; pageSize?: number } = {}) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const data = await request<any>(`/api/v1/knowledge/favorites/files?page=${page}&page_size=${pageSize}`);
  return {
    data: (data.data ?? []).map((it: any): FavoriteFile => ({
      favoriteFileId: it.favorite_file_id, sourceSpaceId: it.source_space_id, sourceFileId: it.source_file_id,
      title: it.title ?? '', fileName: it.file_name ?? '', status: it.status === 'invalid' ? 'invalid' : 'valid',
      updatedAt: it.updated_at ?? '',
    })),
    total: data.total ?? 0, page: data.page ?? page, pageSize: data.page_size ?? pageSize,
  };
}
```

并在 `PersonalKnowledgeSpace` 接口加 `isFavorite: boolean;`，在 `mapPersonalKnowledgeSpace` 里映射 `isFavorite: Boolean(dto.is_favorite)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/api/content.favorite.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add frontend/src/api/content.ts frontend/src/api/content.favorite.test.ts
git commit -m "feat(web): favorite api client for toggle/status/list"
```

---

### Task C2: `useFavoriteDocument` 改为两态 toggle Hook

**Files:**
- Rewrite: `frontend/src/hooks/useFavoriteDocument.ts`
- Test: `frontend/src/hooks/useFavoriteDocument.test.tsx`

**Interfaces:**
- Consumes: C1 `favoriteDocument/removeFavorite/fetchFavoriteStatus/favoriteKey`。
- Produces: `useFavoriteDocument()` 返回：
  - `loadStatuses(files: {spaceId:number,id:number}[]): Promise<void>` — 批量拉状态写入内部 map
  - `isFavorited(spaceId:number, fileId:number): boolean`
  - `toggleFavorite(file: {spaceId:number,id:number}): Promise<void>` — 未收藏→收藏，已收藏→取消，乐观更新+失败回滚
  - `pending(spaceId:number, fileId:number): boolean`

- [ ] **Step 1: 写失败测试**

```tsx
// frontend/src/hooks/useFavoriteDocument.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as content from '../api/content';
import { useFavoriteDocument } from './useFavoriteDocument';

beforeEach(() => vi.restoreAllMocks());

describe('useFavoriteDocument', () => {
  it('loadStatuses then isFavorited reflects map', async () => {
    vi.spyOn(content, 'fetchFavoriteStatus').mockResolvedValue(new Map([['1:2', true]]));
    const { result } = renderHook(() => useFavoriteDocument());
    await act(async () => { await result.current.loadStatuses([{ spaceId: 1, id: 2 }]); });
    expect(result.current.isFavorited(1, 2)).toBe(true);
  });

  it('toggleFavorite adds then removes', async () => {
    vi.spyOn(content, 'favoriteDocument').mockResolvedValue({ favoriteFileId: 9, spaceId: 200, sourceSpaceId: 1, sourceFileId: 2, title: 't' });
    vi.spyOn(content, 'removeFavorite').mockResolvedValue({ removed: true });
    const { result } = renderHook(() => useFavoriteDocument());
    await act(async () => { await result.current.toggleFavorite({ spaceId: 1, id: 2 }); });
    expect(result.current.isFavorited(1, 2)).toBe(true);
    await act(async () => { await result.current.toggleFavorite({ spaceId: 1, id: 2 }); });
    expect(result.current.isFavorited(1, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/hooks/useFavoriteDocument.test.tsx`
Expected: FAIL

- [ ] **Step 3: 重写 Hook**

```ts
import { useCallback, useRef, useState } from 'react';
import { favoriteDocument, removeFavorite, fetchFavoriteStatus, favoriteKey } from '../api/content';

type FileRef = { spaceId: number; id: number };

export function useFavoriteDocument() {
  const [statusMap, setStatusMap] = useState<Map<string, boolean>>(new Map());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const mapRef = useRef(statusMap);
  mapRef.current = statusMap;

  const setKey = useCallback((key: string, val: boolean) => {
    setStatusMap((prev) => { const next = new Map(prev); next.set(key, val); return next; });
  }, []);

  const loadStatuses = useCallback(async (files: FileRef[]) => {
    if (!files.length) return;
    const map = await fetchFavoriteStatus(files.map((f) => ({ spaceId: f.spaceId, fileId: f.id })));
    setStatusMap((prev) => { const next = new Map(prev); map.forEach((v, k) => next.set(k, v)); return next; });
  }, []);

  const isFavorited = useCallback((spaceId: number, fileId: number) =>
    Boolean(mapRef.current.get(favoriteKey(spaceId, fileId))), []);

  const pending = useCallback((spaceId: number, fileId: number) =>
    pendingKeys.has(favoriteKey(spaceId, fileId)), [pendingKeys]);

  const toggleFavorite = useCallback(async (file: FileRef) => {
    const key = favoriteKey(file.spaceId, file.id);
    const wasFav = Boolean(mapRef.current.get(key));
    setPendingKeys((p) => new Set(p).add(key));
    setKey(key, !wasFav); // 乐观更新
    try {
      if (wasFav) await removeFavorite({ sourceSpaceId: file.spaceId, sourceFileId: file.id });
      else await favoriteDocument({ sourceSpaceId: file.spaceId, sourceFileId: file.id });
    } catch (err) {
      setKey(key, wasFav); // 回滚
      throw err;
    } finally {
      setPendingKeys((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  }, [setKey]);

  return { loadStatuses, isFavorited, toggleFavorite, pending };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/hooks/useFavoriteDocument.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add frontend/src/hooks/useFavoriteDocument.ts frontend/src/hooks/useFavoriteDocument.test.tsx
git commit -m "feat(web): two-state favorite toggle hook"
```

---

### Task C3: `FileListItem` 收藏按钮两态 + 未登录隐藏

**Files:**
- Modify: `frontend/src/components/FileListItem.tsx:113-126`
- Test: `frontend/src/components/FileListItem.favorite.test.tsx`

**Interfaces:**
- Consumes: 新 props `favorited?: boolean`、`canFavorite?: boolean`（=已登录且允许）、`onToggleFavorite?: (file) => void`、`favoritePending?: boolean`。
- 行为：`canFavorite===false`（未登录）→ 不渲染收藏按钮；`favorited` 控制实心/空心星与 aria-label（已收藏/收藏）。

- [ ] **Step 1: 写失败测试**

```tsx
// frontend/src/components/FileListItem.favorite.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileListItem } from './FileListItem';

const file: any = { id: 2, spaceId: 1, name: 'doc.pdf' };

describe('FileListItem favorite button', () => {
  it('hides favorite button when canFavorite is false', () => {
    render(<FileListItem file={file} canFavorite={false} onToggleFavorite={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /收藏/ })).toBeNull();
  });

  it('shows favorited state label', () => {
    render(<FileListItem file={file} canFavorite onToggleFavorite={vi.fn()} favorited />);
    expect(screen.getByRole('button', { name: '已收藏' })).toBeInTheDocument();
  });
});
```

> props 透传链：`view.actions.includes('favorite')` 仍可保留为"该视图是否展示收藏位"的开关；最终可见性 = `canFavorite && actionsIncludesFavorite`。执行时对齐组件现有 props 形态。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/FileListItem.favorite.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现按钮两态**

把 `:113-126` 的收藏按钮替换为：

```tsx
{canFavorite && view.actions.includes('favorite') && (
  <button
    type="button"
    className={favorited ? 'file-action file-action--favorited' : 'file-action'}
    aria-label={favorited ? '已收藏' : '收藏'}
    disabled={favoritePending}
    onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(file); }}
  >
    <Star fill={favorited ? 'currentColor' : 'none'} />
  </button>
)}
```

并在组件 props 类型中加入 `favorited?: boolean; canFavorite?: boolean; favoritePending?: boolean; onToggleFavorite?: (file: FileItem) => void;`。移除旧 `onFavorite` 主流程用法（如其它处仍引用，统一改为 `onToggleFavorite`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/FileListItem.favorite.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add frontend/src/components/FileListItem.tsx frontend/src/components/FileListItem.favorite.test.tsx
git commit -m "feat(web): two-state favorite button with login gating"
```

---

### Task C4: ListPage / SearchPage 接入批量状态与 toggle

**Files:**
- Modify: `frontend/src/pages/ListPage.tsx`、`frontend/src/pages/SearchPage.tsx`
- Test: `frontend/src/pages/SearchPage.favorite.test.tsx`

**Interfaces:**
- Consumes: C2 hook、C3 组件 props、现有登录态判定（`isLoggedIn`）。
- 行为：列表数据加载完成后调用 `loadStatuses(files)`；给每个 `FileListItem` 传 `canFavorite={isLoggedIn}`、`favorited={isFavorited(file.spaceId, file.id)}`、`favoritePending={pending(...)}`、`onToggleFavorite={toggleFavorite}`。

- [ ] **Step 1: 写失败测试**

```tsx
// frontend/src/pages/SearchPage.favorite.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as content from '../api/content';

it('SearchPage loads favorite statuses for results', async () => {
  const spy = vi.spyOn(content, 'fetchFavoriteStatus').mockResolvedValue(new Map());
  // 渲染 SearchPage 并注入一组结果（沿用现有页面测试的渲染/mock 方式）
  // ...render(<SearchPage .../>)
  await waitFor(() => expect(spy).toHaveBeenCalled());
});
```

> 本测试需对齐现有页面测试基建（路由、provider、数据 mock）。若现有页面无测试基建，最小实现：抽出"加载结果后批量拉状态"为可单测的小函数并测它。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/pages/SearchPage.favorite.test.tsx`
Expected: FAIL

- [ ] **Step 3: 接入**

两页改动相同模式（以 SearchPage 为例）：
1. `const { loadStatuses, isFavorited, toggleFavorite, pending } = useFavoriteDocument();`
2. 结果数据 `results` 更新后：`useEffect(() => { if (isLoggedIn && results.length) void loadStatuses(results.map(r => ({ spaceId: r.spaceId, id: r.id }))); }, [results, isLoggedIn]);`
3. 渲染 `FileListItem` 处传入：`canFavorite={isLoggedIn} favorited={isFavorited(file.spaceId, file.id)} favoritePending={pending(file.spaceId, file.id)} onToggleFavorite={toggleFavorite}`。
4. 移除原 `openFavorite`/`favoriteModalProps`/`<FavoriteDocumentModal>` 主流程挂载。

`isLoggedIn` 取自现有登录态来源（执行时定位，例如 user context / auth hook）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/pages/SearchPage.favorite.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add frontend/src/pages/ListPage.tsx frontend/src/pages/SearchPage.tsx frontend/src/pages/SearchPage.favorite.test.tsx
git commit -m "feat(web): wire favorite status+toggle into list/search pages"
```

---

### Task C5: "我的收藏"只读视图 + 失效态

**Files:**
- Create: `frontend/src/pages/FavoritesPage.tsx`
- Modify: 路由注册（执行时定位 `frontend/src/` 路由文件，如 `App.tsx`/`router.tsx`）；个人知识库列表点击 `isFavorite` 库时进入此页
- Test: `frontend/src/pages/FavoritesPage.test.tsx`

**Interfaces:**
- Consumes: C1 `fetchFavoriteFiles`、C2 `toggleFavorite`（取消收藏）。
- 行为：
  - 列表展示收藏项；`status==='invalid'` → 置灰 + "已失效"标签 + 不可打开/预览，仅"取消收藏"按钮。
  - `status==='valid'` → 可打开源文件（跳转到源知识库的文件预览，使用 `sourceSpaceId/sourceFileId`）。
  - 无任何上传/删除文件/移动/标签/问答入口（页面本身不渲染这些）。

- [ ] **Step 1: 写失败测试**

```tsx
// frontend/src/pages/FavoritesPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as content from '../api/content';
import { FavoritesPage } from './FavoritesPage';

it('renders invalid favorites as 已失效 and only allows uncollect', async () => {
  vi.spyOn(content, 'fetchFavoriteFiles').mockResolvedValue({
    data: [{ favoriteFileId: 9, sourceSpaceId: 1, sourceFileId: 2, title: 'doc', fileName: 'doc.pdf', status: 'invalid', updatedAt: '' }],
    total: 1, page: 1, pageSize: 20,
  });
  render(<FavoritesPage />);
  await waitFor(() => expect(screen.getByText('已失效')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: '取消收藏' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /上传|删除文件|移动|标签/ })).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/pages/FavoritesPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现页面**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { fetchFavoriteFiles, type FavoriteFile } from '../api/content';
import { useFavoriteDocument } from '../hooks/useFavoriteDocument';

export function FavoritesPage() {
  const [items, setItems] = useState<FavoriteFile[]>([]);
  const { toggleFavorite } = useFavoriteDocument();

  const load = useCallback(async () => {
    const res = await fetchFavoriteFiles({ page: 1, pageSize: 50 });
    setItems(res.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onUncollect = useCallback(async (it: FavoriteFile) => {
    await toggleFavorite({ spaceId: it.sourceSpaceId, id: it.sourceFileId });
    setItems((prev) => prev.filter((x) => x.favoriteFileId !== it.favoriteFileId));
  }, [toggleFavorite]);

  return (
    <div className="favorites-page">
      <h2>我的收藏</h2>
      <ul>
        {items.map((it) => (
          <li key={it.favoriteFileId} className={it.status === 'invalid' ? 'favorite-item favorite-item--invalid' : 'favorite-item'}>
            <span className="favorite-title">{it.title || it.fileName}</span>
            {it.status === 'invalid'
              ? <span className="favorite-badge">已失效</span>
              : <button type="button" onClick={() => openSourceFile(it.sourceSpaceId, it.sourceFileId)}>查看</button>}
            <button type="button" aria-label="取消收藏" onClick={() => onUncollect(it)}>取消收藏</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function openSourceFile(spaceId: number, fileId: number) {
  // 复用现有"打开/预览文件"的跳转方式（执行时对齐 ListPage 中预览源文件的导航逻辑）
  window.location.assign(`/knowledge/${spaceId}/file/${fileId}`);
}
```

> `openSourceFile` 的目标路由按现有文件预览路由对齐。失效项不渲染"查看"按钮，从而不可打开/预览。

注册路由：在前端路由表新增 `/favorites`（或个人库点击 `isFavorite` 项时导航到此页）。个人知识库列表渲染处：当某 space `isFavorite` 为真，点击进入 `FavoritesPage` 而非普通 `ListPage`，并隐藏该库的删除/重命名/上传等入口。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/pages/FavoritesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add frontend/src/pages/FavoritesPage.test.tsx frontend/src/pages/FavoritesPage.tsx frontend/src/
git commit -m "feat(web): read-only favorites page with invalid state"
```

---

### Task C6: 个人知识库列表对收藏库施加只读限制（前端兜底）

**Files:**
- Modify: 个人知识库列表/详情入口组件（执行时定位，搜索 `personal`/`isFavorite`/知识库卡片操作菜单）
- Test: 对应组件测试

**Interfaces:**
- 行为：当知识库 `isFavorite===true`：隐藏删除、重命名、上传、移动、标签编辑、关联新版本、问答等所有写操作入口；点击该库进入 `FavoritesPage`。

- [ ] **Step 1: 写失败测试**

```tsx
// 针对知识库卡片/操作菜单组件
import { render, screen } from '@testing-library/react';
it('hides write actions for favorite space', () => {
  render(<SpaceActions space={{ id: 200, name: '我的收藏', isFavorite: true } as any} />);
  expect(screen.queryByRole('button', { name: /删除|重命名|上传/ })).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run <对应测试文件>`
Expected: FAIL

- [ ] **Step 3: 实现限制**

在知识库卡片/操作菜单组件渲染写操作入口处，包一层 `{!space.isFavorite && (...写操作入口...)}`；点击 `isFavorite` 库的导航目标改为 `/favorites`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run <对应测试文件>`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /Users/zhangguoqing/works/shougang-group-knowledge-portal
git add frontend/src/
git commit -m "feat(web): restrict favorite space to read-only in space list"
```

---

## 收尾验证（实现完成后）

- [ ] bisheng_2：`cd src/backend && python -m pytest test/test_favorite_service.py test/test_favorite_protection.py test/test_shougang_portal_endpoint.py -v` 全绿。
- [ ] portal 后端：`cd backend && python -m pytest tests/ -k favorite -v` 全绿。
- [ ] portal 前端：`cd frontend && npx vitest run` 收藏相关测试全绿；`npx tsc --noEmit` 无类型错误。
- [ ] 手动按 PRD 第 8 节验收标准 1–6 逐条走查（登录/未登录、toggle 一致性、失效态、只读限制）。

## 风险与执行注意

1. **bisheng_2 DAO 细节**：本计划中的 `KnowledgeFileDao.aget_favorite_reference / alist_favorite_pairs / aexists_active / adelete_by_id` 等方法名按命名约定给出，执行 A3–A5 时须对照真实 DAO 文件确认/新增实现，保持签名与本计划一致（供后续 Task 复用）。
2. **失效判定口径**：`aexists_active` 必须与 bisheng_2 现有"文件删除"约定一致（物理删除则 `query_by_id is None`；软删除则按状态/删除标记）。先确认删除实现再写此方法。
3. **历史数据**：旧"复制副本"式收藏不自动迁移（见 PRD 第 7 节）；本次新逻辑只对新收藏生效，需在上线说明中告知。
4. **登录态来源**：前端 `isLoggedIn` 取现有 auth 来源；若无显式状态，可用"收藏接口返回 401"作为兜底信号并隐藏按钮。
5. **执行顺序**：必须 A → B → C，契约（本文件"API 契约"段）为三端唯一真源。
