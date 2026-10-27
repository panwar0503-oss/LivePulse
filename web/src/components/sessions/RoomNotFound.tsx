import { routes } from '../../lib/routes'
import { StatusMessage } from './StatusMessage'
import { linkButton } from '../ui/styles'

export function RoomNotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <StatusMessage kind="error">We could not find that session.</StatusMessage>
      <a href={routes.join()} className={linkButton('primary')}>
        Join with a code
      </a>
    </div>
  )
}
