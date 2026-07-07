# 首钢知库三项增强 — 设计文档

- 日期：2026-07-06
- 涉及仓库：
  - `shougang-group-knowledge-portal`（门户 + BFF），基线 `master`
  - `bisheng_2`（BiSheng 平台，后端 + `client` 前端），基线 `feat/2.5.0-sg`
- 分支/worktree 布局：
  - bisheng_2：从 `feat/2.5.0-sg` 新建 worktree + 分支 `feat/sg-kb-enhancements` —— 承载功能1全部、功能2全部、功能3后端。
  - shougang：从 `master` 新建 worktree + 分支 `feat/home-latest-by-views` —— 承载功能3的 BFF/配置/前端。

> 说明：bisheng_2 当前检出在 `mainline2`，实现时明确基于 `feat/2.5.0-sg` 建 worktree，不改动现有工作区。

---

## 功能1 — 文件改名去后缀（bisheng_2 `client` 前端，纯前端）

### 现状
- 后端 `rename_file`（`src/backend/bisheng/knowledge/domain/services/knowledge_space_service.py:8013` 附近）已有扩展名守卫：新旧后缀不同则抛 `SpaceFileExtensionError`。
- 前端内联改名钩子 `src/frontend/client/src/pages/knowledge/hooks/useInlineRename.ts`（FileTable + FileCard 共用）目前把**完整文件名（含后缀）**塞进输入框，仅默认选中主名（`lastIndexOf(".")` 之前）。
- 文件名字段（`KnowledgeFileBase.file_name`）存的是含扩展名的完整名。

### 目标行为
查看知识空间文件列表、对文件重命名时：**只显示/只允许编辑主名，不显示、不允许修改后缀**。

### 改动
仅前端，改 `useInlineRename.ts`（及其在 `FileTable.tsx`、`FileCard.tsx` 的渲染消费点）：
1. 进入编辑态时，输入框 value 初始化为**主名**（`name.slice(0, lastDot)`），不含后缀。
2. 后缀（如 `.pdf`）以**只读灰字**紧贴输入框右侧展示，让用户知道扩展名存在且不可改。
3. 提交时把「用户输入的主名 + 原后缀」拼回完整文件名，再调用 `renameFileApi`（后端契约不变，仍收含后缀完整名，body `{ name }`）。
4. 边界：
   - 名字里没有 `.`（无扩展名文件）→ 整名可编辑、无后缀标签。
   - 文件夹（`FileType.FOLDER`）→ 维持整名编辑，无后缀概念。
5. 后端扩展名守卫保留作为兜底，不改。

### 验收
- 文件列表（表格视图 + 卡片视图）双击/点重命名进入编辑时，输入框只显示主名，右侧灰字显示后缀。
- 改完保存，文件后缀不变；后端存的仍是含后缀完整名。
- 文件夹改名不受影响。

---

## 功能2 — 个人知识库限制 + 延迟创建（bisheng_2 前后端）

### 规则适用范围
所有 `space_level == PERSONAL` 的知识库（`KnowledgeSpaceLevelEnum.PERSONAL`）。

### 现状
- `我的收藏` 已实现：`Knowledge.is_favorite` 标记的系统个人库，`_ensure_favorite_space()` 幂等/并发安全地延迟创建（`knowledge_space_service.py:2479` 附近），端点 `get_shougang_portal_personal_spaces`（`:2393`）与 `get_spaces_by_level(PERSONAL)`（`:5250`）会触发它。
- `{用户名}的知识库` **尚不存在**，需新增。
- 客户端侧边栏 `KnowledgeSpaceSidebar.tsx` 调 `getGroupedSpacesApi` → `GET /api/v1/knowledge/space/grouped` → `get_grouped_spaces()`（`:5233`），该方法当前**不做** ensure（收藏库靠别处已创建后持久存在才显示）。
- 条目菜单 `KnowledgeSpaceItem.tsx` 通过 props `canEditSpace / canManageMembers / canDeleteSpace` + `isFavorite` 控制菜单项；`isFavorite` 分支已隐藏设置/成员/删除/改名。

### 目标行为
- 个人知识库分类下**不能新建**知识库。
- 延迟创建两个系统个人库：`我的收藏`（已存在，保持现状）+ `{用户名}的知识库`（新增，如"张三的知识库"）。
- 个人知识库**只有编辑功能**（空间设置/改名），**不能删除、不能授权**。
- `我的收藏` 更严格：保持现状——不可编辑、不可删除、不可授权，仅作为收藏文件入口。

### 后端改动（`knowledge_space_service.py` + 端点）
1. **延迟创建 `{用户名}的知识库`**：新增 `_ensure_personal_default_space()`，仿 `_ensure_favorite_space`：
   - 名称 `f"{user_name}的知识库"`（`user_name` 取当前登录用户）。
   - 幂等：先查该用户是否已有同名/标记的个人默认库，有则复用，无则创建 `type=SPACE`、`level=personal`、`user_id=当前用户`。
   - 并发安全：借鉴收藏库的唯一约束/回查复用赢家策略（若无现成唯一索引，则以「用户 + 默认库标记」维度保证唯一，或复用查重逻辑）。
   - 与收藏库合并为 `_ensure_personal_spaces()`，一次确保两者。
2. **挂载点**：把 `_ensure_personal_spaces()` 挂到 `get_grouped_spaces()`，保证客户端侧边栏首次加载时两库都出现；`get_spaces_by_level(PERSONAL)` / 门户 `personal-spaces` 已有收藏 ensure，补上默认库 ensure，保持一致。
3. **禁止用户新建个人库**：`create_knowledge_space`（`:2159` 附近）收到 `level==personal` 时抛业务错误拒绝；系统内部 ensure 走内部创建路径，不经此公共入口，不受限。
4. **禁止删除个人库**：`delete_space`（`:4910` 附近）对 `PERSONAL` 空间拒绝（收藏库已有 `is_favorite` 保护，这里覆盖全部个人库）。
5. **禁止授权**：成员/授权相关服务（`update_member_role` `:5626`、`remove_member` `:5705`）对 `PERSONAL` 空间拒绝。

