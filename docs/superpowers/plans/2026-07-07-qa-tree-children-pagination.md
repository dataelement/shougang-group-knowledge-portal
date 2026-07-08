# QA 树 children 游标分页 + 轻量文件夹计数 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 QA 树 children 接口从"一次拉全层 + 深扫每个文件夹算可见数"改为"每页 10 的游标分页 + 文件夹只出直接子文件数(零 OpenFGA),前端滚动自动续拉"。

**Architecture:** 三层改动。BiSheng `/children` 新增 `folder_count_mode`(默认 `deep` 不变),`shallow` 走新增的批量直接计数(无递归/无鉴权)并返回显式 `has_children`；Portal 透传 `cursor` + 传 `folder_count_mode=shallow`,响应改 `{data,page_size,has_more,next_cursor}`;前端 `content.ts`/`QAKnowledgeTreePicker` 支持 cursor + IntersectionObserver 滚动加载。

**Tech Stack:** BiSheng(FastAPI/SQLModel,`src/backend/.venv`)、Portal 后端(FastAPI,`backend/.venv`)、Portal 前端(React/TS,`node:test` 源码断言)。

设计出处：`docs/superpowers/specs/2026-07-07-qa-tree-children-pagination-design.md`。

## Global Constraints

- **`folder_count_mode` 默认必须为 `"deep"`**：BiSheng 其他调用方(独立知识库页等)行为零变化。
- **轻量计数口径固定**：`shallow` 的 `visible_success_file_num` = **直接子**(`file_level_path == 父 prefix`)中 `file_type=FILE AND status=SUCCESS` 的计数；**不递归、不逐项鉴权、不调用 OpenFGA**(不得引用 `_filter_visible_child_items` / `_build_child_permission_context`)。
- **`has_children` 解耦**:`shallow` 下文件夹节点必须带显式 `has_children`(= 是否存在任意直接子项);文件节点恒 `has_children=false`。
- **错误契约不变**:上游业务错误 = HTTP200+body `status_code`;Portal 对 `{18040,18000}` → 403「包含无权限或不存在的知识库」,文案逐字不变;未登录保留 public 预检 + 「未登录仅可浏览公共知识库目录」。
- **每页 10**:Portal 路由 `page_size` 默认 10。
- **语义取舍(已确认)**:文件夹 ≤20 精确校验交后端 `resolve_qa_scope_file_ids` 兜底(文案「一次最多可选择20个文件进行问答。」不变),前端计数仅作近似提示。

---

## Task 1: BiSheng —— `folder_count_mode=shallow` 轻量直接计数 + 显式 has_children

**Files:**
- Modify: `bisheng_2/src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py`
  - `list_space_children`(约 `:7145`)新增 kwarg `folder_count_mode: str = "deep"`,透传给 `_handle_file_folder_extra_info`。
  - `_handle_file_folder_extra_info`(约 `:6940`)新增 kwarg `folder_count_mode: str = "deep"`,分流 deep/shallow;shallow 时把 `has_children` 写入文件夹 item。
  - 新增 `_load_folder_direct_counts`(紧邻 `_load_folder_stat_counts` `:6663` 之后)。
- Modify: `bisheng_2/src/backend/bisheng/knowledge/api/endpoints/knowledge_space.py`
  - `/children` endpoint(`:442`)新增 `folder_count_mode: str = Query(default="deep", ...)`,传入 service。
- Test: `bisheng_2/src/backend/test/knowledge/test_children_folder_count_mode.py`(新建)

**Interfaces:**
- Produces:
  - `list_space_children(..., folder_count_mode: str = "deep")`
  - `_handle_file_folder_extra_info(res, *, include_folder_counts=True, folder_counts_override=None, enrich_files=True, folder_count_mode="deep")`
  - `_load_folder_direct_counts(folders: list[KnowledgeFile]) -> dict[int, dict]`,每 folder_id → `{"file_num","success_file_num","visible_success_file_num","processing_file_num","has_children"}`
  - endpoint query `folder_count_mode`
