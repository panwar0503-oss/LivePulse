import type { Sequelize } from 'sequelize'
import { Participant, initParticipant } from './participant.model.js'
import { Session, initSession } from './session.model.js'

export { Participant, Session }

// Call once per Sequelize instance: models and associations are registered in this one place.
export const initModels = (
  sequelize: Sequelize,
): { Session: typeof Session; Participant: typeof Participant } => {
  initSession(sequelize)
  initParticipant(sequelize)
  Session.hasMany(Participant, { foreignKey: 'sessionId', onDelete: 'CASCADE' })
  Participant.belongsTo(Session, { foreignKey: 'sessionId' })
  return { Session, Participant }
}
