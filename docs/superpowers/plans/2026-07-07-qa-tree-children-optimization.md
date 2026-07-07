# QA 树 children 接口优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在业务语义完全不变的前提下，优化门户 QA 树 children 接口：信任上游鉴权（去重复拉取）、修分页内部正确性、上游轻量富化。

**Architecture:** 门户 FastAPI 代理层调用 BiSheng 后端 `/children`。改动分两个仓库：BiSheng 上游新增 `enrich_files` 可选参数（默认保持现状）跳过 QA 树用不到的文件富化；门户去掉已登录分支的全量空间预检，改为信任上游鉴权并翻译上游业务错误码为 403，同时修正分页字段并传 `enrich_files=false`。

**Tech Stack:** Python 3 / FastAPI / SQLModel / pytest（asyncio_mode=auto）。门户仓库 `shougang-group-knowledge-portal`，上游仓库 `bisheng_2`。

## Global Constraints

- **业务语义不变**：返回结构、错误 HTTP 码与文案、文件夹精确文件数（`resolved_file_count` = 上游 `visible_success_file_num`）一律保持一致。
- **不改前端**：`frontend/` 一律不动（保持不翻页、不消费 total/page）。
- **BiSheng `enrich_files` 默认值必须为 `True`**（保持现有全富化，其他调用方零影响）。
- **folder counts 不降级成布尔**：`include_folder_counts=True` 与精确 `visible_success_file_num` 保留。
- 上游权限拒绝码 = `18040`（`SpacePermissionDeniedError`）、空间不存在码 = `18000`（`SpaceNotFoundError`），经 HTTP 200 + body `{status_code}` 返回。
- 门户测试命令：在 `shougang-group-knowledge-portal/backend/` 下 `./.venv/bin/python -m pytest`。
- BiSheng 测试命令：在 `bisheng_2/src/backend/` 下 `.venv/bin/python -m pytest`。BiSheng 测试基线存在既有失败用例，只需关注本计划新增/相关用例通过。
- 部署顺序：**BiSheng（Task 1）先上线**，门户（Task 2）再上线（门户传 `enrich_files=false`，上游未识别时会被忽略、行为等同现状，故顺序不阻塞但推荐如此）。

---

### Task 1: BiSheng 上游新增 `enrich_files` 参数（跳过文件富化）

**仓库/工作目录：** `bisheng_2/src/backend/`

**Files:**
- Modify: `bisheng/knowledge/domain/services/knowledge_space_service.py`
  - `list_space_children`（约 `:7143`）：新增 `enrich_files: bool = True`，据此决定是否 `_enrich_with_version_info`，并透传给 `_handle_file_folder_extra_info`。
  - `_handle_file_folder_extra_info`（约 `:6940`）：新增关键字参数 `enrich_files: bool = True`，为 `False` 时跳过文件 tags/缩略图/summary/版本字段。
- Modify: `bisheng/knowledge/api/endpoints/knowledge_space.py`
  - `list_space_children` 端点（约 `:442`）：新增 `enrich_files: bool = Query(default=True, ...)`，透传给 service。
- Test: `test/knowledge/test_children_enrich_files_param.py`（新建）

**Interfaces:**
- Produces:
  - `KnowledgeSpaceService.list_space_children(..., enrich_files: bool = True)`
  - `KnowledgeSpaceService._handle_file_folder_extra_info(res, *, include_folder_counts=True, folder_counts_override=None, enrich_files: bool = True) -> list[dict]`
  - endpoint 查询参数 `enrich_files: bool = True`
  - 当 `enrich_files=False`：文件 dict 只含 `one.model_dump()` 的基础字段，**不含** `tags`/`thumbnails`/`summary`/`version_no`/`is_multi_version`/`has_similar`；文件夹 dict 的 folder counts（含 `visible_success_file_num`）保持不变。

- [ ] **Step 1: 写签名 + 行为失败测试**

创建 `test/knowledge/test_children_enrich_files_param.py`：

