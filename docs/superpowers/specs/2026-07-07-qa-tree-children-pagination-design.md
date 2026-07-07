# QA 树 children 游标分页 + 轻量文件夹计数设计

- 日期：2026-07-07
- 接口：`GET /api/v1/knowledge/qa/tree/spaces/{space_id}/children`（门户自有，代理上游 `/api/v1/knowledge/space/{space_id}/children`）
- 涉及仓库：`shougang-group-knowledge-portal`（门户路由/服务 + 前端）、`bisheng_2`（BiSheng 后端）
- 前置：本设计接续 `2026-07-07-qa-tree-children-optimization-design.md`（已上线 `enrich_files=false` + 信任上游鉴权）。本次继续攻剩余瓶颈。

## 1. 背景：为什么还慢（已在 171 环境实测定位）

对 `spaces/131/children` 做过分阶段计时（临时插桩，已还原）。一次顶层展开 bisheng 内部耗时 warm≈0.26s、冷/拥挤时冲到 0.8–1.1s，分解：

| 阶段 | warm 耗时 | 说明 |
|------|-----------|------|
| `perm_filter`（逐项鉴权本页 61 项） | 0.163s（63%） | 每项 ReBAC，经 OpenFGA `Read` |
| `folder_counts`（深扫 5 个文件夹内部算可见数） | 0.062s（24%） | 每文件夹递归 + 逐子文件鉴权 |
| 其余（建上下文/取数/排除非主版本） | ~0.034s | |

根因 = **ReBAC 权限校验的 OpenFGA 往返次数**：单次展开触发 ~90 次 `Read`（本页 61 项 + 各文件夹下子孙文件 + lineage）。OpenFGA 自身 `query_duration_ms=0`（<1ms），慢在 90 次 Python↔openfga 往返、并发上限仅 8；事件循环拥挤时放大成 1s+。

两个成因：
1. **不分页**——一次把某层全部直接子节点拉回并逐项鉴权（顶层 61 项）。
2. **深度文件夹计数**——为在文件夹行显示"N 个文件"（= 上游 `visible_success_file_num`，深度递归可见数），渲染顶层时就深扫每个文件夹内部，逐子孙文件鉴权。这是"把整个空间数据拉一遍"的真正来源。

space 131 为 `auth_type=APPROVAL`（非公共库），无"公共库整体放行"快路径，逐项鉴权不可省。

## 2. 现状链路关键事实（已核实）

- **上游 `/children` 已是 F027 游标分页**：入参含 `cursor`、`page_size`、`file_type`（0=DIR/1=FILE/空=both），返回 `PageInfiniteCursorData {data, page_size, has_more, next_cursor}`。但 `list_space_children` 内 `include_folder_counts=True` **写死**，深扫由此触发；endpoint 未暴露开关。
- 上游另有 `POST /{space_id}/folder-stats` 可按需取单文件夹深度统计（本次不依赖）。
- **门户 `get_qa_tree_children`**（`knowledge_service.py:806`）把游标塌缩：不传 `cursor`，`page_size` 默认 100，返回伪造的 `total`/`page`；`_map_qa_tree_node`（`:1567`）读 `visible_success_file_num` → `resolved_file_count`，并 **`has_children = (not is_file) and resolved_file_count > 0`**（`:1598`，由计数推导）。
- **门户路由**（`knowledge.py:457`）：`page/page_size` 参数、无 `cursor`；已登录信任上游鉴权、未登录保留 public 预检；18040/18000→403「包含无权限或不存在的知识库」。
- **前端**（`QAKnowledgeTreePicker.tsx`）：已**逐层懒加载文件夹**（展开→`loadChildren(parentId)`）；但**不分页**（`loadChildren` 一次拿全层、存 `result.data`）。文件夹行显示 `resolvedFileCount` 个文件（`:287`）；`resolvedFileCount` 还用于「勾选整文件夹 ≤20 前置校验」（`:218/241`）与空间"全选"态求和（`:397`）。整文件夹的真正取文件在后端 `resolve_qa_scope_file_ids`（`knowledge_space_service.py:7234`，服务端按 folderId 解析可见文件并强制 ≤20，文案「一次最多可选择20个文件进行问答。」）。

## 3. 目标与决策

把"一次拉全层 + 深扫文件夹"改为：

1. **游标分页**：每页 **10**，滚到底用 `next_cursor` 自动拉下一页，直到 `has_more=false`。
2. **轻量文件夹计数**：文件夹只出**直接子 SUCCESS 文件数**（单条批量 SQL，不递归、不逐项鉴权、无 OpenFGA）；`≤20` 精确校验交后端 QA 运行时兜底。

