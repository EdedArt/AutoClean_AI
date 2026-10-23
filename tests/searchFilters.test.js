const http = require('http');
const assert = require('assert');

process.env.PORT = '3095';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';

const { app, server, simulationInterval } = require('../server');
const prisma = require('../src/config/db');

function makeRequest(method, reqPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3095,
      path: reqPath,
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
        } catch (_) {
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

async function runSearchFiltersTests() {
  console.log('🧪 Starting Search, Filters, Pagination and Bay Summary Test Suite...\n');

  const createdVehicleIds = [];
  const createdOrderIds = [];

  try {
    // Setup test vehicles and orders
    console.log('1. Setting up test data for search and filter tests...');
    const v1 = await prisma.vehicle.create({
      data: {
        placa: `MAZ-${Math.floor(100 + Math.random() * 899)}`,
        marca: 'Mazda',
        modelo: 'CX-5',
        nivelSuciedad: 'Moderado',
      },
    });
    createdVehicleIds.push(v1.id);

    const v2 = await prisma.vehicle.create({
      data: {
        placa: `TOY-${Math.floor(100 + Math.random() * 899)}`,
        marca: 'Toyota',
        modelo: 'Corolla Cross',
        nivelSuciedad: 'Severo',
      },
    });
    createdVehicleIds.push(v2.id);

    const bay1 = await prisma.bay.findFirst();

    const o1 = await prisma.serviceOrder.create({
      data: {
        vehicleId: v1.id,
        faseActual: 'LAVADO',
        porcentajeProgreso: 45,
        bayId: bay1 ? bay1.id : null,
      },
    });
    createdOrderIds.push(o1.id);

    const o2 = await prisma.serviceOrder.create({
      data: {
        vehicleId: v2.id,
        faseActual: 'LISTO',
        porcentajeProgreso: 100,
      },
    });
    createdOrderIds.push(o2.id);

    console.log('  ✅ Test data created successfully.');

    // 2. Vehicle search tests
    console.log('\n2. Testing vehicle search by marca, modelo, and placa...');
    const searchMarca = await makeRequest('GET', '/api/vehicles?search=maz');
    assert.strictEqual(searchMarca.status, 200);
    assert.ok(searchMarca.body.data.some((v) => v.id === v1.id));
    assert.ok(!searchMarca.body.data.some((v) => v.id === v2.id));
    console.log('  ✅ Vehicle search matching marca succeeds.');

    const searchModelo = await makeRequest('GET', '/api/vehicles?search=Corolla');
    assert.strictEqual(searchModelo.status, 200);
    assert.ok(searchModelo.body.data.some((v) => v.id === v2.id));
    assert.ok(!searchModelo.body.data.some((v) => v.id === v1.id));
    console.log('  ✅ Vehicle search matching modelo succeeds.');

    const searchPlaca = await makeRequest('GET', `/api/vehicles?search=${v1.placa}`);
    assert.strictEqual(searchPlaca.status, 200);
    assert.strictEqual(searchPlaca.body.data.length, 1);
    assert.strictEqual(searchPlaca.body.data[0].id, v1.id);
    console.log('  ✅ Vehicle search matching placa succeeds.');

    // 3. Vehicle pagination and out-of-range pages
    console.log('\n3. Testing vehicle pagination and out-of-range pages...');
    const page1 = await makeRequest('GET', '/api/vehicles?page=1&limit=1');
    assert.strictEqual(page1.status, 200);
    assert.strictEqual(page1.body.data.length, 1);
    assert.strictEqual(page1.body.meta.page, 1);
    assert.strictEqual(page1.body.meta.limit, 1);
    assert.ok(page1.body.meta.total >= 2);
    assert.ok(page1.body.meta.totalPages >= 2);

    const outOfRange = await makeRequest('GET', '/api/vehicles?page=9999&limit=10');
    assert.strictEqual(outOfRange.status, 200);
    assert.deepStrictEqual(outOfRange.body.data, []);
    assert.strictEqual(outOfRange.body.meta.page, 9999);
    assert.strictEqual(outOfRange.body.meta.limit, 10);
    assert.ok(outOfRange.body.meta.total >= 2);
    console.log('  ✅ Out-of-range page returns 200 with empty data array and valid metadata.');

    // 4. Order filters: placa, fase, bayId, activeOnly, sort
    console.log('\n4. Testing order filters (placa, fase, bayId, activeOnly, sort)...');
    const filterFase = await makeRequest('GET', '/api/orders?fase=LAVADO');
    assert.strictEqual(filterFase.status, 200);
    assert.ok(filterFase.body.data.length > 0);
    assert.ok(filterFase.body.data.every((o) => o.faseActual === 'LAVADO'));
    console.log('  ✅ Filter orders by fase=LAVADO succeeds.');

    const filterPlaca = await makeRequest('GET', `/api/orders?placa=${v1.placa}`);
    assert.strictEqual(filterPlaca.status, 200);
    assert.ok(filterPlaca.body.data.length > 0);
    assert.ok(filterPlaca.body.data.every((o) => o.vehicle.placa === v1.placa));
    console.log('  ✅ Filter orders by related vehicle placa succeeds.');

    const filterActive = await makeRequest('GET', '/api/orders?activeOnly=true');
    assert.strictEqual(filterActive.status, 200);
    assert.ok(filterActive.body.data.every((o) => o.faseActual !== 'LISTO'));
    assert.ok(!filterActive.body.data.some((o) => o.id === o2.id));
    console.log('  ✅ Filter orders by activeOnly=true excludes LISTO orders.');

    if (bay1) {
      const filterBay = await makeRequest('GET', `/api/orders?bayId=${bay1.id}`);
      assert.strictEqual(filterBay.status, 200);
      assert.ok(filterBay.body.data.every((o) => o.bayId === bay1.id));
      console.log('  ✅ Filter orders by bayId succeeds.');
    }

    const sortOldest = await makeRequest('GET', '/api/orders?sort=oldest');
    assert.strictEqual(sortOldest.status, 200);
    assert.ok(sortOldest.body.data.length >= 2);
    const firstDate = new Date(sortOldest.body.data[0].createdAt).getTime();
    const lastDate = new Date(sortOldest.body.data[sortOldest.body.data.length - 1].createdAt).getTime();
    assert.ok(firstDate <= lastDate, 'Orders sort=oldest should be in ascending creation order');
    console.log('  ✅ Order sorting (sort=oldest) works as expected.');

    // 5. Query validation error handling (400 VALIDATION_ERROR)
    console.log('\n5. Testing query validation errors (400 VALIDATION_ERROR)...');
    const badPage = await makeRequest('GET', '/api/vehicles?page=0');
    assert.strictEqual(badPage.status, 400);
    assert.strictEqual(badPage.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(badPage.body.error.details[0].field, 'page');
    console.log('  ✅ page=0 rejected with 400 VALIDATION_ERROR.');

    const badLimit = await makeRequest('GET', '/api/vehicles?limit=500');
    assert.strictEqual(badLimit.status, 400);
    assert.strictEqual(badLimit.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(badLimit.body.error.details[0].field, 'limit');
    console.log('  ✅ limit=500 rejected with 400 VALIDATION_ERROR.');

    const badSearch = await makeRequest('GET', '/api/vehicles?search=' + 'a'.repeat(25));
    assert.strictEqual(badSearch.status, 400);
    assert.strictEqual(badSearch.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(badSearch.body.error.details[0].field, 'search');
    console.log('  ✅ search > 20 chars rejected with 400 VALIDATION_ERROR.');

    const badFase = await makeRequest('GET', '/api/orders?fase=INVALIDA');
    assert.strictEqual(badFase.status, 400);
    assert.strictEqual(badFase.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(badFase.body.error.details[0].field, 'fase');
    console.log('  ✅ fase=INVALIDA rejected with 400 VALIDATION_ERROR.');

    const badSort = await makeRequest('GET', '/api/orders?sort=invalid_sort');
    assert.strictEqual(badSort.status, 400);
    assert.strictEqual(badSort.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(badSort.body.error.details[0].field, 'sort');
    console.log('  ✅ sort=invalid rejected with 400 VALIDATION_ERROR.');

    // 6. Bay Summary endpoint
    console.log('\n6. Testing GET /api/bays/summary endpoint...');
    const summaryRes = await makeRequest('GET', '/api/bays/summary');
    assert.strictEqual(summaryRes.status, 200);
    assert.strictEqual(typeof summaryRes.body.total, 'number');
    assert.strictEqual(typeof summaryRes.body.occupied, 'number');
    assert.strictEqual(typeof summaryRes.body.free, 'number');
    assert.strictEqual(summaryRes.body.total, summaryRes.body.occupied + summaryRes.body.free);

    const actualTotal = await prisma.bay.count();
    const actualOccupied = await prisma.bay.count({ where: { ocupada: true } });
    assert.strictEqual(summaryRes.body.total, actualTotal);
    assert.strictEqual(summaryRes.body.occupied, actualOccupied);
    assert.strictEqual(summaryRes.body.free, actualTotal - actualOccupied);
    console.log('  ✅ GET /api/bays/summary returns matching counts { total, occupied, free }.');

    console.log('\n🎉 All Search, Filters, Pagination and Bay Summary tests passed successfully!');
  } finally {
    for (const orderId of createdOrderIds) {
      await prisma.evidence.deleteMany({ where: { serviceOrderId: orderId } });
      await prisma.serviceOrder.deleteMany({ where: { id: orderId } });
    }
    for (const vehicleId of createdVehicleIds) {
      await prisma.vehicle.deleteMany({ where: { id: vehicleId } });
    }
    if (simulationInterval) clearInterval(simulationInterval);
    if (server) server.close();
    await prisma.$disconnect();
  }
}

runSearchFiltersTests().catch((err) => {
  console.error('\n❌ Search & Filters test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
