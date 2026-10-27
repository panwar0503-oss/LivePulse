import type { Sequelize } from 'sequelize'
import { AiAction, initAiAction } from './ai-action.model.js'
import { AiAnswerDraft, initAiAnswerDraft } from './ai-answer-draft.model.js'
import { AiJob, initAiJob } from './ai-job.model.js'
import type { AiJobStatus } from './ai-job.model.js'
import { KnowledgeDocument, initKnowledgeDocument } from './knowledge-document.model.js'
import { KnowledgePassage, initKnowledgePassage } from './knowledge-passage.model.js'
import { Participant, initParticipant } from './participant.model.js'
import { PollOption, initPollOption } from './poll-option.model.js'
import { Poll, initPoll } from './poll.model.js'
import { QuestionCluster, initQuestionCluster } from './question-cluster.model.js'
import { QuestionUpvote, initQuestionUpvote } from './question-upvote.model.js'
import { Question, initQuestion } from './question.model.js'
import { SessionChatTurn, initSessionChatTurn } from './session-chat-turn.model.js'
import { Session, initSession } from './session.model.js'
import { Vote, initVote } from './vote.model.js'

import { WordPrompt, initWordPrompt } from './word-prompt.model.js'
import { WordResponse, initWordResponse } from './word-response.model.js'

export {
  AiAction,
  AiAnswerDraft,
  AiJob,
  KnowledgeDocument,
  KnowledgePassage,
  Participant,
  Poll,
  PollOption,
  Question,
  QuestionCluster,
  QuestionUpvote,
  Session,
  SessionChatTurn,
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
  KnowledgeDocument: typeof KnowledgeDocument
  KnowledgePassage: typeof KnowledgePassage
  QuestionCluster: typeof QuestionCluster
  AiAnswerDraft: typeof AiAnswerDraft
  SessionChatTurn: typeof SessionChatTurn
  AiAction: typeof AiAction
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
  initKnowledgeDocument(sequelize)
  initKnowledgePassage(sequelize)
  Session.hasMany(KnowledgeDocument, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  KnowledgeDocument.belongsTo(Session, { foreignKey: 'sessionId' })
  AiJob.hasOne(KnowledgeDocument, { foreignKey: 'aiJobId', onDelete: 'SET NULL' })
  KnowledgeDocument.belongsTo(AiJob, { foreignKey: 'aiJobId' })
  KnowledgeDocument.hasMany(KnowledgePassage, { foreignKey: 'documentId', onDelete: 'CASCADE' })
  KnowledgePassage.belongsTo(KnowledgeDocument, { foreignKey: 'documentId' })
  Session.hasMany(KnowledgePassage, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  KnowledgePassage.belongsTo(Session, { foreignKey: 'sessionId' })
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
  initQuestionCluster(sequelize)
  initAiAnswerDraft(sequelize)
  Session.hasMany(QuestionCluster, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  QuestionCluster.belongsTo(Session, { foreignKey: 'sessionId' })
  Session.hasMany(AiAnswerDraft, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  AiAnswerDraft.belongsTo(Session, { foreignKey: 'sessionId' })
  Question.hasOne(AiAnswerDraft, { foreignKey: 'questionId', onDelete: 'CASCADE' })
  AiAnswerDraft.belongsTo(Question, { foreignKey: 'questionId' })
  Question.belongsTo(Question, { as: 'duplicateOf', foreignKey: 'duplicateOfId', onDelete: 'SET NULL' })
  QuestionCluster.hasMany(Question, { foreignKey: 'clusterId', onDelete: 'SET NULL' })
  Question.belongsTo(QuestionCluster, { foreignKey: 'clusterId' })
  AiJob.hasMany(AiAnswerDraft, { foreignKey: 'jobId', onDelete: 'SET NULL' })
  AiAnswerDraft.belongsTo(AiJob, { foreignKey: 'jobId' })
  initSessionChatTurn(sequelize)
  Session.hasMany(SessionChatTurn, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  SessionChatTurn.belongsTo(Session, { foreignKey: 'sessionId' })
  initAiAction(sequelize)
  Session.hasMany(AiAction, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  AiAction.belongsTo(Session, { foreignKey: 'sessionId' })
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
    KnowledgeDocument,
    KnowledgePassage,
    QuestionCluster,
    AiAnswerDraft,
    SessionChatTurn,
    AiAction,
  }
}
