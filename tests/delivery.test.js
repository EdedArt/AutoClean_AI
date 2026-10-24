const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.PORT = '3088';
process.env.NODE_ENV = 'test';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';
process.env.SIMULATION_AUTO_ADVANCE = 'true';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-jwt-signing';
process.env.JWT_EXPIRES_IN = '1d';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders, getClientAuthHeaders, ensureDemoUsers } = require('./helpers/auth');
const {
  formatEtaDuration,
  calculateEta,
  DEFAULT_PHASE_ETA_MINUTES,
} = require('../src/services/eta.service');

const TEST_PORT = 3088;

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const postData = !isBuffer && body && typeof body === 'object' ? JSON.stringify(body) : body;
    const defaultHeaders = {
      ...headers,
    };

    if (!isBuffer && postData) {
      defaultHeaders['Content-Type'] = 'application/json';
      defaultHeaders['Content-Length'] = Buffer.byteLength(postData);
    } else if (isBuffer) {
      defaultHeaders['Content-Length'] = body.length;
    }

    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: reqPath,
      method,
      headers: defaultHeaders,
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

    if (body) {
      if (isBuffer) {
        req.write(body);
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

function makeMultipartRequest(reqPath, fields, fileField, filename, fileBuffer, mimeType, headers = {}) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const crlf = '\r\n';
    let bodyBuffers = [];

    // Append regular text fields
    for (const [key, value] of Object.entries(fields)) {
      bodyBuffers.push(Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${value}${crlf}`
      ));
    }

    // Append file field
    if (fileField && fileBuffer) {
      bodyBuffers.push(Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${fileField}"; filename="${filename}"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`
      ));
      bodyBuffers.push(fileBuffer);
      bodyBuffers.push(Buffer.from(crlf));
    }

    // Closing boundary
    bodyBuffers.push(Buffer.from(`--${boundary}--${crlf}`));
    const finalBuffer = Buffer.concat(bodyBuffers);

    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: reqPath,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': finalBuffer.length,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data), raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(finalBuffer);
    req.end();
  });
}