- Consumes(已存在):`select`、`func`、`col`、`get_async_db_session`、`FileType`、`KnowledgeFileStatus`、`KnowledgeFile`(同文件内已用于 `_count_folder_file_stats`)。

跑测试:`cd bisheng_2/src/backend && .venv/bin/python -m pytest test/knowledge/test_children_folder_count_mode.py -v`

- [ ] **Step 1: 写失败测试** `test/knowledge/test_children_folder_count_mode.py`

```python
"""改动:list_space_children 的 folder_count_mode(shallow 轻量直接计数 + 显式 has_children)。

签名测试用 AST(参照 test_children_enrich_files_param.py);行为测试直接调
_handle_file_folder_extra_info,mock 掉 deep/shallow 两个加载器验证分流与 has_children。
零 OpenFGA 用 AST 断言 _load_folder_direct_counts 源码不引用鉴权辅助函数。
"""
import ast
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

from bisheng.knowledge.domain.models.knowledge_file import FileType
from bisheng.knowledge.domain.services.knowledge_space_service import KnowledgeSpaceService

_BACKEND_ROOT = Path(__file__).resolve().parents[2] / "bisheng"
_SVC_FILE = _BACKEND_ROOT / "knowledge" / "domain" / "services" / "knowledge_space_service.py"
_EP_FILE = _BACKEND_ROOT / "knowledge" / "api" / "endpoints" / "knowledge_space.py"


def _find_fn(source: str, name: str):
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def test_service_list_space_children_accepts_folder_count_mode():
    fn = _find_fn(_SVC_FILE.read_text(), "list_space_children")
    arg_names = [a.arg for a in fn.args.args] + [a.arg for a in fn.args.kwonlyargs]
    assert "folder_count_mode" in arg_names, arg_names


def test_endpoint_children_accepts_folder_count_mode_query():
    for node in ast.walk(ast.parse(_EP_FILE.read_text())):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        arg_names = [a.arg for a in node.args.args] + [a.arg for a in node.args.kwonlyargs]
        if "folder_count_mode" not in arg_names:
            continue
        for dec in node.decorator_list:
            if "/children" in ast.unparse(dec):
                return
    raise AssertionError("no /children endpoint with folder_count_mode kwarg")


def test_direct_counts_helper_makes_no_permission_calls():
    """轻量计数零 OpenFGA:源码不得引用逐项鉴权/权限上下文辅助。"""
    fn = _find_fn(_SVC_FILE.read_text(), "_load_folder_direct_counts")
    assert fn is not None, "_load_folder_direct_counts 未定义"
    body = ast.unparse(fn)
    assert "_filter_visible_child_items" not in body
    assert "_build_child_permission_context" not in body


def _make_folder(folder_id: int):
    f = Mock()
    f.file_type = FileType.DIR
    f.id = folder_id
    f.knowledge_id = 131
    f.file_level_path = ""
    f.model_dump.return_value = {"id": folder_id, "file_type": FileType.DIR.value, "file_name": "d"}
    return f


@pytest.mark.asyncio
async def test_extra_info_shallow_uses_direct_counts_and_sets_has_children():
    svc = KnowledgeSpaceService.__new__(KnowledgeSpaceService)
    svc._load_folder_stat_counts = AsyncMock(return_value={})
    svc._load_folder_direct_counts = AsyncMock(
        return_value={10: {"file_num": 2, "success_file_num": 2,
                           "visible_success_file_num": 2, "processing_file_num": 0,
                           "has_children": True}}
    )
    result = await svc._handle_file_folder_extra_info(
        [_make_folder(10)], include_folder_counts=True,
        enrich_files=False, folder_count_mode="shallow",
    )
    assert result[0]["visible_success_file_num"] == 2
    assert result[0]["has_children"] is True
    svc._load_folder_direct_counts.assert_awaited_once()
    svc._load_folder_stat_counts.assert_not_awaited()


@pytest.mark.asyncio
async def test_extra_info_deep_still_uses_stat_counts():
    svc = KnowledgeSpaceService.__new__(KnowledgeSpaceService)
    svc._load_folder_stat_counts = AsyncMock(
        return_value={10: {"file_num": 5, "success_file_num": 5,
                           "visible_success_file_num": 3, "processing_file_num": 0}}
    )
    svc._load_folder_direct_counts = AsyncMock(return_value={})
    result = await svc._handle_file_folder_extra_info(
        [_make_folder(10)], include_folder_counts=True,
        enrich_files=False, folder_count_mode="deep",
    )
    assert result[0]["visible_success_file_num"] == 3
    svc._load_folder_stat_counts.assert_awaited_once()
    svc._load_folder_direct_counts.assert_not_awaited()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd bisheng_2/src/backend && .venv/bin/python -m pytest test/knowledge/test_children_folder_count_mode.py -v`
