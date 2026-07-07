# QA 树 children 接口优化设计

- 日期：2026-07-07
- 接口：`GET /api/v1/knowledge/qa/tree/spaces/{space_id}/children`
- 涉及仓库：`shougang-group-knowledge-portal`（门户，改动①②③）、`bisheng_2`（BiSheng 后端，改动③）
- 核心约束：**业务语义不变**——用户可见行为、返回结构、错误文案、精确文件数全部保持一致，只改内部实现。

## 1. 背景与现状链路

前端 `frontend/src/api/content.ts` 的 `fetchQaKnowledgeTreeChildren` 调用门户接口，用于 `QAKnowledgeTreePicker` 懒加载知识库目录树的直接子节点。

请求链路三层：

1. **门户路由** `backend/app/api/routes/knowledge.py:448` `list_qa_tree_children`
   - 已登录：调 `list_visible_spaces()` 构造可见空间 ID 集合，校验 `space_id` 是否在内，否则 403「包含无权限或不存在的知识库」。
   - 未登录：调 `list_public_spaces()` 构造 public 空间 ID 集合，不在内则 403「未登录仅可浏览公共知识库目录」。
   - 通过后调 `service.get_qa_tree_children(...)`。
2. **门户服务** `backend/app/services/knowledge_service.py:806` `get_qa_tree_children`
   - 组 params（`page_size`、`file_status=[SUCCESS]`、可选 `parent_id`），GET 上游 `/api/v1/knowledge/space/{space_id}/children`，用 `_map_qa_tree_node`（`:1558`）映射成 `QaKnowledgeTreeNode`。
3. **BiSheng 上游** `bisheng_2 .../knowledge_space_service.py:7143` `list_space_children`（F027 游标分页）
   - 权限校验 → 排除非主版本文件 → `_scan_visible_child_items` 游标扫描 + 可见性过滤 → `_enrich_with_version_info` 版本富化 → `_handle_file_folder_extra_info(include_folder_counts=True)`（`:6940`，对每个文件夹算 counts、对文件批量拉 tags/缩略图/summary）→ 返回 `{data, page_size, has_more, next_cursor}`。

### 关键事实（已核实）

- **前端消费**：`QAKnowledgeTreePicker.tsx` `loadChildren`（`:143`）一次性加载直接子节点，**不翻页、不消费 total/page**；但第 287 行把文件夹的 `resolvedFileCount`（= 上游 `visible_success_file_num`）显示为「N 个文件」，并用于 `resolvedFileCount > 20` 判断（`:218/241`）与求和（`:397`）。→ **精确文件数是可见业务数据，不能降级成布尔。**
- **上游错误约定**：`bisheng_2` 的 `BaseErrorCode` 异常经 `main.py:38` `handle_http_exception` 统一转成 **HTTP 200 + body `{status_code, status_message}`**。权限拒绝 `SpacePermissionDeniedError` = 18040，空间不存在 `SpaceNotFoundError` = 18000。
- **门户既有模式**：`_extract_success_data`（`knowledge_service.py:1742`）对 `status_code ∉ (None, 200)` 抛 `BishengBusinessError`；route 层 `_raise_bisheng_business_error`（`knowledge.py:77`）翻译成 HTTP——但它**透传上游英文文案**，且只对 `{18040, 404}` 映射 403（不含 18000），因此**不能直接复用**。
- **门户 `get_json`**（`app/clients/bisheng.py:152`）用 `raise_for_status()`，只对非 2xx 抛异常；上游业务错误是 HTTP 200，不会自动抛。若不显式检测 body `status_code`，无权限会被当空数据返回**空列表**。

## 2. 改动① 信任上游鉴权（门户仓库）

**问题**：懒加载树每展开一个目录就是一次 children 请求，已登录分支每次全量 `list_visible_spaces()`（一次 `/knowledge/space/grouped`，失败回退 4 个并行接口 + merge + sort），仅为校验单个 `space_id`；而上游 `/children` 已做权限校验，重复。

**改法**：

- **已登录分支**（`list_qa_tree_children`）：删除 `list_visible_spaces()` 与 membership 预检，直接调 `get_qa_tree_children(...)`。
- **`get_qa_tree_children`**：解析上游响应前，先检测 body `status_code`（复用 `_extract_success_data` 的判定逻辑），非 200 码抛 `BishengBusinessError`。避免无权限被当空数据。
- **route 层错误翻译**（children 专用，不复用 `_raise_bisheng_business_error`）：
  - `status_code ∈ {18040, 18000}` → `HTTPException(403, "包含无权限或不存在的知识库")`（**与现状文案逐字一致**）。
  - 其他非 200 码 → 沿用现有翻译（`_raise_bisheng_business_error`，如 502）。
