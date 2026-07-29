/**
 * Relative marks % used for KPI ranking: (obtained/total)*100, 2 decimal places.
 * totalMarks <= 0 → 0.
 */
export function marksPercentage(
  obtainedMarks: number,
  totalMarks: number
): number {
  const obtained = Number(obtainedMarks || 0);
  const total = Number(totalMarks || 0);
  if (!(total > 0)) return 0;
  return Math.round((obtained / total) * 10000) / 100;
}

/**
 * Sort comparator: higher percentage first; ties break on obtainedMarks, then totalMarks.
 */
export function compareByMarksPercentage(
  a: { obtainedMarks?: number; totalMarks?: number },
  b: { obtainedMarks?: number; totalMarks?: number }
): number {
  const pctA = marksPercentage(
    Number(a.obtainedMarks || 0),
    Number(a.totalMarks || 0)
  );
  const pctB = marksPercentage(
    Number(b.obtainedMarks || 0),
    Number(b.totalMarks || 0)
  );
  if (pctB !== pctA) return pctB - pctA;
  const obtA = Number(a.obtainedMarks || 0);
  const obtB = Number(b.obtainedMarks || 0);
  if (obtB !== obtA) return obtB - obtA;
  return Number(b.totalMarks || 0) - Number(a.totalMarks || 0);
}