Expected: FAIL(`folder_count_mode` 未加、`_load_folder_direct_counts` 未定义)。

- [ ] **Step 3: 实现 `_load_folder_direct_counts`**

在 `_load_folder_stat_counts` 方法之后新增(注意 `col` 从 `sqlmodel` 导入,已在 `_count_folder_file_stats` 内局部导入,可同样局部导入):

```python
    async def _load_folder_direct_counts(
        self, folders: list[KnowledgeFile]
    ) -> dict[int, dict[str, int | bool]]:
        """Shallow folder stats: DIRECT-child SUCCESS file count + has_children.

        One batched query per space. NO recursion, NO permission (OpenFGA) checks.
        A direct child of a folder has ``file_level_path == f"{folder.file_level_path}/{folder.id}"``.
        ``visible_success_file_num`` here means direct SUCCESS files (not deep, not visibility-filtered);
        precise <=20 enforcement stays in ``resolve_qa_scope_file_ids`` at QA time.
        """
        from sqlmodel import col

        folder_counts: dict[int, dict[str, int | bool]] = {}
        if not folders:
            return folder_counts

        prefix_to_folder: dict[str, int] = {}
        prefixes_by_space: dict[int, list[str]] = {}
        for folder in folders:
            prefix = f"{folder.file_level_path or ''}/{folder.id}"
            prefix_to_folder[prefix] = int(folder.id)
            prefixes_by_space.setdefault(int(folder.knowledge_id), []).append(prefix)
            folder_counts[int(folder.id)] = {
                "file_num": 0,
                "success_file_num": 0,
                "visible_success_file_num": 0,
                "processing_file_num": 0,
                "has_children": False,
            }

        in_progress_statuses = {
            KnowledgeFileStatus.PROCESSING.value,
            KnowledgeFileStatus.WAITING.value,
            KnowledgeFileStatus.REBUILDING.value,
        }
        for space_id, prefixes in prefixes_by_space.items():
            stmt = (
                select(
                    KnowledgeFile.file_level_path,
                    KnowledgeFile.file_type,
                    KnowledgeFile.status,
                    func.count(KnowledgeFile.id),
                )
                .where(
                    KnowledgeFile.knowledge_id == space_id,
                    col(KnowledgeFile.file_level_path).in_(prefixes),
                )
                .group_by(
                    KnowledgeFile.file_level_path,
                    KnowledgeFile.file_type,
                    KnowledgeFile.status,
                )
            )
            async with get_async_db_session() as session:
                rows = (await session.exec(stmt)).all()
            for level_path, file_type, status, count in rows:
                folder_id = prefix_to_folder.get(level_path)
                if folder_id is None:
                    continue
                entry = folder_counts[folder_id]
                entry["has_children"] = True
                if file_type == FileType.FILE.value:
                    entry["file_num"] += count
                    if status == KnowledgeFileStatus.SUCCESS.value:
                        entry["success_file_num"] += count
                        entry["visible_success_file_num"] += count
                    elif status in in_progress_statuses:
                        entry["processing_file_num"] += count
        return folder_counts
```

- [ ] **Step 4: `_handle_file_folder_extra_info` 加 `folder_count_mode` 分流 + has_children**

签名加 `folder_count_mode: str = "deep"`(放在 `enrich_files` 之后)。把 folder-counts 计算段改为:

