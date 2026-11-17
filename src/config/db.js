require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { resolveDatabaseUrl } = require('./databaseUrl');

// In tests this is TEST_DATABASE_URL (guarded); otherwise Prisma uses DATABASE_URL.
const overrideUrl = resolveDatabaseUrl(process.env);

const prisma = new PrismaClient({
  ...(overrideUrl ? { datasources: { db: { url: overrideUrl } } } : {}),
  // Neon may need a few seconds to wake a suspended compute; avoid spurious
  // interactive-transaction timeouts (Prisma defaults: maxWait 2s, timeout 5s).
  transactionOptions: {
    maxWait: 10000,
    timeout: 20000,
  },
});

module.exports = prisma;
