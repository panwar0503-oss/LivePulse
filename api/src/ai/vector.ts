// Only ever used as a bound value (replacements/bind), never concatenated into SQL.
export const toPgVector = (v: number[], dimension: number): string => {
  if (v.length !== dimension) {
    throw new Error(`Vector must have ${dimension} values`)
  }
  if (!v.every((x) => Number.isFinite(x))) {
    throw new Error('Vector values must be finite numbers')
  }
  return `[${v.join(',')}]`
}