```python
        folder_counts = {}
        if include_folder_counts and folder_ids:
            if folder_counts_override is not None:
                folder_counts = folder_counts_override
            else:
                folders = [f for f in res if f.file_type == FileType.DIR]
                if folder_count_mode == "shallow":
                    folder_counts = await self._load_folder_direct_counts(folders)
                else:
                    folder_counts = await self._load_folder_stat_counts(folders)
```

文件夹分支的 `item.update(counts)` 保持不变——shallow 的 counts 含 `has_children`,会随 update 写入 item;deep 无该键,item 不含,交由门户回退推导。默认兜底 dict(miss 时)保持现状即可(shallow 已对所有 folder 预置)。

- [ ] **Step 5: `list_space_children` 透传 `folder_count_mode`**

签名加 `folder_count_mode: str = "deep"`(放在 `enrich_files` 之后)。把调用改为:

```python
        data = await self._handle_file_folder_extra_info(
            visible_page_items,
            include_folder_counts=True,
            enrich_files=enrich_files,
            folder_count_mode=folder_count_mode,
        )
```

- [ ] **Step 6: endpoint 加 `folder_count_mode` query**

`knowledge_space.py` `/children` 签名加(放在 `enrich_files` 之后):

```python
    folder_count_mode: str = Query(
        default="deep",
        description="deep=深度可见数(默认);shallow=直接子文件数(门户 QA 树,零 openfga)",
    ),
```

并在 `svc.list_space_children(...)` 调用里加 `folder_count_mode=folder_count_mode,`。

- [ ] **Step 7: 运行测试确认通过**

Run: `cd bisheng_2/src/backend && .venv/bin/python -m pytest test/knowledge/test_children_folder_count_mode.py -v`
Expected: PASS(5 项)。

- [ ] **Step 8: 回归相邻测试**

Run: `cd bisheng_2/src/backend && .venv/bin/python -m pytest test/knowledge/test_children_enrich_files_param.py test/knowledge/test_knowledge_space_children_cursor.py test/knowledge/test_list_children_endpoint.py -v`
Expected: 全通过(deep 默认不变)。若基线有预存失败(见 [[bisheng2-backend-test-env]]),记录但不阻塞——只需确认新增未引入新失败。

- [ ] **Step 9: Commit**

```bash
cd bisheng_2 && git add src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py src/backend/bisheng/knowledge/api/endpoints/knowledge_space.py src/backend/test/knowledge/test_children_folder_count_mode.py
git commit -m "feat(knowledge): add folder_count_mode=shallow to /children (direct counts, zero openfga)"
```

---

## Task 2: Portal 后端 —— 透传 cursor + folder_count_mode=shallow + 新响应结构 + has_children 解耦

**Files:**
- Modify: `backend/app/schemas/knowledge.py`(`QaKnowledgeTreeNodeData` `:104`)
- Modify: `backend/app/services/knowledge_service.py`(`get_qa_tree_children` `:806`;`_map_qa_tree_node` `:1567`)
- Modify: `backend/app/api/routes/knowledge.py`(`list_qa_tree_children` `:457`)
- Test: `backend/tests/test_qa_knowledge_scope_api.py`(改造 fake + 现有 paging 测试 + 新增)

**Interfaces:**
- Consumes(来自 Task 1):上游 `/children` 现接受 `folder_count_mode=shallow`,返回体 `{data:[...], page_size, has_more, next_cursor}`,文件夹 item 带显式 `has_children`。
- Produces:
  - `get_qa_tree_children(space_id, parent_id, cursor: str | None = None, page_size: int = 10) -> QaKnowledgeTreeNodeData`
  - `QaKnowledgeTreeNodeData{data, page_size, has_more, next_cursor}`
  - 路由 query `cursor`

跑测试:`cd backend && .venv/bin/python -m pytest tests/test_qa_knowledge_scope_api.py -v`

- [ ] **Step 1: 改造 fake + 写/改失败测试**

在 `backend/tests/test_qa_knowledge_scope_api.py` 的 `QaScopeBishengClient.get_json` 中,7101 根 children 的返回体(现 `total/page/page_size`,约 `:135-139`)改为游标结构,并补第二页与 has_children:

