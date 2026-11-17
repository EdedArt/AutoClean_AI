require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');

console.log('====================================');
console.log('Running AutoClean AI Backend Tests');
console.log('====================================\n');

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long-for-testing';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';
process.env.SIMULATION_AUTO_ADVANCE = 'true';

// Tests always run against a separate PostgreSQL database (TEST_DATABASE_URL).
// resolveDatabaseUrl throws if it is missing or points to the .env DATABASE_URL/DIRECT_URL.
process.env.NODE_ENV = 'test';
const { resolveDatabaseUrl } = require('../src/config/databaseUrl');
let testDatabaseUrl;
try {
  testDatabaseUrl = resolveDatabaseUrl(process.env);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
const testDirectUrl = process.env.TEST_DIRECT_URL || testDatabaseUrl;
const testDbEnv = { DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDirectUrl };

// Bring the test database schema up to date before running the suites
console.log('▶ Applying migrations to the test database (prisma migrate deploy)...');
const migrate = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
  { stdio: 'inherit', cwd: path.join(__dirname, '..'), env: { ...process.env, ...testDbEnv } }
);
if (migrate.status !== 0) {
  console.error('\n❌ Failed to apply migrations to the test database.');
  process.exit(migrate.status || 1);
}

// Seed the test database like production does on boot (idempotent upserts: demo users,
// bays and coded packages). With NODE_ENV=test, src/config/db.js resolves the guarded
// TEST_DATABASE_URL, so this can never reach the .env database.
console.log('\n▶ Seeding the test database (prisma/seed.js)...');
const seed = spawnSync(process.execPath, [path.join(__dirname, '..', 'prisma', 'seed.js')], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, ...testDbEnv, NODE_ENV: 'test' },
});
if (seed.status !== 0) {
  console.error('\n❌ Failed to seed the test database.');
  process.exit(seed.status || 1);
}
console.log('');

const tests = [
  path.join(__dirname, 'simulation.test.js'),
  path.join(__dirname, 'integration.test.js'),
  path.join(__dirname, 'demoControls.test.js'),
  path.join(__dirname, 'prediction.test.js'),
  path.join(__dirname, 'validation.test.js'),
  path.join(__dirname, 'errorHandling.test.js'),
  path.join(__dirname, 'searchFilters.test.js'),
  path.join(__dirname, 'openapi.test.js'),
  path.join(__dirname, 'security.test.js'),
  path.join(__dirname, 'auth.test.js'),
  path.join(__dirname, 'ownership.test.js'),
  path.join(__dirname, 'phasesFlow.test.js'),
  path.join(__dirname, 'aiAnalysis.test.js'),
  path.join(__dirname, 'phaseRules.test.js'),
  path.join(__dirname, 'delivery.test.js'),
  path.join(__dirname, 'plateLookup.test.js'),
  path.join(__dirname, 'layers.test.js'),
];

for (const testFile of tests) {
  console.log(`▶ Executing: ${path.basename(testFile)}`);
  const result = spawnSync('node', [testFile], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...testDbEnv,
      NODE_ENV: 'test',
      AI_MODE: 'simulated',
      GEMINI_API_KEY: '',
      SIMULATION_AUTO_ADVANCE: 'true',
    },
  });
  if (result.status !== 0) {
    console.error(`\n❌ Test failed: ${path.basename(testFile)}`);
    process.exit(result.status || 1);
  }
  console.log(`\n✔ Passed: ${path.basename(testFile)}\n`);
}

console.log('====================================');
console.log('🎉 ALL TEST SUITES PASSED!');
console.log('====================================\n');