async function runDeliveryTests() {
  console.log('🧪 Starting Phase 23: Delivery, One Active Order per Plate, Realistic ETA Test Suite...\n');

  // =========================================================================
  // SECTION A: ETA UNIT TESTS (pure calculation, zero simulation dependence)
  // =========================================================================
  console.log('--- SECTION A: Realistic ETA Unit Tests ---');

  // 1. Label duration formatting
  console.log('1. Testing ETA duration formatting...');
  assert.strictEqual(formatEtaDuration(25), '25 min');
  assert.strictEqual(formatEtaDuration(1), '1 min');
  assert.strictEqual(formatEtaDuration(59), '59 min');
  assert.strictEqual(formatEtaDuration(60), '1 h');
  assert.strictEqual(formatEtaDuration(90), '1 h 30 min');
  assert.strictEqual(formatEtaDuration(120), '2 h');
  assert.strictEqual(formatEtaDuration(125), '2 h 5 min');
  assert.strictEqual(formatEtaDuration(180), '3 h');
  console.log('  ✅ Duration format: <60m "25 min", exact hours "2 h", 60+ "1 h 30 min" verified.');

  // 2. Full wash from PENDIENTE ready
  console.log('2. Testing ETA full wash from ready PENDIENTE...');
  const now = new Date('2026-10-24T12:00:00.000Z');
  const fullWash = calculateEta({
    faseActual: 'PENDIENTE',
    listoParaLavar: true,
    referenceTime: now,
    createdAt: now,
    now,
  });
  // 10 + 5 + 15 + 10 + 0 = 40 min
  assert.strictEqual(fullWash.etaMinutes, 40);
  assert.strictEqual(fullWash.etaLabel, 'Aprox. 40 min');
  assert.strictEqual(fullWash.estimatedReadyAt, new Date('2026-10-24T12:40:00.000Z').toISOString());
  assert.strictEqual(fullWash.deliveredAt, null);
  console.log('  ✅ Full wash from PENDIENTE ready calculates 40 min with label "Aprox. 40 min".');

  // 3. Mid-phase elapsed time
  console.log('3. Testing mid-phase elapsed time deduction...');
  const refTime5MinAgo = new Date(now.getTime() - 5 * 60000);
  const midWash = calculateEta({
    faseActual: 'LAVADO', // LAVADO(15) + SECADO(10) + LISTO(0) = 25 min
    referenceTime: refTime5MinAgo,
    createdAt: refTime5MinAgo,
    now,
  });
  // 25 - 5 = 20 min
  assert.strictEqual(midWash.etaMinutes, 20);
  assert.strictEqual(midWash.etaLabel, 'Aprox. 20 min');
  assert.strictEqual(midWash.estimatedReadyAt, new Date('2026-10-24T12:20:00.000Z').toISOString());
  console.log('  ✅ Elapsed time in current phase deducted correctly.');

  // 4. Remaining time never below 1 minute unless LISTO
  console.log('4. Testing minimum 1 minute clamp...');
  const refTime50MinAgo = new Date(now.getTime() - 50 * 60000);
  const delayedSecado = calculateEta({
    faseActual: 'SECADO', // SECADO(10)
    referenceTime: refTime50MinAgo,
    createdAt: refTime50MinAgo,
    now,
  });
  // 10 - 50 = -40 -> clamped to 1
  assert.strictEqual(delayedSecado.etaMinutes, 1);
  assert.strictEqual(delayedSecado.etaLabel, 'Aprox. 1 min');
  console.log('  ✅ Elapsed phase time never drops ETA below 1 minute.');

  // 5. LISTO is always 0 minutes with specific label
  console.log('5. Testing LISTO phase ETA values...');
  const listoEta = calculateEta({
    faseActual: 'LISTO',
    deliveredAt: null,
    now,
  });
  assert.strictEqual(listoEta.etaMinutes, 0);
  assert.strictEqual(listoEta.etaLabel, 'Listo para entregar');
  assert.strictEqual(listoEta.estimatedReadyAt, null);
  assert.strictEqual(listoEta.deliveredAt, null);
  console.log('  ✅ LISTO returns etaMinutes: 0, label "Listo para entregar", estimatedReadyAt: null.');

  // 6. Queue wait for unready PENDIENTE order
  console.log('6. Testing queue wait for unready PENDIENTE order...');
  const unreadyQueue = calculateEta({
    faseActual: 'PENDIENTE',
    listoParaLavar: false,
    referenceTime: now,
    createdAt: now,
    earlierActiveOrdersCount: 2, // 2 * 15 = 30 min queue wait
    now,
  });
  // 40 base + 30 queue = 70 min
  assert.strictEqual(unreadyQueue.etaMinutes, 70);
  assert.strictEqual(unreadyQueue.etaLabel, 'Pendiente, aprox. 1 h 10 min');
  assert.strictEqual(unreadyQueue.estimatedReadyAt, new Date('2026-10-24T13:10:00.000Z').toISOString());
  console.log('  ✅ Unready PENDIENTE with 2 earlier orders adds 30 min queue wait with "Pendiente, aprox." label.');

  // 7. Queue wait cap at 120 minutes
  console.log('7. Testing queue wait cap at 120 minutes...');
  const cappedQueue = calculateEta({
    faseActual: 'PENDIENTE',
    listoParaLavar: false,
    referenceTime: now,
    createdAt: now,
    earlierActiveOrdersCount: 10, // 10 * 15 = 150 -> capped at 120
    now,
  });
  // 40 base + 120 cap = 160 min
  assert.strictEqual(cappedQueue.etaMinutes, 160);
  assert.strictEqual(cappedQueue.etaLabel, 'Pendiente, aprox. 2 h 40 min');
  console.log('  ✅ Queue wait capped at 120 minutes successfully.');

  // =========================================================================
  // SECTION B: DELIVERY & ACTIVE ORDER INTEGRATION TESTS
  // =========================================================================
  console.log('\n--- SECTION B: API Delivery & Active Order Integration Tests ---');

  const operatorHeaders = await getOperatorAuthHeaders(prisma);
  const { cliente: client1 } = await ensureDemoUsers(prisma);
  const client1Headers = await getClientAuthHeaders(prisma);

  const bcrypt = require('bcryptjs');
  const { generateToken } = require('./helpers/auth');
  const passwordHash = await bcrypt.hash('Demo12345!', 10);
  const client2 = await prisma.user.upsert({
    where: { email: 'client2@autoclean.com' },
    update: { passwordHash, nombre: 'Client Two', rol: 'CLIENTE' },
    create: { email: 'client2@autoclean.com', passwordHash, nombre: 'Client Two', rol: 'CLIENTE' },
  });
  const client2Headers = { Authorization: `Bearer ${generateToken(client2)}` };

  const createdVehicleIds = [];
  const createdOrderIds = [];

  try {
    const testPlaca1 = `DLV-${Math.floor(100 + Math.random() * 900)}`;
    const v1 = await prisma.vehicle.create({
      data: {
        placa: testPlaca1,
        marca: 'Toyota',
        modelo: 'RAV4',
        color: 'Plata',
        ownerName: 'Delivery Owner 1',
        ownerId: client1.id,
      },
    });
    createdVehicleIds.push(v1.id);

    // 8. Create first active order for Vehicle 1
    console.log('\n8. Creating first active order for Vehicle 1...');
    const order1Res = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v1.id },
      operatorHeaders
    );
    assert.strictEqual(order1Res.status, 201);
    const order1 = order1Res.body;
    createdOrderIds.push(order1.id);
    console.log(`  ✅ Active order #${order1.id} created.`);

    // 9. Deliver only works from LISTO (NOT_FINISHED otherwise)
    console.log('\n9. Testing deliver rejection when not in LISTO (409 NOT_FINISHED)...');
    const prematureDeliverRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/deliver`,
      {},
      operatorHeaders
    );
    assert.strictEqual(prematureDeliverRes.status, 409);
    assert.strictEqual(prematureDeliverRes.body.error.code, 'NOT_FINISHED');
    assert.strictEqual(
      prematureDeliverRes.body.error.message,
      'Order cannot be delivered until it reaches LISTO phase'
    );
    console.log('  ✅ Deliver rejected with 409 NOT_FINISHED when order is in PENDIENTE.');

    // 10. CLIENTE cannot deliver (403 FORBIDDEN)
    console.log('\n10. Testing CLIENTE role cannot deliver (403 FORBIDDEN)...');
    const clientDeliverRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/deliver`,
      {},
      client1Headers
    );
    assert.strictEqual(clientDeliverRes.status, 403);
    assert.strictEqual(clientDeliverRes.body.error.code, 'FORBIDDEN');
    console.log('  ✅ CLIENTE receiving 403 FORBIDDEN on /deliver verified.');

    // 11. Creating a second order for the same vehicle with an active order -> ACTIVE_ORDER_EXISTS
    console.log('\n11. Testing second order for vehicle with active order -> 409 ACTIVE_ORDER_EXISTS...');
    const duplicateActiveRes = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v1.id },
      operatorHeaders
    );
    assert.strictEqual(duplicateActiveRes.status, 409);
    assert.strictEqual(duplicateActiveRes.body.error.code, 'ACTIVE_ORDER_EXISTS');
    assert.ok(duplicateActiveRes.body.error.details, 'Must include error details');
    assert.strictEqual(duplicateActiveRes.body.error.details.orderId, order1.id);
    assert.strictEqual(duplicateActiveRes.body.error.details.faseActual, 'PENDIENTE');
    console.log('  ✅ Duplicate active order rejected with 409 ACTIVE_ORDER_EXISTS and details { orderId, faseActual }.');

    // 12. Advance order1 to LISTO
    console.log('\n12. Advancing order1 to LISTO...');
    const completeRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/simulate/complete`,
      {},
      operatorHeaders
    );
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.faseActual, 'LISTO');
    console.log('  ✅ Order is now in LISTO phase.');

    // 13. Deliver order1 successfully as OPERARIO
    console.log('\n13. Delivering order1 as OPERARIO...');
    const deliverRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/deliver`,
      {},
      operatorHeaders
    );
    assert.strictEqual(deliverRes.status, 200);
    assert.ok(deliverRes.body.deliveredAt, 'deliveredAt timestamp must be set');
    assert.strictEqual(deliverRes.body.id, order1.id);
    console.log('  ✅ Order successfully delivered with 200 OK.');

    // 14. Double delivery -> ALREADY_DELIVERED
    console.log('\n14. Testing double delivery rejection -> 409 ALREADY_DELIVERED...');
    const doubleDeliverRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/deliver`,
      {},
      operatorHeaders
    );
    assert.strictEqual(doubleDeliverRes.status, 409);
    assert.strictEqual(doubleDeliverRes.body.error.code, 'ALREADY_DELIVERED');
    assert.strictEqual(doubleDeliverRes.body.error.message, 'Order is already delivered');
    console.log('  ✅ Second delivery rejected with 409 ALREADY_DELIVERED.');

    // 15. After delivery a new order for the same vehicle IS allowed
    console.log('\n15. Testing new order for same vehicle after delivery IS allowed...');
    const order2Res = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v1.id },
      operatorHeaders
    );
    assert.strictEqual(order2Res.status, 201);
    const order2 = order2Res.body;
    createdOrderIds.push(order2.id);
    assert.notStrictEqual(order2.id, order1.id);
    console.log(`  ✅ New order #${order2.id} created for same vehicle after previous was delivered.`);

    // 16. Deliver order2 so vehicle has NO active orders
    await makeRequest('POST', `/api/orders/${order2.id}/simulate/complete`, {}, operatorHeaders);
    await makeRequest('POST', `/api/orders/${order2.id}/deliver`, {}, operatorHeaders);

    // 17. Track after delivery -> 404 with exact message "No hay un carro lavándose con esta placa"
    console.log('\n17. Testing track after delivery returns 404 with exact message...');
    const trackDeliveredRes = await makeRequest(
      'GET',
      `/api/orders/track/${testPlaca1}`,
      null,
      operatorHeaders
    );
    assert.strictEqual(trackDeliveredRes.status, 404);
    assert.strictEqual(trackDeliveredRes.body.error.code, 'NOT_FOUND');
    assert.strictEqual(
      trackDeliveredRes.body.error.message,
      'No hay un carro lavándose con esta placa'
    );
    console.log('  ✅ Tracking delivered plate returns 404 "No hay un carro lavándose con esta placa".');

    // 18. Non-existent plate returns identical 404
    console.log('\n18. Testing tracking non-existent plate returns identical 404...');
    const trackNonExistentRes = await makeRequest(
      'GET',
      '/api/orders/track/NON-999',
      null,
      operatorHeaders
    );
    assert.strictEqual(trackNonExistentRes.status, 404);
    assert.strictEqual(
      trackNonExistentRes.body.error.message,
      'No hay un carro lavándose con esta placa'
    );
    console.log('  ✅ Non-existent plate returns identical 404.');

    // 19. A CLIENTE tracking someone else's plate gets the identical 404
    console.log('\n19. Testing CLIENTE tracking someone else\'s plate returns identical 404...');
    // Create an active order for Client 1
    const testPlaca2 = `CIV-${Math.floor(100 + Math.random() * 900)}`;
    const v2 = await prisma.vehicle.create({
      data: {
        placa: testPlaca2,
        marca: 'Honda',
        modelo: 'Civic',
        color: 'Negro',
        ownerName: 'Client 1 Owner',
        ownerId: client1.id,
      },
    });
    createdVehicleIds.push(v2.id);

    const activeOrderClient1Res = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v2.id },
      operatorHeaders
    );
    createdOrderIds.push(activeOrderClient1Res.body.id);

    // Client 2 attempts to track Client 1's active plate
    const client2TrackRes = await makeRequest(
      'GET',
      `/api/orders/track/${testPlaca2}`,
      null,
      client2Headers
    );
    assert.strictEqual(client2TrackRes.status, 404);
    assert.strictEqual(client2TrackRes.body.error.code, 'NOT_FOUND');
    assert.strictEqual(
      client2TrackRes.body.error.message,
      'No hay un carro lavándose con esta placa'
    );
    console.log('  ✅ CLIENTE tracking another user\'s vehicle plate receives identical 404.');

    // Client 1 (owner) tracks plate -> gets 200 with ETA fields
    const client1TrackRes = await makeRequest(
      'GET',
      `/api/orders/track/${testPlaca2}`,
      null,
      client1Headers
    );
    assert.strictEqual(client1TrackRes.status, 200);
    assert.strictEqual(typeof client1TrackRes.body.etaMinutes, 'number');
    assert.strictEqual(typeof client1TrackRes.body.etaLabel, 'string');
    assert.ok(client1TrackRes.body.estimatedReadyAt);
    assert.strictEqual(client1TrackRes.body.deliveredAt, null);
    console.log('  ✅ Owner client receives 200 with accurate ETA fields.');

    // 20. Block changes on delivered orders: PATCH phase / simulate / analyze
    console.log('\n20. Testing all changes are blocked on delivered orders (409 ALREADY_DELIVERED)...');
    const deliveredOrderId = order1.id;

    // PATCH phase
    const patchPhaseRes = await makeRequest(
      'PATCH',
      `/api/orders/${deliveredOrderId}/phase`,
      { faseActual: 'LAVADO' },
      operatorHeaders
    );
    assert.strictEqual(patchPhaseRes.status, 409);
    assert.strictEqual(patchPhaseRes.body.error.code, 'ALREADY_DELIVERED');

    // simulate advance
    const advanceDeliveredRes = await makeRequest(
      'POST',
      `/api/orders/${deliveredOrderId}/simulate/advance`,
      {},
      operatorHeaders
    );
    assert.strictEqual(advanceDeliveredRes.status, 409);
    assert.strictEqual(advanceDeliveredRes.body.error.code, 'ALREADY_DELIVERED');

    // simulate reset
    const resetDeliveredRes = await makeRequest(
      'POST',
      `/api/orders/${deliveredOrderId}/simulate/reset`,
      {},
      operatorHeaders
    );
    assert.strictEqual(resetDeliveredRes.status, 409);
    assert.strictEqual(resetDeliveredRes.body.error.code, 'ALREADY_DELIVERED');

    // simulate complete
    const completeDeliveredRes = await makeRequest(
      'POST',
      `/api/orders/${deliveredOrderId}/simulate/complete`,
      {},
      operatorHeaders
    );
    assert.strictEqual(completeDeliveredRes.status, 409);
    assert.strictEqual(completeDeliveredRes.body.error.code, 'ALREADY_DELIVERED');

    // /analyze endpoint
    const dummyImageBuffer = Buffer.from('fake-jpeg-image-bytes-for-delivery-test');
    const analyzeDeliveredRes = await makeMultipartRequest(
      `/api/orders/${deliveredOrderId}/analyze`,
      {},
      'image',
      'car.jpg',
      dummyImageBuffer,
      'image/jpeg',
      operatorHeaders
    );
    assert.strictEqual(analyzeDeliveredRes.status, 409);
    assert.strictEqual(analyzeDeliveredRes.body.error.code, 'ALREADY_DELIVERED');
    console.log('  ✅ All phase modifications, demo controls, and /analyze rejected on delivered orders.');

    // 21. Timeline contains delivery entry
    console.log('\n21. Testing timeline contains delivery entry for delivered order...');
    const timelineRes = await makeRequest(
      'GET',
      `/api/orders/${deliveredOrderId}/timeline`,
      null,
      operatorHeaders
    );
    assert.strictEqual(timelineRes.status, 200);
    assert.ok(Array.isArray(timelineRes.body));
    const lastEvent = timelineRes.body[timelineRes.body.length - 1];
    assert.strictEqual(lastEvent.type, 'DELIVERED');
    assert.ok(lastEvent.at);
    // Previous events must still have phase fields
    assert.strictEqual(timelineRes.body[0].fase, 'PENDIENTE');
    console.log('  ✅ Timeline includes { type: "DELIVERED", at } while preserving phase events.');

    // 22. GET /api/orders active query filter (active=true / active=false)
    console.log('\n22. Testing active=true and active=false filter on GET /api/orders...');
    const activeOnlyRes = await makeRequest(
      'GET',
      '/api/orders?active=true',
      null,
      operatorHeaders
    );
    assert.strictEqual(activeOnlyRes.status, 200);
    assert.ok(Array.isArray(activeOnlyRes.body.data));
    assert.ok(activeOnlyRes.body.data.every((o) => o.deliveredAt === null));

    const deliveredOnlyRes = await makeRequest(
      'GET',
      '/api/orders?active=false',
      null,
      operatorHeaders
    );
    assert.strictEqual(deliveredOnlyRes.status, 200);
    assert.ok(Array.isArray(deliveredOnlyRes.body.data));
    assert.ok(deliveredOnlyRes.body.data.every((o) => o.deliveredAt !== null));

    // Verify ETA fields exposed in GET /api/orders
    const firstOrder = activeOnlyRes.body.data[0];
    if (firstOrder) {
      assert.ok('etaMinutes' in firstOrder);
      assert.ok('etaLabel' in firstOrder);
      assert.ok('estimatedReadyAt' in firstOrder);
      assert.ok('deliveredAt' in firstOrder);
    }
    console.log('  ✅ Query active=true and active=false correctly filters orders and exposes ETA fields.');

    console.log('\n🎉 ALL DELIVERY & REALISTIC ETA TESTS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup created test records
    for (const orderId of createdOrderIds) {
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } }).catch(() => {});
      await prisma.aiAnalysis.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.phaseEvent.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
    }
    for (const vehicleId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } }).catch(() => {});
    }
    if (simulationInterval) clearInterval(simulationInterval);
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runDeliveryTests().catch((err) => {
  console.error('\n❌ Delivery test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