（用户已明确选择：轻量直接计数 + 滚动自动加载 + page_size=10。）

## 4. 改动① BiSheng：轻量文件夹计数模式

**endpoint + `list_space_children` 新增可选参数 `folder_count_mode: str = "deep"`**（默认 `deep` = 现状全深扫，其他调用方零影响）。门户传 `shallow`。

- `list_space_children` 把 `folder_count_mode` 透传给 `_handle_file_folder_extra_info`；`deep` 走现有 `_load_folder_stat_counts`（深度 + openfga），`shallow` 走新增 `_load_folder_direct_counts`。
- **新增 `_load_folder_direct_counts(folders)`**：对本页文件夹用**一条批量查询**统计各文件夹的**直接子项**（子节点的 `file_level_path == 父文件夹 prefix`，`prefix = f"{folder.file_level_path or ''}/{folder.id}"`）：
  - `visible_success_file_num` = 直接子中 `file_type=FILE AND status=SUCCESS` 的计数（写入该字段，门户映射不变）。
  - `has_children` = 是否存在任意直接子项（任意 file_type，用于展开箭头）。
  - 其余 `file_num/success_file_num/processing_file_num` 置为直接口径的可得值（不深扫）。
  - **无 OpenFGA、无递归**。
- **item 显式携带 `has_children`**：`shallow` 模式下文件夹节点在返回体里带上 `has_children` 布尔（因为轻量计数下"只含子文件夹"的目录 `visible_success_file_num=0`，不能再用计数推导展开箭头）。

**保留不动**：`_scan_visible_child_items` 对**本页节点**的逐项可见性过滤（安全必须，分页后每页仅 ≤10 项）、排除非主版本文件、游标契约。`deep` 模式行为完全不变。

**红线**：`folder_count_mode` 默认必须是 `deep`；BiSheng 独立知识库页 / 其他调用方零影响。

## 5. 改动② Portal：透传游标 + 新响应结构

- **schema `QaKnowledgeTreeNodeData`**（`schemas/knowledge.py:104`）：新增 `has_more: bool`、`next_cursor: str | None`；**删除 `total`、`page`**（门户自有接口，唯一消费方是本前端，一并改）。保留 `data`、`page_size`。
- **`get_qa_tree_children`**：签名改为 `(space_id, parent_id, cursor: str | None = None, page_size: int = 10)`；组 params 传 `cursor`（非空时）、`page_size`、`file_status=[SUCCESS]`、`enrich_files=False`、**`folder_count_mode="shallow"`**；调用 `_extract_success_data` 检测业务错误码后，从上游响应读 `has_more`/`next_cursor`/`page_size` 原样透传；`data` 仍走 `_map_qa_tree_node`。返回 `QaKnowledgeTreeNodeData{data, page_size, has_more, next_cursor}`。
- **`_map_qa_tree_node`**：`has_children` 优先读 item 显式 `has_children`（存在时直接用），否则回退现有 `(not is_file) and resolved_file_count > 0`（保证 `deep` 或旧数据兼容）。`resolved_file_count` 映射不变。
- **路由 `list_qa_tree_children`**：新增 `cursor: str | None = Query(default=None)`；`page_size` 默认 100 → **10**（保留 `ge=1, le=100`）；**删除 `page` 参数**（前端不再传）；已登录/未登录两分支都把 `cursor` 传入 `get_qa_tree_children`。错误翻译（18040/18000→403 文案）保持不变。未登录 public 预检保留。

## 6. 改动③ 前端：游标分页 + 滚动加载

- **`content.ts`**：
  - `QaKnowledgeTreeNodeDataDto` 去 `total`/`page`，加 `has_more`、`next_cursor`。
  - `fetchQaKnowledgeTreeChildren(spaceId, parentId?, cursor?)` → 返回 `{ data, pageSize, hasMore, nextCursor }`；`cursor` 非空时拼进 query。
- **`QAKnowledgeTreePicker.tsx`**：
  - 每个节点键（space 根 / 文件夹）状态从"仅 children 数组"扩展为 `{ items, nextCursor, hasMore, loadingMore }`（可用并行的 `nextCursorByKey/hasMoreByKey/loadingMoreByKey` 记录，`childrenByKey` 仍存已加载 items 数组，追加而非覆盖）。
  - `loadChildren`：拉第一页（无 cursor），存 items + nextCursor + hasMore。
  - 新增 `loadMoreChildren(key)`：`hasMore && !loadingMore` 时用 `nextCursor` 拉下一页，**追加**到 items、更新 cursor/hasMore、去重（按 `spaceId-id`）。
  - **滚动自动加载**：picker 列表滚动容器为 IntersectionObserver root；每个"已展开且 hasMore"的节点在其子项末尾渲染一个哨兵 `div`，进入视口即触发该 key 的 `loadMoreChildren`。
  - "N 个文件"标签、勾选逻辑**不改**（`resolvedFileCount` 现为直接子文件数）；`collectKnownFolderFileRefs` 仍从已加载 items 收集（分页/懒加载下可能不全 → 前置 ≤20 变近似，后端 `resolve_qa_scope_file_ids` 权威兜底，符合已确认取舍）。

