const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Returns a comparable identity for a PostgreSQL connection string
 * (host without Neon's "-pooler" suffix + database name), or null if unparseable.
 * Pooled and direct URLs of the same Neon database map to the same identity.
 *
 * @param {string|undefined} rawUrl
 * @returns {string|null}
 */
function databaseIdentity(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace('-pooler.', '.');
    return `${host}:${url.port || '5432'}${url.pathname.toLowerCase()}`;
  } catch (_) {
    return null;
  }
}

/**
 * Reads DATABASE_URL / DIRECT_URL exactly as written in Backend/.env (ignoring any
 * process-level overrides), so the test guard always compares against the real
 * dev/production database.
 *
 * @returns {string[]}
 */
function readProtectedUrlsFromEnvFile() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return [];
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  return [parsed.DATABASE_URL, parsed.DIRECT_URL].filter(Boolean);
}

/**
 * Resolves the database URL Prisma must use.
 * - Outside tests: null (Prisma uses DATABASE_URL from the schema).
 * - With NODE_ENV=test: TEST_DATABASE_URL is mandatory and must point to a different
 *   database than DATABASE_URL/DIRECT_URL in .env. Tests create/modify data and the
 *   simulation loop advances every active order, so they must never touch production.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {string|null}
 */
function resolveDatabaseUrl(env = process.env) {
  if (env.NODE_ENV !== 'test') {
    return null;
  }

  const testUrl = env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'NODE_ENV=test requires TEST_DATABASE_URL (a separate PostgreSQL database, e.g. a Neon "test" branch). ' +
        'Refusing to run tests against DATABASE_URL.'
    );
  }

  const testIdentity = databaseIdentity(testUrl);
  if (!testIdentity) {
    throw new Error('TEST_DATABASE_URL is not a valid PostgreSQL connection string.');
  }

  const protectedIdentities = readProtectedUrlsFromEnvFile().map(databaseIdentity);
  if (protectedIdentities.includes(testIdentity)) {
    throw new Error(
      'TEST_DATABASE_URL points to the same database as DATABASE_URL/DIRECT_URL in .env. ' +
        'Use a separate database (e.g. a Neon branch) for tests.'
    );
  }

  return testUrl;
}

module.exports = {
  databaseIdentity,
  resolveDatabaseUrl,
};