```python
            # 根 children:第一页(无 cursor)→ has_more,带 next_cursor
            if params.get("cursor") == "CUR7101P2":
                return {"data": {"data": [
                    {"id": 9002, "knowledge_id": 7101, "file_name": "第二页.pdf",
                     "file_type": 1, "status": 2, "file_level_path": ""},
                ], "page_size": 10, "has_more": False, "next_cursor": None}}
            return {"data": {"data": [
                {"id": 3001, "knowledge_id": 7101, "file_name": "团队规范", "file_type": 0,
                 "status": 2, "file_level_path": "", "visible_success_file_num": 1,
                 "has_children": True},
                {"id": 9001, "knowledge_id": 7101, "file_name": "开发流程文档.pdf",
                 "file_type": 1, "status": 2, "file_level_path": "", "file_ext": "pdf",
                 "summary": "开发流程", "file_encoding": "DEV-PROC-001", "tags": []},
            ], "page_size": 10, "has_more": True, "next_cursor": "CUR7101P2"}}
```

（保留 `parent_id==3001` 的 nested 分支;把其返回体也补 `"page_size": 10, "has_more": False, "next_cursor": None`。）

新增/改写测试:

```python
def test_qa_tree_children_uses_cursor_pagination_and_shallow_counts(tmp_path: Path):
    for client, _c, fake_bisheng in _make_auth_client(tmp_path):
        first = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children")
        second = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children?cursor=CUR7101P2")
    assert first.status_code == 200
    body = first.json()["data"]
    assert body["has_more"] is True
    assert body["next_cursor"] == "CUR7101P2"
    assert body["page_size"] == 10
    assert "total" not in body and "page" not in body
    # 上游收到 shallow 模式 + page_size
    call = next(p for p in fake_bisheng.get_calls if p[0] == "/api/v1/knowledge/space/7101/children")
    assert call[1].get("folder_count_mode") == "shallow"
    assert call[1].get("page_size") == 10
    # 第二页透传 cursor
    assert second.json()["data"]["data"][0]["id"] == 9002
    assert any(p[1].get("cursor") == "CUR7101P2"
               for p in fake_bisheng.get_calls if p[0] == "/api/v1/knowledge/space/7101/children")


def test_qa_tree_children_has_children_decoupled_from_count(tmp_path: Path):
    for client, _c, _b in _make_auth_client(tmp_path):
        body = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children").json()["data"]
    folder = next(n for n in body["data"] if n["type"] == "folder")
    # 该文件夹 visible_success_file_num=1 且显式 has_children=True → 节点可展开
    assert folder["has_children"] is True
    assert folder["resolved_file_count"] == 1
```

同时把现有 `test_qa_tree_children_passes_enrich_files_false_and_fixes_paging`(约 `:378`)中对 `body["total"]`/`body["page"]` 的断言,改为断言 `body["has_more"]`/`body["next_cursor"]`/`body["page_size"]`,并保留 `enrich_files is False` 断言。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_qa_knowledge_scope_api.py -k "cursor or has_children or enrich_files" -v`
Expected: FAIL(schema 仍是 total/page;service 未传 folder_count_mode/cursor;has_children 未解耦)。

- [ ] **Step 3: 改 schema**

`backend/app/schemas/knowledge.py`:

```python
class QaKnowledgeTreeNodeData(BaseModel):
    data: list[QaKnowledgeTreeNode] = Field(default_factory=list)
    page_size: int = 10
    has_more: bool = False
    next_cursor: str | None = None