```python
"""改动③：list_space_children 的 enrich_files 参数。

签名测试用 AST 避免重依赖导入（参照 test_list_children_endpoint.py）；
行为测试直接调 _handle_file_folder_extra_info，mock DB 依赖。
"""
import ast
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

from bisheng.database.models.knowledge_file import FileType
from bisheng.knowledge.domain.services.knowledge_space_service import KnowledgeSpaceService

_BACKEND_ROOT = Path(__file__).resolve().parents[2] / "bisheng"


def _find_fn(source: str, name: str):
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def test_service_list_space_children_accepts_enrich_files():
    svc_file = _BACKEND_ROOT / "knowledge" / "domain" / "services" / "knowledge_space_service.py"
    fn = _find_fn(svc_file.read_text(), "list_space_children")
    arg_names = [a.arg for a in fn.args.args] + [a.arg for a in fn.args.kwonlyargs]
    assert "enrich_files" in arg_names, arg_names


def test_endpoint_children_accepts_enrich_files_query():
    ep_file = _BACKEND_ROOT / "knowledge" / "api" / "endpoints" / "knowledge_space.py"
    for node in ast.walk(ast.parse(ep_file.read_text())):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        arg_names = [a.arg for a in node.args.args] + [a.arg for a in node.args.kwonlyargs]
        if "enrich_files" not in arg_names:
            continue
        for dec in node.decorator_list:
            if "/children" in ast.unparse(dec):
                return
    raise AssertionError("no /children endpoint with enrich_files kwarg")


def _make_svc():
    svc = KnowledgeSpaceService.__new__(KnowledgeSpaceService)
    svc._load_folder_stat_counts = AsyncMock(return_value={})
    svc._load_file_tags_batch = AsyncMock(return_value={9001: [{"tag_name": "x"}]})
    svc.get_logo_share_link = Mock(return_value="thumb")
    return svc


def _make_file(file_id: int):
    f = Mock()
    f.file_type = FileType.FILE
    f.id = file_id
    f.thumbnails = ""
    f.abstract = "摘要"
    f.similar_status = 0
    f.model_dump.return_value = {"id": file_id, "file_name": "a.pdf", "file_type": FileType.FILE.value}
    return f


@pytest.mark.asyncio
async def test_extra_info_skips_file_enrichment_when_disabled():
    svc = _make_svc()
    result = await svc._handle_file_folder_extra_info(
        [_make_file(9001)], include_folder_counts=True, enrich_files=False
    )
    assert "tags" not in result[0]
    assert "version_no" not in result[0]
    assert "thumbnails" not in result[0]
    svc._load_file_tags_batch.assert_not_awaited()


@pytest.mark.asyncio
async def test_extra_info_enriches_files_by_default():
    svc = _make_svc()
    result = await svc._handle_file_folder_extra_info(
        [_make_file(9001)], include_folder_counts=True, enrich_files=True
    )
    assert result[0]["tags"] == [{"tag_name": "x"}]
    assert "version_no" in result[0]
    svc._load_file_tags_batch.assert_awaited()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `.venv/bin/python -m pytest test/knowledge/test_children_enrich_files_param.py -v`
Expected: FAIL —— 签名测试断言 `enrich_files` 不在参数中；行为测试报 `_handle_file_folder_extra_info` 不接受 `enrich_files` 关键字（TypeError）。

- [ ] **Step 3: 给 `_handle_file_folder_extra_info` 加 `enrich_files` 参数**

在 `knowledge_space_service.py` `_handle_file_folder_extra_info`（约 `:6940`）：

签名改为：
```python
    async def _handle_file_folder_extra_info(
        self,
        res: list[KnowledgeFile],
        *,
        include_folder_counts: bool = True,
        folder_counts_override: dict[int, dict[str, int]] | None = None,
        enrich_files: bool = True,
    ) -> list[dict]:
```

把 tags 加载改为受 `enrich_files` 控制：
```python
        # file need find all tags (skip when caller does not consume enrichment, e.g. QA tree)
        file_tags = await self._load_file_tags_batch(file_ids) if (enrich_files and file_ids) else {}
```

文件分支的富化包进 `if enrich_files:`（`else` 文件分支）：
```python
            else:
                if enrich_files:
                    item["thumbnails"] = self.get_logo_share_link(one.thumbnails)
                    item["tags"] = file_tags.get(one.id, [])
                    item["summary"] = one.abstract or ""
                    # Version enrichment fields set by _enrich_with_version_info (if version_repo is set).
                    item["version_no"] = getattr(one, "_version_no", None)
                    item["is_multi_version"] = getattr(one, "_is_multi_version", False)
                    item["has_similar"] = getattr(one, "_has_similar", (one.similar_status == 1))