## 7. 语义/体验变化（已确认接受）

- 文件夹计数含义：**深度递归可见数 → 直接子文件数**（嵌套子文件夹里的文件不计入标签，数值偏小）。
- 文件夹勾选 ≤20 前置校验变近似；真正拦截在后端 QA 运行时（文案不变）。
- 每层一次只加载 10 项，滚动续拉；单次展开 OpenFGA 往返从 ~90 降到 ~每页 ≤10 项对应的量，深扫整空间行为消除。
- 空间"全选"态（依赖计数求和）变近似显示，不影响实际问答范围（后端权威）。

## 8. 测试策略

**BiSheng**（`src/backend/.venv/bin/python`）：
- `folder_count_mode` 默认 `deep`：现有 children 行为/计数回归完全不变（快照对比 `visible_success_file_num` 深度值）。
- `shallow`：文件夹 `visible_success_file_num` = 直接子 SUCCESS 文件数（构造"直接 2 文件 + 子文件夹内 3 文件"→ 期望 2），`has_children` 对"仅含子文件夹"的目录为 True；**断言该路径零 OpenFGA 调用**（mock/spy）。
- 游标翻页：`page_size=10` 连翻多页，节点无重复、无漏项，末页 `has_more=false`、`next_cursor` 语义正确（沿用现有 F027 游标测试模式）。

**Portal**（`backend/.venv/bin/python`）：
- `get_qa_tree_children` 传 `folder_count_mode=shallow` 且透传 `cursor`；响应为 `{data, page_size, has_more, next_cursor}`（无 total/page）。
- `_map_qa_tree_node`：item 带显式 `has_children=True` 而 `resolved_file_count=0` 时，节点 `has_children=True`（解耦验证）。
- 上游 `status_code=18040`/`18000` → 403「包含无权限或不存在的知识库」文案不变；未登录 public 预检命中/未命中。

**前端**（vitest）：
- `fetchQaKnowledgeTreeChildren` 拼 `cursor`、解析 `has_more/next_cursor`。
- picker：首屏 10 项 + `loadMoreChildren` 追加去重、`has_more=false` 停止；文件夹计数展示、勾选 ≤20 前置提示仍触发。

## 9. 改动范围清单

| 仓库 | 文件 | 改动 |
|------|------|------|
| bisheng_2 | `knowledge/api/endpoints/knowledge_space.py` | `/children` 新增 `folder_count_mode` query 参数 |
| bisheng_2 | `knowledge/domain/services/knowledge_space_service.py` | `list_space_children`/`_handle_file_folder_extra_info` 支持 `folder_count_mode`；新增 `_load_folder_direct_counts`（批量直接计数 + 显式 `has_children`，零 openfga） |
| portal | `backend/app/schemas/knowledge.py` | `QaKnowledgeTreeNodeData` 增 `has_more`/`next_cursor`，删 `total`/`page` |
| portal | `backend/app/services/knowledge_service.py` | `get_qa_tree_children` 透传 `cursor` + `folder_count_mode=shallow` + 新响应；`_map_qa_tree_node` 解耦 `has_children` |
| portal | `backend/app/api/routes/knowledge.py` | 路由加 `cursor`、`page_size` 默认 10、删 `page`，两分支透传 |
| portal | `frontend/src/api/content.ts` | DTO/函数支持 cursor + has_more/next_cursor |
| portal | `frontend/src/components/QAKnowledgeTreePicker.tsx` | 分页状态 + `loadMoreChildren` + IntersectionObserver 滚动加载 |

## 10. 非目标（本次不做）

- 不改 ReBAC/OpenFGA 权限模型本身（不做批量 tuple 拉取的结构性改造——留作后续）。
- 不改后端 `resolve_qa_scope_file_ids` 的 ≤20 权威校验逻辑。
- 不引入会话级/进程级空间列表或权限缓存。
- 不改文件搜索路径（`qa/files/search`）。
- 文件夹计数不连子文件夹一起递归数（明确为直接子文件口径）。
