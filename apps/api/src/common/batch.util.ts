export const DEFAULT_BATCH_SIZE = 100;
export const RECONCILE_BATCH_SIZE = 50;

export function chunkArray<T>(items: T[], size = DEFAULT_BATCH_SIZE): T[][] {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