```

- [ ] **Step 4: 改 `get_qa_tree_children`**

```python
    async def get_qa_tree_children(
        self,
        space_id: int,
        parent_id: int | None,
        cursor: str | None = None,
        page_size: int = 10,
    ) -> QaKnowledgeTreeNodeData:
        resolved_page_size = min(max(page_size, 1), self._page_size_limit)
        params: dict[str, Any] = {
            "page_size": resolved_page_size,
            "file_status": [SUCCESS_STATUS],
            "enrich_files": False,
            # QA 树只需直接子文件数,走上游轻量计数(零 openfga、不递归)。
            "folder_count_mode": "shallow",
        }
        if parent_id is not None:
            params["parent_id"] = parent_id
        if cursor:
            params["cursor"] = cursor
        response = await self._bisheng.get_json(f"/api/v1/knowledge/space/{space_id}/children", params=params)
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        nodes = [
            self._map_qa_tree_node(item, fallback_space_id=space_id, fallback_parent_id=parent_id)
            for item in raw_items
            if isinstance(item, dict)
        ]
        next_cursor = data.get("next_cursor") if isinstance(data, dict) else None
        return QaKnowledgeTreeNodeData(
            data=nodes,
            page_size=int(data.get("page_size") or resolved_page_size) if isinstance(data, dict) else resolved_page_size,
            has_more=bool(data.get("has_more")) if isinstance(data, dict) else False,
            next_cursor=next_cursor if isinstance(next_cursor, str) else None,
        )
```

- [ ] **Step 5: `_map_qa_tree_node` 解耦 has_children**

把 `return QaKnowledgeTreeNode(...)` 前的计算与 `has_children=` 改为:

```python
        raw_has_children = item.get("has_children")
        if raw_has_children is not None and not is_file:
            has_children = bool(raw_has_children)
        else:
            has_children = (not is_file) and resolved_file_count > 0
        return QaKnowledgeTreeNode(
            ...
            has_children=has_children,
            resolved_file_count=1 if is_file else resolved_file_count,
        )
```

- [ ] **Step 6: 改路由 `list_qa_tree_children`**

签名:删 `page`,`page_size` 默认改 10,新增 `cursor`:

```python
    parent_id: Optional[int] = Query(default=None),
    cursor: Optional[str] = Query(default=None),
    page_size: int = Query(default=10, ge=1, le=100),
```

两个分支的 `service.get_qa_tree_children(...)` 调用改为 `space_id=space_id, parent_id=parent_id, cursor=cursor, page_size=page_size`(去掉 `page=page`)。其余(session 判定、错误翻译、public 预检)不变。

- [ ] **Step 7: 运行测试确认通过**

Run: `cd backend && .venv/bin/python -m pytest tests/test_qa_knowledge_scope_api.py -v`
Expected: 全通过(含现有 `test_qa_tree_spaces_and_children_use_current_user_visible_scope`——它只读 `data.data`,`resolved_file_count==1` 仍成立)。

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/knowledge.py backend/app/services/knowledge_service.py backend/app/api/routes/knowledge.py backend/tests/test_qa_knowledge_scope_api.py
git commit -m "feat(qa-tree): cursor pagination passthrough + shallow folder counts + decouple has_children"
```

---

## Task 3: 前端 —— cursor 分页 + IntersectionObserver 滚动加载

**Files:**
- Modify: `frontend/src/api/content.ts`(`QaKnowledgeTreeNodeDataDto` `:333`;`fetchQaKnowledgeTreeChildren` `:791`)
- Modify: `frontend/src/components/QAKnowledgeTreePicker.tsx`
- Test: `frontend/tests/qaKnowledgeTreeSelection.test.ts`(源码正则断言,追加用例)

**Interfaces:**
- Consumes(来自 Task 2):`GET .../children?cursor=` → `{data, page_size, has_more, next_cursor}`。
- Produces:`fetchQaKnowledgeTreeChildren(spaceId, parentId?, cursor?) => Promise<{data, pageSize, hasMore, nextCursor}>`;picker 支持滚动续拉。

跑测试:`cd frontend && npm test`

- [ ] **Step 1: 追加失败测试**

在 `frontend/tests/qaKnowledgeTreeSelection.test.ts` 末尾追加(源码断言,与既有风格一致):

```typescript
test('content api supports cursor pagination for tree children', () => {
  assert.match(contentApiSource, /fetchQaKnowledgeTreeChildren\s*\(\s*spaceId:\s*number,\s*parentId\?:\s*number,\s*cursor\?:\s*string/);
  assert.match(contentApiSource, /next_cursor/);
  assert.match(contentApiSource, /has_more/);
  assert.match(contentApiSource, /query\.set\('cursor'/);
});

test('tree picker auto-loads more children on scroll via IntersectionObserver', () => {
  assert.match(pickerSource, /IntersectionObserver/);
  assert.match(pickerSource, /loadMoreChildren/);
  assert.match(pickerSource, /nextCursor/);
  assert.match(pickerSource, /hasMore/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npm test`
