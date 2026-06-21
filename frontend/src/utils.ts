/** Currency symbol — all prices are INR */
export const SYM = '₹'

export function fmt(val: number | null | undefined, decimals = 2): string {
  if (val == null || !isFinite(val)) return 'N/A'
  return val.toFixed(decimals)
}

export function fmtCurrency(val: number | null | undefined, currency = 'INR'): string {
  const sym = currency === 'INR' ? '₹' : '$'
  if (val == null || !isFinite(val)) return 'N/A'
  if (Math.abs(val) >= 1_000_000_000_000) return `${sym}${(val / 1_000_000_000_000).toFixed(2)}T`
  if (Math.abs(val) >= 1_000_000_000)     return `${sym}${(val / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(val) >= 1_000_000_000)     return `${sym}${(val / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(val) >= 10_000_000)        return `${sym}${(val / 10_000_000).toFixed(2)}Cr`   // Indian crore
  if (Math.abs(val) >= 100_000)           return `${sym}${(val / 100_000).toFixed(2)}L`        // Indian lakh
  return `${sym}${val.toLocaleString('en-IN')}`
}

export function fmtLargeNum(val: number | null | undefined): string {
  if (val == null || !isFinite(val)) return 'N/A'
  if (Math.abs(val) >= 1_000_000_000_000) return `${(val / 1_000_000_000_000).toFixed(2)}T`
  if (Math.abs(val) >= 1_000_000_000)     return `${(val / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(val) >= 10_000_000)        return `${(val / 10_000_000).toFixed(2)}Cr`
  if (Math.abs(val) >= 100_000)           return `${(val / 100_000).toFixed(2)}L`
  return val.toLocaleString('en-IN')
}

export function fmtPct(val: number | null | undefined, alreadyPct = false): string {
  if (val == null || !isFinite(val)) return 'N/A'
  const v = alreadyPct ? val : val * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export function clsx(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
