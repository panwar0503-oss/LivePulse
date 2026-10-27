import { StatusMessage } from '../sessions/StatusMessage'
import { Icon } from './Icon'
import { button } from './styles'

export type ErrorStateProps = {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <StatusMessage kind="error">{message}</StatusMessage>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={button('secondary', 'sm')}>
          <Icon name="refresh" />
          Try again
        </button>
      ) : null}
    </div>
  )
}
