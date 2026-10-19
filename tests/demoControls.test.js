const http = require('http');
const assert = require('assert');

process.env.PORT = '3098';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3098,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
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
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runDemoControlTests() {
  console.log('🧪 Starting Demo Control Endpoints Test Suite...\n');

  const testPlaca = `DEM-${Math.floor(100 + Math.random() * 900)}`;

  // 1. Setup vehicle and order
  const vRes = await makeRequest('POST', '/api/vehicles', {
    placa: testPlaca,
    marca: 'DemoMaker',
    modelo: 'DemoModel',
    nivelSuciedad: 'Severo',
  });
  assert.strictEqual(vRes.status, 201);
  const vehicle = vRes.body;

  const oRes = await makeRequest('POST', '/api/orders', {
    vehicleId: vehicle.id,
  });
  assert.strictEqual(oRes.status, 201);
  const order = oRes.body;
  assert.strictEqual(order.faseActual, 'RECIBIDO');
  console.log(`1. Initialized test order #${order.id} in RECIBIDO.`);

  try {
    // 2. Test POST /api/orders/:id/simulate/advance (RECIBIDO -> LAVADO)
    console.log('\n2. Testing POST /api/orders/:id/simulate/advance (RECIBIDO -> LAVADO)...');
    const adv1 = await makeRequest('POST', `/api/orders/${order.id}/simulate/advance`);
    assert.strictEqual(adv1.status, 200);
    assert.strictEqual(adv1.body.faseActual, 'LAVADO');
    assert.strictEqual(adv1.body.porcentajeProgreso, 45);
    assert.ok(adv1.body.vehicle);
    console.log('  ✅ Successfully advanced to LAVADO (45%).');

    // Verify tracking reflects change
    const track1 = await makeRequest('GET', `/api/orders/track/${testPlaca}`);
    assert.strictEqual(track1.status, 200);
    assert.strictEqual(track1.body.faseActual, 'LAVADO');
    assert.strictEqual(track1.body.porcentajeProgreso, 45);
    console.log('  ✅ Tracking endpoint immediately reflects LAVADO.');

    // 3. Test advancing LAVADO -> SECADO
    console.log('\n3. Testing advance LAVADO -> SECADO...');
    const adv2 = await makeRequest('POST', `/api/orders/${order.id}/simulate/advance`);
    assert.strictEqual(adv2.status, 200);
    assert.strictEqual(adv2.body.faseActual, 'SECADO');
    assert.strictEqual(adv2.body.porcentajeProgreso, 80);
    console.log('  ✅ Successfully advanced to SECADO (80%).');

    // 4. Test advancing SECADO -> LISTO
    console.log('\n4. Testing advance SECADO -> LISTO...');
    const adv3 = await makeRequest('POST', `/api/orders/${order.id}/simulate/advance`);
    assert.strictEqual(adv3.status, 200);
    assert.strictEqual(adv3.body.faseActual, 'LISTO');
    assert.strictEqual(adv3.body.porcentajeProgreso, 100);
    console.log('  ✅ Successfully advanced to LISTO (100%).');

    // 5. Test advancing an order already in LISTO returns 400
    console.log('\n5. Testing advance on order in LISTO returns 400...');
    const advFail = await makeRequest('POST', `/api/orders/${order.id}/simulate/advance`);
    assert.strictEqual(advFail.status, 400);
    assert.strictEqual(advFail.body.error.message, 'Order is already completed.');
    assert.strictEqual(advFail.body.error.code, 'ORDER_COMPLETED');
    console.log('  ✅ Returned 400 with "Order is already completed." message.');

    // 6. Test POST /api/orders/:id/simulate/reset
    console.log('\n6. Testing POST /api/orders/:id/simulate/reset...');
    const resetRes = await makeRequest('POST', `/api/orders/${order.id}/simulate/reset`);
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.body.faseActual, 'RECIBIDO');
    assert.strictEqual(resetRes.body.porcentajeProgreso, 10);
    console.log('  ✅ Order reset to RECIBIDO (10%).');

    // Verify tracking reflects reset
    const trackReset = await makeRequest('GET', `/api/orders/track/${testPlaca}`);
    assert.strictEqual(trackReset.status, 200);
    assert.strictEqual(trackReset.body.faseActual, 'RECIBIDO');
    assert.strictEqual(trackReset.body.porcentajeProgreso, 10);
    console.log('  ✅ Tracking endpoint immediately reflects RECIBIDO.');

    // 7. Test POST /api/orders/:id/simulate/complete
    console.log('\n7. Testing POST /api/orders/:id/simulate/complete...');
    const completeRes = await makeRequest('POST', `/api/orders/${order.id}/simulate/complete`);
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.faseActual, 'LISTO');
    assert.strictEqual(completeRes.body.porcentajeProgreso, 100);
    console.log('  ✅ Order force-completed directly to LISTO (100%).');

    // Verify tracking reflects complete
    const trackComplete = await makeRequest('GET', `/api/orders/track/${testPlaca}`);
    assert.strictEqual(trackComplete.status, 200);
    assert.strictEqual(trackComplete.body.faseActual, 'LISTO');
    assert.strictEqual(trackComplete.body.porcentajeProgreso, 100);
    console.log('  ✅ Tracking endpoint immediately reflects LISTO.');

    // 8. Test 404 for non-existent order
    console.log('\n8. Testing 404 for non-existent order ID...');
    const nonExistentId = 999999;
    const notFoundAdv = await makeRequest('POST', `/api/orders/${nonExistentId}/simulate/advance`);
    assert.strictEqual(notFoundAdv.status, 404);
    assert.strictEqual(notFoundAdv.body.error.message, 'Service order not found');
    assert.strictEqual(notFoundAdv.body.error.code, 'NOT_FOUND');

    const notFoundReset = await makeRequest('POST', `/api/orders/${nonExistentId}/simulate/reset`);
    assert.strictEqual(notFoundReset.status, 404);
    assert.strictEqual(notFoundReset.body.error.message, 'Service order not found');
    assert.strictEqual(notFoundReset.body.error.code, 'NOT_FOUND');

    const notFoundComplete = await makeRequest('POST', `/api/orders/${nonExistentId}/simulate/complete`);
    assert.strictEqual(notFoundComplete.status, 404);
    assert.strictEqual(notFoundComplete.body.error.message, 'Service order not found');
    assert.strictEqual(notFoundComplete.body.error.code, 'NOT_FOUND');
    console.log('  ✅ All three endpoints return 404 for non-existent order.');

    // 9. Test 400 for invalid non-integer order ID
    console.log('\n9. Testing 400 for invalid ID format...');
    const invalidId = await makeRequest('POST', '/api/orders/abc/simulate/advance');
    assert.strictEqual(invalidId.status, 400);
    assert.strictEqual(invalidId.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(invalidId.body.error.message, 'Validation failed');
    assert.strictEqual(invalidId.body.error.details[0].field, 'id');
    console.log('  ✅ Returns 400 for non-integer order ID.');

    console.log('\n🎉 All Demo Control Endpoints tests passed successfully!');
  } finally {
    // Cleanup
    await prisma.serviceOrder.deleteMany({ where: { vehicleId: vehicle.id } });
    await prisma.vehicle.delete({ where: { id: vehicle.id } });

    clearInterval(simulationInterval);
    server.close();
    await prisma.$disconnect();
  }
}

runDemoControlTests().catch((err) => {
  console.error('❌ Demo Control test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
