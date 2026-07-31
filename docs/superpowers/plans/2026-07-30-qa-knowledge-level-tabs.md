# QA Knowledge Picker Level Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under portal「按知识库」, add four level tabs (公共/部门/团队/个人) that filter the existing space tree; keep cross-tab selection and「按文件分类」unchanged.

**Architecture:** Extract pure space-level helpers into a small module; wire `activeSpaceLevel` + secondary tab UI into `QAKnowledgeTreePicker`; filter the knowledge-mode list by level (no in-list group headers). No BFF/API changes. Cover helpers with `node:test` unit tests and extend existing source-assert tests; finish with the manual checklist from the design spec.

**Tech Stack:** Portal frontend React/TypeScript, CSS modules, `node:test` via `npm test` in `frontend/`.

**Spec:** `docs/superpowers/specs/2026-07-30-qa-knowledge-level-tabs-design.md`

## Global Constraints

- **Portal only** — do not modify BiSheng Client/Platform or Portal BFF APIs.
- **Level-2 tabs only when** `pickerMode === 'knowledge'` **and** search query is empty; always show all four tabs.
- **Levels:** `public` / `department` / `team` / `personal` only; omit missing/`other`/unknown from tabs.
- **Selection persists** across level tabs; file cap tip「一次最多可选择20个文件进行问答。」unchanged.
- **Default tab:** first non-empty level in order; if all empty → `public`.
- **全选 / 取消全选:** operate on **current tab’s spaces only**; merge with / remove from existing `knowledge_space` IDs without wiping other levels’ whole-space selections; if removing current tab leaves no whole spaces and mode was `knowledge_space`, set `mode: 'none'` only when no IDs remain.
- **Empty copy:** `暂无{SPACE_LEVEL_LABELS[level]}` (e.g.「暂无公共知识库」).
- **Commits:** only when the user explicitly asks; skip commit steps otherwise and leave working tree dirty for review.

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `frontend/src/components/qaKnowledgeSpaceLevels.ts` | Level constants, default tab, filter active-level spaces |
| Modify: `frontend/src/components/QAKnowledgeTreePicker.tsx` | Level-2 tabs, filter list, scoped 全选, empty copy |
| Modify: `frontend/src/components/QAKnowledgeTreePicker.module.css` | Level-2 tab styles |
| Create: `frontend/tests/qaKnowledgeSpaceLevels.test.ts` | Unit tests for helpers |
| Modify: `frontend/tests/qaKnowledgeTreeSelection.test.ts` | Source-assert level tabs + empty copy + no group headers in knowledge list |

---

### Task 1: Pure helpers — `qaKnowledgeSpaceLevels.ts`

**Files:**
- Create: `frontend/src/components/qaKnowledgeSpaceLevels.ts`
- Test: `frontend/tests/qaKnowledgeSpaceLevels.test.ts`

**Interfaces:**
- Produces:
  - `export type QaSpaceLevelTab = 'public' | 'department' | 'team' | 'personal'`
  - `export const QA_SPACE_LEVEL_ORDER: readonly QaSpaceLevelTab[]`
  - `export const QA_SPACE_LEVEL_LABELS: Record<QaSpaceLevelTab, string>`
  - `export function isQaSpaceLevelTab(value: string): value is QaSpaceLevelTab`
  - `export function pickDefaultSpaceLevel(spaces: Array<{ spaceLevel?: string | null }>): QaSpaceLevelTab`
  - `export function filterSpacesByLevel<T extends { spaceLevel?: string | null }>(spaces: T[], level: QaSpaceLevelTab): T[]`
- Consumes: none (no React)

- [ ] **Step 1: Write the failing unit test**

