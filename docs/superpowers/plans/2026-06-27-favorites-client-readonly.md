# 我的收藏 — BiSheng client 只读视图 实现计划（C5/C6）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 `- [ ]`。

**Goal:** 在 BiSheng client（门户 iframe 实际应用）把"我的收藏"PERSONAL 库渲染为只读视图：仅查看/取消收藏，失效项置灰仅可取消，有效项点击打开源文件。

**Architecture:** 内容数据源用后端已就绪的 `/api/v1/knowledge/shougang-portal/favorites/files`（含源解析 + valid/invalid）。收藏库靠真实 PERSONAL 库 + grouped 返回 `is_favorite` 自然出现。前端按 `isFavorite` 特判走只读分支。

**Tech Stack:** 后端 bisheng `.venv/bin/python -m pytest`；client 前端 React18+Vite+**jest**+RTL（`src/frontend/client`）。

## Global Constraints
- 内容源固定为 `favorites/files`；取消收藏用 `favorites/remove`。
- 只读：隐藏上传/新建/删除/移动/标签/问答/重命名；仅查看 + 取消收藏。
- 失效项仅可取消收藏；有效项点击打开源文件（source_space_id/source_file_id）。
- client 测试命令（执行时确认 client/package.json 的 test 脚本，jest）。后端用 `cd /Users/zhangguoqing/works/bisheng_2/src/backend && .venv/bin/python -m pytest`。
- 收藏库删除/改名后端已禁（A6）；本计划不重复。

---

### Task D1: 确认/确保原生 grouped 返回 is_favorite（bisheng_2 后端）

**Files:**
- Verify/Modify: `src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py`（grouped/个人空间格式化路径，约 `:4500-4548` `_format_member_spaces` 用 `**one.model_dump()`）
- Test: `src/backend/test/test_grouped_is_favorite.py`

**Interfaces:** grouped 返回的 personal space 项含 `is_favorite: bool`（收藏库为 True）。

- [ ] **Step 1: 写测试**：构造/mock 一个 `is_favorite=True` 的 Knowledge，断言它经 `_format_member_spaces`（或 grouped 个人路径）产出的 `KnowledgeSpaceInfoResp.is_favorite is True`。`KnowledgeSpaceInfoResp` 已含 is_favorite 字段（继承 KnowledgeBase）。
- [ ] **Step 2: 运行**：`.venv/bin/python -m pytest test/test_grouped_is_favorite.py -v`。
- [ ] **Step 3:** 若已为 True（因 `**one.model_dump()` 透传）→ 测试即文档，无需改源；若为 False（某构造逐字段未传）→ 在该构造补 `is_favorite=one.is_favorite`。
- [ ] **Step 4:** 测试通过。
- [ ] **Step 5: 提交**（bisheng_2）`feat(knowledge): ensure grouped personal spaces expose is_favorite`。

---

### Task D2: client API 包装 + 类型映射

**Files:**
- Modify: `src/frontend/client/src/api/knowledge.ts`（`KnowledgeSpace` 类型 ~`:145`、`mapSpace` ~`:496`，末尾加函数）
- Test: `src/frontend/client/src/api/knowledge.favorite.test.ts`（jest，参考现有 `knowledge.test.ts` 的 `jest.mock('~/api/request')`）

**Interfaces (Produces):**
- `KnowledgeSpace` 增 `isFavorite: boolean`
- `mapSpace` 映射 `isFavorite: Boolean(raw.is_favorite)`
- `interface PortalFavoriteFile { favoriteFileId, sourceSpaceId, sourceFileId, title, fileName, status:'valid'|'invalid', updatedAt }`
- `listPortalFavoritesApi({page?,pageSize?}) -> { data: PortalFavoriteFile[], total }`（GET `/api/v1/knowledge/shougang-portal/favorites/files`，映射 snake→camel）
- `removePortalFavoriteApi({sourceSpaceId, sourceFileId}) -> { removed: boolean }`（POST `/api/v1/knowledge/shougang-portal/favorites/remove` body `{source_space_id, source_file_id}`）

