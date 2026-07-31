# Design: QA Knowledge Picker Level Tabs

**Date:** 2026-07-30  
**Repo:** `shougang-group-knowledge-portal`  
**Status:** Approved for planning (awaiting implementation plan)

## Goal

In the portal knowledge-scope picker, under **按知识库**, add a second-level tab bar that separates spaces by type: 公共 / 部门 / 团队 / 个人. Selection may span tabs. **按文件分类** stays unchanged.

## Non-goals

- No changes to BiSheng Client (`ChatKnowledge`, `UserSelectedKnowledgePicker`) or Platform.
- No BFF / BiSheng API changes; reuse the existing `spaces` payload and `spaceLevel` field.
- No tab badge for per-level selected counts in v1 (summary bar is enough).
- Do not surface unknown/`other` space levels in the four tabs.

## Surfaces

| Surface | Component | Notes |
|---------|-----------|--------|
| Home「小智知道」 | `QAKnowledgeTreePicker` via `HomePage` | Same component |
| `/apps` 智能问答 | `QAKnowledgeTreePicker` via `QAPage` / `SmartQaWorkspace` | Same component |

## Current behavior

- Level-1 tabs: `按知识库` | `按文件分类`.
- Under `按知识库`, spaces are shown as one scrollable list with **section headers** per `spaceLevel` (`SPACE_LEVEL_ORDER` / `SPACE_LEVEL_LABELS`).
- Multi-select files/folders/whole spaces; max 20 files; search is global by filename/encoding.

## Target UX

Panel top → bottom:

1. Header「知识范围」+ close
2. Level-1 tabs: `按知识库` | `按文件分类` (unchanged)
3. **Only when `pickerMode === 'knowledge'` and search is empty:** level-2 tabs  
   `公共知识库` | `部门知识库` | `团队知识库` | `个人知识库`  
   Always show all four; empty tab shows empty copy (e.g.「暂无公共知识库」)
4. Search box (global, unchanged semantics)
5. Selected summary bar (cross-tab totals; clear clears all)
6. List: spaces for the **active** level only (no level section headers — tabs own that role)

When search has a non-empty query: **hide** level-2 tabs and show global search results (same as today). Clearing search restores level-2 tabs and the previously active level.

### Level mapping

| Tab label | `spaceLevel` |
|-----------|--------------|
| 公共知识库 | `public` |
| 部门知识库 | `department` |
| 团队知识库 | `team` |
| 个人知识库 | `personal` |

Spaces with missing/`other`/unknown `spaceLevel` are **not** listed in any of the four tabs in v1.

### Default active tab

Prefer the first level in order (`public` → `department` → `team` → `personal`) that has at least one space. If all empty, default to `public`.

### Selection

- Switching level-2 tabs only filters the list; `scope` selection is preserved across tabs.
- File limit (20) and whole-space / folder / file toggle behavior unchanged.
- Level-1 switch to `按文件分类` does not show level-2 tabs; existing category tree behavior unchanged.

## Implementation approach (chosen)

**Frontend filter + secondary tabs** inside `QAKnowledgeTreePicker`:

1. Add `activeSpaceLevel` state (`public` | `department` | `team` | `personal`).
2. Derive grouped spaces from props; render only `activeSpaceLevel` in the knowledge-mode tree list.
3. Remove the in-list level group headers under knowledge mode (replaced by tabs).
4. Style level-2 tabs similarly to existing `modeTabs` (slightly denser if needed for four columns).
5. a11y: `role="tablist"` / `role="tab"` / `aria-selected` consistent with level-1 tabs.

### Files

| File | Change |
|------|--------|
| `frontend/src/components/QAKnowledgeTreePicker.tsx` | Level-2 tabs, filter, default tab, empty copy, hide tabs while searching |
| `frontend/src/components/QAKnowledgeTreePicker.module.css` | Level-2 tab styles |
| `HomePage` / `QAPage` | No prop API change expected |

## Error / empty / edge cases

| Case | Behavior |
|------|----------|
| Empty level | Show「暂无{label}」in list area |
| All levels empty | Still show four tabs; default `public`; empty copy |
| Search active | Hide level-2 tabs; global results |
| Search cleared | Restore last `activeSpaceLevel` |
| `other` spaces | Omitted from tabs (v1) |
| Loading spaces | Keep existing loading UI |

## Testing & verification

### Automated

Portal has no mature unit suite for this picker. **Exception:** rely on the manual checklist below as the completion gate (no pytest/Jest requirement for this UI-only change). How to confirm correctness: visual + interaction pass on both mount points; diff review of TSX/CSS.

### Manual / integration checklist

**Preconditions:** portal frontend + BFF running; account with access to at least two space levels if possible (also verify empty levels).

| # | Steps | Pass criteria |
|---|--------|----------------|
| 1 | Home → 小智知道 → open picker → 按知识库 | Four level tabs visible |
| 2 | Click each tab | List shows only that level; empty levels show empty copy |
| 3 | Select files/spaces on tab A, switch to B, back to A | Selections preserved; summary count correct |
| 4 | Select across two levels until near 20 | Cap still enforced; tip unchanged |
| 5 | Type search query | Level-2 tabs hidden; global results; clear restores tabs + last level |
| 6 | Switch to 按文件分类 | No level-2 tabs; category mode works |
| 7 | Repeat 1–6 on `/apps` 智能问答 | Same behavior |

### Done gate

- [ ] Checklist items 1–7 passed
- [ ] Diff limited to picker TSX/CSS (no accidental API / BiSheng edits)

## Open decisions (resolved)

| Topic | Decision |
|-------|----------|
| Scope | Portal only |
| Tab nesting | Under 按知识库 only (option A) |
| Cross-tab selection | Persist (option A) |
| Empty tabs | Always show four + empty state (option A) |
| Approach | Frontend filter, no new API (approach 1) |
| Tab badges | Deferred |
| `other` level | Omit from four tabs |