Expected: 两条新用例 FAIL。

- [ ] **Step 3: 改 `content.ts`**

DTO(`:333`)与函数(`:791`)改为:

```typescript
interface QaKnowledgeTreeNodeDataDto {
  data: QaKnowledgeTreeNodeDto[];
  page_size: number;
  has_more: boolean;
  next_cursor: string | null;
}

export async function fetchQaKnowledgeTreeChildren(
  spaceId: number,
  parentId?: number,
  cursor?: string,
): Promise<{ data: QaKnowledgeTreeNode[]; pageSize: number; hasMore: boolean; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (parentId) query.set('parent_id', String(parentId));
  if (cursor) query.set('cursor', cursor);
  const suffix = query.toString();
  const data = await request<QaKnowledgeTreeNodeDataDto>(
    `/api/v1/knowledge/qa/tree/spaces/${spaceId}/children${suffix ? `?${suffix}` : ''}`,
  );
  return {
    data: data.data.map(mapQaKnowledgeTreeNode),
    pageSize: data.page_size,
    hasMore: Boolean(data.has_more),
    nextCursor: data.next_cursor ?? null,
  };
}
```

- [ ] **Step 4: 改 `QAKnowledgeTreePicker.tsx` —— 分页状态 + loadMoreChildren**

props 类型:`onLoadChildren` 改为返回分页信息:

```typescript
  onLoadChildren: (spaceId: number, parentId?: number, cursor?: string)
    => Promise<{ data: QaKnowledgeTreeNode[]; hasMore: boolean; nextCursor: string | null }>;
```

新增状态(在既有 `childrenByKey` 等旁):

```typescript
  const [nextCursorByKey, setNextCursorByKey] = useState<Record<string, string | null>>({});
  const [hasMoreByKey, setHasMoreByKey] = useState<Record<string, boolean>>({});
  const [loadingMoreKeys, setLoadingMoreKeys] = useState<Set<string>>(() => new Set());
```

`loadChildren` 成功分支改为记录游标:

```typescript
      const result = await onLoadChildren(spaceId, parentId ?? undefined);
      setChildrenByKey((prev) => ({ ...prev, [key]: result.data }));
      setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
      setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
```

新增 `loadMoreChildren`(去重追加):

```typescript
  const loadMoreChildren = async (spaceId: number, parentId?: number | null) => {
    const key = nodeChildrenKey(spaceId, parentId);
    if (!hasMoreByKey[key] || loadingMoreKeys.has(key)) return;
    const cursor = nextCursorByKey[key];
    if (!cursor) return;
    setLoadingMoreKeys((prev) => new Set(prev).add(key));
    try {
      const result = await onLoadChildren(spaceId, parentId ?? undefined, cursor);
      setChildrenByKey((prev) => {
        const existing = prev[key] ?? [];
        const seen = new Set(existing.map((n) => `${n.spaceId}-${n.id}`));
        const merged = [...existing, ...result.data.filter((n) => !seen.has(`${n.spaceId}-${n.id}`))];
        return { ...prev, [key]: merged };
      });
      setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
      setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
    } catch {
      setErrorKeys((prev) => new Set(prev).add(key));
    } finally {
      setLoadingMoreKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };
```

- [ ] **Step 5: IntersectionObserver 滚动加载**

用一个 observer(root = 列表滚动容器 `s.spaceList`)观察每个"已展开且 hasMore"节点末尾的哨兵。实现:

```typescript
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMoreChildren);
  loadMoreRef.current = loadMoreChildren;
  const sentinelCbRef = useRef<(el: HTMLDivElement | null, spaceId: number, parentId?: number | null) => void>();

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    const targets = new Map<Element, { spaceId: number; parentId?: number | null }>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const meta = targets.get(entry.target);
        if (meta) void loadMoreRef.current(meta.spaceId, meta.parentId);
      }
    }, { root, rootMargin: '80px' });
    sentinelCbRef.current = (el, spaceId, parentId) => {
      if (!el) return;
      targets.set(el, { spaceId, parentId });
      observer.observe(el);
    };
    return () => observer.disconnect();
  }, []);
```

