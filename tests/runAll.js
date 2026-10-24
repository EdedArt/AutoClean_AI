const { spawnSync } = require('child_process');
const path = require('path');

console.log('====================================');
console.log('Running AutoClean AI Backend Tests');
console.log('====================================\n');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long-for-testing';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';
process.env.SIMULATION_AUTO_ADVANCE = 'true';

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
];

for (const testFile of tests) {
  console.log(`▶ Executing: ${path.basename(testFile)}`);
  const result = spawnSync('node', [testFile], {
    stdio: 'inherit',
    env: {
      ...process.env,
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
