const http = require('http');
const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.PORT = '3087';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';
process.env.SIMULATION_AUTO_ADVANCE = 'false';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-jwt-signing';
process.env.JWT_EXPIRES_IN = '1d';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';
// Short classifier timeout keeps the timeout cases fast; the production default is 3000 ms
process.env.VEHICLE_CLASSIFIER_TIMEOUT_MS = '300';

const { server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');
const { freshPlate } = require('./helpers/fixtures');
const { getOperatorAuthHeaders, getClientAuthHeaders, ensureDemoUsers } = require('./helpers/auth');
const { lookupBodyType, catalogKey } = require('../src/services/vehicleStyle/modelCatalog');
const { mapColor, COLOR_HEX, FALLBACK_COLOR_HEX } = require('../src/services/vehicleStyle/colorMapper');
const { BODY_TYPES } = require('../src/services/vehicleStyle/bodyTypes');
const classifier = require('../src/services/vehicleStyle/bodyTypeClassifier');
const geminiBodyTypeProvider = require('../src/services/ai/geminiBodyTypeProvider');

const TIMEOUT_MS = 300;

function makeRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3087,
        path: reqPath,
        method,
        headers: {
          ...headers,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (_) {
            /* keep raw */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Provider stub that counts calls. */
function stubProvider(impl) {
  const stub = {
    name: 'stub',
    calls: 0,
    lastSignal: null,
    async classifyBodyType(params) {
      stub.calls += 1;
      stub.lastSignal = params.signal;
      return impl(params);
    },
  };
  return stub;
}

const hang = (signalHolder) =>
  new Promise((resolve) => {
    // Resolves only when aborted, so the test proves the classifier's own timeout fired
    if (signalHolder && signalHolder.signal) {
      signalHolder.signal.addEventListener('abort', () => resolve('SEDAN'));
    }
  });

function testCatalog() {
  console.log('1. Static catalog lookup (accents, case, brand prefix, unknown models)...');
  const cases = [
    ['Chevrolet', 'Tracker', 'SUV'],
    ['CHEVROLET', 'spark gt', 'HATCHBACK'],
    ['Chevy', 'Spark', 'HATCHBACK'],
    ['Chevrolet', 'D-Max', 'PICKUP'],
    ['Isuzu', 'DMAX', 'PICKUP'],
    ['Renault', 'Sandero Stepway', 'HATCHBACK'],
    ['Renault', 'Logan', 'SEDAN'],
    ['renault', 'DUSTER 4x4', 'SUV'],
    ['Renault', 'Renault Kwid', 'HATCHBACK'],
    ['Kia', 'Picanto', 'HATCHBACK'],
    ['Hyundai', 'i10', 'HATCHBACK'],
    ['Hyundai', 'I-25', 'SEDAN'],
    ['Mazda', 'Mazda 3', 'SEDAN'],
    ['Mazda', '3', 'SEDAN'],
    ['Mazda', 'Mazda3 Touring', 'SEDAN'],
    ['Mazda', 'CX-30', 'SUV'],
    ['Mazda', 'cx30', 'SUV'],
    ['Toyota', 'Hilux', 'PICKUP'],
    ['Toyota', 'Corolla', 'SEDAN'],
    ['Toyota', 'Corolla Cross', 'SUV'],
    ['Citroën', 'C3', 'HATCHBACK'],
    ['Peugeot', '208', 'HATCHBACK'],
    ['Peugeot', '2008', 'SUV'],
    ['Mercedes-Benz', 'Sprinter', 'VAN'],
    ['Mercedes Benz', 'Mercedes Benz GLC', 'SUV'],
    ['Volkswagen', 'T-Cross', 'SUV'],
    ['Nissan', 'X-Trail', 'SUV'],
    ['Chevrolett', 'Tracker', 'SUV'], // misspelled brand, model unique across brands
  ];
  for (const [brand, model, expected] of cases) {
    assert.strictEqual(lookupBodyType(brand, model), expected, `${brand} ${model} should be ${expected}`);
  }
  for (const [brand, model] of [
    ['Tesla', 'Model S'],
    ['Marca', 'Inventada'],
    ['', ''],
    [null, undefined],
    ['Mazda', 'MX-5'],
    ['Foo', '3'], // bare numbers are not matched without a known brand
  ]) {
    assert.strictEqual(lookupBodyType(brand, model), null, `${brand} ${model} should be unknown`);
  }
  assert.strictEqual(catalogKey('Mazda', 'CX-30'), catalogKey('MAZDA', 'cx 30'));
  assert.strictEqual(catalogKey('Citroën', 'C3'), 'citroen|c3');
  console.log('  ✅ Catalog lookup passed.');
}

function testColorMapper() {
  console.log('\n2. Color mapper (Spanish/English, gender variants, accents, shades, fallback)...');
  const cases = [
    ['Blanco', 'white', true],
    ['blanca', 'white', true],
    ['BLANCO PERLA', 'white', true],
    ['White', 'white', true],
    ['Negra', 'black', true],
    ['negro mate', 'black', true],
    ['Gris plata', 'silver', true],
    ['Plateado', 'silver', true],
    ['Silver', 'silver', true],
    ['gris', 'gray', true],
    ['Gris oscuro', 'darkGray', true],
    ['Gris claro', 'lightGray', true],
    ['Azul oscuro', 'darkBlue', true],
    ['Azul Marino', 'darkBlue', true],
    ['dark blue', 'darkBlue', true],
    ['Azul claro', 'lightBlue', true],
    ['Celeste', 'lightBlue', true],
    ['Rojo', 'red', true],
    ['roja metalizada', 'red', true],
    ['Rojo oscuro', 'wine', true],
    ['Vinotinto', 'wine', true],
    ['Verde oscuro', 'darkGreen', true],
    ['Amarilla', 'yellow', true],
    ['Café', 'brown', true],
    ['Marrón', 'brown', true],
    ['Dorado', 'gold', true],
    ['Champaña', 'champagne', true],
    ['Metálico Plateada', 'silver', true],
  ];
  for (const [text, key, exact] of cases) {
    const result = mapColor(text);
    assert.strictEqual(result.key, key, `"${text}" should map to ${key}`);
    assert.strictEqual(result.hex, COLOR_HEX[key]);
    assert.strictEqual(result.isKnown, true);
    assert.strictEqual(result.exact, exact, `"${text}" exact flag`);
  }

  // Recognized base with extra words: paint is real, but the text is shown as typed
  const nimbus = mapColor('Gris Nimbus');
  assert.deepStrictEqual(nimbus, { key: 'gray', hex: COLOR_HEX.gray, isKnown: true, exact: false });
  const twoTone = mapColor('Blanco y negro');
  assert.strictEqual(twoTone.key, 'white');
  assert.strictEqual(twoTone.exact, false);

  for (const text of ['Sin especificar', 'Tornasol', '', '   ', null, undefined, 42]) {
    assert.deepStrictEqual(mapColor(text), { key: null, hex: FALLBACK_COLOR_HEX, isKnown: false, exact: false });
  }
  for (const hex of Object.values(COLOR_HEX)) {
    assert.match(hex, /^#[0-9A-F]{6}$/);
  }
  console.log('  ✅ Color mapper passed.');
}

async function testGeminiProvider() {
  console.log('\n3. Gemini body-type provider: strict output validation and request shape...');
  const { parseOutput } = geminiBodyTypeProvider;
  assert.strictEqual(parseOutput('{"bodyType":"SUV"}'), 'SUV');
  assert.strictEqual(parseOutput(' {"bodyType":"UNKNOWN"} '), null);
  for (const bad of ['', 'SUV', '{"bodyType":"suv"}', '{"bodyType":"TRUCK"}', '{"bodyType":"SUV","extra":1}', '{}', '[]', 'null']) {
    assert.throws(() => parseOutput(bad), `"${bad}" must be rejected`);
  }

  let captured = null;
  geminiBodyTypeProvider.setClient({
    models: {
      generateContent: async (req) => {
        captured = req;
        return { text: '{"bodyType":"VAN"}' };
      },
    },
  });
  const value = await geminiBodyTypeProvider.classifyBodyType({ brand: 'Foton', model: 'View CS2' });
  assert.strictEqual(value, 'VAN');
  assert.deepStrictEqual(JSON.parse(captured.contents[0].parts[0].text), { brand: 'Foton', model: 'View CS2' });
  assert.strictEqual(captured.config.responseMimeType, 'application/json');
  assert.deepStrictEqual(captured.config.responseSchema.properties.bodyType.enum, [...BODY_TYPES, 'UNKNOWN']);

  geminiBodyTypeProvider.setClient({
    models: {
      generateContent: async () => {
        throw new Error('429 RESOURCE_EXHAUSTED quota');
      },
    },
  });
  await assert.rejects(() => geminiBodyTypeProvider.classifyBodyType({ brand: 'A', model: 'B' }));
  console.log('  ✅ Gemini provider validation passed.');
}

async function testClassifierFallbacks() {
  console.log('\n4. Classifier: catalog first, AI fallback, cache, failures and timeout -> null...');

  // Default resolution in tests (AI_MODE=simulated): no AI call, unknown -> null
  classifier.resetBodyTypeProvider();
  classifier.clearBodyTypeCache();
  assert.deepStrictEqual(await classifier.classifyBodyType('Tesla', 'Model Y'), { bodyType: null, source: 'none' });

  // Catalog hit never calls the provider
  const catalogStub = stubProvider(() => 'VAN');
  classifier.setBodyTypeProvider(catalogStub);
  assert.deepStrictEqual(await classifier.classifyBodyType('Kia', 'Picanto'), { bodyType: 'HATCHBACK', source: 'catalog' });
  assert.strictEqual(catalogStub.calls, 0);

  // Unknown model -> AI once, then cached per brand+model (case/accents insensitive)
  classifier.clearBodyTypeCache();
  const aiStub = stubProvider(() => 'SUV');
  classifier.setBodyTypeProvider(aiStub);
  assert.deepStrictEqual(await classifier.classifyBodyType('Tesla', 'Model Y'), { bodyType: 'SUV', source: 'ai' });
  assert.deepStrictEqual(await classifier.classifyBodyType('TESLA', 'model-y'), { bodyType: 'SUV', source: 'cache' });
  assert.strictEqual(aiStub.calls, 1);

  // Concurrent registrations of the same model share one AI call
  classifier.clearBodyTypeCache();
  const concurrentStub = stubProvider(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return 'PICKUP';
  });
  classifier.setBodyTypeProvider(concurrentStub);
  const both = await Promise.all([
    classifier.classifyBodyType('Foton', 'Tunland'),
    classifier.classifyBodyType('Foton', 'Tunland'),
  ]);
  assert.deepStrictEqual(both.map((r) => r.bodyType), ['PICKUP', 'PICKUP']);
  assert.strictEqual(concurrentStub.calls, 1);

  // A valid "unknown" answer is cached as null
  classifier.clearBodyTypeCache();
  const unknownStub = stubProvider(() => null);
  classifier.setBodyTypeProvider(unknownStub);
  assert.strictEqual((await classifier.classifyBodyType('Marca', 'Rara')).bodyType, null);
  assert.deepStrictEqual(await classifier.classifyBodyType('Marca', 'Rara'), { bodyType: null, source: 'cache' });
  assert.strictEqual(unknownStub.calls, 1);

  // Provider error -> null and NOT cached (next registration retries)
  classifier.clearBodyTypeCache();
  const failingStub = stubProvider(() => {
    throw new Error('network down');
  });
  classifier.setBodyTypeProvider(failingStub);
  assert.deepStrictEqual(await classifier.classifyBodyType('Tesla', 'Model 3'), { bodyType: null, source: 'none' });
  await classifier.classifyBodyType('Tesla', 'Model 3');
  assert.strictEqual(failingStub.calls, 2);

  // Invalid provider value -> null
  classifier.setBodyTypeProvider(stubProvider(() => 'TRUCK'));
  assert.strictEqual((await classifier.classifyBodyType('Tesla', 'Cybertruck')).bodyType, null);

  // Hanging provider -> null after the hard timeout, and the request is aborted
  classifier.clearBodyTypeCache();
  const hangingStub = stubProvider((params) => hang(params));
  classifier.setBodyTypeProvider(hangingStub);
  const started = Date.now();
  const timedOut = await classifier.classifyBodyType('Tesla', 'Roadster');
  const elapsed = Date.now() - started;
  assert.strictEqual(timedOut.bodyType, null);
  assert.ok(elapsed >= TIMEOUT_MS - 20 && elapsed < TIMEOUT_MS + 500, `timeout should fire near ${TIMEOUT_MS}ms, took ${elapsed}ms`);
  assert.strictEqual(hangingStub.lastSignal.aborted, true);
  assert.strictEqual(hangingStub.calls, 1);
  // Not cached after a timeout
  await classifier.classifyBodyType('Tesla', 'Roadster');
  assert.strictEqual(hangingStub.calls, 2);

  // Real Gemini provider with a failing / hanging client -> null
  classifier.clearBodyTypeCache();
  classifier.setBodyTypeProvider(geminiBodyTypeProvider);
  geminiBodyTypeProvider.setClient({
    models: {
      generateContent: async () => {
        throw new Error('503 UNAVAILABLE');
      },
    },
  });
  assert.strictEqual((await classifier.classifyBodyType('Tesla', 'Model X')).bodyType, null);
  geminiBodyTypeProvider.setClient({ models: { generateContent: () => new Promise(() => {}) } });
  const geminiStart = Date.now();
  assert.strictEqual((await classifier.classifyBodyType('Tesla', 'Model X')).bodyType, null);
  assert.ok(Date.now() - geminiStart < TIMEOUT_MS + 500);
  geminiBodyTypeProvider.setClient({ models: { generateContent: async () => ({ text: '{"bodyType":"SEDAN"}' }) } });
  assert.deepStrictEqual(await classifier.classifyBodyType('Tesla', 'Model X'), { bodyType: 'SEDAN', source: 'ai' });
  geminiBodyTypeProvider.setClient(null);

  classifier.resetBodyTypeProvider();
  classifier.clearBodyTypeCache();
  console.log('  ✅ Classifier fallbacks passed.');
}

async function testRegistrationAndPrivacy(createdVehicleIds, createdOrderIds) {
  console.log('\n5. Registration never fails because of classification, and the plate view stays minimal...');
  await ensureDemoUsers();
  const operatorHeaders = await getOperatorAuthHeaders();
  const clientHeaders = await getClientAuthHeaders();

  const register = async (prefix, marca, modelo, color) => {
    const placa = await freshPlate(prisma, prefix);
    const res = await makeRequest(
      'POST',
      '/api/vehicles',
      { placa, marca, modelo, color, ownerName: 'Vehicle Style Test' },
      operatorHeaders
    );
    if (res.body && res.body.id) createdVehicleIds.push(res.body.id);
    return { placa, res };
  };

  // Catalog model
  const tracker = await register('VSA', 'Chevrolet', 'Tracker', 'Blanca');
  assert.strictEqual(tracker.res.status, 201);
  assert.strictEqual(tracker.res.body.bodyType, 'SUV');

  // Provider throws -> still 201, bodyType null
  classifier.clearBodyTypeCache();
  classifier.setBodyTypeProvider(stubProvider(() => {
    throw new Error('boom');
  }));
  const failing = await register('VSB', 'Marca Desconocida', 'Modelo X1', 'Azul oscuro');
  assert.strictEqual(failing.res.status, 201);
  assert.strictEqual(failing.res.body.bodyType, null);

  // Provider hangs -> still 201 shortly after the timeout, bodyType null
  classifier.setBodyTypeProvider(stubProvider((params) => hang(params)));
  const started = Date.now();
  const hanging = await register('VSC', 'Otra Marca', 'Modelo Lento', 'Tornasol');
  assert.strictEqual(hanging.res.status, 201);
  assert.strictEqual(hanging.res.body.bodyType, null);
  assert.ok(Date.now() - started < TIMEOUT_MS + 3000, 'registration must not wait beyond the classifier timeout');

  // AI answer is persisted
  classifier.setBodyTypeProvider(stubProvider(() => 'VAN'));
  const van = await register('VSD', 'Foton', 'View CS2', 'Gris plata');
  assert.strictEqual(van.res.status, 201);
  assert.strictEqual(van.res.body.bodyType, 'VAN');
  classifier.resetBodyTypeProvider();
  classifier.clearBodyTypeCache();

  const stored = await prisma.vehicle.findUnique({ where: { id: van.res.body.id } });
  assert.strictEqual(stored.bodyType, 'VAN');

  // Active orders so the public plate endpoint answers
  for (const v of [tracker, hanging]) {
    const order = await prisma.serviceOrder.create({
      data: { vehicleId: v.res.body.id, faseActual: 'LAVADO', porcentajeProgreso: 60, listoParaLavar: true, readyAt: new Date() },
    });
    createdOrderIds.push(order.id);
  }

  const trackerView = await makeRequest('GET', `/api/plates/${tracker.placa}/status`, null, clientHeaders);
  assert.strictEqual(trackerView.status, 200);
  assert.strictEqual(trackerView.body.bodyType, 'SUV');
  assert.strictEqual(trackerView.body.colorHex, COLOR_HEX.white);
  assert.strictEqual(trackerView.body.marca, 'Chevrolet');
  assert.strictEqual(trackerView.body.modelo, 'Tracker');
  assert.strictEqual(trackerView.body.color, 'Blanca');

  const unknownView = await makeRequest('GET', `/api/plates/${hanging.placa}/status`, null, clientHeaders);
  assert.strictEqual(unknownView.status, 200);
  assert.strictEqual(unknownView.body.bodyType, null);
  assert.strictEqual(unknownView.body.colorHex, FALLBACK_COLOR_HEX);

  // Privacy: nothing about the owner or internals, for client and operator alike
  for (const view of [trackerView.body, unknownView.body]) {
    for (const forbidden of ['ownerName', 'ownerId', 'owner', 'ownerEmail', 'email', 'id', 'vehicleId', 'bayId', 'bay', 'nivelSuciedad', 'createdAt', 'evidences', 'aiAnalyses']) {
      assert.strictEqual(view[forbidden], undefined, `${forbidden} must not be exposed`);
    }
    assert.ok(!JSON.stringify(view).includes('Vehicle Style Test'), 'owner name must not leak');
  }
  const opView = await makeRequest('GET', `/api/plates/${tracker.placa}/status`, null, operatorHeaders);
  assert.deepStrictEqual(Object.keys(opView.body).sort(), Object.keys(trackerView.body).sort());
  console.log('  ✅ Registration resilience and privacy passed.');
}

async function run() {
  console.log('🧪 Starting Vehicle Style Tests (body type + color)...\n');
  const createdVehicleIds = [];
  const createdOrderIds = [];
  try {
    testCatalog();
    testColorMapper();
    await testGeminiProvider();
    await testClassifierFallbacks();
    await testRegistrationAndPrivacy(createdVehicleIds, createdOrderIds);
    console.log('\n🎉 Vehicle style tests passed!');
  } finally {
    classifier.resetBodyTypeProvider();
    geminiBodyTypeProvider.setClient(null);
    const plates = await prisma.vehicle
      .findMany({ where: { id: { in: createdVehicleIds } }, select: { placa: true } })
      .then((rows) => rows.map((r) => r.placa))
      .catch(() => []);
    if (plates.length > 0) {
      await prisma.searchedPlate.deleteMany({ where: { placa: { in: plates } } }).catch(() => {});
    }
    if (createdOrderIds.length > 0) {
      await prisma.phaseEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {});
      await prisma.serviceOrder.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
    }
    if (createdVehicleIds.length > 0) {
      await prisma.serviceOrder.deleteMany({ where: { vehicleId: { in: createdVehicleIds } } }).catch(() => {});
      await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } }).catch(() => {});
    }
    if (simulationInterval) clearInterval(simulationInterval);
    if (server && server.close) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Tests failed:', err);
    process.exit(1);
  });
}

module.exports = run;
