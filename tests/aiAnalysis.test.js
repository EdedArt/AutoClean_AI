const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.PORT = '3094';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-jwt-signing';
process.env.JWT_EXPIRES_IN = '1d';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { getOperatorAuthHeaders, getClientAuthHeaders, ensureDemoUsers } = require('./helpers/auth');
const aiService = require('../src/services/ai');
const simulatedProvider = require('../src/services/ai/simulatedProvider');
const geminiProvider = require('../src/services/ai/geminiProvider');
const { validateEnv } = require('../src/config/env');

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
      port: 3094,
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

function buildMultipart({ fieldName = 'image', filename = 'car.jpg', mimeType = 'image/jpeg', content = 'fake-image-bytes', fields = {} } = {}) {
  const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
  const chunks = [];

  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }

  if (content !== null) {
    const fileBuf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      )
    );
    chunks.push(fileBuf);
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    buffer: Buffer.concat(chunks),
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
  };
}

async function runAiAnalysisTests() {
  console.log('🧪 Starting Phase 22 Gemini Vision & AI Analysis Test Suite...\n');

  const createdOrderIds = [];
  const createdVehicleIds = [];

  try {
    await ensureDemoUsers();
    const operatorHeaders = await getOperatorAuthHeaders();
    const clientHeaders = await getClientAuthHeaders();

    // Helper to create a fresh vehicle and ready order
    async function createTestVehicleAndOrder({ placa = 'AIX-101', listo = true, currentPhase = 'PENDIENTE', nivelSuciedad = null } = {}) {
      const v = await prisma.vehicle.create({
        data: {
          placa,
          marca: 'Mazda',
          modelo: 'CX-30',
          color: 'Blanco',
          ownerName: 'Test Owner',
          nivelSuciedad,
        },
      });
      createdVehicleIds.push(v.id);

      const o = await prisma.serviceOrder.create({
        data: {
          vehicleId: v.id,
          faseActual: currentPhase,
          porcentajeProgreso: currentPhase === 'PENDIENTE' ? 10 : 30,
          listoParaLavar: listo,
          readyAt: listo ? new Date() : null,
        },
        include: { vehicle: true },
      });
      createdOrderIds.push(o.id);
      return { vehicle: v, order: o };
    }

    // 1. Simulated provider is deterministic and honors scenarios
    console.log('1. Testing simulated provider determinism and demo scenarios...');
    const det1 = await simulatedProvider.analyzeImage({
      expectedPlate: 'AIX-101',
      currentPhase: 'PENDIENTE',
      orderId: 99,
    });
    const det2 = await simulatedProvider.analyzeImage({
      expectedPlate: 'AIX-101',
      currentPhase: 'PENDIENTE',
      orderId: 99,
    });
    assert.strictEqual(det1.plateDetected, 'AIX-101');
    assert.strictEqual(det1.phase, 'REMOJO');
    assert.strictEqual(det1.plateConfidence, det2.plateConfidence);
    assert.strictEqual(det1.phaseConfidence, det2.phaseConfidence);

    // Scenario tests
    const scenWrong = await simulatedProvider.analyzeImage({
      expectedPlate: 'AIX-101',
      currentPhase: 'PENDIENTE',
      scenario: 'wrong_vehicle',
    });
    assert.notStrictEqual(scenWrong.plateDetected, 'AIX-101');
    assert.strictEqual(scenWrong.plateDetected, 'ZZZ-999');

    const scenUnreadable = await simulatedProvider.analyzeImage({
      expectedPlate: 'AIX-101',
      scenario: 'unreadable',
    });
    assert.strictEqual(scenUnreadable.plateDetected, null);

    const scenRegression = await simulatedProvider.analyzeImage({
      expectedPlate: 'AIX-101',
      currentPhase: 'LAVADO',
      scenario: 'regression',
    });
    assert.strictEqual(scenRegression.phase, 'REMOJO');
    console.log('  ✅ Simulated provider is deterministic and correctly honors all scenarios.');

    // 2. Matching plate advances the phase with a PhaseEvent of source "AI"
    console.log('\n2. Testing matching plate auto-advances phase with source "AI"...');
    const { order: order1 } = await createTestVehicleAndOrder({ placa: 'MAT-101', listo: true });
    const mp1 = buildMultipart({
      fields: { saveEvidence: 'true' },
    });

    const resMatch = await makeRequest('POST', `/api/orders/${order1.id}/analyze`, mp1.buffer, {
      ...operatorHeaders,
      ...mp1.headers,
    });

    assert.strictEqual(resMatch.status, 200);
    assert.strictEqual(resMatch.body.plate.matched, true);
    assert.strictEqual(resMatch.body.phase.changed, true);
    assert.strictEqual(resMatch.body.phase.previous, 'PENDIENTE');
    assert.strictEqual(resMatch.body.phase.current, 'REMOJO');
    assert.strictEqual(resMatch.body.order.faseActual, 'REMOJO');
    assert.ok(resMatch.body.evidenceId, 'Evidence should be created on matching plate');

    const aiEvent = await prisma.phaseEvent.findFirst({
      where: {
        orderId: order1.id,
        fase: 'REMOJO',
        source: 'AI',
      },
    });
    assert.ok(aiEvent, 'PhaseEvent with source AI must be recorded in database');
    console.log('  ✅ Matching plate advanced phase to REMOJO with PhaseEvent source="AI".');

    // 3. Wrong plate -> 409 WRONG_VEHICLE and phase is unchanged
    console.log('\n3. Testing wrong plate returns 409 WRONG_VEHICLE with detected & expected details...');
    const { order: order2 } = await createTestVehicleAndOrder({ placa: 'EXP-202', listo: true });
    const mpWrong = buildMultipart({
      fields: { scenario: 'wrong_vehicle' },
    });

    const resWrong = await makeRequest('POST', `/api/orders/${order2.id}/analyze`, mpWrong.buffer, {
      ...operatorHeaders,
      ...mpWrong.headers,
    });

    assert.strictEqual(resWrong.status, 409);
    assert.strictEqual(resWrong.body.error.code, 'WRONG_VEHICLE');
    assert.ok(resWrong.body.error.details, 'Error details must be present');
    assert.strictEqual(resWrong.body.error.details.expected, 'EXP-202');
    assert.strictEqual(resWrong.body.error.details.detected, 'ZZZ-999');

    const freshOrder2 = await prisma.serviceOrder.findUnique({ where: { id: order2.id } });
    assert.strictEqual(freshOrder2.faseActual, 'PENDIENTE');

    const wrongAnalysis = await prisma.aiAnalysis.findFirst({
      where: { orderId: order2.id, outcome: 'WRONG_VEHICLE' },
    });
    assert.ok(wrongAnalysis, 'AiAnalysis record with outcome WRONG_VEHICLE must be saved');
    console.log('  ✅ Wrong vehicle rejected with 409 WRONG_VEHICLE and details; phase untouched.');

    // 4. Unreadable plate -> 422 PLATE_UNREADABLE
    console.log('\n4. Testing unreadable plate returns 422 PLATE_UNREADABLE...');
    const { order: order3 } = await createTestVehicleAndOrder({ placa: 'UNR-303', listo: true });
    const mpUnreadable = buildMultipart({
      fields: { scenario: 'unreadable' },
    });

    const resUnreadable = await makeRequest('POST', `/api/orders/${order3.id}/analyze`, mpUnreadable.buffer, {
      ...operatorHeaders,
      ...mpUnreadable.headers,
    });

    assert.strictEqual(resUnreadable.status, 422);
    assert.strictEqual(resUnreadable.body.error.code, 'PLATE_UNREADABLE');

    const unreadableAnalysis = await prisma.aiAnalysis.findFirst({
      where: { orderId: order3.id, outcome: 'PLATE_UNREADABLE' },
    });
    assert.ok(unreadableAnalysis, 'AiAnalysis record with outcome PLATE_UNREADABLE must be saved');
    console.log('  ✅ Unreadable plate rejected with 422 PLATE_UNREADABLE.');

    // 5. Low confidence phase -> 200 with changed: false
    console.log('\n5. Testing low confidence phase leaves phase unchanged...');
    const { order: order4 } = await createTestVehicleAndOrder({ placa: 'LOW-404', listo: true });
    const mpLowConf = buildMultipart({
      fields: { scenario: 'low_confidence' },
    });

    const resLowConf = await makeRequest('POST', `/api/orders/${order4.id}/analyze`, mpLowConf.buffer, {
      ...operatorHeaders,
      ...mpLowConf.headers,
    });

    assert.strictEqual(resLowConf.status, 200);
    assert.strictEqual(resLowConf.body.phase.changed, false);
    assert.strictEqual(resLowConf.body.phase.current, 'PENDIENTE');

    const lowConfAnalysis = await prisma.aiAnalysis.findFirst({
      where: { orderId: order4.id, outcome: 'LOW_CONFIDENCE' },
    });
    assert.ok(lowConfAnalysis, 'AiAnalysis record with outcome LOW_CONFIDENCE saved');
    console.log('  ✅ Low confidence phase returns 200 with changed: false.');

    // 6. Regression ignored -> 200 with regression: true and changed: false
    console.log('\n6. Testing regression phase is safely ignored...');
    const { order: order5 } = await createTestVehicleAndOrder({
      placa: 'REG-505',
      listo: true,
      currentPhase: 'LAVADO',
    });
    const mpReg = buildMultipart({
      fields: { scenario: 'regression' },
    });

    const resReg = await makeRequest('POST', `/api/orders/${order5.id}/analyze`, mpReg.buffer, {
      ...operatorHeaders,
      ...mpReg.headers,
    });

    assert.strictEqual(resReg.status, 200);
    assert.strictEqual(resReg.body.phase.changed, false);
    assert.strictEqual(resReg.body.phase.regression, true);
    assert.strictEqual(resReg.body.phase.current, 'LAVADO');

    const regAnalysis = await prisma.aiAnalysis.findFirst({
      where: { orderId: order5.id, outcome: 'REGRESSION_IGNORED' },
    });
    assert.ok(regAnalysis, 'AiAnalysis record with outcome REGRESSION_IGNORED saved');
    console.log('  ✅ Earlier detected phase flagged as regression and ignored (phase stays LAVADO).');

    // 7. Precondition: Order not ready -> 409 NOT_READY
    console.log('\n7. Testing unready order returns 409 NOT_READY...');
    const { order: orderUnready } = await createTestVehicleAndOrder({ placa: 'NRD-707', listo: false });
    const mpUnready = buildMultipart();

    const resNotReady = await makeRequest('POST', `/api/orders/${orderUnready.id}/analyze`, mpUnready.buffer, {
      ...operatorHeaders,
      ...mpUnready.headers,
    });

    assert.strictEqual(resNotReady.status, 409);
    assert.strictEqual(resNotReady.body.error.code, 'NOT_READY');
    console.log('  ✅ Unready order rejected with 409 NOT_READY.');

    // 8. Precondition: Completed order (LISTO) -> 409 INVALID_STATE
    console.log('\n8. Testing completed order returns 409 INVALID_STATE...');
    const { order: orderListo } = await createTestVehicleAndOrder({
      placa: 'LST-808',
      listo: true,
      currentPhase: 'LISTO',
    });
    const mpListo = buildMultipart();

    const resListo = await makeRequest('POST', `/api/orders/${orderListo.id}/analyze`, mpListo.buffer, {
      ...operatorHeaders,
      ...mpListo.headers,
    });

    assert.strictEqual(resListo.status, 409);
    assert.strictEqual(resListo.body.error.code, 'INVALID_STATE');
    console.log('  ✅ Order in LISTO phase rejected with 409 INVALID_STATE.');

    // 9. Role authorization: CLIENTE -> 403 Forbidden
    console.log('\n9. Testing CLIENTE receives 403 Forbidden on analyze endpoint...');
    const resForbidden = await makeRequest('POST', `/api/orders/${order1.id}/analyze`, mp1.buffer, {
      ...clientHeaders,
      ...mp1.headers,
    });
    assert.strictEqual(resForbidden.status, 403);
    assert.strictEqual(resForbidden.body.error.code, 'FORBIDDEN');
    console.log('  ✅ CLIENTE role blocked with 403 FORBIDDEN.');

    // 10. File upload validation & orphan file cleanup
    console.log('\n10. Testing invalid file type and size validation...');
    const mpInvalidType = buildMultipart({
      filename: 'document.txt',
      mimeType: 'text/plain',
      content: 'hello text',
    });
    const resInvalidType = await makeRequest('POST', `/api/orders/${order1.id}/analyze`, mpInvalidType.buffer, {
      ...operatorHeaders,
      ...mpInvalidType.headers,
    });
    assert.strictEqual(resInvalidType.status, 400);
    assert.strictEqual(resInvalidType.body.error.code, 'INVALID_FILE_TYPE');

    const bigBuffer = Buffer.alloc(5.5 * 1024 * 1024, 0); // 5.5 MB
    const mpTooLarge = buildMultipart({
      content: bigBuffer,
    });
    const resTooLarge = await makeRequest('POST', `/api/orders/${order1.id}/analyze`, mpTooLarge.buffer, {
      ...operatorHeaders,
      ...mpTooLarge.headers,
    });
    assert.strictEqual(resTooLarge.status, 413);
    assert.strictEqual(resTooLarge.body.error.code, 'FILE_TOO_LARGE');
    console.log('  ✅ Invalid file type (400) and oversize file (413) properly rejected.');

    // 11. Vehicle nivelSuciedad filling only when null
    console.log('\n11. Testing vehicle nivelSuciedad is filled only when null...');
    const { order: orderDirt, vehicle: vehicleDirt } = await createTestVehicleAndOrder({
      placa: 'DRT-111',
      listo: true,
      nivelSuciedad: null,
    });
    const mpDirt = buildMultipart();
    const resDirt = await makeRequest('POST', `/api/orders/${orderDirt.id}/analyze`, mpDirt.buffer, {
      ...operatorHeaders,
      ...mpDirt.headers,
    });
    assert.strictEqual(resDirt.status, 200);

    const updatedVehicle = await prisma.vehicle.findUnique({ where: { id: vehicleDirt.id } });
    assert.ok(updatedVehicle.nivelSuciedad !== null, 'nivelSuciedad should be filled when previously null');
    const existingDirt = updatedVehicle.nivelSuciedad;

    // Analyzing again should never overwrite existing value
    const mpDirt2 = buildMultipart();
    await makeRequest('POST', `/api/orders/${orderDirt.id}/analyze`, mpDirt2.buffer, {
      ...operatorHeaders,
      ...mpDirt2.headers,
    });
    const vehicleNotOverwritten = await prisma.vehicle.findUnique({ where: { id: vehicleDirt.id } });
    assert.strictEqual(vehicleNotOverwritten.nivelSuciedad, existingDirt);
    console.log('  ✅ nivelSuciedad populated when null and strictly preserved when already present.');

    // 12. Fallback logic: Mock Gemini failure with fallback enabled
    console.log('\n12. Testing Gemini failure with fallback to simulated provider...');
    aiService.setProvider({
      name: 'gemini',
      analyzeImage: async () => {
        const err = new Error('Gemini API call failed simulated test');
        err.status = 500;
        throw err;
      },
    });

    const { order: orderFb } = await createTestVehicleAndOrder({ placa: 'FBK-121', listo: true });
    const mpFb = buildMultipart();
    const resFb = await makeRequest('POST', `/api/orders/${orderFb.id}/analyze`, mpFb.buffer, {
      ...operatorHeaders,
      ...mpFb.headers,
    });

    assert.strictEqual(resFb.status, 200);
    assert.strictEqual(resFb.body.provider, 'simulated');
    assert.strictEqual(resFb.body.fallbackUsed, true);
    aiService.resetProvider();
    console.log('  ✅ Gemini failure smoothly fell back to simulated provider (fallbackUsed: true).');

    // 13. Fallback disabled -> 503 AI_UNAVAILABLE and AI_RATE_LIMITED (429)
    console.log('\n13. Testing fallback disabled: 503 AI_UNAVAILABLE & AI_RATE_LIMITED...');
    process.env.AI_FALLBACK_TO_SIMULATED = 'false';

    aiService.setProvider({
      name: 'gemini',
      analyzeImage: async () => {
        const err = new Error('Gemini network connection lost');
        err.status = 503;
        throw err;
      },
    });

    const resUnavailable = await makeRequest('POST', `/api/orders/${order1.id}/analyze`, mp1.buffer, {
      ...operatorHeaders,
      ...mp1.headers,
    });
    assert.strictEqual(resUnavailable.status, 503);
    assert.strictEqual(resUnavailable.body.error.code, 'AI_UNAVAILABLE');

    // Test 429 quota error -> AI_RATE_LIMITED
    aiService.setProvider({
      name: 'gemini',
      analyzeImage: async () => {
        const err = new Error('Quota exceeded 429 RESOURCE_EXHAUSTED');
        err.status = 429;
        err.isQuota = true;
        throw err;
      },
    });

    const resRateLimited = await makeRequest('POST', `/api/orders/${order1.id}/analyze`, mp1.buffer, {
      ...operatorHeaders,
      ...mp1.headers,
    });
    assert.strictEqual(resRateLimited.status, 503);
    assert.strictEqual(resRateLimited.body.error.code, 'AI_RATE_LIMITED');
    assert.ok(resRateLimited.body.error.message.includes('Retry-After'));

    process.env.AI_FALLBACK_TO_SIMULATED = 'true';
    aiService.resetProvider();
    console.log('  ✅ Fallback disabled properly throws 503 AI_UNAVAILABLE and 503 AI_RATE_LIMITED.');

    // 14. GET /api/ai/status endpoint and secrets protection
    console.log('\n14. Testing GET /api/ai/status and verifying secrets never leak...');
    const resStatus = await makeRequest('GET', '/api/ai/status', null, operatorHeaders);
    assert.strictEqual(resStatus.status, 200);
    assert.ok(['auto', 'gemini', 'simulated'].includes(resStatus.body.mode));
    assert.strictEqual(typeof resStatus.body.keyConfigured, 'boolean');
    assert.strictEqual(typeof resStatus.body.fallbackEnabled, 'boolean');
    assert.strictEqual(typeof resStatus.body.minConfidence, 'number');

    // Assert key value and AIza prefix NEVER appear in raw output
    assert.ok(!resStatus.raw.includes('AIza'), 'Key prefix AIza must never appear in response body');
    if (process.env.GEMINI_API_KEY) {
      assert.ok(!resStatus.raw.includes(process.env.GEMINI_API_KEY), 'Real GEMINI_API_KEY must never leak in response body');
    }
    console.log('  ✅ GET /api/ai/status returns valid metadata and never leaks secrets.');

    // 15. GET /api/orders/:id/analyses history endpoint
    console.log('\n15. Testing GET /api/orders/:id/analyses history endpoint...');
    const resAnalyses = await makeRequest('GET', `/api/orders/${order1.id}/analyses?page=1&limit=5`, null, operatorHeaders);
    assert.strictEqual(resAnalyses.status, 200);
    assert.ok(Array.isArray(resAnalyses.body.data));
    assert.ok(resAnalyses.body.meta);
    assert.strictEqual(resAnalyses.body.meta.page, 1);
    assert.strictEqual(resAnalyses.body.meta.limit, 5);
    console.log(`  ✅ GET /api/orders/:id/analyses returned envelope with ${resAnalyses.body.data.length} records.`);

    // 16. Fast-fail at startup when AI_MODE=gemini without a key
    console.log('\n16. Testing fast-fail validation when AI_MODE=gemini without key...');
    let fastFailCaught = false;
    try {
      validateEnv(
        {
          PORT: 3000,
          NODE_ENV: 'test',
          DATABASE_URL: 'file:./dev.db',
          JWT_SECRET: 'super-secret-key-at-least-32-chars-long',
          AI_MODE: 'gemini',
          GEMINI_API_KEY: '',
        },
        false
      );
    } catch (ffErr) {
      fastFailCaught = true;
      assert.ok(ffErr.message.includes("GEMINI_API_KEY is required when AI_MODE is 'gemini'"));
    }
    assert.strictEqual(fastFailCaught, true, 'Startup validation must throw when AI_MODE=gemini and key is missing');
    console.log('  ✅ Startup validation correctly fails fast without printing secrets.');

    console.log('\n🎉 All Phase 22 Gemini Vision & AI Analysis tests passed successfully!');
  } finally {
    // Teardown test artifacts
    for (const orderId of createdOrderIds) {
      await prisma.aiAnalysis.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } }).catch(() => {});
      await prisma.phaseEvent.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } }).catch(() => {});
    }
    for (const vId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vId } }).catch(() => {});
    }

    if (simulationInterval) {
      clearInterval(simulationInterval);
    }
    server.close();
  }
}

runAiAnalysisTests().catch((err) => {
  console.error('\n❌ Test execution failed with error:');
  console.error(err);
  process.exit(1);
});
