'use client'

import { useState } from 'react'
import { useParticipantPoll } from '../../hooks/use-participant-poll'
import { castVote } from '../../lib/api/polls'
import { voteErrorMessage } from './poll-messages'
import { ParticipantPoll } from './ParticipantPoll'

export type LiveParticipantPollProps = { roomCode: string }

// Connects the poll view to the API; a refused vote is re-read so the screen shows the stored answer.
export function LiveParticipantPoll({ roomCode }: LiveParticipantPollProps) {
  const { poll, status, refresh, error } = useParticipantPoll(roomCode)
  const [pending, setPending] = useState(false)
  const [voteError, setVoteError] = useState<string | undefined>()

  const handleVote = async (optionId: string): Promise<void> => {
    if (!poll) return
    setPending(true)
    setVoteError(undefined)
    const result = await castVote(poll.id, optionId)
    setPending(false)
    if (!result.ok) {
      setVoteError(
        result.code === 'VOTE_ALREADY_RECORDED'
          ? 'You already voted. Your recorded answer is shown.'
          : voteErrorMessage(result.code),
      )
    }
    refresh()
  }

  return (
    <ParticipantPoll
      poll={poll}
      status={status}
      loadError={error?.message}
      onRetry={refresh}
      pending={pending}
      voteError={voteError}
      onVote={(id) => void handleVote(id)}
    />
  )
}