```

（文件夹 `if one.file_type == FileType.DIR:` 分支保持原样，folder counts 与 `item["summary"] = ""` 不变。）

- [ ] **Step 4: 给 `list_space_children` 加 `enrich_files` 并按需跳过版本富化**

在 `knowledge_space_service.py` `list_space_children`（约 `:7143`）：

签名末尾新增参数：
```python
        file_type: int | None = None,
        enrich_files: bool = True,
    ) -> "PageInfiniteCursorData":
```

把版本富化包进条件、并透传给 extra_info（替换约 `:7206-7212`）：
```python
        # Enrich page items with version fields (version_no, is_multi_version, has_similar).
        if enrich_files:
            await self._enrich_with_version_info(visible_page_items)

        data = await self._handle_file_folder_extra_info(
            visible_page_items,
            include_folder_counts=True,
            enrich_files=enrich_files,
        )
```

（注意：`exclude_file_ids`/排除非主版本的扫描逻辑在 `:7188-7204` 之前，**保持不变**——它影响可见集合，与 `enrich_files` 无关。）

- [ ] **Step 5: 给 endpoint 加 `enrich_files` 查询参数**

在 `knowledge_space.py` `list_space_children` 端点（约 `:442`）签名中，`file_type` 之后、`svc` 之前新增：
```python
    file_type: int | None = Query(default=None, description="0=DIR only, 1=FILE only, empty=both"),
    enrich_files: bool = Query(
        default=True,
        description="是否富化文件的 tags/缩略图/摘要/版本字段；门户 QA 树传 false 以省开销",
    ),
    svc: KnowledgeSpaceService = Depends(get_knowledge_space_service),
```

并在调用处透传：
```python
    result = await svc.list_space_children(
        space_id,
        parent_id,
        file_ids,
        order_field,
        order_sort,
        file_status=file_status,
        cursor=cursor,
        page_size=page_size,
        file_type=file_type,
        enrich_files=enrich_files,
    )
```

- [ ] **Step 6: 运行测试确认通过**

Run: `.venv/bin/python -m pytest test/knowledge/test_children_enrich_files_param.py -v`
Expected: PASS（4 passed）

- [ ] **Step 7: 回归相关既有测试**

Run: `.venv/bin/python -m pytest test/knowledge/test_list_children_endpoint.py test/knowledge/test_portal_qa_tree_selection.py test/knowledge/test_knowledge_space_children_cursor.py test/knowledge/test_list_space_children_excludes_non_primary.py -v`
Expected: 与改动前一致（无因本次改动新引入的失败；`enrich_files` 默认 True 保证既有行为不变）。

- [ ] **Step 8: 提交**

```bash
git add bisheng/knowledge/domain/services/knowledge_space_service.py bisheng/knowledge/api/endpoints/knowledge_space.py test/knowledge/test_children_enrich_files_param.py
git commit -m "feat(knowledge): add enrich_files param to /children to skip file enrichment"
```

---

### Task 2: 门户信任上游鉴权 + 修分页 + 传 `enrich_files`

**仓库/工作目录：** `shougang-group-knowledge-portal/backend/`

**Files:**
- Modify: `app/services/knowledge_service.py`
  - `get_qa_tree_children`（约 `:806`）：params 加 `enrich_files=False`；用 `_extract_success_data` 检测上游业务错误码；分页字段本地赋值。
- Modify: `app/api/routes/knowledge.py`
  - 新增 `_raise_qa_tree_children_error` helper；`list_qa_tree_children`（约 `:448`）已登录分支去掉 `list_visible_spaces()` 预检，两个分支都捕获 `BishengBusinessError` 翻译为 403。
- Test: `tests/test_qa_knowledge_scope_api.py`（新增用例）

**Interfaces:**
- Consumes（来自 Task 1，运行时）：上游 `/children` 支持 `enrich_files` 查询参数；无权限/不存在时 HTTP 200 + body `{status_code: 18040|18000}`。
- Produces：
  - `get_qa_tree_children` 向上游传 `enrich_files=False`；上游业务错误码 → 抛 `BishengBusinessError`；返回 `QaKnowledgeTreeNodeData(total=len(nodes), page=<入参>, page_size=<上游 or 请求>)`。
  - route helper `_raise_qa_tree_children_error(err: BishengBusinessError) -> None`：`err.status_code ∈ {18040, 18000}` → `HTTPException(403, "包含无权限或不存在的知识库")`，否则委托 `_raise_bisheng_business_error(err)`。

- [ ] **Step 1: 写失败测试（新场景 + 分页 + 传参）**

在 `tests/test_qa_knowledge_scope_api.py` 末尾追加：

```python
class QaForbiddenBishengClient(QaScopeBishengClient):
    """对 7199/children 返回上游权限拒绝码（HTTP 200 + body status_code）。"""

    async def get_json(self, path: str, params=None, headers=None):
        self.get_calls.append((path, params or {}))
        if path == "/api/v1/knowledge/space/7199/children":
            return {"status_code": 18040, "status_message": "Permission denied"}
        return await super().get_json(path, params=params, headers=headers)


