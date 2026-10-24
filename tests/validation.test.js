const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const prisma = require('../src/config/db');

const vehicleRoutes = require('../src/routes/vehicle.routes');
const serviceOrderRoutes = require('../src/routes/serviceOrder.routes');
const evidenceRoutes = require('../src/routes/evidence.routes');
const { notFoundHandler, errorHandler } = require('../src/middlewares/error.middleware');
const { getOperatorAuthHeaders } = require('./helpers/auth');

let authHeaders = {};

const TEST_PORT = 3096;
const app = express();
app.use(express.json());
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/orders', serviceOrderRoutes);
app.use('/api/orders', evidenceRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

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
        ...(!isBuffer && body ? { 'Content-Type': 'application/json' } : {}),
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
          resolve({ status: res.statusCode, body: parsed, raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      if (isBuffer) {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runValidationTests() {
  console.log('🧪 Starting Input Validation (Zod) Test Suite...\n');
  const server = app.listen(TEST_PORT);
  authHeaders = await getOperatorAuthHeaders(prisma);

  const createdVehicleIds = [];
  const createdOrderIds = [];

  try {
    // 1. Vehicle placa validation - Invalid plate format
    console.log('1. Testing invalid plate formats...');
    const invalidPlates = ['INVALID', '123-ABC', 'AB-123', 'ABCD-123', 'ABC-1234', ''];
    for (const badPlate of invalidPlates) {
      const res = await makeRequest('POST', '/api/vehicles', {
        placa: badPlate,
        marca: 'Toyota',
        modelo: 'Corolla',
        color: 'Blanco',
        ownerName: 'Validation Owner',
        nivelSuciedad: 'Leve',
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.message, 'Validation failed');
      assert.strictEqual(res.body.error.details[0].field, 'placa');
    }
    console.log('  ✅ Invalid plate formats correctly rejected with 400.');

    // 2. Vehicle missing required fields
    console.log('\n2. Testing missing required vehicle fields...');
    const missingPlacaRes = await makeRequest('POST', '/api/vehicles', {
      marca: 'Toyota',
      modelo: 'Corolla',
      color: 'Blanco',
      ownerName: 'Validation Owner',
      nivelSuciedad: 'Leve',
    });
    assert.strictEqual(missingPlacaRes.status, 400);
    assert.strictEqual(missingPlacaRes.body.error.message, 'Validation failed');
    assert.strictEqual(missingPlacaRes.body.error.details[0].field, 'placa');

    const missingMarcaRes = await makeRequest('POST', '/api/vehicles', {
      placa: 'VAL-101',
      modelo: 'Corolla',
      color: 'Blanco',
      ownerName: 'Validation Owner',
      nivelSuciedad: 'Leve',
    });
    assert.strictEqual(missingMarcaRes.status, 400);
    assert.strictEqual(missingMarcaRes.body.error.message, 'Validation failed');
    assert.strictEqual(missingMarcaRes.body.error.details[0].field, 'marca');

    const emptyModeloRes = await makeRequest('POST', '/api/vehicles', {
      placa: 'VAL-101',
      marca: 'Toyota',
      modelo: '   ',
      color: 'Blanco',
      ownerName: 'Validation Owner',
      nivelSuciedad: 'Leve',
    });
    assert.strictEqual(emptyModeloRes.status, 400);
    assert.strictEqual(emptyModeloRes.body.error.message, 'Validation failed');
    assert.strictEqual(emptyModeloRes.body.error.details[0].field, 'modelo');
    console.log('  ✅ Missing or blank required fields rejected with 400.');

    // 3. Vehicle invalid nivelSuciedad
    console.log('\n3. Testing invalid nivelSuciedad...');
    const invalidSuciedad = await makeRequest('POST', '/api/vehicles', {
      placa: 'VAL-102',
      marca: 'Toyota',
      modelo: 'Corolla',
      color: 'Blanco',
      ownerName: 'Validation Owner',
      nivelSuciedad: 'Invalido',
    });
    assert.strictEqual(invalidSuciedad.status, 400);
    assert.strictEqual(invalidSuciedad.body.error.message, 'Validation failed');
    assert.strictEqual(invalidSuciedad.body.error.details[0].field, 'nivelSuciedad');
    console.log('  ✅ Invalid nivelSuciedad rejected with 400.');

    // 4. Vehicle placa normalization (lowercase to uppercase)
    console.log('\n4. Testing placa uppercase normalization...');
    const normalizedPlaca = `val-${Math.floor(100 + Math.random() * 900)}`;
    const normRes = await makeRequest('POST', '/api/vehicles', {
      placa: normalizedPlaca,
      marca: 'Toyota',
      modelo: 'Yaris',
      color: 'Gris',
      ownerName: 'Validation Owner',
      nivelSuciedad: 'Moderado',
    });
    assert.strictEqual(normRes.status, 201);
    assert.strictEqual(normRes.body.placa, normalizedPlaca.toUpperCase());
    createdVehicleIds.push(normRes.body.id);
    console.log(`  ✅ Lowercase plate "${normalizedPlaca}" normalized to "${normRes.body.placa}".`);

    // 5. Vehicle ID param validation
    console.log('\n5. Testing non-numeric and negative vehicle ID params...');
    const badVehicleId = await makeRequest('GET', '/api/vehicles/not-a-number');
    assert.strictEqual(badVehicleId.status, 400);
    assert.strictEqual(badVehicleId.body.error.message, 'Validation failed');
    assert.strictEqual(badVehicleId.body.error.details[0].field, 'id');

    const negativeVehicleId = await makeRequest('GET', '/api/vehicles/-5');
    assert.strictEqual(negativeVehicleId.status, 400);
    assert.strictEqual(negativeVehicleId.body.error.message, 'Validation failed');
    assert.strictEqual(negativeVehicleId.body.error.details[0].field, 'id');
    console.log('  ✅ Invalid vehicle ID params rejected with 400.');

    // 6. Service Order creation validation
    console.log('\n6. Testing service order creation validations...');
    const badOrderId = await makeRequest('POST', '/api/orders', {
      vehicleId: 'non-numeric',
    });
    assert.strictEqual(badOrderId.status, 400);
    assert.strictEqual(badOrderId.body.error.message, 'Validation failed');
    assert.strictEqual(badOrderId.body.error.details[0].field, 'vehicleId');

    const missingVehicleId = await makeRequest('POST', '/api/orders', {});
    assert.strictEqual(missingVehicleId.status, 400);
    assert.strictEqual(missingVehicleId.body.error.message, 'Validation failed');
    assert.strictEqual(missingVehicleId.body.error.details[0].field, 'vehicleId');

    // Create a valid order for subsequent tests
    const orderRes = await makeRequest('POST', '/api/orders', {
      vehicleId: normRes.body.id,
    });
    assert.strictEqual(orderRes.status, 201);
    const validOrder = orderRes.body;
    createdOrderIds.push(validOrder.id);
    console.log(`  ✅ Order #${validOrder.id} created successfully.`);

    // 7. Bay occupancy validation (409)
    console.log('\n7. Testing bay occupancy conflict check (409)...');
    let occupiedBay = await prisma.bay.findFirst({ where: { ocupada: true } });
    if (!occupiedBay) {
      occupiedBay = await prisma.bay.create({
        data: { numero: 999, ocupada: true },
      });
    }
    const occupiedBayRes = await makeRequest('POST', '/api/orders', {
      vehicleId: normRes.body.id,
      bayId: occupiedBay.id,
    });
    assert.strictEqual(occupiedBayRes.status, 409);
    assert.strictEqual(occupiedBayRes.body.error.code, 'BAY_OCCUPIED');
    assert.strictEqual(occupiedBayRes.body.error.message, 'Bay is already occupied');
    console.log('  ✅ Creating order with occupied bay returns 409.');

    // 8. Service Order PATCH phase validation
    console.log('\n8. Testing PATCH phase validation...');
    const invalidPhaseRes = await makeRequest('PATCH', `/api/orders/${validOrder.id}/phase`, {
      faseActual: 'INVALID_PHASE',
    });
    assert.strictEqual(invalidPhaseRes.status, 400);
    assert.strictEqual(invalidPhaseRes.body.error.message, 'Validation failed');
    assert.strictEqual(invalidPhaseRes.body.error.details[0].field, 'faseActual');

    const validPhaseRes = await makeRequest('PATCH', `/api/orders/${validOrder.id}/phase`, {
      faseActual: 'LAVADO',
    });
    assert.strictEqual(validPhaseRes.status, 200);
    assert.strictEqual(validPhaseRes.body.faseActual, 'LAVADO');
    console.log('  ✅ Invalid phase rejected with 400; valid phase accepted with 200.');

    // 9. Track by plate validation
    console.log('\n9. Testing track order by plate validation...');
    const invalidTrackPlate = await makeRequest('GET', '/api/orders/track/invalid-plate');
    assert.strictEqual(invalidTrackPlate.status, 400);
    assert.strictEqual(invalidTrackPlate.body.error.message, 'Validation failed');
    assert.strictEqual(invalidTrackPlate.body.error.details[0].field, 'placa');

    const validTrackPlate = await makeRequest('GET', `/api/orders/track/${normRes.body.placa.toLowerCase()}`);
    assert.strictEqual(validTrackPlate.status, 200);
    assert.strictEqual(validTrackPlate.body.id, validOrder.id);
    console.log('  ✅ Track with invalid plate returns 400; lowercase plate normalizes and returns 200.');

    // 10. Evidence upload with invalid etapa and orphan file cleanup
    console.log('\n10. Testing evidence upload with invalid etapa and orphan file cleanup...');
    const evidenceDir = path.join(__dirname, '../storage/evidence');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const filesBefore = fs.readdirSync(evidenceDir);

    const boundary = '----AutoCleanTestBoundary' + Date.now().toString(16);
    const multipartPayload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\nContent-Type: image/jpeg\r\n\r\nfake-image-content\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="etapa"\r\n\r\nINVALID_ETAPA\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ]);

    const uploadRes = await makeRequest(
      'POST',
      `/api/orders/${validOrder.id}/evidence`,
      multipartPayload,
      {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartPayload.length,
      }
    );

    assert.strictEqual(uploadRes.status, 400);
    assert.strictEqual(uploadRes.body.error.message, 'Validation failed');
    assert.strictEqual(uploadRes.body.error.details[0].field, 'etapa');

    const filesAfter = fs.readdirSync(evidenceDir);
    assert.strictEqual(
      filesAfter.length,
      filesBefore.length,
      'Orphan file was left on disk after validation failed!'
    );
    console.log('  ✅ Upload with invalid etapa returned 400 and left NO orphan file on disk.');

    // 11. Evidence with non-numeric orderId
    console.log('\n11. Testing evidence with non-numeric order ID...');
    const badEvidenceOrderId = await makeRequest('GET', '/api/orders/abc/evidence');
    assert.strictEqual(badEvidenceOrderId.status, 400);
    assert.strictEqual(badEvidenceOrderId.body.error.message, 'Validation failed');
    assert.strictEqual(badEvidenceOrderId.body.error.details[0].field, 'orderId');
    console.log('  ✅ Evidence with non-numeric order ID returned 400.');

    console.log('\n🎉 All Input Validation (Zod) tests passed successfully!');
  } finally {
    // Cleanup created orders and vehicles
    for (const orderId of createdOrderIds) {
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } });
      await prisma.phaseEvent.deleteMany({ where: { orderId } });
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } });
    }
    for (const vehicleId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    }
    server.close();
    await prisma.$disconnect();
  }
}

runValidationTests().catch((err) => {
  console.error('❌ Validation test suite failed:', err);
  process.exit(1);
});
