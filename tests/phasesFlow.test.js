const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.PORT = '3093';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-jwt-signing';
process.env.JWT_EXPIRES_IN = '1d';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders, getClientAuthHeaders, ensureDemoUsers } = require('./helpers/auth');
const {
  VALID_PHASES,
  PHASE_CATALOG,
  advanceOrderPhase,
} = require('../src/services/simulation.service');

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
      port: 3093,
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
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runPhasesFlowTests() {
  console.log('🧪 Starting Phase 21: Wash Phases, Ready-to-Wash Flow and Bay Lifecycle Test Suite...\n');

  let operatorHeaders;
  let client1Headers;
  let client2Headers;

  const createdVehicleIds = [];
  const createdOrderIds = [];
  const createdBayIds = [];
  const createdUserIds = [];

  try {
    // 0. Setup demo users and auth tokens
    const { operario, cliente: client1 } = await ensureDemoUsers(prisma);
    operatorHeaders = await getOperatorAuthHeaders(prisma);
    client1Headers = await getClientAuthHeaders(prisma);

    const client2 = await prisma.user.create({
      data: {
        email: `client2_${Date.now()}@autoclean.com`,
        passwordHash: 'dummyhash',
        nombre: 'Second Client',
        rol: 'CLIENTE',
      },
    });
    createdUserIds.push(client2.id);
    const { generateToken } = require('./helpers/auth');
    client2Headers = { Authorization: `Bearer ${generateToken(client2)}` };

    // Create a vehicle owned by Client 1
    const testPlaca1 = `PHS-${Date.now().toString().slice(-4)}`;
    const v1 = await prisma.vehicle.create({
      data: {
        placa: testPlaca1,
        marca: 'Mazda',
        modelo: 'CX-50',
        color: 'Rojo',
        ownerName: 'Edgar Arteaga',
        ownerId: client1.id,
      },
    });
    createdVehicleIds.push(v1.id);

    // =========================================================================
    // 1. New order starts as PENDIENTE, progress 10, listoParaLavar: false
    // =========================================================================
    console.log('1. Testing order creation starts in PENDIENTE (10%) and unready...');
    const order1Res = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v1.id },
      operatorHeaders
    );
    assert.strictEqual(order1Res.status, 201);
    const order1 = order1Res.body;
    createdOrderIds.push(order1.id);

    assert.strictEqual(order1.faseActual, 'PENDIENTE');
    assert.strictEqual(order1.porcentajeProgreso, 10);
    assert.strictEqual(order1.listoParaLavar, false);
    assert.strictEqual(order1.readyAt, null);

    // Verify initial PhaseEvent created with source 'MANUAL'
    const initialEvents = await prisma.phaseEvent.findMany({
      where: { orderId: order1.id },
    });
    assert.strictEqual(initialEvents.length, 1);
    assert.strictEqual(initialEvents[0].fase, 'PENDIENTE');
    assert.strictEqual(initialEvents[0].progreso, 10);
    assert.strictEqual(initialEvents[0].source, 'MANUAL');
    console.log('  ✅ Order starts PENDIENTE / 10% / listoParaLavar: false with MANUAL PhaseEvent.');

    // =========================================================================
    // 2. Simulation auto-advance: skips unready orders, advances ready orders
    // =========================================================================
    console.log('\n2. Testing simulation scheduler advances only ready orders...');
    const fakeNow = Date.now() + 100000;
    const unreadyAdvance = await advanceOrderPhase(order1, { now: fakeNow, durationMs: 60000 });
    assert.strictEqual(unreadyAdvance, null, 'Unready order must not advance in simulation');

    // Order in DB remains PENDIENTE
    const checkDbOrder = await prisma.serviceOrder.findUnique({ where: { id: order1.id } });
    assert.strictEqual(checkDbOrder.faseActual, 'PENDIENTE');
    console.log('  ✅ Unready order was NOT advanced by simulation.');

    // =========================================================================
    // 3. Ready-to-wash endpoint POST /api/orders/:id/ready
    // =========================================================================
    console.log('\n3. Testing POST /api/orders/:id/ready endpoint...');

    // 3a. CLIENTE role forbidden
    const clientReadyRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/ready`,
      {},
      client1Headers
    );
    assert.strictEqual(clientReadyRes.status, 403);
    assert.strictEqual(clientReadyRes.body.error.code, 'FORBIDDEN');
    console.log('  ✅ CLIENTE receives 403 FORBIDDEN on /ready.');

    // 3b. Non-existent order returns 404
    const notFoundReady = await makeRequest(
      'POST',
      '/api/orders/999999/ready',
      {},
      operatorHeaders
    );
    assert.strictEqual(notFoundReady.status, 404);
    assert.strictEqual(notFoundReady.body.error.code, 'NOT_FOUND');
    console.log('  ✅ Non-existent order returns 404 NOT_FOUND.');

    // 3c. OPERARIO marks ready: 200 OK
    const readyRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/ready`,
      {},
      operatorHeaders
    );
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.body.listoParaLavar, true);
    assert.ok(readyRes.body.readyAt, 'readyAt timestamp must be set');
    console.log('  ✅ Order successfully marked ready to wash (200 OK).');

    // 3d. Already ready returns 409 ALREADY_READY
    const alreadyReadyRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/ready`,
      {},
      operatorHeaders
    );
    assert.strictEqual(alreadyReadyRes.status, 409);
    assert.strictEqual(alreadyReadyRes.body.error.code, 'ALREADY_READY');
    console.log('  ✅ Already ready order returns 409 ALREADY_READY.');

    // 3e. Advancing now succeeds
    const readyAdvance = await advanceOrderPhase(
      { ...order1, listoParaLavar: true, updatedAt: new Date(Date.now() - 70000) },
      { now: Date.now(), durationMs: 60000 }
    );
    assert.ok(readyAdvance);
    assert.strictEqual(readyAdvance.faseActual, 'REMOJO');
    assert.strictEqual(readyAdvance.porcentajeProgreso, 30);
    console.log('  ✅ Ready order successfully advanced to REMOJO in simulation.');

    // 3f. Marking ready when not in PENDIENTE returns 409 INVALID_STATE
    const invalidStateRes = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/ready`,
      {},
      operatorHeaders
    );
    assert.strictEqual(invalidStateRes.status, 409);
    assert.strictEqual(invalidStateRes.body.error.code, 'INVALID_STATE');
    console.log('  ✅ Order not in PENDIENTE returns 409 INVALID_STATE on /ready.');

    // =========================================================================
    // 4. Bay lifecycle: occupies on creation and frees at LISTO
    // =========================================================================
    console.log('\n4. Testing bay lifecycle (occupies on creation, frees on LISTO)...');
    const testBay = await prisma.bay.create({
      data: { numero: 991, ocupada: false },
    });
    createdBayIds.push(testBay.id);

    const testPlaca2 = `PHS-${Date.now().toString().slice(-4)}B`;
    const v2 = await prisma.vehicle.create({
      data: {
        placa: testPlaca2,
        marca: 'Toyota',
        modelo: 'Corolla',
        color: 'Gris',
        ownerName: 'Carlos Gómez',
      },
    });
    createdVehicleIds.push(v2.id);

    // Create order with bayId
    const orderWithBayRes = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v2.id, bayId: testBay.id },
      operatorHeaders
    );
    assert.strictEqual(orderWithBayRes.status, 201);
    const orderWithBay = orderWithBayRes.body;
    createdOrderIds.push(orderWithBay.id);

    // Verify bay is occupied in DB
    const bayAfterCreation = await prisma.bay.findUnique({ where: { id: testBay.id } });
    assert.strictEqual(bayAfterCreation.ocupada, true);

    // Second order trying to take same bay returns 409 BAY_OCCUPIED
    const conflictBayRes = await makeRequest(
      'POST',
      '/api/orders',
      { vehicleId: v1.id, bayId: testBay.id },
      operatorHeaders
    );
    assert.strictEqual(conflictBayRes.status, 409);
    assert.strictEqual(conflictBayRes.body.error.code, 'BAY_OCCUPIED');
    console.log('  ✅ Bay occupied on order creation and rejects conflicts with 409 BAY_OCCUPIED.');

    // Complete order to LISTO: bay must be freed
    const completeOrderRes = await makeRequest(
      'POST',
      `/api/orders/${orderWithBay.id}/simulate/complete`,
      {},
      operatorHeaders
    );
    assert.strictEqual(completeOrderRes.status, 200);
    assert.strictEqual(completeOrderRes.body.faseActual, 'LISTO');

    const bayAfterComplete = await prisma.bay.findUnique({ where: { id: testBay.id } });
    assert.strictEqual(bayAfterComplete.ocupada, false);
    console.log('  ✅ Bay freed (ocupada: false) when order reaches LISTO.');

    // =========================================================================
    // 5. Reset from LISTO re-occupies bay or returns 409 if bay taken
    // =========================================================================
    console.log('\n5. Testing reset from LISTO re-occupies bay or throws 409...');

    // 5a. Reset when bay is free -> re-occupies bay
    const resetRes = await makeRequest(
      'POST',
      `/api/orders/${orderWithBay.id}/simulate/reset`,
      {},
      operatorHeaders
    );
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.body.faseActual, 'PENDIENTE');

    const bayAfterReset = await prisma.bay.findUnique({ where: { id: testBay.id } });
    assert.strictEqual(bayAfterReset.ocupada, true);
    console.log('  ✅ Reset from LISTO re-occupies bay successfully.');

    // Complete again to free bay
    await makeRequest('POST', `/api/orders/${orderWithBay.id}/simulate/complete`, {}, operatorHeaders);
    const bayFreedAgain = await prisma.bay.findUnique({ where: { id: testBay.id } });
    assert.strictEqual(bayFreedAgain.ocupada, false);

    // Simulate another car taking the bay
    await prisma.bay.update({ where: { id: testBay.id }, data: { ocupada: true } });

    // 5b. Reset when bay is already taken returns 409 BAY_OCCUPIED
    const resetConflictRes = await makeRequest(
      'POST',
      `/api/orders/${orderWithBay.id}/simulate/reset`,
      {},
      operatorHeaders
    );
    assert.strictEqual(resetConflictRes.status, 409);
    assert.strictEqual(resetConflictRes.body.error.code, 'BAY_OCCUPIED');
    console.log('  ✅ Reset from LISTO throws 409 BAY_OCCUPIED when assigned bay is occupied.');

    // Revert bay status
    await prisma.bay.update({ where: { id: testBay.id }, data: { ocupada: false } });

    // =========================================================================
    // 6. PhaseEvent is created per change with the right source
    // =========================================================================
    console.log('\n6. Testing PhaseEvent audit creation with correct sources...');
    const testPlaca3 = `PHS-${Date.now().toString().slice(-4)}C`;
    const v3 = await prisma.vehicle.create({
      data: {
        placa: testPlaca3,
        marca: 'Renault',
        modelo: 'Duster',
        color: 'Negro',
        ownerName: 'Audit Owner',
      },
    });
    createdVehicleIds.push(v3.id);

    // 1. Order creation -> MANUAL
    const auditOrderRes = await makeRequest('POST', '/api/orders', { vehicleId: v3.id }, operatorHeaders);
    const auditOrder = auditOrderRes.body;
    createdOrderIds.push(auditOrder.id);

    // 2. Demo advance -> DEMO
    await makeRequest('POST', `/api/orders/${auditOrder.id}/simulate/advance`, {}, operatorHeaders);

    // 3. Manual patch -> MANUAL
    await makeRequest('PATCH', `/api/orders/${auditOrder.id}/phase`, { faseActual: 'SECADO' }, operatorHeaders);

    // 4. Background simulation advance -> SIMULATION
    await advanceOrderPhase(
      { id: auditOrder.id, faseActual: 'SECADO', listoParaLavar: true, updatedAt: new Date(Date.now() - 70000) },
      { now: Date.now(), durationMs: 60000 }
    );

    const events = await prisma.phaseEvent.findMany({
      where: { orderId: auditOrder.id },
      orderBy: { createdAt: 'asc' },
    });

    assert.strictEqual(events.length, 4);
    assert.strictEqual(events[0].source, 'MANUAL');
    assert.strictEqual(events[0].fase, 'PENDIENTE');

    assert.strictEqual(events[1].source, 'DEMO');
    assert.strictEqual(events[1].fase, 'REMOJO');

    assert.strictEqual(events[2].source, 'MANUAL');
    assert.strictEqual(events[2].fase, 'SECADO');

    assert.strictEqual(events[3].source, 'SIMULATION');
    assert.strictEqual(events[3].fase, 'LISTO');
    console.log('  ✅ Every transition creates PhaseEvent with expected source (MANUAL, DEMO, SIMULATION).');

    // =========================================================================
    // 7. GET /api/phases catalog endpoint
    // =========================================================================
    console.log('\n7. Testing GET /api/phases endpoint...');
    const phasesRes = await makeRequest('GET', '/api/phases', null, operatorHeaders);
    assert.strictEqual(phasesRes.status, 200);
    assert.ok(Array.isArray(phasesRes.body));
    assert.strictEqual(phasesRes.body.length, 5);

    assert.deepStrictEqual(
      phasesRes.body.map((p) => p.code),
      ['PENDIENTE', 'REMOJO', 'LAVADO', 'SECADO', 'LISTO']
    );
    assert.deepStrictEqual(
      phasesRes.body.map((p) => p.progress),
      [10, 30, 55, 80, 100]
    );

    // Also accessible to CLIENTE
    const clientPhasesRes = await makeRequest('GET', '/api/phases', null, client1Headers);
    assert.strictEqual(clientPhasesRes.status, 200);
    assert.strictEqual(clientPhasesRes.body.length, 5);
    console.log('  ✅ GET /api/phases returns accurate catalog to both OPERARIO and CLIENTE.');

    // =========================================================================
    // 8. GET /api/orders/:id/timeline & ownership access rule
    // =========================================================================
    console.log('\n8. Testing GET /api/orders/:id/timeline and ownership enforcement...');
    // Client 1 owns vehicle v1 and order1
    const client1TimelineRes = await makeRequest('GET', `/api/orders/${order1.id}/timeline`, null, client1Headers);
    assert.strictEqual(client1TimelineRes.status, 200);
    assert.ok(Array.isArray(client1TimelineRes.body));
    assert.ok(client1TimelineRes.body.length >= 1);
    assert.ok(client1TimelineRes.body[0].label, 'Event must have display label');
    assert.ok(client1TimelineRes.body[0].progreso !== undefined);

    // Client 2 does NOT own order1 -> must get 404
    const client2TimelineRes = await makeRequest('GET', `/api/orders/${order1.id}/timeline`, null, client2Headers);
    assert.strictEqual(client2TimelineRes.status, 404);
    assert.strictEqual(client2TimelineRes.body.error.code, 'NOT_FOUND');

    // OPERARIO sees all timelines
    const operarioTimelineRes = await makeRequest('GET', `/api/orders/${order1.id}/timeline`, null, operatorHeaders);
    assert.strictEqual(operarioTimelineRes.status, 200);
    assert.ok(operarioTimelineRes.body.length >= 1);
    console.log('  ✅ Timeline enforces ownership: owner gets 200, non-owner client gets 404, operator gets 200.');

    // =========================================================================
    // 9. Prediction delay detection skipped while PENDIENTE and unready
    // =========================================================================
    console.log('\n9. Testing prediction delay is not flagged for unready PENDIENTE orders...');
    const testPlaca4 = `PHS-${Date.now().toString().slice(-4)}D`;
    const v4 = await prisma.vehicle.create({
      data: {
        placa: testPlaca4,
        marca: 'Nissan',
        modelo: 'Kicks',
        color: 'Azul',
        ownerName: 'Delay Test Owner',
      },
    });
    createdVehicleIds.push(v4.id);

    const unreadyOrderRes = await makeRequest('POST', '/api/orders', { vehicleId: v4.id }, operatorHeaders);
    const unreadyOrder = unreadyOrderRes.body;
    createdOrderIds.push(unreadyOrder.id);

    // Simulate elapsed time 10 minutes ago
    await prisma.serviceOrder.update({
      where: { id: unreadyOrder.id },
      data: { updatedAt: new Date(Date.now() - 600000) },
    });

    const predUnreadyRes = await makeRequest('GET', `/api/orders/${unreadyOrder.id}/prediction`, null, operatorHeaders);
    assert.strictEqual(predUnreadyRes.status, 200);
    assert.strictEqual(predUnreadyRes.body.recalculated, false);
    assert.strictEqual(predUnreadyRes.body.message, null);
    console.log('  ✅ Unready PENDIENTE order with old timestamp is NEVER flagged as delayed.');

    // Mark as ready -> now delay recalculation should trigger
    await makeRequest('POST', `/api/orders/${unreadyOrder.id}/ready`, {}, operatorHeaders);
    await prisma.serviceOrder.update({
      where: { id: unreadyOrder.id },
      data: { updatedAt: new Date(Date.now() - 600000) },
    });
    const predReadyRes = await makeRequest('GET', `/api/orders/${unreadyOrder.id}/prediction`, null, operatorHeaders);
    assert.strictEqual(predReadyRes.status, 200);
    assert.strictEqual(predReadyRes.body.recalculated, true);
    assert.strictEqual(predReadyRes.body.message, 'Tiempo recalculado por posible retraso');
    console.log('  ✅ Ready order with elapsed time is flagged as delayed.');

    // =========================================================================
    // 10. SIMULATION_AUTO_ADVANCE=false stops scheduler
    // =========================================================================
    console.log('\n10. Testing SIMULATION_AUTO_ADVANCE=false disables simulation...');
    process.env.SIMULATION_AUTO_ADVANCE = 'false';

    const stoppedAdvance = await advanceOrderPhase(
      { id: unreadyOrder.id, faseActual: 'PENDIENTE', listoParaLavar: true, updatedAt: new Date(Date.now() - 100000) },
      { now: Date.now(), durationMs: 60000 }
    );
    assert.strictEqual(stoppedAdvance, null, 'advanceOrderPhase must return null when SIMULATION_AUTO_ADVANCE=false');

    process.env.SIMULATION_AUTO_ADVANCE = 'true';
    console.log('  ✅ SIMULATION_AUTO_ADVANCE=false stops simulation advancement.');

    // =========================================================================
    // 11. Evidence upload accepts new etapa values and rejects RECIBIDO
    // =========================================================================
    console.log('\n11. Testing evidence upload with new etapa values and rejecting RECIBIDO...');
    const boundary = '----AutoCleanBoundary' + Date.now().toString(16);

    // 11a. RECIBIDO must be rejected with 400
    const payloadRecibido = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nfake-image-bytes\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="etapa"\r\n\r\nRECIBIDO\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ]);
    const resRecibido = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/evidence`,
      payloadRecibido,
      {
        ...operatorHeaders,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      }
    );
    assert.strictEqual(resRecibido.status, 400);
    assert.strictEqual(resRecibido.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(resRecibido.body.error.details[0].field, 'etapa');
    console.log('  ✅ Upload with etapa RECIBIDO is rejected with 400.');

    // 11b. REMOJO must be accepted with 201
    const payloadRemojo = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="remojo.jpg"\r\nContent-Type: image/jpeg\r\n\r\nfake-image-bytes\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="etapa"\r\n\r\nREMOJO\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ]);
    const resRemojo = await makeRequest(
      'POST',
      `/api/orders/${order1.id}/evidence`,
      payloadRemojo,
      {
        ...operatorHeaders,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      }
    );
    assert.strictEqual(resRemojo.status, 201);
    assert.strictEqual(resRemojo.body.etapa, 'REMOJO');
    console.log('  ✅ Upload with etapa REMOJO succeeds with 201.');

    // Cleanup uploaded file on disk
    if (resRemojo.body.url) {
      const diskPath = path.join(__dirname, '..', 'storage', resRemojo.body.url.replace(/^\//, ''));
      if (fs.existsSync(diskPath)) {
        try { fs.unlinkSync(diskPath); } catch (_) {}
      }
    }

    console.log('\n🎉 All Phase 21 Phases & Ready Flow tests passed successfully!');
  } finally {
    // Teardown test artifacts
    for (const orderId of createdOrderIds) {
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } });
      await prisma.phaseEvent.deleteMany({ where: { orderId } });
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } });
    }
    for (const vehicleId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    }
    for (const bayId of createdBayIds) {
      await prisma.bay.deleteMany({ where: { id: bayId } });
    }
    for (const userId of createdUserIds) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    clearInterval(simulationInterval);
    server.close();
    await prisma.$disconnect();
  }
}

runPhasesFlowTests().catch((err) => {
  console.error('\n❌ PhasesFlow test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