- **未登录分支**：保留 `list_public_spaces()` 预检 + 「未登录仅可浏览公共知识库目录」403；同样对上游错误做上述翻译（防止匿名越权时返回空列表）。

**语义保证**：无权限/不存在仍返回 403 且文案不变；有权限正常返回。已登录每次展开的全量空间拉取 **1 → 0 次**。

**风险**：未登录分支仍每次 `list_public_spaces()`，但该场景低频、且用户选择保留「未登录仅可浏览公共库」约束。

## 3. 改动② 修分页内部正确性（门户仓库，前端零改动）

**问题**：上游 F027 已移除 `total`/`page`；`get_qa_tree_children` 仍 `data.get("total") or len(nodes)`、`data.get("page") or page` 兜底——读的是不存在的字段，靠 `or` 兜底「能跑但语义误导」。前端不消费 total/page、不翻页。

**改法**：`get_qa_tree_children` 明确本地赋值 `total = len(nodes)`、`page = 入参 page`、`page_size = 上游返回值 or 请求值`，并加注释说明「上游为游标分页，门户当前仅加载首页直接子节点，total 非全量、不跨页」。返回结构 `QaKnowledgeTreeNodeData{data,total,page,page_size}` **保持不变**，不引入 cursor 透传。与改动①的 status_code 检测合并实现。

**语义保证**：纯清理 + 文档化，零行为变化；`> page_size` 截断的现状按既定选择保持不动。

## 4. 改动③ 上游轻量富化（BiSheng 仓库 + 门户传参）

**问题**：上游对每个文件节点做 tags 批量查询、缩略图、summary、版本字段富化，QA 树全不消费（`QaKnowledgeTreeNode` 无这些字段）。

**改法**：

- BiSheng `list_space_children` 与 endpoint（`knowledge_space.py:442`）新增**可选参数** `enrich_files: bool = True`（默认 True = 现状不变，其他调用方零影响），透传到 `_handle_file_folder_extra_info`。
- 门户 `get_qa_tree_children` 显式传 `enrich_files=false`。此时上游：
  - **保留**：排除非主版本文件（影响可见集合，必须留）、folder counts（`include_folder_counts=True`，含精确 `visible_success_file_num`）。
  - **跳过**：`_enrich_with_version_info`（版本字段富化）、文件 `_load_file_tags_batch`（tags）、缩略图 `get_logo_share_link`、summary。

**语义保证**：QA 树 map 只用 id/name/type/path/file_ext/`resolved_file_count`（= `visible_success_file_num`），全部保留 → 「N 个文件」精确值不变；被跳过字段前端本就不用。

**红线**：folder counts **不**降级成布尔，精确数保留。

**风险**：`enrich_files` 默认值必须保持现有全富化，确保 BiSheng 独立知识库页 / 其他调用方零影响。

## 5. 测试策略

- **门户**（pytest，`backend/tests/test_knowledge_api.py` 等）：
  - `get_qa_tree_children` 有权限成功路径；
  - 上游返回 `status_code=18040` → 403「包含无权限或不存在的知识库」；
  - 上游返回 `status_code=18000` → 403 同文案；
  - 未登录 public 预检（命中 / 未命中 403）；
  - 改动②：total = 当前页节点数、page = 入参、page_size 取值。
- **BiSheng**（用 `src/backend/.venv/bin/python` 跑）：
  - `enrich_files=False` 与默认返回的**节点集合、folder counts 完全一致**，仅 tags/version/缩略图/summary 字段缺省；
  - 默认参数（`enrich_files=True`）行为回归不变。

## 6. 改动范围清单

| 仓库 | 文件 | 改动 |
|------|------|------|
| portal | `backend/app/api/routes/knowledge.py` | ① 去已登录预检、children 专用错误翻译（18040/18000→403 中文） |
| portal | `backend/app/services/knowledge_service.py` | ①② status_code 检测 + 分页字段本地赋值；③ 传 `enrich_files=false` |
| bisheng_2 | `.../knowledge/api/endpoints/knowledge_space.py` | ③ endpoint 新增 `enrich_files` query 参数 |
| bisheng_2 | `.../knowledge/domain/services/knowledge_space_service.py` | ③ `list_space_children` / `_handle_file_folder_extra_info` 支持 `enrich_files`，跳过版本富化 |

## 7. 非目标（本次不做）

- 不改前端 `QAKnowledgeTreePicker` / `content.ts`（保持不翻页、不消费 total/page）。
- 不支持 `> page_size` 子节点分页加载（现状静默截断保持）。
- 不改 folder counts 计算方式（保留精确 `visible_success_file_num`）。
- 不引入会话级 / 进程级空间列表缓存。
