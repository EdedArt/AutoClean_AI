const http = require('http');
const assert = require('assert');
const jwt = require('jsonwebtoken');
const prisma = require('../src/config/db');
const env = require('../src/config/env');
const {
  ensureDemoUsers,
  getOperatorAuthHeaders,
  getClientAuthHeaders,
  DEMO_PASSWORD,
} = require('./helpers/auth');

// Set port for auth test server
process.env.PORT = '3093';

const { app, server, simulationInterval } = require('../server');

const TEST_PORT = 3093;

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: reqPath,
      method,
      headers: {
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

async function runAuthTests() {
  console.log('🧪 Starting JWT Authentication & Role-Based Authorization Test Suite...\n');

  try {
    // 0. Ensure demo users exist
    await ensureDemoUsers(prisma);

    // =======================================================================
    // 1. Public endpoints remain accessible without authentication
    // =======================================================================
    console.log('1. Testing public endpoints without Authorization header...');
    const healthRes = await makeRequest('GET', '/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.body.status, 'ok');
    console.log('  ✅ GET /api/health is publicly accessible without token');

    const docsRes = await makeRequest('GET', '/api/docs.json');
    assert.strictEqual(docsRes.status, 200);
    console.log('  ✅ GET /api/docs.json is publicly accessible without token');

    // =======================================================================
    // 2. User Registration (POST /api/auth/register)
    // =======================================================================
    console.log('\n2. Testing registration always assigns role CLIENTE...');
    const uniqueEmail = `test-client-${Date.now()}@example.com`;
    const regPayload = {
      nombre: 'Cliente Prueba',
      email: uniqueEmail,
      password: 'StrongPassword123!',
      rol: 'OPERARIO', // Caller attempts to register as OPERARIO
    };

    const regRes = await makeRequest('POST', '/api/auth/register', regPayload);
    assert.strictEqual(regRes.status, 201, `Expected 201, got ${regRes.status}`);
    assert.ok(regRes.body, 'Expected response body');

    const createdUser = regRes.body.user || regRes.body;
    assert.strictEqual(createdUser.email, uniqueEmail.toLowerCase());
    assert.strictEqual(createdUser.nombre, 'Cliente Prueba');
    assert.strictEqual(
      createdUser.rol,
      'CLIENTE',
      'Self-registration must ALWAYS enforce role CLIENTE even if caller requested OPERARIO'
    );
    assert.strictEqual(
      createdUser.passwordHash,
      undefined,
      'passwordHash must NEVER appear in registration response'
    );
    assert.strictEqual(
      regRes.raw.includes('passwordHash'),
      false,
      'passwordHash must not appear anywhere in the raw response'
    );
    console.log('  ✅ Self-registration forces role CLIENTE and excludes passwordHash');

    // =======================================================================
    // 3. Duplicate email registration conflict (409)
    // =======================================================================
    console.log('\n3. Testing duplicate email registration returns 409...');
    const dupRes = await makeRequest('POST', '/api/auth/register', regPayload);
    assert.strictEqual(dupRes.status, 409, `Expected 409, got ${dupRes.status}`);
    assert.ok(dupRes.body && dupRes.body.error, 'Expected unified error format');
    assert.strictEqual(dupRes.body.error.code, 'DUPLICATE_RESOURCE');
    console.log('  ✅ Duplicate email registration returns 409 DUPLICATE_RESOURCE');

    // Password length validation
    console.log('\n4. Testing password min 8 characters validation...');
    const shortPassRes = await makeRequest('POST', '/api/auth/register', {
      nombre: 'Short Pass',
      email: `short-${Date.now()}@example.com`,
      password: 'short',
    });
    assert.strictEqual(shortPassRes.status, 400);
    assert.strictEqual(shortPassRes.body.error.code, 'VALIDATION_ERROR');
    console.log('  ✅ Short password (< 8 chars) rejected with 400 VALIDATION_ERROR');

    // =======================================================================
    // 5. User Login (POST /api/auth/login)
    // =======================================================================
    console.log('\n5. Testing user login...');
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      email: uniqueEmail,
      password: 'StrongPassword123!',
    });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.body.token, 'Expected JWT token in login response');
    assert.ok(loginRes.body.user, 'Expected user profile in login response');
    assert.strictEqual(loginRes.body.user.email, uniqueEmail.toLowerCase());
    assert.strictEqual(loginRes.body.user.rol, 'CLIENTE');
    assert.strictEqual(
      loginRes.body.user.passwordHash,
      undefined,
      'passwordHash must NEVER appear in login response'
    );
    assert.strictEqual(
      loginRes.raw.includes('passwordHash'),
      false,
      'passwordHash must not appear anywhere in login response body'
    );
    const clientToken = loginRes.body.token;
    console.log('  ✅ Login returns JWT token and user profile without passwordHash');

    // =======================================================================
    // 6. Anti-enumeration: wrong password vs unknown email return same error
    // =======================================================================
    console.log('\n6. Testing anti-enumeration on wrong password vs unknown email...');
    const wrongPassRes = await makeRequest('POST', '/api/auth/login', {
      email: uniqueEmail,
      password: 'WrongPassword999!',
    });
    assert.strictEqual(wrongPassRes.status, 401);
    assert.strictEqual(wrongPassRes.body.error.code, 'INVALID_CREDENTIALS');

    const unknownEmailRes = await makeRequest('POST', '/api/auth/login', {
      email: 'does-not-exist-999@autoclean.com',
      password: 'AnyPassword123!',
    });
    assert.strictEqual(unknownEmailRes.status, 401);
    assert.strictEqual(unknownEmailRes.body.error.code, 'INVALID_CREDENTIALS');

    assert.strictEqual(
      wrongPassRes.body.error.message,
      unknownEmailRes.body.error.message,
      'Error message must be IDENTICAL for unknown email and wrong password to prevent user enumeration'
    );
    console.log('  ✅ Both return 401 INVALID_CREDENTIALS with identical message');

    // =======================================================================
    // 7. GET /api/auth/me (with and without token)
    // =======================================================================
    console.log('\n7. Testing GET /api/auth/me with and without token...');
    const meNoToken = await makeRequest('GET', '/api/auth/me');
    assert.strictEqual(meNoToken.status, 401);
    assert.strictEqual(meNoToken.body.error.code, 'UNAUTHORIZED');
    console.log('  ✅ GET /api/auth/me without token returns 401 UNAUTHORIZED');

    const meWithToken = await makeRequest('GET', '/api/auth/me', null, {
      Authorization: `Bearer ${clientToken}`,
    });
    assert.strictEqual(meWithToken.status, 200);
    const meUser = meWithToken.body.user || meWithToken.body;
    assert.strictEqual(meUser.email, uniqueEmail.toLowerCase());
    assert.strictEqual(meUser.rol, 'CLIENTE');
    assert.strictEqual(meUser.passwordHash, undefined);
    console.log('  ✅ GET /api/auth/me with valid Bearer token returns user profile');

    // =======================================================================
    // 8. Tampered and Expired Token tests
    // =======================================================================
    console.log('\n8. Testing tampered and expired token rejection...');
    const tamperedRes = await makeRequest('GET', '/api/auth/me', null, {
      Authorization: `Bearer ${clientToken}tampered`,
    });
    assert.strictEqual(tamperedRes.status, 401);
    assert.strictEqual(tamperedRes.body.error.code, 'UNAUTHORIZED');
    console.log('  ✅ Tampered token returns 401 UNAUTHORIZED');

    // Create expired token
    const expiredToken = jwt.sign(
      { id: 1, email: 'operario@autoclean.com', rol: 'OPERARIO' },
      env.JWT_SECRET,
      { expiresIn: '-10s' }
    );
    const expiredRes = await makeRequest('GET', '/api/auth/me', null, {
      Authorization: `Bearer ${expiredToken}`,
    });
    assert.strictEqual(expiredRes.status, 401);
    assert.strictEqual(expiredRes.body.error.code, 'UNAUTHORIZED');
    console.log('  ✅ Expired token returns 401 UNAUTHORIZED');

    // =======================================================================
    // 9. Role-Based Authorization (OPERARIO vs CLIENTE)
    // =======================================================================
    console.log('\n9. Testing Role-Based Authorization (403 for CLIENTE on operator routes)...');
    const operatorHeaders = await getOperatorAuthHeaders(prisma);
    const clientHeaders = await getClientAuthHeaders(prisma);

    // Operator-only route: GET /api/bays/summary
    const baySummaryClient = await makeRequest('GET', '/api/bays/summary', null, clientHeaders);
    assert.strictEqual(
      baySummaryClient.status,
      403,
      `Expected 403 for CLIENTE on /api/bays/summary, got ${baySummaryClient.status}`
    );
    assert.strictEqual(baySummaryClient.body.error.code, 'FORBIDDEN');
    console.log('  ✅ CLIENTE receives 403 FORBIDDEN on GET /api/bays/summary');

    const baySummaryOperator = await makeRequest('GET', '/api/bays/summary', null, operatorHeaders);
    assert.strictEqual(baySummaryOperator.status, 200);
    assert.strictEqual(typeof baySummaryOperator.body.total, 'number');
    console.log('  ✅ OPERARIO receives 200 OK on GET /api/bays/summary');

    // Operator-only route: POST /api/vehicles
    const createVehClient = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: 'CLI-123',
        marca: 'Ford',
        modelo: 'Focus',
        nivelSuciedad: 'Leve',
      },
      clientHeaders
    );
    assert.strictEqual(
      createVehClient.status,
      403,
      `Expected 403 for CLIENTE on POST /api/vehicles, got ${createVehClient.status}`
    );
    assert.strictEqual(createVehClient.body.error.code, 'FORBIDDEN');
    console.log('  ✅ CLIENTE receives 403 FORBIDDEN on POST /api/vehicles');

    const createVehOperator = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `OPE-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Ford',
        modelo: 'Focus',
        nivelSuciedad: 'Leve',
      },
      operatorHeaders
    );
    assert.strictEqual(createVehOperator.status, 201);
    console.log('  ✅ OPERARIO receives 201 Created on POST /api/vehicles');

    // Both roles allowed: GET /api/vehicles
    const listVehClient = await makeRequest('GET', '/api/vehicles', null, clientHeaders);
    assert.strictEqual(listVehClient.status, 200);
    console.log('  ✅ CLIENTE receives 200 OK on GET /api/vehicles (read-only allowed)');

    // Protected route without token returns 401
    const noTokenRes = await makeRequest('GET', '/api/vehicles');
    assert.strictEqual(noTokenRes.status, 401);
    assert.strictEqual(noTokenRes.body.error.code, 'UNAUTHORIZED');
    console.log('  ✅ Protected route without token returns 401 UNAUTHORIZED');

    // Cleanup created test user
    await prisma.user.deleteMany({ where: { email: uniqueEmail.toLowerCase() } });

    console.log('\n🎉 ALL JWT AUTHENTICATION & ROLE AUTHORIZATION TESTS PASSED!\n');
  } finally {
    if (simulationInterval) clearInterval(simulationInterval);
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runAuthTests().catch(async (err) => {
  console.error('\n❌ Auth test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  await prisma.$disconnect();
  process.exit(1);
});
