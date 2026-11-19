// 1 on the same day, decaying with the gap. A found date before the lost date is impossible.
export function dateScore(lostDate, foundDate, decayDays) {
  const gapDays = (new Date(foundDate) - new Date(lostDate)) / 86_400_000;
  if (gapDays < -1) return 0;
  return Math.exp(-Math.abs(gapDays) / decayDays);
}
