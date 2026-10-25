import type { Sequelize } from 'sequelize'
import { AiJob, initAiJob } from './ai-job.model.js'
import type { AiJobStatus } from './ai-job.model.js'
import { Participant, initParticipant } from './participant.model.js'
import { PollOption, initPollOption } from './poll-option.model.js'
import { Poll, initPoll } from './poll.model.js'
import { QuestionUpvote, initQuestionUpvote } from './question-upvote.model.js'
import { Question, initQuestion } from './question.model.js'
import { Session, initSession } from './session.model.js'
import { Vote, initVote } from './vote.model.js'

import { WordPrompt, initWordPrompt } from './word-prompt.model.js'
import { WordResponse, initWordResponse } from './word-response.model.js'

export {
  AiJob,
  Participant,
  Poll,
  PollOption,
  Question,
  QuestionUpvote,
  Session,
  Vote,
  WordPrompt,
  WordResponse,
}
export type { AiJobStatus }

export type Models = {
  Session: typeof Session
  Participant: typeof Participant
  Poll: typeof Poll
  PollOption: typeof PollOption
  Vote: typeof Vote
  WordPrompt: typeof WordPrompt
  WordResponse: typeof WordResponse
  Question: typeof Question
  QuestionUpvote: typeof QuestionUpvote
  AiJob: typeof AiJob
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
  initQuestion(sequelize)
  initQuestionUpvote(sequelize)
  initAiJob(sequelize)
  Session.hasMany(AiJob, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  AiJob.belongsTo(Session, { foreignKey: 'sessionId' })
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
  Session.hasMany(Question, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  Question.belongsTo(Session, { foreignKey: 'sessionId' })
  Participant.hasMany(Question, { foreignKey: 'participantId', onDelete: 'CASCADE' })
  Question.belongsTo(Participant, { foreignKey: 'participantId' })
  Question.hasMany(QuestionUpvote, { foreignKey: 'questionId', onDelete: 'CASCADE' })
  QuestionUpvote.belongsTo(Question, { foreignKey: 'questionId' })
  Participant.hasMany(QuestionUpvote, { foreignKey: 'participantId', onDelete: 'CASCADE' })
  QuestionUpvote.belongsTo(Participant, { foreignKey: 'participantId' })
  return {
    Session,
    Participant,
    Poll,
    PollOption,
    Vote,
    WordPrompt,
    WordResponse,
    Question,
    QuestionUpvote,
    AiJob,
  }
}
