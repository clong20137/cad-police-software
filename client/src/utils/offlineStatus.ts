export const offlineAgeLabel = (ageMs: number | null): string => {
  if (ageMs === null) return 'Cached data unavailable';
  const seconds = Math.max(1, Math.round(ageMs / 1000));
  if (seconds < 60) return `Cached ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Cached ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Cached ${hours}h ago`;
};