Create `frontend/tests/qaKnowledgeSpaceLevels.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QA_SPACE_LEVEL_LABELS,
  QA_SPACE_LEVEL_ORDER,
  filterSpacesByLevel,
  isQaSpaceLevelTab,
  pickDefaultSpaceLevel,
} from '../src/components/qaKnowledgeSpaceLevels';

test('QA_SPACE_LEVEL_ORDER is public → department → team → personal', () => {
  assert.deepEqual([...QA_SPACE_LEVEL_ORDER], ['public', 'department', 'team', 'personal']);
});

test('labels match product copy', () => {
  assert.equal(QA_SPACE_LEVEL_LABELS.public, '公共知识库');
  assert.equal(QA_SPACE_LEVEL_LABELS.department, '部门知识库');
  assert.equal(QA_SPACE_LEVEL_LABELS.team, '团队知识库');
  assert.equal(QA_SPACE_LEVEL_LABELS.personal, '个人知识库');
});

test('isQaSpaceLevelTab accepts only the four tabs', () => {
  assert.equal(isQaSpaceLevelTab('public'), true);
  assert.equal(isQaSpaceLevelTab('other'), false);
  assert.equal(isQaSpaceLevelTab(''), false);
});

test('pickDefaultSpaceLevel prefers first non-empty level', () => {
  assert.equal(pickDefaultSpaceLevel([]), 'public');
  assert.equal(pickDefaultSpaceLevel([{ spaceLevel: 'personal' }]), 'personal');
  assert.equal(
    pickDefaultSpaceLevel([{ spaceLevel: 'team' }, { spaceLevel: 'public' }]),
    'public',
  );
  assert.equal(
    pickDefaultSpaceLevel([{ spaceLevel: 'other' }, { spaceLevel: 'department' }]),
    'department',
  );
  assert.equal(pickDefaultSpaceLevel([{ spaceLevel: 'other' }]), 'public');
});

test('filterSpacesByLevel keeps only exact level and drops other/unknown', () => {
  const spaces = [
    { id: 1, spaceLevel: 'public' },
    { id: 2, spaceLevel: 'department' },
    { id: 3, spaceLevel: 'other' },
    { id: 4, spaceLevel: null },
    { id: 5, spaceLevel: 'public' },
  ];
  assert.deepEqual(
    filterSpacesByLevel(spaces, 'public').map((s) => s.id),
    [1, 5],
  );
  assert.deepEqual(filterSpacesByLevel(spaces, 'team'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal/frontend && npm test -- tests/qaKnowledgeSpaceLevels.test.ts
```

Expected: FAIL (module missing / cannot resolve import).

- [ ] **Step 3: Implement helpers**

Create `frontend/src/components/qaKnowledgeSpaceLevels.ts`:

```typescript
/** Space-level tabs for the portal QA knowledge picker (under「按知识库」). */

export type QaSpaceLevelTab = 'public' | 'department' | 'team' | 'personal';

export const QA_SPACE_LEVEL_ORDER: readonly QaSpaceLevelTab[] = [
  'public',
  'department',
  'team',
  'personal',
] as const;

export const QA_SPACE_LEVEL_LABELS: Record<QaSpaceLevelTab, string> = {
  public: '公共知识库',
  department: '部门知识库',
  team: '团队知识库',
  personal: '个人知识库',
};

/** True when value is one of the four picker tabs (excludes other/unknown). */
export function isQaSpaceLevelTab(value: string): value is QaSpaceLevelTab {
  return (QA_SPACE_LEVEL_ORDER as readonly string[]).includes(value);
}

/**
 * Default tab: first level in order that has at least one space.
 * Empty or only-other spaces → public.
 */
export function pickDefaultSpaceLevel(
  spaces: Array<{ spaceLevel?: string | null }>,
): QaSpaceLevelTab {
  for (const level of QA_SPACE_LEVEL_ORDER) {
    if (spaces.some((space) => space.spaceLevel === level)) {
      return level;
    }
  }
  return 'public';
}

/** Spaces belonging to the active tab; other/unknown levels never match. */
export function filterSpacesByLevel<T extends { spaceLevel?: string | null }>(
  spaces: T[],
  level: QaSpaceLevelTab,
): T[] {
  return spaces.filter((space) => space.spaceLevel === level);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal/frontend && npm test -- tests/qaKnowledgeSpaceLevels.test.ts
```

Expected: PASS (all tests in that file).

- [ ] **Step 5: Commit (only if user requested)**

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal
git add frontend/src/components/qaKnowledgeSpaceLevels.ts frontend/tests/qaKnowledgeSpaceLevels.test.ts
git commit -m "$(cat <<'EOF'
feat(qa): add space-level helpers for knowledge picker tabs

