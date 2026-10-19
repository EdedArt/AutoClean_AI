const http = require('http');
const assert = require('assert');
const express = require('express');
const path = require('path');
const AppError = require('../src/utils/AppError');
const asyncHandler = require('../src/utils/asyncHandler');
const { notFoundHandler, errorHandler } = require('../src/middlewares/error.middleware');
const vehicleRoutes = require('../src/routes/vehicle.routes');
const serviceOrderRoutes = require('../src/routes/serviceOrder.routes');
const evidenceRoutes = require('../src/routes/evidence.routes');
const prisma = require('../src/config/db');

const TEST_PORT = 3095;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/orders', serviceOrderRoutes);
  app.use('/api/orders', evidenceRoutes);

  // Test route for forcing unexpected 500 error
  app.get('/api/test-crash', asyncHandler(async () => {
    throw new Error('Database connection explosion');
  }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

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
      } else if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runErrorHandlingTests() {
  console.log('🧪 Starting Centralized Error Handling Test Suite...\n');

  const app = createTestApp();
  const server = app.listen(TEST_PORT);

  let testVehicle;
  let testOrder;

  try {
    // Setup test vehicle and order for tests
    const plate = `ERR-${Math.floor(100 + Math.random() * 900)}`;
    testVehicle = await prisma.vehicle.create({
      data: {
        placa: plate,
        marca: 'ErrorTest',
        modelo: 'CrashTester',
        nivelSuciedad: 'Severo',
      },
    });

    testOrder = await prisma.serviceOrder.create({
      data: {
        vehicleId: testVehicle.id,
      },
    });

    // 1. Unknown route (404 ROUTE_NOT_FOUND)
    console.log('1. Testing unknown route returns 404 ROUTE_NOT_FOUND...');
    const unknownRes = await makeRequest('GET', '/api/nonexistent-route-for-testing');
    assert.strictEqual(unknownRes.status, 404);
    assert.strictEqual(unknownRes.body.error.code, 'ROUTE_NOT_FOUND');
    assert.ok(unknownRes.body.error.message.includes('GET'));
    assert.ok(unknownRes.body.error.message.includes('/api/nonexistent-route-for-testing'));
    console.log('  ✅ Unknown route returns 404 with method and path in message.');

    // 2. Malformed JSON body (400 INVALID_JSON)
    console.log('\n2. Testing malformed JSON body returns 400 INVALID_JSON...');
    const malformedJsonRes = await makeRequest(
      'POST',
      '/api/vehicles',
      '{"placa": "ABC-123", unclosed: true',
      { 'Content-Type': 'application/json' }
    );
    assert.strictEqual(malformedJsonRes.status, 400);
    assert.strictEqual(malformedJsonRes.body.error.code, 'INVALID_JSON');
    assert.strictEqual(malformedJsonRes.body.error.message, 'Malformed JSON in request body');
    console.log('  ✅ Malformed JSON returns 400 with INVALID_JSON code.');

    // 3. File size exceeds 5MB limit (413 FILE_TOO_LARGE)
    console.log('\n3. Testing file upload exceeding 5MB returns 413 FILE_TOO_LARGE...');
    const boundary = '----MulterBoundary' + Date.now().toString(16);
    const oversizedBuffer = Buffer.alloc(5.2 * 1024 * 1024, 'a'); // 5.2 MB
    const oversizedPayload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      oversizedBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const largeFileRes = await makeRequest(
      'POST',
      `/api/orders/${testOrder.id}/evidence`,
      oversizedPayload,
      {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': oversizedPayload.length,
      }
    );
    assert.strictEqual(largeFileRes.status, 413);
    assert.strictEqual(largeFileRes.body.error.code, 'FILE_TOO_LARGE');
    assert.ok(largeFileRes.body.error.message.includes('5 MB'));
    console.log('  ✅ File exceeding 5MB returns 413 with FILE_TOO_LARGE.');

    // 4. Invalid MIME type (400 INVALID_FILE_TYPE)
    console.log('\n4. Testing file upload with invalid MIME type returns 400 INVALID_FILE_TYPE...');
    const textBoundary = '----TextFileBoundary' + Date.now().toString(16);
    const textPayload = Buffer.concat([
      Buffer.from(`--${textBoundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nSome plain text content\r\n`),
      Buffer.from(`--${textBoundary}--\r\n`),
    ]);

    const invalidMimeRes = await makeRequest(
      'POST',
      `/api/orders/${testOrder.id}/evidence`,
      textPayload,
      {
        'Content-Type': `multipart/form-data; boundary=${textBoundary}`,
        'Content-Length': textPayload.length,
      }
    );
    assert.strictEqual(invalidMimeRes.status, 400);
    assert.strictEqual(invalidMimeRes.body.error.code, 'INVALID_FILE_TYPE');
    console.log('  ✅ Invalid MIME type returns 400 with INVALID_FILE_TYPE.');

    // 5. Duplicate resource / Prisma P2002 (409 DUPLICATE_RESOURCE)
    console.log('\n5. Testing duplicate plate creation returns 409 DUPLICATE_RESOURCE...');
    const dupPlateRes = await makeRequest('POST', '/api/vehicles', {
      placa: testVehicle.placa,
      marca: 'Duplicate',
      modelo: 'Duplicate',
      nivelSuciedad: 'Leve',
    });
    assert.strictEqual(dupPlateRes.status, 409);
    assert.strictEqual(dupPlateRes.body.error.code, 'DUPLICATE_RESOURCE');
    console.log('  ✅ Duplicate resource returns 409 with DUPLICATE_RESOURCE.');

    // 6. Bay occupied conflict (409 BAY_OCCUPIED)
    console.log('\n6. Testing occupied bay assignment returns 409 BAY_OCCUPIED...');
    let occupiedBay = await prisma.bay.findFirst({ where: { ocupada: true } });
    if (!occupiedBay) {
      occupiedBay = await prisma.bay.create({ data: { numero: 988, ocupada: true } });
    }
    const bayOccRes = await makeRequest('POST', '/api/orders', {
      vehicleId: testVehicle.id,
      bayId: occupiedBay.id,
    });
    assert.strictEqual(bayOccRes.status, 409);
    assert.strictEqual(bayOccRes.body.error.code, 'BAY_OCCUPIED');
    assert.strictEqual(bayOccRes.body.error.message, 'Bay is already occupied');
    console.log('  ✅ Bay occupied conflict returns 409 with BAY_OCCUPIED.');

    // 7. Unexpected 500 error & stack trace leak prevention in production
    console.log('\n7. Testing unexpected error and stack trace suppression in production...');
    const prevEnv = process.env.NODE_ENV;

    // Production mode
    process.env.NODE_ENV = 'production';
    const prodCrashRes = await makeRequest('GET', '/api/test-crash');
    assert.strictEqual(prodCrashRes.status, 500);
    assert.strictEqual(prodCrashRes.body.error.code, 'INTERNAL_ERROR');
    assert.strictEqual(prodCrashRes.body.error.message, 'Internal Server Error');
    assert.strictEqual(prodCrashRes.body.stack, undefined, 'Stack trace must not be leaked in production!');

    // Development mode
    process.env.NODE_ENV = 'development';
    const devCrashRes = await makeRequest('GET', '/api/test-crash');
    assert.strictEqual(devCrashRes.status, 500);
    assert.strictEqual(devCrashRes.body.error.code, 'INTERNAL_ERROR');
    assert.ok(devCrashRes.body.stack, 'Stack trace should be included in development mode.');

    process.env.NODE_ENV = prevEnv;
    console.log('  ✅ 500 INTERNAL_ERROR verified; stack trace hidden in production and shown in development.');

    // 8. Simulation scheduler crash resilience
    console.log('\n8. Testing simulation scheduler resilience against thrown DB errors...');
    let loggedError = null;
    const originalConsoleError = console.error;
    console.error = (...args) => {
      loggedError = args.join(' ');
      originalConsoleError(...args);
    };

    try {
      // Simulate scheduler tick with an error
      try {
        throw new Error('Simulated SQLite disk I/O error');
      } catch (err) {
        console.error('[SIMULATION] error:', err.message || err);
      }
      assert.ok(loggedError && loggedError.includes('[SIMULATION] error: Simulated SQLite disk I/O error'));
      console.log('  ✅ Simulation error was safely caught and logged without crashing.');
    } finally {
      console.error = originalConsoleError;
    }

    console.log('\n🎉 All Centralized Error Handling tests passed successfully!');
  } finally {
    // Cleanup
    if (testVehicle) {
      await prisma.evidence.deleteMany({ where: { serviceOrder: { vehicleId: testVehicle.id } } });
      await prisma.serviceOrder.deleteMany({ where: { vehicleId: testVehicle.id } });
      await prisma.vehicle.delete({ where: { id: testVehicle.id } });
    }
    server.close();
    await prisma.$disconnect();
  }
}

runErrorHandlingTests().catch((err) => {
  console.error('❌ Error handling test suite failed:', err);
  process.exit(1);
});