### 前端改动（`KnowledgeSpaceSidebar.tsx` + `KnowledgeSpaceItem.tsx`）
1. **隐藏个人分组"新建"入口**：移除/隐藏个人分组的 `+`；若创建流程按 level 选择，则移除 personal 选项。
2. 个人（非收藏）空间条目：传 `canEditSpace=true`、`canManageMembers=false`、`canDeleteSpace=false`。
3. `我的收藏`：`isFavorite` 分支不动（已全隐藏）。

### 验收
- 侧边栏"个人知识库"分组无新建入口；调后端 create 个人库接口被拒。
- 新用户/首次打开知识页，个人分组自动出现 `我的收藏` + `{用户名}的知识库`。
- 个人库条目菜单只有"空间设置"（可改名），无"成员管理/授权"、无"删除"；后端对个人库的删除/授权接口拒绝。
- `我的收藏` 行为不变。

---

## 功能3 — 首页"最新精选"按浏览量排序（ES 聚合，仅最新精选）

### 现状
- 首页内容链路：前端 `HomePage` → BFF `GET /api/v1/knowledge/home`（`get_home_content`，`backend/app/services/knowledge_service.py:199`）→ BiSheng `POST /api/v1/knowledge/shougang-portal/home`（`get_shougang_portal_home`，`bisheng_2 knowledge_space_service.py:3104`）。
- BiSheng 侧：按 section 的 tag 选文件 → `_filter_shougang_portal_visible_files` **已按权限过滤** → 当前 `_sort_shougang_portal_file_items(items, "updated_at", None)` 排序 → 切 `section.page_size`。
- X 条数已由后台配置 `display.home.section_page_size`（"知识推荐/典型案例条数"）控制，透传到 BiSheng 的 `page_size`。
- 浏览量是 ES 埋点事件 `portal_document_read`（`PortalTelemetryEventService`），**非数据库字段**；`count_file_views(file_id)` 可单文件统计；无现成的按浏览量排序查询。
- 默认分区：`最新精选`（tag=`最新精选`）、`典型案例`（tag=`典型案例`），定义于 `backend/app/config/portal_config.py:244/253`，schema `SectionConfig`（`backend/app/schemas/portal_config.py:38`）。

### 决策
- 浏览量来源：**ES 聚合排序**（保留埋点、无迁移、保留历史浏览数据、权限过滤已前置）。
- 范围：**仅"最新精选"**分区按浏览量；"典型案例"保持 `updated_at`。
- "哪个分区按浏览量排"由**配置驱动**（避免硬编码 tag 字符串）。
- X 条数沿用现有 `section_page_size`，不新增配置项。

### shougang 改动（BFF + 配置 + 可选前端）
1. `SectionConfig`（`portal_config.py` schema）增加 `sort: Literal["updated_at", "views"] = "updated_at"`。
2. 默认配置数据（`backend/app/config/portal_config.py`）把"最新精选"分区设为 `sort="views"`；"典型案例"维持默认 `updated_at`。
3. BFF `get_home_content`（`knowledge_service.py:214` 的 section 载荷）每个 section 带上 `"sort": section.sort`，透传给 BiSheng。
4. 兼容既有持久化配置（SQLite 里旧 sections 无 `sort` 字段）：pydantic 默认值 `updated_at` 保证反序列化不报错；在门户配置加载/规范化时，对 `tag == 默认"最新精选"tag` 且 `sort` 仍为默认 `updated_at` 的 section，补正为 `sort="views"`，确保历史部署无需管理员手动操作即可生效。
5. 本次**不**在后台"首页分区"页新增"排序方式"下拉（YAGNI）：排序由默认配置 + 上述规范化决定；后续如需管理员自助配置再单独迭代。

### BiSheng 后端改动（`get_shougang_portal_home` 及 schema）
1. `ShougangPortalHomeReq` 的 section 项 schema 增加 `sort: str = "updated_at"`。
2. 新增批量聚合 `PortalTelemetryEventService.count_file_views_batch(file_ids) -> dict[int, int]`（ES terms 聚合，字段 `event_data.portal_document_read_file_id`，一次查完候选文件的浏览次数）。
3. `get_shougang_portal_home` 逐 section 处理时：
   - `sort == "views"`：对已权限过滤的候选文件，用 `count_file_views_batch` 取浏览量，按浏览量降序（并列以 `update_time` 降序兜底）排序，切 `page_size`。
   - 其它 section：维持现有 `updated_at` 排序。
4. BFF 兜底路径（主接口异常时的 `search_files`，`knowledge_service.py:234`）维持 `updated_at`，降级路径不做浏览量排序。

### 验收
- 管理员在"展示配置"里改"知识推荐/典型案例条数" = X，"最新精选"展示条数随之变化。
- "知识推荐·最新精选"按浏览量高→低展示当前登录用户**有权限看到**的前 X 条。
- "典型案例·事故分析"排序不变（更新时间）。
- 无历史浏览数据丢失（沿用 ES 埋点）。

---

## 跨功能注意事项
- bisheng_2 后端测试用 `src/backend/.venv/bin/python`（裸 `python` 缺依赖）。
- 三功能相互独立，可分别验证；功能3 跨两仓库，需 BFF 与 BiSheng 契约（section `sort` 字段）对齐后联调。
- 部署验证参考现有测试环境机制（`192.168.106.171`）。
