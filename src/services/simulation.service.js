const prisma = require('../config/db');

const VALID_PHASES = ['RECIBIDO', 'LAVADO', 'SECADO', 'LISTO'];

const NEXT_PHASE_MAP = {
  RECIBIDO: 'LAVADO',
  LAVADO: 'SECADO',
  SECADO: 'LISTO',
};

const PHASE_PROGRESS_MAP = {
  RECIBIDO: 10,
  LAVADO: 45,
  SECADO: 80,
  LISTO: 100,
};

/**
 * Service to simulate car wash progress over time.
 */
const advanceOrderPhase = async (order) => {
  // Skeleton implementation to be expanded
  return null;
};

module.exports = {
  VALID_PHASES,
  NEXT_PHASE_MAP,
  PHASE_PROGRESS_MAP,
  advanceOrderPhase,
};