def _make_forbidden_client(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    user_bisheng = QaForbiddenBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        previous_bisheng = getattr(client.app.state, "bisheng_client", None)
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.portal_auth_service = FakePortalAuthService(user_bisheng)
        try:
            yield client, user_bisheng
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth
            if previous_bisheng is not None:
                client.app.state.bisheng_client = previous_bisheng


def test_qa_tree_children_translates_upstream_permission_error_to_403(tmp_path: Path):
    for client, _ in _make_forbidden_client(tmp_path):
        resp = client.get("/api/v1/knowledge/qa/tree/spaces/7199/children")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "包含无权限或不存在的知识库"


def test_qa_tree_children_passes_enrich_files_false_and_fixes_paging(tmp_path: Path):
    for client, fake_bisheng in _make_auth_client(tmp_path):
        resp = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children")
    assert resp.status_code == 200
    body = resp.json()["data"]
    # 分页字段：total = 本页节点数，page 回显入参
    assert body["total"] == len(body["data"]) == 2
    assert body["page"] == 1
    # 向上游传了 enrich_files=False（省富化）
    children_calls = [p for p in fake_bisheng.get_calls if p[0] == "/api/v1/knowledge/space/7101/children"]
    assert children_calls, "未调用上游 children"
    assert children_calls[0][1].get("enrich_files") is False
```

- [ ] **Step 2: 运行确认失败**

Run: `./.venv/bin/python -m pytest tests/test_qa_knowledge_scope_api.py -v -k "translates_upstream or passes_enrich_files"`
Expected: FAIL —— 权限错误当前被当空数据返回 200（而非 403）；`enrich_files` 参数当前不存在。

- [ ] **Step 3: 改 `get_qa_tree_children`（service）**

在 `app/services/knowledge_service.py` `get_qa_tree_children`（约 `:806`），整体替换方法体为：

```python
    async def get_qa_tree_children(
        self,
        space_id: int,
        parent_id: int | None,
        page: int = 1,
        page_size: int = 100,
    ) -> QaKnowledgeTreeNodeData:
        resolved_page_size = min(max(page_size, 1), self._page_size_limit)
        params: dict[str, Any] = {
            "page_size": resolved_page_size,
            "file_status": [SUCCESS_STATUS],
            # QA 树只用 folder counts 与节点基础字段，跳过上游文件富化以省开销。
            "enrich_files": False,
        }
        if parent_id is not None:
            params["parent_id"] = parent_id
        response = await self._bisheng.get_json(f"/api/v1/knowledge/space/{space_id}/children", params=params)
        # 上游权限/不存在等业务错误经 HTTP 200 + body status_code 返回；
        # 显式检测并抛 BishengBusinessError，交由路由层翻译为 403。
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        nodes = [
            self._map_qa_tree_node(item, fallback_space_id=space_id, fallback_parent_id=parent_id)
            for item in raw_items
            if isinstance(item, dict)
        ]
        # 上游为 F027 游标分页，已移除 total/page；门户当前仅加载首页直接子节点：
        # total 仅表示本页节点数（非全量），page 回显入参，不做跨页。
        return QaKnowledgeTreeNodeData(
            data=nodes,
            total=len(nodes),
            page=page,
            page_size=int(data.get("page_size") or resolved_page_size),
        )
```

- [ ] **Step 4: 改 route（去预检 + 错误翻译）**

在 `app/api/routes/knowledge.py`，`_raise_bisheng_business_error`（约 `:77-79`）之后新增 helper：

```python
_QA_TREE_FORBIDDEN_CODES = {18040, 18000}  # SpacePermissionDenied / SpaceNotFound


def _raise_qa_tree_children_error(err: BishengBusinessError) -> None:
    if err.status_code in _QA_TREE_FORBIDDEN_CODES:
        raise HTTPException(status_code=403, detail="包含无权限或不存在的知识库")
    _raise_bisheng_business_error(err)
```

把 `list_qa_tree_children`（约 `:448-494`）整体替换为：

```python
@router.get("/qa/tree/spaces/{space_id}/children")
async def list_qa_tree_children(
    space_id: int,
    request: Request,
    parent_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = auth_service.get_session(request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        public_space_ids = {space.id for space in (await service.list_public_spaces()).data}
        if space_id not in public_space_ids:
            raise HTTPException(status_code=403, detail="未登录仅可浏览公共知识库目录")
        try:
            return response_ok(
                await service.get_qa_tree_children(
                    space_id=space_id,
                    parent_id=parent_id,
                    page=page,
                    page_size=page_size,
                )
            )
        except BishengBusinessError as err:
            _raise_qa_tree_children_error(err)

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        # 信任上游 /children 的读权限校验：不再自己全量拉取可见空间做预检。
        try:
            return response_ok(
                await service.get_qa_tree_children(
                    space_id=space_id,
                    parent_id=parent_id,
                    page=page,
                    page_size=page_size,
                )
            )
        except BishengBusinessError as err:
            _raise_qa_tree_children_error(err)
    finally:
        await bisheng_client.aclose()
```

- [ ] **Step 5: 运行新测试确认通过**

Run: `./.venv/bin/python -m pytest tests/test_qa_knowledge_scope_api.py -v -k "translates_upstream or passes_enrich_files"`
Expected: PASS（2 passed）

- [ ] **Step 6: 回归既有 QA scope 测试（语义基线）**

Run: `./.venv/bin/python -m pytest tests/test_qa_knowledge_scope_api.py -v`
Expected: 全部 PASS——特别是 `test_qa_tree_spaces_and_children_use_current_user_visible_scope`（已登录 7101 成功、`resolved_file_count==1`）与 `test_qa_tree_anonymous_scope_is_limited_to_public_bisheng_spaces`（未登录 7103 → 403 含"公共"）。

- [ ] **Step 7: 回归门户知识域测试**

Run: `./.venv/bin/python -m pytest tests/test_knowledge_api.py -v`
Expected: 全部 PASS（`get_qa_tree_children` 改动不影响空间列表/搜索等其他用例）。

- [ ] **Step 8: 提交**

```bash
git add app/services/knowledge_service.py app/api/routes/knowledge.py tests/test_qa_knowledge_scope_api.py
git commit -m "feat(qa-tree): trust upstream auth, fix paging fields, request light enrich"
```

---

## Self-Review 记录

- **Spec 覆盖**：改动①→ Task 2 Step 4（去预检 + 翻译）；改动②→ Task 2 Step 3（分页字段）；改动③→ Task 1（全部）+ Task 2 Step 3（传 `enrich_files=false`）。测试策略 → Task 1 Step 1/7、Task 2 Step 1/6/7。
- **占位符**：无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致**：`enrich_files: bool`（service/endpoint/params）一致；`_raise_qa_tree_children_error` / `BishengBusinessError.status_code` / `{18040,18000}` 前后一致；`get_qa_tree_children` 返回 `QaKnowledgeTreeNodeData(data,total,page,page_size)` 与既有 schema 字段一致。
- **语义基线**：既有 `test_qa_knowledge_scope_api.py` 两个核心用例在 Task 2 Step 6 显式回归。
```
