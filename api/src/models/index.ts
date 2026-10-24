import type { Sequelize } from 'sequelize'
import { Participant, initParticipant } from './participant.model.js'
import { PollOption, initPollOption } from './poll-option.model.js'
import { Poll, initPoll } from './poll.model.js'
import { Session, initSession } from './session.model.js'
import { Vote, initVote } from './vote.model.js'

import { WordPrompt, initWordPrompt } from './word-prompt.model.js'
import { WordResponse, initWordResponse } from './word-response.model.js'

export { Participant, Poll, PollOption, Session, Vote, WordPrompt, WordResponse }

export type Models = {
  Session: typeof Session
  Participant: typeof Participant
  Poll: typeof Poll
  PollOption: typeof PollOption
  Vote: typeof Vote
  WordPrompt: typeof WordPrompt
  WordResponse: typeof WordResponse
}

// Call once per Sequelize instance: models and associations are registered in this one place.
export const initModels = (sequelize: Sequelize): Models => {
  initSession(sequelize)
  initParticipant(sequelize)
  initPoll(sequelize)
  initPollOption(sequelize)
  initVote(sequelize)
  initWordPrompt(sequelize)
  initWordResponse(sequelize)
  Session.hasMany(Participant, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  Participant.belongsTo(Session, { foreignKey: 'sessionId' })
  Session.hasMany(Poll, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  Poll.belongsTo(Session, { foreignKey: 'sessionId' })
  Poll.hasMany(PollOption, { foreignKey: 'pollId', onDelete: 'CASCADE' })
  PollOption.belongsTo(Poll, { foreignKey: 'pollId' })
  Poll.hasMany(Vote, { foreignKey: 'pollId', onDelete: 'CASCADE' })
  Vote.belongsTo(Poll, { foreignKey: 'pollId' })
  PollOption.hasMany(Vote, { foreignKey: 'optionId', onDelete: 'CASCADE' })
  Vote.belongsTo(PollOption, { foreignKey: 'optionId' })
  Participant.hasMany(Vote, { foreignKey: 'participantId', onDelete: 'CASCADE' })
  Vote.belongsTo(Participant, { foreignKey: 'participantId' })
  Session.hasMany(WordPrompt, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  WordPrompt.belongsTo(Session, { foreignKey: 'sessionId' })
  WordPrompt.hasMany(WordResponse, { foreignKey: 'promptId', onDelete: 'CASCADE' })
  WordResponse.belongsTo(WordPrompt, { foreignKey: 'promptId' })
  Participant.hasMany(WordResponse, { foreignKey: 'participantId', onDelete: 'CASCADE' })
  WordResponse.belongsTo(Participant, { foreignKey: 'participantId' })
  return { Session, Participant, Poll, PollOption, Vote, WordPrompt, WordResponse }
}
