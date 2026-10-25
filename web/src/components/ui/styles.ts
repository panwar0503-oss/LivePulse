// Shared class recipes so every control looks and focuses the same way.
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

const motion = 'transition-colors duration-150 motion-reduce:transition-none'

type Variant = 'primary' | 'secondary' | 'danger' | 'dangerSecondary'
type Size = 'sm' | 'md' | 'lg'

const BASE = `inline-flex items-center justify-center gap-2 rounded-xl font-medium ${motion} ${focusRing}`

const SIZES: Record<Size, string> = {
  // One control height (44 px) for every primary and secondary action; sm is for compact inline controls only.
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-5 text-base',
  lg: 'min-h-11 px-5 text-base',
}

// Buttons: hover only while enabled, so a disabled control never looks clickable.
const BUTTON_VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white enabled:hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-400',
  secondary:
    'border border-slate-300 bg-white text-ink enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
  danger:
    'bg-danger-700 text-white enabled:hover:bg-danger-800 disabled:cursor-not-allowed disabled:bg-slate-400',
  dangerSecondary:
    'border border-danger-200 bg-white text-danger-700 enabled:hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-50',
}

// Links have no disabled state.
const LINK_VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-slate-300 bg-white text-ink hover:bg-slate-50',
  danger: 'bg-danger-700 text-white hover:bg-danger-800',
  dangerSecondary: 'border border-danger-200 bg-white text-danger-700 hover:bg-danger-50',
}

export const button = (variant: Variant = 'primary', size: Size = 'md'): string =>
  `${BASE} ${SIZES[size]} ${BUTTON_VARIANTS[variant]}`

export const linkButton = (variant: Variant = 'primary', size: Size = 'md'): string =>
  `${BASE} ${SIZES[size]} ${LINK_VARIANTS[variant]}`

// slate-500 keeps the field edge at 3:1 contrast against white.
export const inputClass = `w-full rounded-xl border border-slate-500 bg-white px-3 py-2 text-ink ${motion} ${focusRing} focus-visible:border-brand-600 disabled:bg-slate-50 disabled:text-slate-600`

export const inputLargeClass = `min-h-14 w-full rounded-xl border-2 border-slate-500 bg-white px-4 py-3 text-lg text-ink ${motion} ${focusRing} focus-visible:border-brand-600 disabled:bg-slate-50 disabled:text-slate-600`

export const checkboxClass = `h-5 w-5 rounded accent-brand-600 ${focusRing}`

export const labelClass = 'font-medium text-ink'
export const hintClass = 'text-sm text-muted'
export const fieldErrorClass = 'text-sm font-medium text-danger-800'

export const badgeClass =
  'inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700'

export const itemCardClass = 'flex flex-col gap-3 rounded-2xl border border-line bg-white p-4'

// Page-level surface: one thin border, no shadow, generous padding.
export const panelClass = 'flex min-w-0 flex-col gap-6 rounded-2xl border border-line bg-surface p-5 sm:p-8'

// One heading scale: page title, section title.
export const pageTitleClass = 'text-2xl font-semibold tracking-tight break-words sm:text-3xl'
export const sectionTitleClass = 'text-lg font-semibold tracking-tight'

export const skeletonClass = 'animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none'

export const detailsClass = 'rounded-2xl border border-line bg-slate-50/60 p-4'
export const summaryClass = `cursor-pointer rounded-lg font-medium text-brand-700 ${focusRing}`

export const switchTrackClass = `relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-500 bg-white ${motion} ${focusRing} aria-checked:border-brand-600 aria-checked:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50`

export const switchThumbClass = (checked: boolean): string =>
  `inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-150 motion-reduce:transition-none ${
    checked ? 'translate-x-6 bg-white' : 'translate-x-1 bg-slate-600'
  }`
