import { formatCount, formatStep, formatValue } from './format'
import type { Issue, NormalizeReport, Summary } from './types'

/** Plain-language list of everything that is wrong with the data of a run. */
export function buildIssues(s: Summary, r: NormalizeReport): Issue[] {
  const out: Issue[] = []
  const l = s.loss
  const nonFinite = l.nan + l.posInf + l.negInf

  if (s.points > 0 && l.trailingNonFinite > 0) {
    const tail =
      l.trailingNonFinite === s.points
        ? 'There is no finite loss value in this run.'
        : `Last finite loss: ${formatValue(l.lastFinite)} at step ${formatStep(l.lastFiniteStep)}.`
    out.push({
      level: 'bad',
      tag: `loss is ${formatValue(l.last)}`,
      text: `Loss is ${formatValue(l.last)} right now, and has been non-finite for the last ${formatCount(
        l.trailingNonFinite,
      )} logged steps. ${tail}`,
    })
  } else if (nonFinite > 0) {
    out.push({
      level: 'warn',
      tag: 'NaN/Inf',
      text: `${formatCount(nonFinite)} non-finite loss values (${l.nan} NaN, ${l.posInf} +Inf, ${
        l.negInf
      } -Inf), first at step ${formatStep(l.firstNonFiniteStep)}. They are marked in red and are not part of the line.`,
    })
  }

  if (r.duplicates > 0) {
    out.push({
      level: 'warn',
      tag: 'duplicates',
      text: `${formatCount(r.duplicates)} rows repeated a step that was logged again later; the last written row is shown. ${formatCount(
        r.conflictingDuplicates,
      )} of them had different values from the row that was kept.`,
    })
  }
  if (r.outOfOrder > 0) {
    out.push({
      level: 'warn',
      tag: 'unsorted',
      text: `${formatCount(r.outOfOrder)} rows arrived out of order. Rows are sorted by step before drawing.`,
    })
  }
  if (r.gaps.length > 0) {
    const biggest = r.gaps.reduce((a, b) => (b.missing > a.missing ? b : a))
    const missing = r.gaps.reduce((a, g) => a + g.missing, 0)
    out.push({
      level: 'warn',
      tag: 'gaps',
      text: `${formatCount(r.gaps.length)} gaps in logging, about ${formatCount(missing)} steps missing (largest: ${formatStep(
        biggest.from,
      )} to ${formatStep(biggest.to)}). The line is broken there, not interpolated.`,
    })
  }
  if (l.nonPositive > 0) {
    out.push({
      level: 'warn',
      tag: 'loss ≤ 0',
      text: `${formatCount(l.nonPositive)} loss values are zero or negative. They cannot be placed on a log axis; with log scale on they are marked at the bottom edge and counted.`,
    })
  }
  if (r.droppedInvalidSteps > 0) {
    out.push({
      level: 'warn',
      tag: 'bad steps',
      text: `${formatCount(r.droppedInvalidSteps)} rows had no valid step number and could not be placed on the chart.`,
    })
  }
  return out
}