- [ ] **Step 1:** 写 jest 失败测试：mock request.get/post，断言 URL、参数、响应映射（含 status invalid、isFavorite）。
- [ ] **Step 2:** 运行 client 测试确认失败。
- [ ] **Step 3:** 实现类型/映射/两个函数（参照 `getGroupedSpacesApi` 的 request 用法与 `mapSpace` 风格）。
- [ ] **Step 4:** 测试通过。
- [ ] **Step 5: 提交** `feat(client): favorite list/remove api + isFavorite space mapping`。

---

### Task D3: PortalKnowledgeWorkbench 收藏库只读视图

**Files:**
- Modify: `src/frontend/client/src/pages/knowledge/portal/PortalKnowledgeWorkbench.tsx`（`isActiveSpacePersonal` ~`:365`；内容加载；传 `KnowledgeSpaceContent` 处 ~`:1837-1890`）
- Possibly Modify: `src/pages/knowledge/SpaceDetail/index.tsx`（只读 prop）、`portal/components/PortalHeaderActions.tsx`（隐藏上传/新建）
- 抽纯逻辑到可单测 util（如 `portal/favoriteView.ts`）：把"收藏项→展示项""是否只读""失效判定→可点击性"等做成纯函数。
- Test: `src/frontend/client/src/pages/knowledge/portal/favoriteView.test.ts`（纯逻辑 jest）+ 必要的组件渲染断言。

**Interfaces (Consumes):** D2 的 `listPortalFavoritesApi/removePortalFavoriteApi`、`KnowledgeSpace.isFavorite`。

- [ ] **Step 1:** 抽纯逻辑 + 写 jest 测试：
  - `isFavoriteSpace(space) -> boolean`
  - `toFavoriteListItem(fav)`：valid→可点击+可取消；invalid→置灰+「已失效」+不可点击+仅可取消。
  - `favoriteOpenTarget(fav)`：返回 `{spaceId: sourceSpaceId, fileId: sourceFileId}`（仅 valid）。
- [ ] **Step 2:** 运行确认失败。
- [ ] **Step 3:** 实现纯逻辑；在 `PortalKnowledgeWorkbench` 接入：
  - `const isActiveSpaceFavorite = activeSpace?.isFavorite === true;`
  - 收藏库 active：用 `listPortalFavoritesApi` 取内容（替代 `space/{id}/children` 分支）；渲染只读（`hideFilePermissionActions` 置真 + `PortalHeaderActions` canUpload/canCreateFolder=false + 隐藏删除/移动/标签/问答）。
  - 列表项：失效置灰 +「已失效」标签；有效项点击 → 用 `favoriteOpenTarget` 打开源文件（复用现有文件预览/导航）。
  - 每项「取消收藏」→ `removePortalFavoriteApi` → 成功后刷新收藏列表。
- [ ] **Step 4:** 纯逻辑测试通过；可达的组件断言通过；`npm/jest` 全量不回归。
- [ ] **Step 5: 提交** `feat(client): read-only favorites space view with invalid state and uncollect`。

---

### Task D4: 端到端自检 + 验收走查
- [ ] client 测试全绿（对比基线无新增失败）。
- [ ] 后端 grouped 测试 + 收藏相关测试全绿。
- [ ] 按 spec 第 6 节验收 1–4 手动走查（个人库出现我的收藏、只读、失效态、点击打开源文件、取消收藏）。

## 风险
- `PortalKnowledgeWorkbench` 体量大（2127 行）；D3 优先抽纯逻辑单测，组件接线用最小侵入 + 渲染断言。
- "打开源文件"复用现有预览/导航的真实能力，执行时对照现有 `handleSelectFile`/`PortalPreviewWorkspace` 的真实跳转方式。
- client 测试是 jest（非 vitest），mock `~/api/request`。
