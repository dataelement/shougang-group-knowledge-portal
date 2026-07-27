import type { CategoryCardConfig, SpaceOption } from '../api/adminConfig';

export interface CategoryCardDraft {
  code: string;
  name: string;
  image: string;
  spaceIds: string[];
  enabled: boolean;
}

export function createCategoryCardDraft(current?: CategoryCardConfig): CategoryCardDraft {
  return {
    code: current?.code ?? '',
    name: current?.name ?? '',
    image: current?.image ?? '',
    spaceIds: (current?.space_ids ?? []).map((spaceId) => String(spaceId)),
    enabled: current?.enabled ?? true,
  };
}

export function validateCategoryCardDraft(
  draft: CategoryCardDraft,
  spaces: SpaceOption[],
  cards: CategoryCardConfig[],
  editIndex: number | null,
): { card?: CategoryCardConfig; error?: string } {
  const code = draft.code.trim().toUpperCase();
  if (!code) return { error: '请选择绑定的一级分类' };
  if (cards.some((item, index) => index !== editIndex && item.code.trim().toUpperCase() === code)) {
    return { error: '该一级分类已配置过卡片' };
  }

  const spaceIds: number[] = [];
  for (const spaceIdRaw of draft.spaceIds) {
    if (!spaceIdRaw.trim()) continue;
    const spaceId = Number(spaceIdRaw);
    if (!Number.isInteger(spaceId) || spaceId <= 0) return { error: '绑定空间格式有误' };
    const boundSpace = spaces.find((space) => space.id === spaceId);
    if (!boundSpace) return { error: '绑定空间不存在' };
    if (!spaceIds.includes(spaceId)) spaceIds.push(spaceId);
  }

  return {
    card: {
      code,
      name: draft.name.trim(),
      image: draft.image.trim(),
      space_ids: spaceIds,
      enabled: draft.enabled,
    },
  };
}
