const http = require('http');
const assert = require('assert');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders } = require('./helpers/auth');

const TEST_PORT = 3094;
const BASE_URL = `http://localhost:${TEST_PORT}`;
let authHeaders = {};

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: reqPath,
      method,
      headers: {
        ...authHeaders,
        ...(!isBuffer && typeof body === 'object' && body !== null ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      if (isBuffer) {
        req.write(body);
      } else if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

function startTestServer(envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: 'test',
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_MAX: '2',
        CORS_ORIGINS: 'https://mobile.autoclean.com,https://dashboard.autoclean.com',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const onData = (data) => {
      const chunk = data.toString();
      output += chunk;
      if (output.includes(`AutoClean AI backend running on http://localhost:${TEST_PORT}`)) {
        serverProcess.stdout.removeListener('data', onData);
        resolve(serverProcess);
      }
    };

    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', (err) => {
      output += err.toString();
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Server exited unexpectedly with code ${code}. Output:\n${output}`));
      }
    });

    setTimeout(() => {
      reject(new Error(`Server startup timed out after 10s. Output:\n${output}`));
    }, 10000);
  });
}

async function stopTestServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) return;
  return new Promise((resolve) => {
    serverProcess.on('exit', () => resolve());
    try {
      serverProcess.kill();
    } catch (_) {
      resolve();
    }
    setTimeout(resolve, 2000);
  });
}

async function runSecurityTests() {
  console.log('🧪 Starting Basic Security and Configuration Test Suite...\n');

  // =========================================================================
  // 1. Environment validation tests (Zod schema in src/config/env.js)
  // =========================================================================
  console.log('1. Testing environment variable validation at startup...');

  // Test missing DATABASE_URL
  const missingDbResult = spawnSync(
    'node',
    ['-e', "require('./src/config/env')"],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: '' },
      encoding: 'utf8',
    }
  );
  assert.strictEqual(missingDbResult.status, 1, 'Expected exit code 1 when DATABASE_URL is missing');
  assert.ok(
    (missingDbResult.stderr + missingDbResult.stdout).includes('DATABASE_URL'),
    'Expected error message to mention DATABASE_URL'
  );
  console.log('  ✅ Rejects missing DATABASE_URL with descriptive error and exit(1)');

  // Test invalid NODE_ENV
  const invalidEnvResult = spawnSync(
    'node',
    ['-e', "require('./src/config/env')"],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'staging' },
      encoding: 'utf8',
    }
  );
  assert.strictEqual(invalidEnvResult.status, 1, 'Expected exit code 1 when NODE_ENV is invalid');
  assert.ok(
    (invalidEnvResult.stderr + invalidEnvResult.stdout).includes('NODE_ENV'),
    'Expected error message to mention NODE_ENV'
  );
  console.log('  ✅ Rejects invalid NODE_ENV (e.g. "staging") with exit(1)');

  // Test invalid PORT
  const invalidPortResult = spawnSync(
    'node',
    ['-e', "require('./src/config/env')"],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: 'not-a-number' },
      encoding: 'utf8',
    }
  );
  assert.strictEqual(invalidPortResult.status, 1, 'Expected exit code 1 when PORT is invalid');
  assert.ok(
    (invalidPortResult.stderr + invalidPortResult.stdout).includes('PORT'),
    'Expected error message to mention PORT'
  );
  console.log('  ✅ Rejects non-numeric PORT with exit(1)');

  // =========================================================================
  // 2. Integration security tests against running server
  // =========================================================================
  let serverProcess = null;
  try {
    console.log('\n2. Starting test server with restrictive CORS and tiny rate limit (max=2)...');
    serverProcess = await startTestServer();
    authHeaders = await getOperatorAuthHeaders(prisma);
    console.log('  ✅ Test server running on port', TEST_PORT);

    // =======================================================================
    // 3. Helmet & Header security tests
    // =======================================================================
    console.log('\n3. Testing Helmet security headers and X-Powered-By removal...');
    const healthRes = await makeRequest('GET', '/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(
      healthRes.headers['x-powered-by'],
      undefined,
      'X-Powered-By header should be disabled/absent'
    );
    assert.strictEqual(
      healthRes.headers['x-content-type-options'],
      'nosniff',
      'X-Content-Type-Options: nosniff must be present'
    );
    console.log('  ✅ X-Powered-By is absent');
    console.log('  ✅ X-Content-Type-Options: nosniff is set');

    // Cross-Origin-Resource-Policy for /evidence
    console.log('\n4. Testing Cross-Origin-Resource-Policy for /evidence static assets...');
    const evidenceRes = await makeRequest('GET', '/evidence/1791353433477-135470588.png');
    assert.strictEqual(
      evidenceRes.headers['cross-origin-resource-policy'],
      'cross-origin',
      'Expected Cross-Origin-Resource-Policy: cross-origin on /evidence static files'
    );
    console.log('  ✅ Static /evidence responses include Cross-Origin-Resource-Policy: cross-origin');

    // CSP relaxation for Swagger UI at /api/docs
    console.log('\n5. Testing Swagger UI at /api/docs (relaxed CSP)...');
    let docsRes = await makeRequest('GET', '/api/docs/');
    if (docsRes.status === 301 || docsRes.status === 302) {
      docsRes = await makeRequest('GET', docsRes.headers.location);
    }
    assert.strictEqual(docsRes.status, 200);
    assert.strictEqual(
      docsRes.headers['content-security-policy'],
      undefined,
      'Swagger UI path should have contentSecurityPolicy disabled/relaxed'
    );
    console.log('  ✅ Swagger UI loads at /api/docs with relaxed Content-Security-Policy');

    // =======================================================================
    // 6. CORS Tests
    // =======================================================================
    console.log('\n6. Testing CORS with restrictive whitelist (https://mobile.autoclean.com)...');

    // A. Request with listed Origin
    const allowedOriginRes = await makeRequest('GET', '/api/health', null, {
      Origin: 'https://mobile.autoclean.com',
    });
    assert.strictEqual(allowedOriginRes.status, 200);
    assert.strictEqual(
      allowedOriginRes.headers['access-control-allow-origin'],
      'https://mobile.autoclean.com',
      'Allowed origin should receive Access-Control-Allow-Origin header matching its origin'
    );
    console.log('  ✅ Listed origin receives Access-Control-Allow-Origin header');

    // B. Request with unlisted Origin
    const blockedOriginRes = await makeRequest('GET', '/api/health', null, {
      Origin: 'https://unauthorized-domain.com',
    });
    assert.strictEqual(blockedOriginRes.status, 200);
    assert.strictEqual(
      blockedOriginRes.headers['access-control-allow-origin'],
      undefined,
      'Unlisted origin must not receive Access-Control-Allow-Origin header'
    );
    console.log('  ✅ Unlisted origin is denied Access-Control-Allow-Origin header');

    // C. Request with NO Origin header (native mobile app, curl)
    const noOriginRes = await makeRequest('GET', '/api/health');
    assert.strictEqual(noOriginRes.status, 200);
    console.log('  ✅ Requests with no Origin header are always permitted');

    // D. Preflight OPTIONS request for listed origin
    const preflightRes = await makeRequest('OPTIONS', '/api/vehicles', null, {
      Origin: 'https://mobile.autoclean.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, Authorization',
    });
    assert.ok(
      preflightRes.status === 200 || preflightRes.status === 204,
      `Expected preflight status 200 or 204, got ${preflightRes.status}`
    );
    assert.strictEqual(
      preflightRes.headers['access-control-allow-origin'],
      'https://mobile.autoclean.com'
    );
    const allowMethods = preflightRes.headers['access-control-allow-methods'] || '';
    assert.ok(allowMethods.includes('POST'), 'Access-Control-Allow-Methods must include POST');
    assert.ok(allowMethods.includes('PATCH'), 'Access-Control-Allow-Methods must include PATCH');
    const allowHeaders = preflightRes.headers['access-control-allow-headers'] || '';
    assert.ok(
      allowHeaders.toLowerCase().includes('content-type') &&
      allowHeaders.toLowerCase().includes('authorization'),
      'Access-Control-Allow-Headers must include Content-Type and Authorization'
    );
    console.log('  ✅ Preflight OPTIONS request returns 200/204 with correct CORS headers');

    // =======================================================================
    // 7. Rate Limiting Tests (RATE_LIMIT_MAX = 2)
    // =======================================================================
    console.log('\n7. Testing global rate limiter on /api (RATE_LIMIT_MAX = 2)...');

    // Request 1 to /api/vehicles
    const req1 = await makeRequest('GET', '/api/vehicles');
    assert.strictEqual(req1.status, 200);
    console.log('  ✔ Request 1/2 succeeded (status 200)');

    // Request 2 to /api/vehicles
    const req2 = await makeRequest('GET', '/api/vehicles');
    assert.strictEqual(req2.status, 200);
    console.log('  ✔ Request 2/2 succeeded (status 200)');

    // Request 3 to /api/vehicles -> Should be rate limited (429)
    const req3 = await makeRequest('GET', '/api/vehicles');
    assert.strictEqual(req3.status, 429, `Expected 429 RATE_LIMITED, got ${req3.status}`);
    assert.ok(req3.body && req3.body.error, 'Expected unified error format in 429 response');
    assert.strictEqual(req3.body.error.code, 'RATE_LIMITED');
    assert.ok(
      typeof req3.body.error.message === 'string' && req3.body.error.message.length > 0,
      'Expected descriptive rate limit message'
    );

    // Verify RateLimit headers
    const limitHeader = req3.headers['ratelimit-limit'];
    const remainingHeader = req3.headers['ratelimit-remaining'];
    assert.ok(limitHeader !== undefined, 'Expected RateLimit-Limit header');
    assert.strictEqual(String(remainingHeader), '0', 'Expected RateLimit-Remaining header to be 0');
    console.log('  ✅ Exceeding limit returns 429 with unified code "RATE_LIMITED" and headers');

    // Verify /api/health is skipped from rate limiting even after limit is reached
    const healthAfterLimit = await makeRequest('GET', '/api/health');
    assert.strictEqual(
      healthAfterLimit.status,
      200,
      'GET /api/health must never be rate limited'
    );
    assert.strictEqual(healthAfterLimit.body.status, 'ok');
    console.log('  ✅ GET /api/health continues to return 200 (skipped from rate limiter)');

    // =======================================================================
    // 8. Body Size Limit Tests (100kb limit)
    // =======================================================================
    console.log('\n8. Testing JSON body size limit (100kb) and unified 413 error...');

    // Generate payload larger than 100 KB (~105 KB string)
    const largePayload = {
      placa: 'XYZ-999',
      tipo: 'SEDAN',
      marca: 'A'.repeat(110 * 1024),
      modelo: 'TestModel',
      color: 'Black',
    };

    const payloadTooLargeRes = await makeRequest('POST', '/api/vehicles', largePayload);
    assert.strictEqual(
      payloadTooLargeRes.status,
      413,
      `Expected status 413 for oversized body, got ${payloadTooLargeRes.status}`
    );
    assert.ok(
      payloadTooLargeRes.body && payloadTooLargeRes.body.error,
      'Expected unified error response for 413'
    );
    assert.strictEqual(payloadTooLargeRes.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.ok(
      payloadTooLargeRes.body.error.message.includes('100 KB') ||
      payloadTooLargeRes.body.error.message.toLowerCase().includes('payload') ||
      payloadTooLargeRes.body.error.message.toLowerCase().includes('large'),
      `Expected message explaining body limit, got "${payloadTooLargeRes.body.error.message}"`
    );
    console.log('  ✅ Oversized JSON body (>100kb) returns 413 with unified code "PAYLOAD_TOO_LARGE"');

    console.log('\n🎉 ALL SECURITY & CONFIGURATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    if (serverProcess) {
      await stopTestServer(serverProcess);
    }
  }
}

runSecurityTests().catch(async (err) => {
  console.error('\n❌ Security test failed:', err);
  process.exit(1);
});