EOF
)"
```

---

### Task 2: Wire level tabs + filtered list in `QAKnowledgeTreePicker`

**Files:**
- Modify: `frontend/src/components/QAKnowledgeTreePicker.tsx`
- Modify: `frontend/src/components/QAKnowledgeTreePicker.module.css`
- Modify: `frontend/tests/qaKnowledgeTreeSelection.test.ts`

**Interfaces:**
- Consumes: helpers from Task 1 (`QaSpaceLevelTab`, `QA_SPACE_LEVEL_ORDER`, `QA_SPACE_LEVEL_LABELS`, `pickDefaultSpaceLevel`, `filterSpacesByLevel`)
- Produces: UI behavior per spec (no new public props)

- [ ] **Step 1: Extend source-assert tests (fail first)**

In `frontend/tests/qaKnowledgeTreeSelection.test.ts`, add (or extend the existing picker test):

```typescript
test('qa knowledge tree picker exposes space-level tabs under knowledge mode', () => {
  assert.match(pickerSource, /qaKnowledgeSpaceLevels/);
  assert.match(pickerSource, /activeSpaceLevel/);
  assert.match(pickerSource, /公共知识库/);
  assert.match(pickerSource, /部门知识库/);
  assert.match(pickerSource, /团队知识库/);
  assert.match(pickerSource, /个人知识库/);
  assert.match(pickerSource, /知识库类型/);
  assert.match(pickerSource, /暂无公共知识库|暂无\$\{/);
  // Level group headers no longer drive the knowledge list
  assert.doesNotMatch(pickerSource, /spaceGroups\.map/);
  assert.doesNotMatch(pickerSource, /spaceGroupHeader/);
});
```

Also update `test('qa knowledge tree picker supports dual mode and file limit')` if it asserted `暂无可见内容` as the only empty state — keep that string for loading/search/category empties where still used; level empty uses `暂无{label}`.

Run:

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal/frontend && npm test -- tests/qaKnowledgeTreeSelection.test.ts
```

Expected: FAIL on new asserts (`activeSpaceLevel` / import missing).

- [ ] **Step 2: Add CSS for level tabs**

In `QAKnowledgeTreePicker.module.css`, after `.modeTabActive`, add:

```css
.levelTabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: #f2f3f5;
}

.levelTab {
  border: none;
  border-radius: 8px;
  padding: 8px 6px;
  font-size: 13px;
  color: #4e5969;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}

.levelTabActive {
  background: #fff;
  color: #3662e3;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
```

Keep `.spaceGroup` / `.spaceGroupHeader` rules for now (unused is fine) or delete if unused after TSX change — prefer delete unused rules in the same edit to avoid dead CSS.

- [ ] **Step 3: Implement TSX wiring**

In `QAKnowledgeTreePicker.tsx`:

1. Replace local `SPACE_LEVEL_ORDER` / `SPACE_LEVEL_LABELS` with imports from `./qaKnowledgeSpaceLevels`.
2. Add state + one-shot default:

```typescript
const [activeSpaceLevel, setActiveSpaceLevel] = useState<QaSpaceLevelTab>('public');
const didInitActiveLevelRef = useRef(false);

useEffect(() => {
  if (didInitActiveLevelRef.current) return;
  // Wait until initial load finishes so default reflects real spaces.
  if (loading) return;
  setActiveSpaceLevel(pickDefaultSpaceLevel(spaces));
  didInitActiveLevelRef.current = true;
}, [loading, spaces]);
```

3. Replace `spaceGroups` usage for the knowledge tree with:

```typescript
const activeLevelSpaces = useMemo(
  () => filterSpacesByLevel(sortedSpaces, activeSpaceLevel),
  [sortedSpaces, activeSpaceLevel],
);
```

Keep `sortedSpaces` for search ordering / name maps. Drop `spaceGroups` if unused.

4. Scope 全选 to `activeLevelSpaces`:

```typescript
const wholeSelectedSpaceIds = /* existing */;

const allActiveLevelSpacesSelected = activeLevelSpaces.length > 0
  && scope.mode === 'knowledge_space'
  && activeLevelSpaces.every((space) => wholeSelectedSpaceIds.includes(space.id));

const toggleSelectAllSpaces = () => {
  const activeIds = activeLevelSpaces.map((space) => space.id);
  if (allActiveLevelSpacesSelected) {
    const next = wholeSelectedSpaceIds.filter((id) => !activeIds.includes(id));
    onChange(next.length ? { mode: 'knowledge_space', knowledgeSpaceIds: next } : { mode: 'none' });
    return;
  }
  const merged = [...wholeSelectedSpaceIds];
  for (const id of activeIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  onChange({ mode: 'knowledge_space', knowledgeSpaceIds: merged });
};
```

Update button: use `allActiveLevelSpacesSelected`; `title` →「全选当前类型知识库」; show 全选 only when `activeLevelSpaces.length > 0` (not `spaces.length`).

5. Render level-2 tabs in knowledge branch **above** `selectedBar` when `!searchMode`:

```tsx
{!searchMode ? (
  <div className={s.levelTabs} role="tablist" aria-label="知识库类型">
    {QA_SPACE_LEVEL_ORDER.map((level) => (
      <button
        key={level}
        type="button"
        role="tab"
        aria-selected={activeSpaceLevel === level}
        className={`${s.levelTab} ${activeSpaceLevel === level ? s.levelTabActive : ''}`}
        onClick={() => setActiveSpaceLevel(level)}
      >
        {QA_SPACE_LEVEL_LABELS[level]}
      </button>
    ))}
  </div>
) : null}
```

Place this **inside** the knowledge-mode branch (the `else` of `pickerMode === 'category'`), so category mode never shows it. Search mode hides it via `!searchMode`.

6. Replace knowledge non-search list rendering:

```tsx
{!loading && activeLevelSpaces.length === 0 ? (
  <div className={s.stateLine}>暂无{QA_SPACE_LEVEL_LABELS[activeSpaceLevel]}</div>
) : null}
{!loading && activeLevelSpaces.map((space) => (
  // same space section markup as before (checkbox / expand / children)
))}
```

Remove the `spaceGroups.map` wrapper and `spaceGroupHeader`.

7. Global empty `spaces.length === 0` line can remain for loading edge cases, but prefer per-level empty when tabs are visible (`activeLevelSpaces.length === 0`).

- [ ] **Step 4: Run automated tests**

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal/frontend && npm test -- tests/qaKnowledgeSpaceLevels.test.ts tests/qaKnowledgeTreeSelection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit (only if user requested)**

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal
git add frontend/src/components/QAKnowledgeTreePicker.tsx \
  frontend/src/components/QAKnowledgeTreePicker.module.css \
  frontend/tests/qaKnowledgeTreeSelection.test.ts
git commit -m "$(cat <<'EOF'
feat(qa): add public/department/team/personal tabs in knowledge picker

EOF
)"
```

---

### Task 3: Manual verification (completion gate)

**Files:** none (manual)

**Interfaces:** none

- [ ] **Step 1: Start / confirm portal stack**

Portal frontend + BFF reachable (local ports per project norm). Login with an account that has ≥2 space levels if possible.

- [ ] **Step 2: Run checklist from spec**

| # | Steps | Pass criteria |
|---|--------|----------------|
| 1 | Home → 小智知道 → open picker → 按知识库 | Four level tabs visible |
| 2 | Click each tab | List shows only that level; empty levels show「暂无××知识库」 |
| 3 | Select on tab A, switch to B, back to A | Selections preserved; summary count correct |
| 4 | 全选 on one tab; other tab had prior whole-space selection | Other tab selections remain; cancel 全选 only clears current tab wholes |
| 5 | Select across two levels near file cap 20 | Cap tip still enforced |
| 6 | Type search query | Level-2 tabs hidden; global results; clear restores tabs + last level |
| 7 | Switch to 按文件分类 | No level-2 tabs; category mode works |
| 8 | Repeat 1–7 on `/apps` 智能问答 | Same behavior |

- [ ] **Step 3: Diff gate**

```bash
cd /Users/lkk/workplace/shougang-group-knowledge-portal && git status && git diff --stat
```

Expected: only picker helpers/TSX/CSS + the two test files (and optionally this plan/spec). No BiSheng / BFF API churn.

- [ ] **Step 4: Mark done only if checklist 1–8 + diff gate pass**

Do not claim complete without evidence from Step 2–3.

---

## 测试与验证（计划专节）

### 自动化

| 测什么 | 放哪 | 怎么跑 |
|--------|------|--------|
| Level helpers | `frontend/tests/qaKnowledgeSpaceLevels.test.ts` | `cd frontend && npm test -- tests/qaKnowledgeSpaceLevels.test.ts` |
| Picker wiring source-assert | `frontend/tests/qaKnowledgeTreeSelection.test.ts` | `cd frontend && npm test -- tests/qaKnowledgeTreeSelection.test.ts` |

必覆盖用例：默认 Tab、过滤四档、`other` 剔除、源码含四级 Tab / 空态 / 不再 `spaceGroups.map`。

### 联调 / 手工

见 Task 3 清单（首页小智知道 + `/apps` 问答）。

### 完成门禁

- [ ] Task 1–2 自动化全绿  
- [ ] Task 3 手工清单 1–8 通过  
- [ ] Diff 仅限约定文件  

未跑通不得宣称完成。

---

## Plan self-review

| Spec requirement | Task |
|------------------|------|
| Level-2 tabs under 按知识库 | Task 2 |
| Always four tabs + empty copy | Task 2 |
| Hide tabs while searching | Task 2 |
| Persist selection across tabs | Task 2 (filter-only) + Task 3 |
| Omit other/unknown | Task 1 `filterSpacesByLevel` |
| Default first non-empty | Task 1 + Task 2 init effect |
| No API / BiSheng changes | Global Constraints + Task 3 diff |
| Manual checklist both surfaces | Task 3 |
| Automated tests | Task 1 + Task 2 source-assert |

No TBD placeholders. Types consistent (`QaSpaceLevelTab`). 全选 scoped to active tab is an explicit plan constraint (spec left it implicit).
