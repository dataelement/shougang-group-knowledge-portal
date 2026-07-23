const COLOR_PALETTE = ['#4F86C6', '#58A55C', '#D4713A', '#9B6BBE', '#C0565B', '#4AACAB'];
const colorCache = new Map<string, string>();

export function getExpertAvatarColor(name: string): string {
  const cached = colorCache.get(name);
  if (cached) return cached;

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  const color = COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
  colorCache.set(name, color);
  return color;
}

export function getExpertInitial(name: string): string {
  return name ? name.charAt(0).toUpperCase() : '?';
}
