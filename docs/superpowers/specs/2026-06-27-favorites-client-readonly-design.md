# 我的收藏 — BiSheng client 只读视图 设计（C5/C6 子项目）

- 文档版本：v1.0
- 创建日期：2026-06-27
- 状态：待评审
- 仓库：`bisheng_2`（`src/frontend/client` 前端 + `src/backend` 一处原生端点小改）
- 关联：[2026-06-26-my-favorites PRD/Plan]，承接需求 1/2/3 的前端落地

## 1. 背景

需求 1/2/3 的后端地基已在 Phase A 完成：每用户一个真实 PERSONAL 知识库 `is_favorite=True`（懒创建、服务层禁删改）、收藏存引用、`/api/v1/knowledge/shougang-portal/favorites/files` 返回收藏项（含源文件解析与 `valid|invalid` 失效态）。

门户"个人知识库"实际是嵌入的 BiSheng **client** 应用 `/workspace/knowledge-portal`（`PortalKnowledgeWorkbench`）。因此"我的收藏"在个人库列表的展示、只读限制、失效态 UI 都落在 client。

关键事实：client 空间列表走 **BiSheng 原生** `GET /api/v1/knowledge/space/grouped`（非 portal BFF 的 personal-spaces）。该原生端点当前**不返回 `is_favorite`**，client `mapSpace` 也未映射。

## 2. 目标（对应需求）

1. 「我的收藏」作为个人知识库出现在 client 个人库分组中（需求 1：默认存在、不可删除——删除保护已由后端 A6 保证）。
2. 进入「我的收藏」只能：查看收藏内容、取消收藏；隐藏一切其它写操作（需求 2）。
3. 源文件被删的收藏项显示「已失效」，不可打开/预览，仅可取消收藏（需求 3）。
4. 有效收藏项点击 → 打开其**源文件**（源知识库中的原文件），而非空引用。

## 3. 范围

### 3.1 后端（bisheng_2，一处小改）
- 让原生 `GET /api/v1/knowledge/space/grouped` 的 `personal_spaces`（及其它分组如适用）每项返回 `is_favorite` 字段。定位该端点的 service/响应构造处，把 Knowledge.is_favorite 透出。
- 不改收藏的增删查端点（已就绪）。

### 3.2 client 前端
- 类型与映射：`KnowledgeSpace` 增 `isFavorite: boolean`；`mapSpace`（`client/src/api/knowledge.ts:496`）映射 `raw.is_favorite`。
- API 包装（`client/src/api/knowledge.ts`）：
  - `listPortalFavoritesApi({page,pageSize}) -> { data: PortalFavoriteFile[], total }`（GET `/api/v1/knowledge/shougang-portal/favorites/files`）
  - `removePortalFavoriteApi({sourceSpaceId, sourceFileId}) -> { removed }`（POST `/api/v1/knowledge/shougang-portal/favorites/remove`）
  - 类型 `PortalFavoriteFile { favoriteFileId, sourceSpaceId, sourceFileId, title, fileName, status:'valid'|'invalid', updatedAt }`
- `PortalKnowledgeWorkbench`（`client/src/pages/knowledge/portal/PortalKnowledgeWorkbench.tsx`）：
  - 识别收藏库：`isActiveSpaceFavorite = activeSpace?.isFavorite === true`。
  - 收藏库 active 时：内容数据源改用 `listPortalFavoritesApi`（不走 `space/{id}/children`）；渲染只读。
  - 只读：复用现有 `hideFilePermissionActions`（个人空间已隐藏部分），并对收藏库额外隐藏上传/新建/网页链接（`PortalHeaderActions` 的 canUpload/canCreateFolder 置 false）、删除/移动/标签/问答等。
  - 失效项：`status==='invalid'` → 置灰 + 「已失效」标签 + 不可打开/预览；仅「取消收藏」。
  - 有效项：点击 → 打开源文件（用 `sourceSpaceId`/`sourceFileId` 导航/预览到源空间的源文件）。
  - 取消收藏：列表项操作调用 `removePortalFavoriteApi`，成功后刷新收藏列表（并可触发空间文件数刷新）。

## 4. 关键设计决策

- **内容数据源 = `favorites/files` 端点**（已确认）。收藏库 active 时前端特判走该端点，天然获得源文件信息与 valid/invalid，避免展示无内容的引用行。
- **收藏库的出现** = 真实 PERSONAL 库 + 原生 grouped 返回 is_favorite + 前端映射；不新增前端路由（沿用现有空间选中机制）。
- **只读 = 前端隐藏入口 + 后端服务层兜底**（A6 已保证删/改拒绝；上传进收藏库的后端 guard 作为已知次要缺口留待后续，前端不暴露入口）。
- **打开源文件**：复用 client 现有文件预览/导航能力，目标定位 source 空间 + source 文件。

## 5. 测试（client 用 jest + RTL）
- api 单测：`listPortalFavoritesApi`/`removePortalFavoriteApi` 的 URL 与响应映射（jest.mock request）。
- `mapSpace` 映射 `isFavorite` 单测。
- 组件/逻辑：收藏库 active 时隐藏写操作、失效项仅可取消、点击有效项触发打开源文件（按 client 现有测试可达粒度，优先抽纯逻辑函数单测 + 必要的组件渲染断言）。
- 后端：原生 grouped 返回 is_favorite 的单测（沿用 bisheng `.venv/bin/python -m pytest`）。

## 6. 验收
1. 登录后 client 个人库分组出现「我的收藏」，无删除/重命名入口。
2. 进入「我的收藏」：无上传/新建/删除/移动/标签/问答入口，仅查看 + 取消收藏。
3. 收藏一个文件→删源文件→进「我的收藏」显示「已失效」、不可打开、仅可取消。
4. 有效项点击打开源文件；取消收藏后从列表消失。

## 7. 不在范围（YAGNI）
- 收藏分组/排序/备注、收藏全文检索、配额、分享。
- 阻止"直接上传进收藏库"的后端 add-file guard（前端已隐藏入口；留待后续小补）。
