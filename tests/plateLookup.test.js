const http = require('http');
const assert = require('assert');
const path = require('path');

process.env.PORT = '3092';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';
process.env.SIMULATION_AUTO_ADVANCE = 'true';
process.env.PLATE_LOOKUP_RATE_LIMIT_PER_MINUTE = '5';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-jwt-signing';
process.env.JWT_EXPIRES_IN = '1d';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders, getClientAuthHeaders, ensureDemoUsers } = require('./helpers/auth');
const { recordPlateSearch } = require('../src/controllers/plate.controller');

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const options = {
      hostname: 'localhost',
      port: 3092,
      path: reqPath,
      method,
      headers: {
        ...headers,
        ...(!isBuffer && body ? { 'Content-Type': 'application/json' } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (isBuffer) {
      req.write(body);
    } else if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const ALLOWED_MINIMAL_KEYS = [
  'color',
  'estimatedReadyAt',
  'etaLabel',
  'etaMinutes',
  'fase',
  'listoParaLavar',
  'marca',
  'modelo',
  'placa',
  'porcentajeProgreso',
  'receivedAt',
  'startedAt',
];

async function createTestClient(email, name, createdUserIds) {
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const passwordHash = await bcrypt.hash('Client12345!', 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      nombre: name,
      rol: 'CLIENTE',
    },
  });
  createdUserIds.push(user.id);
  const token = jwt.sign(
    { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
  return { user, headers: { Authorization: `Bearer ${token}` } };
}

async function runPlateLookupTests() {
  console.log('🧪 Starting Phase 24: Plate Status Lookup, Search History & Privacy Tests...\n');

  const createdVehicleIds = [];
  const createdOrderIds = [];
  const createdUserIds = [];

  try {
    await ensureDemoUsers();
    const operatorHeaders = await getOperatorAuthHeaders();
    const client1Headers = await getClientAuthHeaders();

    // Create client2 for lookup testing
    const client2 = await createTestClient(`client2_${Date.now()}@autoclean.com`, 'Client Two', createdUserIds);
    // Create client for format testing
    const formatClient = await createTestClient(`format_${Date.now()}@autoclean.com`, 'Format Client', createdUserIds);
    // Create client for not-found testing
    const notFoundClient = await createTestClient(`notfound_${Date.now()}@autoclean.com`, 'Not Found Client', createdUserIds);
    // Create client for history testing
    const historyClient = await createTestClient(`history_${Date.now()}@autoclean.com`, 'History Client', createdUserIds);
    // Create client for rate limit testing
    const rateLimitClient = await createTestClient(`ratelimit_${Date.now()}@autoclean.com`, 'Rate Limit Client', createdUserIds);

    // Get client1 user from DB
    const client1User = await prisma.user.findFirst({ where: { rol: 'CLIENTE' } });

    // Create a vehicle owned by Client 1 with an active order in LAVADO
    const plate1 = `PLK-${Math.floor(100 + Math.random() * 900)}`;
    const vehicle1 = await prisma.vehicle.create({
      data: {
        placa: plate1,
        marca: 'Toyota',
        modelo: 'Corolla Cross',
        color: 'Azul',
        ownerName: 'Client One',
        ownerId: client1User.id,
      },
    });
    createdVehicleIds.push(vehicle1.id);

    const order1 = await prisma.serviceOrder.create({
      data: {
        vehicleId: vehicle1.id,
        faseActual: 'LAVADO',
        porcentajeProgreso: 60,
        listoParaLavar: true,
        readyAt: new Date(Date.now() - 300000),
      },
    });
    createdOrderIds.push(order1.id);

    // 1. Unauthenticated -> 401
    console.log('1. Testing unauthenticated lookup returns 401...');
    const unauthRes = await makeRequest('GET', `/api/plates/${plate1}/status`);
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.body.error.code, 'UNAUTHORIZED');
    console.log('  ✅ Unauthenticated request rejected with 401 UNAUTHORIZED.');

    // 2. Client 2 looks up plate owned by Client 1 -> returns minimal view with exact keys
    console.log('\n2. Testing Client 2 looking up Client 1 vehicle gets minimal view with exact keys...');
    const client2Lookup = await makeRequest('GET', `/api/plates/${plate1}/status`, null, client2.headers);
    assert.strictEqual(client2Lookup.status, 200);

    const bodyKeys = Object.keys(client2Lookup.body).sort();
    assert.deepStrictEqual(bodyKeys, ALLOWED_MINIMAL_KEYS, 'Response keys must match minimal view exactly');

    assert.strictEqual(client2Lookup.body.placa, plate1);
    assert.strictEqual(client2Lookup.body.marca, 'Toyota');
    assert.strictEqual(client2Lookup.body.modelo, 'Corolla Cross');
    assert.strictEqual(client2Lookup.body.color, 'Azul');
    assert.strictEqual(client2Lookup.body.fase, 'LAVADO');
    assert.strictEqual(client2Lookup.body.porcentajeProgreso, 60);
    assert.strictEqual(client2Lookup.body.listoParaLavar, true);
    assert.ok(client2Lookup.body.startedAt);
    assert.ok(client2Lookup.body.receivedAt);
    assert.strictEqual(typeof client2Lookup.body.etaMinutes, 'number');
    assert.strictEqual(typeof client2Lookup.body.etaLabel, 'string');
    assert.ok(client2Lookup.body.estimatedReadyAt);

    // Verify forbidden fields are NOT leaked
    assert.strictEqual(client2Lookup.body.ownerName, undefined);
    assert.strictEqual(client2Lookup.body.ownerId, undefined);
    assert.strictEqual(client2Lookup.body.owner, undefined);
    assert.strictEqual(client2Lookup.body.bay, undefined);
    assert.strictEqual(client2Lookup.body.bayId, undefined);
    assert.strictEqual(client2Lookup.body.evidence, undefined);
    assert.strictEqual(client2Lookup.body.evidences, undefined);
    assert.strictEqual(client2Lookup.body.aiAnalyses, undefined);
    assert.strictEqual(client2Lookup.body.nivelSuciedad, undefined);
    assert.strictEqual(client2Lookup.body.id, undefined);
    console.log('  ✅ Client 2 receives exact minimal view without any sensitive owner, bay, or evidence data.');

    // 3. OPERARIO gets the same minimal view
    console.log('\n3. Testing OPERARIO looking up plate gets the exact same minimal view...');
    const opLookup = await makeRequest('GET', `/api/plates/${plate1}/status`, null, operatorHeaders);
    assert.strictEqual(opLookup.status, 200);
    assert.deepStrictEqual(Object.keys(opLookup.body).sort(), ALLOWED_MINIMAL_KEYS);
    assert.strictEqual(opLookup.body.placa, plate1);
    console.log('  ✅ OPERARIO receives the identical minimal view.');

    // 4. Plate normalization: lowercase and without dash (e.g. abc123 -> ABC-123)
    console.log('\n4. Testing plate normalization (abc123 -> ABC-123 and lowercase with dash)...');
    const unhyphenatedPlate = plate1.replace('-', '').toLowerCase();
    const normLookup1 = await makeRequest('GET', `/api/plates/${unhyphenatedPlate}/status`, null, client2.headers);
    assert.strictEqual(normLookup1.status, 200);
    assert.strictEqual(normLookup1.body.placa, plate1);

    const lowercaseLookup = await makeRequest('GET', `/api/plates/${plate1.toLowerCase()}/status`, null, client2.headers);
    assert.strictEqual(lowercaseLookup.status, 200);
    assert.strictEqual(lowercaseLookup.body.placa, plate1);
    console.log('  ✅ Plate successfully normalized from lowercase and dash-omitted formats.');

    // 5. Invalid plate format -> 400 VALIDATION_ERROR
    console.log('\n5. Testing invalid plate formats return 400 VALIDATION_ERROR...');
    const invalidPlates = ['INVALID-PLATE', '123-ABC', 'AB-12', 'ABCD-123', 'A12-345'];
    for (const badPlate of invalidPlates) {
      const badRes = await makeRequest('GET', `/api/plates/${badPlate}/status`, null, formatClient.headers);
      assert.strictEqual(badRes.status, 400);
      assert.strictEqual(badRes.body.error.code, 'VALIDATION_ERROR');
    }
    console.log('  ✅ Invalid plate formats correctly rejected with 400 VALIDATION_ERROR.');

    // 6. Nonexistent plate, delivered plate, and plate without order -> identical 404 NOT_FOUND
    console.log('\n6. Testing nonexistent plate, delivered plate, and plate without order return identical 404...');
    const nonexistentPlate = 'NON-999';
    const nonExistRes = await makeRequest('GET', `/api/plates/${nonexistentPlate}/status`, null, notFoundClient.headers);
    assert.strictEqual(nonExistRes.status, 404);
    assert.strictEqual(nonExistRes.body.error.code, 'NOT_FOUND');
    assert.strictEqual(nonExistRes.body.error.message, 'No hay un carro lavándose con esta placa');

    // Vehicle with no orders
    const noOrderPlate = `PLK-${Math.floor(100 + Math.random() * 900)}`;
    const vehicleNoOrder = await prisma.vehicle.create({
      data: {
        placa: noOrderPlate,
        marca: 'Chevrolet',
        modelo: 'Sail',
        color: 'Blanco',
        ownerName: 'No Order Owner',
      },
    });
    createdVehicleIds.push(vehicleNoOrder.id);
    const noOrderRes = await makeRequest('GET', `/api/plates/${noOrderPlate}/status`, null, notFoundClient.headers);
    assert.strictEqual(noOrderRes.status, 404);
    assert.strictEqual(noOrderRes.body.error.code, 'NOT_FOUND');
    assert.strictEqual(noOrderRes.body.error.message, 'No hay un carro lavándose con esta placa');

    // Vehicle with delivered order
    const deliveredPlate = `PLK-${Math.floor(100 + Math.random() * 900)}`;
    const vehicleDelivered = await prisma.vehicle.create({
      data: {
        placa: deliveredPlate,
        marca: 'Ford',
        modelo: 'Fiesta',
        color: 'Negro',
        ownerName: 'Delivered Owner',
      },
    });
    createdVehicleIds.push(vehicleDelivered.id);
    const deliveredOrder = await prisma.serviceOrder.create({
      data: {
        vehicleId: vehicleDelivered.id,
        faseActual: 'LISTO',
        porcentajeProgreso: 100,
        listoParaLavar: true,
        deliveredAt: new Date(),
      },
    });
    createdOrderIds.push(deliveredOrder.id);
    const deliveredRes = await makeRequest('GET', `/api/plates/${deliveredPlate}/status`, null, notFoundClient.headers);
    assert.strictEqual(deliveredRes.status, 404);
    assert.strictEqual(deliveredRes.body.error.code, 'NOT_FOUND');
    assert.strictEqual(deliveredRes.body.error.message, 'No hay un carro lavándose con esta placa');
    console.log('  ✅ Nonexistent, delivered, and orderless plates return identical 404 with exact message.');

    // 7. Search history is created for CLIENTE (found and not found), NOT for OPERARIO
    console.log('\n7. Testing search history creation for CLIENTE (found and not found) and NOT for OPERARIO...');
    const opUser = await prisma.user.findFirst({ where: { rol: 'OPERARIO' } });
    await prisma.searchedPlate.deleteMany({ where: { userId: opUser.id } });

    // notFoundClient searched noOrderPlate (found vehicle, no order) and nonexistentPlate (not found)
    const clientHistory = await prisma.searchedPlate.findMany({ where: { userId: notFoundClient.user.id } });
    assert.strictEqual(clientHistory.length, 3); // nonexistentPlate, noOrderPlate, deliveredPlate
    const savedPlates = clientHistory.map((h) => h.placa).sort();
    assert.deepStrictEqual(savedPlates, [deliveredPlate, noOrderPlate, nonexistentPlate].sort());

    // Operator searches plate1
    await makeRequest('GET', `/api/plates/${plate1}/status`, null, operatorHeaders);
    const opHistory = await prisma.searchedPlate.findMany({ where: { userId: opUser.id } });
    assert.strictEqual(opHistory.length, 0, 'OPERARIO searches must not be recorded in search history');
    console.log('  ✅ Search history properly recorded for CLIENTE (found and not found), omitted for OPERARIO.');

    // 8. Max 10 entries keeps only the 10 most recent
    console.log('\n8. Testing max 10 entries in search history keeps only the most recent...');
    for (let i = 1; i <= 12; i++) {
      const p = `HST-1${i.toString().padStart(2, '0')}`;
      await recordPlateSearch(historyClient.user.id, p);
    }

    const historyCount = await prisma.searchedPlate.count({ where: { userId: historyClient.user.id } });
    assert.strictEqual(historyCount, 10, 'History must be capped at 10 items');

    const oldestExpectedDeleted = await prisma.searchedPlate.findUnique({
      where: { userId_placa: { userId: historyClient.user.id, placa: 'HST-101' } },
    });
    assert.strictEqual(oldestExpectedDeleted, null, 'Oldest plate HST-101 must have been pruned');

    const newestExpectedPresent = await prisma.searchedPlate.findUnique({
      where: { userId_placa: { userId: historyClient.user.id, placa: 'HST-112' } },
    });
    assert.ok(newestExpectedPresent, 'Newest plate HST-112 must be present');
    console.log('  ✅ Search history strictly capped at 10 most recent entries.');

    // 9. Re-searching moves a plate to the top without duplicating
    console.log('\n9. Testing re-searching an existing plate moves it to the top without duplicate...');
    const beforeCount = await prisma.searchedPlate.count({ where: { userId: historyClient.user.id } });
    assert.strictEqual(beforeCount, 10);

    // Re-search HST-105 via recordPlateSearch (or HTTP request)
    await recordPlateSearch(historyClient.user.id, 'HST-105');
    const afterCount = await prisma.searchedPlate.count({ where: { userId: historyClient.user.id } });
    assert.strictEqual(afterCount, 10, 'Count should not increase on re-search');

    const latestPlate = await prisma.searchedPlate.findFirst({
      where: { userId: historyClient.user.id },
      orderBy: { lastSearchedAt: 'desc' },
    });
    assert.strictEqual(latestPlate.placa, 'HST-105', 'Re-searched plate must be at the top of history');
    console.log('  ✅ Re-searching updates timestamp and moves plate to top without duplication.');

    // 10. GET /api/me/plates returns live status and null+message for inactive
    console.log('\n10. Testing GET /api/me/plates returns live status and null+message for inactive...');
    await prisma.searchedPlate.deleteMany({ where: { userId: historyClient.user.id } });

    // Record active plate1 and inactive nonexistentPlate
    await recordPlateSearch(historyClient.user.id, plate1);
    await recordPlateSearch(historyClient.user.id, nonexistentPlate);

    const mePlatesRes = await makeRequest('GET', '/api/me/plates', null, historyClient.headers);
    assert.strictEqual(mePlatesRes.status, 200);
    assert.ok(Array.isArray(mePlatesRes.body.data));
    assert.strictEqual(mePlatesRes.body.data.length, 2);

    const activeEntry = mePlatesRes.body.data.find((e) => e.placa === plate1);
    assert.ok(activeEntry);
    assert.ok(activeEntry.status);
    assert.strictEqual(activeEntry.status.placa, plate1);
    assert.strictEqual(activeEntry.status.fase, 'LAVADO');
    assert.strictEqual(activeEntry.status.marca, 'Toyota');
    assert.strictEqual(activeEntry.message, undefined);

    const inactiveEntry = mePlatesRes.body.data.find((e) => e.placa === nonexistentPlate);
    assert.ok(inactiveEntry);
    assert.strictEqual(inactiveEntry.status, null);
    assert.strictEqual(inactiveEntry.message, 'No hay un carro lavándose con esta placa');
    console.log('  ✅ GET /api/me/plates correctly formats live status and inactive messages.');

    // 11. DELETE works; second DELETE -> 404
    console.log('\n11. Testing DELETE /api/me/plates/:placa and repeated delete...');
    const deleteRes = await makeRequest('DELETE', `/api/me/plates/${nonexistentPlate}`, null, historyClient.headers);
    assert.strictEqual(deleteRes.status, 204);

    const secondDeleteRes = await makeRequest('DELETE', `/api/me/plates/${nonexistentPlate}`, null, historyClient.headers);
    assert.strictEqual(secondDeleteRes.status, 404);
    assert.strictEqual(secondDeleteRes.body.error.code, 'NOT_FOUND');
    console.log('  ✅ DELETE returns 204 on success and 404 on subsequent attempt.');

    // 12. User isolation: one user cannot see or delete another user's history
    console.log('\n12. Testing user history isolation...');
    await prisma.searchedPlate.deleteMany({ where: { userId: client1User.id } });
    await recordPlateSearch(client1User.id, plate1);

    // historyClient attempts to delete plate1 from history (plate1 is only in Client 1 history)
    await prisma.searchedPlate.deleteMany({ where: { userId: historyClient.user.id } });
    const deleteUnownedHistory = await makeRequest('DELETE', `/api/me/plates/${plate1}`, null, historyClient.headers);
    assert.strictEqual(deleteUnownedHistory.status, 404);

    // Client 1 history still has plate1 intact
    const client1History = await prisma.searchedPlate.findMany({ where: { userId: client1User.id } });
    assert.strictEqual(client1History.length, 1);
    assert.strictEqual(client1History[0].placa, plate1);

    // OPERARIO cannot access /api/me/plates or DELETE -> 403
    const opMePlates = await makeRequest('GET', '/api/me/plates', null, operatorHeaders);
    assert.strictEqual(opMePlates.status, 403);
    assert.strictEqual(opMePlates.body.error.code, 'FORBIDDEN');

    const opDelPlates = await makeRequest('DELETE', `/api/me/plates/${plate1}`, null, operatorHeaders);
    assert.strictEqual(opDelPlates.status, 403);
    assert.strictEqual(opDelPlates.body.error.code, 'FORBIDDEN');
    console.log('  ✅ History is strictly isolated per user and OPERARIO receives 403 on /api/me/plates.');

    // 13. Rate limit returns 429
    console.log('\n13. Testing rate limit (PLATE_LOOKUP_RATE_LIMIT_PER_MINUTE=5) returns 429 RATE_LIMITED...');
    for (let i = 1; i <= 5; i++) {
      const resOk = await makeRequest('GET', `/api/plates/${plate1}/status`, null, rateLimitClient.headers);
      assert.strictEqual(resOk.status, 200);
    }

    const resLimited = await makeRequest('GET', `/api/plates/${plate1}/status`, null, rateLimitClient.headers);
    assert.strictEqual(resLimited.status, 429);
    assert.strictEqual(resLimited.body.error.code, 'RATE_LIMITED');
    assert.strictEqual(resLimited.body.error.message, 'Too many plate lookup requests, please try again later.');
    console.log('  ✅ Rate limit quota exhaustion returned 429 RATE_LIMITED in unified format.');

    // 14. CLIENTE gets 403 on GET /api/orders/:orderId/evidence even for own vehicle
    console.log('\n14. Testing CLIENTE gets 403 on evidence even for own vehicle...');
    const client1EvidenceRes = await makeRequest('GET', `/api/orders/${order1.id}/evidence`, null, client1Headers);
    assert.strictEqual(client1EvidenceRes.status, 403);
    assert.strictEqual(client1EvidenceRes.body.error.code, 'FORBIDDEN');

    const client2EvidenceRes = await makeRequest('GET', `/api/orders/${order1.id}/evidence`, null, client2.headers);
    assert.strictEqual(client2EvidenceRes.status, 403);
    assert.strictEqual(client2EvidenceRes.body.error.code, 'FORBIDDEN');
    console.log('  ✅ CLIENTE receives 403 FORBIDDEN on evidence even for own vehicle.');

    // 15. OPERARIO still gets 200 on GET /api/orders/:orderId/evidence
    console.log('\n15. Testing OPERARIO still gets 200 on GET /api/orders/:orderId/evidence...');
    const opEvidenceRes = await makeRequest('GET', `/api/orders/${order1.id}/evidence`, null, operatorHeaders);
    assert.strictEqual(opEvidenceRes.status, 200);
    assert.ok(Array.isArray(opEvidenceRes.body));
    console.log('  ✅ OPERARIO receives 200 on photo evidence.');

    console.log('\n🎉 ALL PLATE STATUS LOOKUP, SEARCH HISTORY & PRIVACY TESTS PASSED!');
  } finally {
    // Cleanup created records
    for (const orderId of createdOrderIds) {
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } }).catch(() => {});
      await prisma.phaseEvent.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.aiAnalysis.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
    }
    for (const vehicleId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => {});
    }
    for (const userId of createdUserIds) {
      await prisma.searchedPlate.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }

    if (simulationInterval) clearInterval(simulationInterval);
    if (server && server.close) {
      await new Promise((resolve) => server.close(resolve));
    }
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runPlateLookupTests().catch((err) => {
    console.error('❌ Tests failed:', err);
    process.exit(1);
  });
}

module.exports = runPlateLookupTests;
