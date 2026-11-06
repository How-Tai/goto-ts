// Keep full precision for grading and ranking; round only the displayed value.
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(2)
}
