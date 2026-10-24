const http = require('http');
const assert = require('assert');

process.env.PORT = '3095';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-jwt-signing';
process.env.JWT_EXPIRES_IN = '1d';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders, getClientAuthHeaders } = require('./helpers/auth');

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const defaultHeaders = {
      ...headers,
    };
    if (postData) {
      defaultHeaders['Content-Type'] = 'application/json';
      defaultHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: 'localhost',
      port: 3095,
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

async function runOwnershipTests() {
  console.log('🧪 Starting Vehicle Ownership, Color, and Per-Client Visibility Test Suite...\n');

  let operatorHeaders;
  let client1Headers;
  let client2Headers;

  const createdVehicleIds = [];
  const createdOrderIds = [];

  try {
    // 0. Setup authentication for operator and client1
    console.log('0. Setting up test credentials and accounts...');
    operatorHeaders = await getOperatorAuthHeaders(prisma);
    client1Headers = await getClientAuthHeaders(prisma);

    // Register a second client user through public self-registration
    const client2Email = `client2_${Date.now()}@autoclean.com`;
    const regRes = await makeRequest('POST', '/api/auth/register', {
      nombre: 'Cliente Dos',
      email: client2Email,
      password: 'Password123!',
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.body.rol, 'CLIENTE');

    // Login client2 to obtain JWT
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      email: client2Email,
      password: 'Password123!',
    });
    assert.strictEqual(loginRes.status, 200);
    client2Headers = { Authorization: `Bearer ${loginRes.body.token}` };
    console.log('  ✅ Operator, Client 1, and Client 2 authenticated successfully.');

    // 1. Vehicle creation with color, ownerName, ownerEmail and omitting nivelSuciedad
    console.log('\n1. Testing vehicle creation with color, ownerName, ownerEmail (omitting nivelSuciedad)...');
    const plate1 = `OWN-${Math.floor(100 + Math.random() * 900)}`;
    const createVehRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: plate1,
        marca: 'Mazda',
        modelo: 'CX-50',
        color: 'Rojo',
        ownerName: 'Edgar Arteaga',
        ownerEmail: 'cliente@autoclean.com',
      },
      operatorHeaders
    );

    assert.strictEqual(createVehRes.status, 201, `Expected 201, got ${createVehRes.status}`);
    const v1 = createVehRes.body;
    createdVehicleIds.push(v1.id);
    assert.strictEqual(v1.placa, plate1);
    assert.strictEqual(v1.color, 'Rojo');
    assert.strictEqual(v1.ownerName, 'Edgar Arteaga');
    assert.strictEqual(v1.nivelSuciedad, null, 'Expected nivelSuciedad to be null when omitted');
    assert.ok(v1.ownerId, 'Expected ownerId to be populated');
    console.log(`  ✅ Vehicle #${v1.id} (${plate1}) created with color "Rojo" and linked to cliente@autoclean.com.`);

    // 2. Validation for color and ownerName fields
    console.log('\n2. Testing validation errors on color and ownerName...');
    // Missing color
    const missingColorRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `ERR-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Mazda',
        modelo: '3',
        ownerName: 'Test Owner',
      },
      operatorHeaders
    );
    assert.strictEqual(missingColorRes.status, 400);
    assert.strictEqual(missingColorRes.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(missingColorRes.body.error.details[0].field, 'color');
    console.log('  ✅ Missing color rejected with 400 VALIDATION_ERROR.');

    // Empty color
    const emptyColorRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `ERR-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Mazda',
        modelo: '3',
        color: '   ',
        ownerName: 'Test Owner',
      },
      operatorHeaders
    );
    assert.strictEqual(emptyColorRes.status, 400);
    assert.strictEqual(emptyColorRes.body.error.code, 'VALIDATION_ERROR');
    console.log('  ✅ Blank color rejected with 400 VALIDATION_ERROR.');

    // Missing ownerName
    const missingOwnerNameRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `ERR-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Mazda',
        modelo: '3',
        color: 'Negro',
      },
      operatorHeaders
    );
    assert.strictEqual(missingOwnerNameRes.status, 400);
    assert.strictEqual(missingOwnerNameRes.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(missingOwnerNameRes.body.error.details[0].field, 'ownerName');
    console.log('  ✅ Missing ownerName rejected with 400 VALIDATION_ERROR.');

    // ownerName too short (< 2 chars)
    const shortOwnerRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `ERR-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Mazda',
        modelo: '3',
        color: 'Negro',
        ownerName: 'A',
      },
      operatorHeaders
    );
    assert.strictEqual(shortOwnerRes.status, 400);
    assert.strictEqual(shortOwnerRes.body.error.code, 'VALIDATION_ERROR');
    console.log('  ✅ Too short ownerName rejected with 400 VALIDATION_ERROR.');

    // 3. Unknown ownerEmail -> 404 OWNER_NOT_FOUND
    console.log('\n3. Testing vehicle creation with unknown ownerEmail returns 404 OWNER_NOT_FOUND...');
    const unknownOwnerRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `ERR-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Mazda',
        modelo: '3',
        color: 'Negro',
        ownerName: 'Ghost Owner',
        ownerEmail: 'doesnotexist@autoclean.com',
      },
      operatorHeaders
    );
    assert.strictEqual(unknownOwnerRes.status, 404);
    assert.strictEqual(unknownOwnerRes.body.error.code, 'OWNER_NOT_FOUND');
    console.log('  ✅ Unknown ownerEmail correctly returns 404 OWNER_NOT_FOUND.');

    // 4. ownerEmail of an OPERARIO -> 400 INVALID_OWNER
    console.log('\n4. Testing vehicle creation with operario email returns 400 INVALID_OWNER...');
    const operarioOwnerRes = await makeRequest(
      'POST',
      '/api/vehicles',
      {
        placa: `ERR-${Math.floor(100 + Math.random() * 900)}`,
        marca: 'Mazda',
        modelo: '3',
        color: 'Negro',
        ownerName: 'Operario As Owner',
        ownerEmail: 'operario@autoclean.com',
      },
      operatorHeaders
    );
    assert.strictEqual(operarioOwnerRes.status, 400);
    assert.strictEqual(operarioOwnerRes.body.error.code, 'INVALID_OWNER');
    console.log('  ✅ OPERARIO role as owner correctly returns 400 INVALID_OWNER.');

    // 5. Client 1 sees own vehicle, Client 2 gets 404
    console.log('\n5. Testing client vehicle visibility (Client 1 sees it, Client 2 gets 404)...');
    // Client 1 list
    const client1List = await makeRequest('GET', '/api/vehicles', null, client1Headers);
    assert.strictEqual(client1List.status, 200);
    const client1HasVehicle = client1List.body.data.some((v) => v.id === v1.id);
    assert.ok(client1HasVehicle, 'Client 1 should see own vehicle in list');

    // Client 1 detail
    const client1Detail = await makeRequest('GET', `/api/vehicles/${v1.id}`, null, client1Headers);
    assert.strictEqual(client1Detail.status, 200);
    assert.strictEqual(client1Detail.body.id, v1.id);
    console.log('  ✅ Client 1 can list and view details of own vehicle.');

    // Client 2 list
    const client2List = await makeRequest('GET', '/api/vehicles', null, client2Headers);
    assert.strictEqual(client2List.status, 200);
    const client2HasVehicle = client2List.body.data.some((v) => v.id === v1.id);
    assert.strictEqual(client2HasVehicle, false, 'Client 2 should NOT see Client 1 vehicle in list');

    // Client 2 detail -> 404 NOT_FOUND
    const client2Detail = await makeRequest('GET', `/api/vehicles/${v1.id}`, null, client2Headers);
    assert.strictEqual(client2Detail.status, 404, 'Client 2 should receive 404 for another client vehicle');
    assert.strictEqual(client2Detail.body.error.code, 'NOT_FOUND');
    console.log('  ✅ Client 2 receives 404 NOT_FOUND when requesting Client 1 vehicle.');

    // 6. Orders visibility, tracking, prediction, and evidence
    console.log('\n6. Testing order, tracking, prediction, and evidence visibility...');
    // Create order for v1
    const orderRes = await makeRequest(
      'POST',
      '/api/orders',
      {
        vehicleId: v1.id,
      },
      operatorHeaders
    );
    assert.strictEqual(orderRes.status, 201);
    const order1 = orderRes.body;
    createdOrderIds.push(order1.id);

    // Client 1 lists orders -> sees order1
    const client1Orders = await makeRequest('GET', '/api/orders', null, client1Headers);
    assert.strictEqual(client1Orders.status, 200);
    const client1HasOrder = client1Orders.body.data.some((o) => o.id === order1.id);
    assert.ok(client1HasOrder, 'Client 1 should see order for own vehicle');

    // Client 1 tracks plate
    const client1Track = await makeRequest('GET', `/api/orders/track/${v1.placa}`, null, client1Headers);
    assert.strictEqual(client1Track.status, 200);
    assert.strictEqual(client1Track.body.id, order1.id);
    assert.ok(client1Track.body.prediction, 'Tracking response includes prediction');

    // Client 1 prediction
    const client1Pred = await makeRequest('GET', `/api/orders/${order1.id}/prediction`, null, client1Headers);
    assert.strictEqual(client1Pred.status, 200);
    assert.ok(client1Pred.body.estimatedDeliveryTime);

    // Client 1 evidence list
    const client1Ev = await makeRequest('GET', `/api/orders/${order1.id}/evidence`, null, client1Headers);
    assert.strictEqual(client1Ev.status, 200);
    assert.ok(Array.isArray(client1Ev.body));
    console.log('  ✅ Client 1 successfully accesses orders, tracking, prediction, and evidence.');

    // Client 2 orders list -> does not contain order1
    const client2Orders = await makeRequest('GET', '/api/orders', null, client2Headers);
    assert.strictEqual(client2Orders.status, 200);
    const client2HasOrder = client2Orders.body.data.some((o) => o.id === order1.id);
    assert.strictEqual(client2HasOrder, false, 'Client 2 should not see Client 1 order in list');

    // Client 2 tracks plate -> 404 NOT_FOUND
    const client2Track = await makeRequest('GET', `/api/orders/track/${v1.placa}`, null, client2Headers);
    assert.strictEqual(client2Track.status, 404);
    assert.strictEqual(client2Track.body.error.code, 'NOT_FOUND');

    // Compare with completely non-existent plate
    const nonExistentTrack = await makeRequest('GET', '/api/orders/track/NON-999', null, client2Headers);
    assert.strictEqual(nonExistentTrack.status, 404);
    assert.strictEqual(client2Track.body.error.message, nonExistentTrack.body.error.message);
    console.log('  ✅ Client 2 tracking unowned plate returns identical 404 as non-existent plate.');

    // Client 2 prediction -> 404 NOT_FOUND
    const client2Pred = await makeRequest('GET', `/api/orders/${order1.id}/prediction`, null, client2Headers);
    assert.strictEqual(client2Pred.status, 404);
    assert.strictEqual(client2Pred.body.error.code, 'NOT_FOUND');

    // Client 2 evidence list -> 404 NOT_FOUND
    const client2Ev = await makeRequest('GET', `/api/orders/${order1.id}/evidence`, null, client2Headers);
    assert.strictEqual(client2Ev.status, 404);
    assert.strictEqual(client2Ev.body.error.code, 'NOT_FOUND');
    console.log('  ✅ Client 2 receives 404 NOT_FOUND on prediction and evidence for unowned vehicle.');

    // 7. Operator sees all records
    console.log('\n7. Testing operator has global visibility...');
    const opVehicles = await makeRequest('GET', '/api/vehicles', null, operatorHeaders);
    assert.strictEqual(opVehicles.status, 200);
    assert.ok(opVehicles.body.data.some((v) => v.id === v1.id));

    const opOrders = await makeRequest('GET', '/api/orders', null, operatorHeaders);
    assert.strictEqual(opOrders.status, 200);
    assert.ok(opOrders.body.data.some((o) => o.id === order1.id));

    const opTrack = await makeRequest('GET', `/api/orders/track/${v1.placa}`, null, operatorHeaders);
    assert.strictEqual(opTrack.status, 200);

    const opPred = await makeRequest('GET', `/api/orders/${order1.id}/prediction`, null, operatorHeaders);
    assert.strictEqual(opPred.status, 200);
    console.log('  ✅ Operator has full visibility across all vehicles, orders, and predictions.');

    // 8. PATCH /api/vehicles/:id/owner transfer to Client 2
    console.log('\n8. Testing PATCH /api/vehicles/:id/owner transferring ownership to Client 2...');
    const patchRes = await makeRequest(
      'PATCH',
      `/api/vehicles/${v1.id}/owner`,
      {
        ownerEmail: client2Email,
      },
      operatorHeaders
    );
    assert.strictEqual(patchRes.status, 200);
    assert.ok(patchRes.body.ownerId !== v1.ownerId, 'ownerId should be updated to Client 2');
    console.log(`  ✅ Vehicle #${v1.id} owner successfully transferred to ${client2Email}.`);

    // Verify visibility transferred: Client 2 now sees it, Client 1 now gets 404
    const client2DetailAfter = await makeRequest('GET', `/api/vehicles/${v1.id}`, null, client2Headers);
    assert.strictEqual(client2DetailAfter.status, 200);

    const client2TrackAfter = await makeRequest('GET', `/api/orders/track/${v1.placa}`, null, client2Headers);
    assert.strictEqual(client2TrackAfter.status, 200);

    const client1DetailAfter = await makeRequest('GET', `/api/vehicles/${v1.id}`, null, client1Headers);
    assert.strictEqual(client1DetailAfter.status, 404);

    const client1TrackAfter = await makeRequest('GET', `/api/orders/track/${v1.placa}`, null, client1Headers);
    assert.strictEqual(client1TrackAfter.status, 404);
    console.log('  ✅ Visibility inverted immediately: Client 2 sees vehicle/order, Client 1 gets 404.');

    // 9. PATCH /api/vehicles/:id/owner error scenarios
    console.log('\n9. Testing PATCH /api/vehicles/:id/owner validation and errors...');
    // Vehicle not found
    const patchNotFound = await makeRequest(
      'PATCH',
      '/api/vehicles/999999/owner',
      { ownerEmail: client2Email },
      operatorHeaders
    );
    assert.strictEqual(patchNotFound.status, 404);

    // Owner user not found
    const patchOwnerNotFound = await makeRequest(
      'PATCH',
      `/api/vehicles/${v1.id}/owner`,
      { ownerEmail: 'nosuchuser@autoclean.com' },
      operatorHeaders
    );
    assert.strictEqual(patchOwnerNotFound.status, 404);
    assert.strictEqual(patchOwnerNotFound.body.error.code, 'OWNER_NOT_FOUND');

    // Operario as owner
    const patchInvalidOwner = await makeRequest(
      'PATCH',
      `/api/vehicles/${v1.id}/owner`,
      { ownerEmail: 'operario@autoclean.com' },
      operatorHeaders
    );
    assert.strictEqual(patchInvalidOwner.status, 400);
    assert.strictEqual(patchInvalidOwner.body.error.code, 'INVALID_OWNER');

    // Invalid email format
    const patchBadEmail = await makeRequest(
      'PATCH',
      `/api/vehicles/${v1.id}/owner`,
      { ownerEmail: 'not-an-email' },
      operatorHeaders
    );
    assert.strictEqual(patchBadEmail.status, 400);
    assert.strictEqual(patchBadEmail.body.error.code, 'VALIDATION_ERROR');
    console.log('  ✅ PATCH /api/vehicles/:id/owner validates input and role restrictions accurately.');

    console.log('\n🎉 ALL VEHICLE OWNERSHIP & CLIENT VISIBILITY TESTS PASSED!\n');
  } finally {
    // Cleanup created test records
    for (const orderId of createdOrderIds) {
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } });
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } });
    }
    for (const vehicleId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    }

    if (simulationInterval) {
      clearInterval(simulationInterval);
    }
    server.close();
  }
}

if (require.main === module) {
  runOwnershipTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Ownership Test Suite Failed:', err);
      process.exit(1);
    });
}

module.exports = runOwnershipTests;
