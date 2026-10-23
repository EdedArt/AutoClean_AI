const http = require('http');
const assert = require('assert');

// Set fast duration for testing: 1000ms (1 second per phase)
process.env.SIMULATION_PHASE_DURATION_MS = '1000';
process.env.PORT = '3099';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3099,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runIntegrationTest() {
  console.log('🚀 Running Integration Test with live HTTP Server & Background Scheduler...\n');

  const testPlaca = `SIM-${Math.floor(100 + Math.random() * 900)}`;

  // 1. Create a vehicle
  const vRes = await makeRequest('POST', '/api/vehicles', {
    placa: testPlaca,
    marca: 'Hyundai',
    modelo: 'Tucson',
    nivelSuciedad: 'Severo',
  });
  assert.strictEqual(vRes.status, 201);
  const vehicle = vRes.body;

  // 2. Create a service order
  const oRes = await makeRequest('POST', '/api/orders', {
    vehicleId: vehicle.id,
  });
  assert.strictEqual(oRes.status, 201);
  const order = oRes.body;
  assert.strictEqual(order.faseActual, 'RECIBIDO');
  console.log(`✅ Order #${order.id} created in RECIBIDO for vehicle ${testPlaca}`);

  // 2b. Verify paginated envelope on GET /api/vehicles and GET /api/orders
  const vListRes = await makeRequest('GET', '/api/vehicles');
  assert.strictEqual(vListRes.status, 200);
  assert.ok(Array.isArray(vListRes.body.data), 'GET /api/vehicles data must be an array');
  assert.strictEqual(typeof vListRes.body.meta.total, 'number');
  assert.strictEqual(typeof vListRes.body.meta.totalPages, 'number');
  assert.ok(vListRes.body.data.some((v) => v.id === vehicle.id));

  const oListRes = await makeRequest('GET', '/api/orders');
  assert.strictEqual(oListRes.status, 200);
  assert.ok(Array.isArray(oListRes.body.data), 'GET /api/orders data must be an array');
  assert.strictEqual(typeof oListRes.body.meta.total, 'number');
  assert.strictEqual(typeof oListRes.body.meta.totalPages, 'number');
  assert.ok(oListRes.body.data.some((o) => o.id === order.id));
  console.log('✅ Paginated envelope { data, meta } verified for vehicles and orders lists');


  // 3. Test tracking endpoint initially
  const trackInitial = await makeRequest('GET', `/api/orders/track/${testPlaca}`);
  assert.strictEqual(trackInitial.status, 200);
  assert.strictEqual(trackInitial.body.faseActual, 'RECIBIDO');
  console.log('✅ GET /api/orders/track/:placa verified initial status RECIBIDO');

  // 4. Test manual PATCH /api/orders/:id/phase still works
  const patchRes = await makeRequest('PATCH', `/api/orders/${order.id}/phase`, {
    faseActual: 'LAVADO',
  });
  assert.strictEqual(patchRes.status, 200);
  assert.strictEqual(patchRes.body.faseActual, 'LAVADO');
  assert.strictEqual(patchRes.body.porcentajeProgreso, 45);
  console.log('✅ Manual PATCH /api/orders/:id/phase works correctly (advanced to LAVADO, 45%)');

  // 5. Test Tracking again to verify manual change is visible
  const trackAfterPatch = await makeRequest('GET', `/api/orders/track/${testPlaca}`);
  assert.strictEqual(trackAfterPatch.body.faseActual, 'LAVADO');
  assert.strictEqual(trackAfterPatch.body.porcentajeProgreso, 45);
  console.log('✅ Tracking endpoint confirms manual change');

  // 6. Test that LISTO orders remain unchanged
  const readyOrder = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle.id,
      faseActual: 'LISTO',
      porcentajeProgreso: 100,
    },
  });
  await sleep(1200);
  const checkReadyOrder = await prisma.serviceOrder.findUnique({ where: { id: readyOrder.id } });
  assert.strictEqual(checkReadyOrder.faseActual, 'LISTO');
  assert.strictEqual(checkReadyOrder.porcentajeProgreso, 100);
  console.log('✅ Orders in LISTO phase remain unchanged');

  // Cleanup
  await prisma.serviceOrder.deleteMany({ where: { vehicleId: vehicle.id } });
  await prisma.vehicle.delete({ where: { id: vehicle.id } });

  // Shutdown server and clear interval
  clearInterval(simulationInterval);
  server.close();
  await prisma.$disconnect();

  console.log('\n🎉 Integration test completed successfully!');
}

runIntegrationTest().catch((err) => {
  console.error('❌ Integration test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
