const http = require('http');
const assert = require('assert');

process.env.PORT = '3097';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders } = require('./helpers/auth');
const {
  getRemainingPhasesCount,
  getDeterministicAccuracy,
  calculateDeliveryPrediction,
} = require('../src/services/prediction.service');

let authHeaders = {};

function makeRequest(method, path, body = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3097,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...customHeaders,
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

async function runPredictionTests() {
  console.log('🧪 Starting AI Delivery Time Prediction Test Suite...\n');

  authHeaders = await getOperatorAuthHeaders(prisma);

  // -------------------------------------------------------------
  // UNIT TESTS: prediction.service.js
  // -------------------------------------------------------------
  console.log('=== PART 1: Unit Tests for prediction.service.js ===');

  // 1. Remaining phases count
  console.log('1. Testing getRemainingPhasesCount...');
  assert.strictEqual(getRemainingPhasesCount('RECIBIDO'), 3);
  assert.strictEqual(getRemainingPhasesCount('LAVADO'), 2);
  assert.strictEqual(getRemainingPhasesCount('SECADO'), 1);
  assert.strictEqual(getRemainingPhasesCount('LISTO'), 0);
  assert.strictEqual(getRemainingPhasesCount('UNKNOWN'), 0);
  console.log('  ✅ getRemainingPhasesCount returns correct counts for all phases.');

  // 2. Deterministic accuracy percentage
  console.log('\n2. Testing getDeterministicAccuracy...');
  const acc1 = getDeterministicAccuracy(42);
  const acc2 = getDeterministicAccuracy(42);
  assert.strictEqual(acc1, acc2, 'Accuracy must be identical across repeated calls for same ID');
  assert.ok(acc1 >= 88 && acc1 <= 97, `Accuracy ${acc1} must be between 88 and 97`);

  const sampleAccuracies = new Set();
  for (let id = 1; id <= 30; id++) {
    const acc = getDeterministicAccuracy(id);
    assert.ok(acc >= 88 && acc <= 97, `Accuracy ${acc} for ID ${id} out of bounds`);
    sampleAccuracies.add(acc);
  }
  assert.ok(sampleAccuracies.size > 1, 'Different order IDs should yield varied accuracy percentages');
  console.log('  ✅ Deterministic accuracy is repeatable and properly distributed between 88 and 97.');

  // 3. calculateDeliveryPrediction remaining time calculation
  console.log('\n3. Testing calculateDeliveryPrediction time calculation...');
  const mockNow = 1700000000000;
  const phaseDuration = 60000;

  const recibidoOrder = {
    id: 101,
    faseActual: 'RECIBIDO',
    updatedAt: new Date(mockNow),
    createdAt: new Date(mockNow),
  };
  const predRecibido = calculateDeliveryPrediction(recibidoOrder, {
    now: mockNow,
    phaseDurationMs: phaseDuration,
  });
  // 3 phases remaining -> 3 * 60000ms = 180000ms
  assert.strictEqual(predRecibido.estimatedDeliveryTime.getTime(), mockNow + 180000);
  assert.strictEqual(predRecibido.recalculated, false);
  assert.strictEqual(predRecibido.message, null);
  assert.strictEqual(predRecibido.accuracyPercentage, getDeterministicAccuracy(101));

  const lavadoOrder = {
    id: 102,
    faseActual: 'LAVADO',
    updatedAt: new Date(mockNow),
  };
  const predLavado = calculateDeliveryPrediction(lavadoOrder, {
    now: mockNow,
    phaseDurationMs: phaseDuration,
  });
  // 2 phases remaining -> 2 * 60000ms = 120000ms
  assert.strictEqual(predLavado.estimatedDeliveryTime.getTime(), mockNow + 120000);

  const secadoOrder = {
    id: 103,
    faseActual: 'SECADO',
    updatedAt: new Date(mockNow),
  };
  const predSecado = calculateDeliveryPrediction(secadoOrder, {
    now: mockNow,
    phaseDurationMs: phaseDuration,
  });
  // 1 phase remaining -> 1 * 60000ms = 60000ms
  assert.strictEqual(predSecado.estimatedDeliveryTime.getTime(), mockNow + 60000);
  console.log('  ✅ Remaining time calculation scales accurately with remaining phases.');

  // 4. LISTO phase behavior
  console.log('\n4. Testing LISTO phase behavior...');
  const finishTime = new Date('2026-10-19T10:30:00.000Z');
  const listoOrder = {
    id: 104,
    faseActual: 'LISTO',
    updatedAt: finishTime,
  };
  const predListo = calculateDeliveryPrediction(listoOrder, { now: mockNow });
  assert.strictEqual(predListo.estimatedDeliveryTime.getTime(), finishTime.getTime());
  assert.strictEqual(predListo.accuracyPercentage, 100);
  assert.strictEqual(predListo.recalculated, false);
  assert.strictEqual(predListo.message, null);
  console.log('  ✅ Order in LISTO returns actual completion time and 100% accuracy.');

  // 5. Delay detection
  console.log('\n5. Testing delay detection...');
  const delayedOrder = {
    id: 105,
    faseActual: 'LAVADO',
    updatedAt: new Date(mockNow - 75000), // 75 seconds ago (> 60s phase duration)
  };
  const predDelayed = calculateDeliveryPrediction(delayedOrder, {
    now: mockNow,
    phaseDurationMs: phaseDuration,
  });
  assert.strictEqual(predDelayed.recalculated, true);
  assert.strictEqual(predDelayed.message, 'Tiempo recalculado por posible retraso');

  const onTimeOrder = {
    id: 106,
    faseActual: 'LAVADO',
    updatedAt: new Date(mockNow - 45000), // 45 seconds ago (<= 60s phase duration)
  };
  const predOnTime = calculateDeliveryPrediction(onTimeOrder, {
    now: mockNow,
    phaseDurationMs: phaseDuration,
  });
  assert.strictEqual(predOnTime.recalculated, false);
  assert.strictEqual(predOnTime.message, null);
  console.log('  ✅ Delay detection triggers correctly when phase duration is exceeded.');

  // -------------------------------------------------------------
  // API INTEGRATION TESTS: HTTP Endpoints
  // -------------------------------------------------------------
  console.log('\n=== PART 2: Integration Tests for Prediction Endpoints ===');

  let testVehicle = null;
  let testOrder = null;

  try {
    // Setup test vehicle
    const testPlaca = `PRE-${Math.floor(100 + Math.random() * 900)}`;
    const vRes = await makeRequest('POST', '/api/vehicles', {
      placa: testPlaca,
      marca: 'AITest',
      modelo: 'Predictor',
      color: 'Azul',
      ownerName: 'Prediction Owner',
      nivelSuciedad: 'Moderado',
    });
    assert.strictEqual(vRes.status, 201);
    testVehicle = vRes.body;

    // Setup test order
    const oRes = await makeRequest('POST', '/api/orders', {
      vehicleId: testVehicle.id,
    });
    assert.strictEqual(oRes.status, 201);
    testOrder = oRes.body;
    console.log(`  ✅ Test order #${testOrder.id} created for vehicle ${testPlaca}.`);

    // 6. Test GET /api/orders/:id/prediction
    console.log('\n6. Testing GET /api/orders/:id/prediction...');
    const predRes = await makeRequest('GET', `/api/orders/${testOrder.id}/prediction`);
    assert.strictEqual(predRes.status, 200);
    assert.ok(predRes.body.estimatedDeliveryTime, 'Response must have estimatedDeliveryTime');
    assert.ok(typeof predRes.body.accuracyPercentage === 'number', 'accuracyPercentage must be a number');
    assert.ok(
      predRes.body.accuracyPercentage >= 88 && predRes.body.accuracyPercentage <= 97,
      `accuracyPercentage must be in range [88, 97], got ${predRes.body.accuracyPercentage}`
    );
    assert.strictEqual(predRes.body.recalculated, false);
    assert.strictEqual(predRes.body.message, null);

    // Verify repeatability
    const predRes2 = await makeRequest('GET', `/api/orders/${testOrder.id}/prediction`);
    assert.strictEqual(predRes2.body.accuracyPercentage, predRes.body.accuracyPercentage);
    console.log('  ✅ GET /api/orders/:id/prediction returns valid deterministic prediction.');

    // 7. Test delay detection via database timestamp manipulation
    console.log('\n7. Testing delay detection via API endpoint...');
    await prisma.serviceOrder.update({
      where: { id: testOrder.id },
      data: {
        updatedAt: new Date(Date.now() - 120000), // 2 minutes ago (> 60s)
      },
    });
    const delayedRes = await makeRequest('GET', `/api/orders/${testOrder.id}/prediction`);
    assert.strictEqual(delayedRes.status, 200);
    assert.strictEqual(delayedRes.body.recalculated, true);
    assert.strictEqual(delayedRes.body.message, 'Tiempo recalculado por posible retraso');
    console.log('  ✅ Delay detection triggers through API endpoint for stuck order.');

    // 8. Test prediction on force-completed (LISTO) order
    console.log('\n8. Testing prediction on LISTO order...');
    await makeRequest('POST', `/api/orders/${testOrder.id}/simulate/complete`);
    const listoRes = await makeRequest('GET', `/api/orders/${testOrder.id}/prediction`);
    assert.strictEqual(listoRes.status, 200);
    assert.strictEqual(listoRes.body.accuracyPercentage, 100);
    assert.strictEqual(listoRes.body.recalculated, false);
    assert.strictEqual(listoRes.body.message, null);
    console.log('  ✅ Completed order returns 100% accuracy and actual finish time.');

    // 9. Test GET /api/orders/track/:placa with embedded prediction
    console.log('\n9. Testing GET /api/orders/track/:placa includes embedded prediction...');
    const trackRes = await makeRequest('GET', `/api/orders/track/${testPlaca}`);
    assert.strictEqual(trackRes.status, 200);
    assert.ok(trackRes.body.prediction, 'Tracking response must include "prediction" property');
    assert.strictEqual(trackRes.body.prediction.accuracyPercentage, 100);
    assert.strictEqual(trackRes.body.prediction.recalculated, false);
    assert.ok(trackRes.body.prediction.estimatedDeliveryTime);
    console.log('  ✅ GET /api/orders/track/:placa embeds prediction object correctly.');

    // 10. Test error handling
    console.log('\n10. Testing error handling (404 and 400)...');
    const notFoundRes = await makeRequest('GET', '/api/orders/999999/prediction');
    assert.strictEqual(notFoundRes.status, 404);
    assert.strictEqual(notFoundRes.body.error.message, 'Service order not found');
    assert.strictEqual(notFoundRes.body.error.code, 'NOT_FOUND');

    const invalidIdRes = await makeRequest('GET', '/api/orders/invalid-id/prediction');
    assert.strictEqual(invalidIdRes.status, 400);
    assert.strictEqual(invalidIdRes.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(invalidIdRes.body.error.message, 'Validation failed');
    assert.strictEqual(invalidIdRes.body.error.details[0].field, 'id');
    console.log('  ✅ Prediction endpoint returns 404 for non-existent and 400 for invalid ID.');

    console.log('\n🎉 All AI Delivery Time Prediction tests passed successfully!');
  } finally {
    // Cleanup
    if (testOrder && testVehicle) {
      await prisma.serviceOrder.deleteMany({ where: { vehicleId: testVehicle.id } });
      await prisma.vehicle.delete({ where: { id: testVehicle.id } });
    }

    clearInterval(simulationInterval);
    server.close();
    await prisma.$disconnect();
  }
}

runPredictionTests().catch((err) => {
  console.error('❌ Prediction test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
