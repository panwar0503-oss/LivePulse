import { skeletonClass } from './styles'

export type LoadingStateProps = {
  label?: string
  rows?: number
}

// Fixed row heights keep the layout from jumping when the content arrives.
export function LoadingState({ label = 'Loading…', rows = 3 }: LoadingStateProps) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <p className="text-sm text-muted">{label}</p>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className={`h-14 ${skeletonClass}`} />
      ))}
    </div>
  )
}