给列表容器加 ref:把 `<div className={s.spaceList}>`(`:344`)改为 `<div className={s.spaceList} ref={scrollRootRef}>`。

在 space 根展开块(`:442` `rootChildren`)与文件夹展开块(`:291` `nodeChildren`)的子项渲染之后,追加哨兵:

```tsx
{hasMoreByKey[rootKey] ? (
  <div ref={(el) => sentinelCbRef.current?.(el, space.id, undefined)} className={s.loadMoreSentinel}>
    {loadingMoreKeys.has(rootKey) ? <Loader2 size={14} className={s.spin} /> : null}
  </div>
) : null}
```

文件夹层同理,用 `key`/`node.spaceId`/`node.id`:

```tsx
{hasMoreByKey[key] ? (
  <div ref={(el) => sentinelCbRef.current?.(el, node.spaceId, node.id)} className={s.loadMoreSentinel}>
    {loadingMoreKeys.has(key) ? <Loader2 size={14} className={s.spin} /> : null}
  </div>
) : null}
```

（`renderNode` 内已有 `const key = nodeChildrenKey(node.spaceId, node.id)`;`useRef`/`useEffect` 需确认已在文件顶部 import——现有 import 为 `useEffect, useMemo, useState`,补 `useRef`。`s.loadMoreSentinel` 在 CSS module 加一个最简样式如 `.loadMoreSentinel{height:1px;display:flex;justify-content:center;padding:6px 0;}`。）

- [ ] **Step 6: 运行测试确认通过**

Run: `cd frontend && npm test`
Expected: 全绿(含两条新用例)。

- [ ] **Step 7: 类型检查**

Run: `cd frontend && npx tsc -b`
Expected: 无错误(`tsc -b` 是构建/测试门禁)。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/content.ts frontend/src/components/QAKnowledgeTreePicker.tsx frontend/src/components/QAKnowledgeTreePicker.module.css frontend/tests/qaKnowledgeTreeSelection.test.ts
git commit -m "feat(qa-tree): cursor pagination + infinite-scroll load-more in tree picker"
```

---

## Task 4: 部署 171 + 真实环境自测验证

**说明**:非 TDD 任务,由控制器在三任务合并后执行,验证端到端与性能。

- [ ] **Step 1: 部署**(源码 bind-mount + uvicorn --reload,见 [[test-env-deploy]])
  - bisheng:scp 改动文件到 `/opt/code/bisheng/src/backend/...`(先 md5 校验与本地 HEAD 一致),`--reload` 自动生效或 `docker restart bisheng-backend bisheng-backend-worker`。
  - portal 后端:scp 到 `/opt/code/shougang-group-knowledge-portal/backend/...` + `docker compose restart portal-backend`。
  - portal 前端:需 build 镜像(`deploy/Dockerfile.portal-frontend`)+ `docker compose up -d portal-frontend`。
- [ ] **Step 2: 接口自测**
  - `curl .../qa/tree/spaces/131/children` → 首页 ≤10 项、含 `has_more`/`next_cursor`;带 `?cursor=` 取下一页无重复;文件夹 `resolved_file_count` = 直接子文件数、`has_children` 正确。
  - bisheng 日志确认 `folder_count_mode=false→shallow` 已传、process_time 明显下降;openfga 单次请求 Read 数从 ~90 降到与页大小相当。
- [ ] **Step 3: 前端自测**:门户 QA 页打开知识库范围选择器,展开知识库/文件夹,滚动触发续拉,计数与勾选可用(headless-Chrome/CDP 见 [[portal-iframe-debugging]])。

---

## 部署顺序

建议 **BiSheng → Portal 后端 → Portal 前端**。两个方向都安全:BiSheng 先则默认 `deep`、门户尚未传 shallow;若门户先行,FastAPI 会忽略上游未声明的 `folder_count_mode` query(不报错),只是暂时仍走深扫、无性能收益。cursor/`page_size=10` 上游 F027 早已支持。
