process.env.NODE_ENV = 'test';
process.env.SIMULATION_AUTO_ADVANCE = 'true';
const assert = require('assert');
const prisma = require('../src/config/db');
const {
  getNextPhase,
  getPhaseDurationMs,
  shouldAdvancePhase,
  advanceOrderPhase,
  PHASE_PROGRESS_MAP,
  NEXT_PHASE_MAP,
  VALID_PHASES,
} = require('../src/services/simulation.service');

async function runTests() {
  console.log('🧪 Starting Simulation Engine Test Suite...\n');

  // Test 1: Phase mapping checks
  console.log('1. Testing getNextPhase mapping...');
  assert.strictEqual(getNextPhase('PENDIENTE'), 'REMOJO');
  assert.strictEqual(getNextPhase('REMOJO'), 'LAVADO');
  assert.strictEqual(getNextPhase('LAVADO'), 'SECADO');
  assert.strictEqual(getNextPhase('SECADO'), 'LISTO');
  assert.strictEqual(getNextPhase('LISTO'), null);
  assert.strictEqual(getNextPhase('UNKNOWN_PHASE'), null);
  console.log('  ✅ getNextPhase works as expected.\n');

  // Test 2: Phase progress percentage mapping
  console.log('2. Testing PHASE_PROGRESS_MAP...');
  assert.strictEqual(PHASE_PROGRESS_MAP.PENDIENTE, 10);
  assert.strictEqual(PHASE_PROGRESS_MAP.REMOJO, 30);
  assert.strictEqual(PHASE_PROGRESS_MAP.LAVADO, 55);
  assert.strictEqual(PHASE_PROGRESS_MAP.SECADO, 80);
  assert.strictEqual(PHASE_PROGRESS_MAP.LISTO, 100);
  console.log('  ✅ Progress percentages match requirements (10%, 30%, 55%, 80%, 100%).\n');

  // Test 3: Environment variable duration parsing
  console.log('3. Testing getPhaseDurationMs configuration...');
  const originalEnv = process.env.SIMULATION_PHASE_DURATION_MS;
  delete process.env.SIMULATION_PHASE_DURATION_MS;
  assert.strictEqual(getPhaseDurationMs(), 60000);

  process.env.SIMULATION_PHASE_DURATION_MS = '15000';
  assert.strictEqual(getPhaseDurationMs(), 15000);

  process.env.SIMULATION_PHASE_DURATION_MS = 'invalid_number';
  assert.strictEqual(getPhaseDurationMs(), 60000);

  process.env.SIMULATION_PHASE_DURATION_MS = originalEnv || '60000';
  console.log('  ✅ Environment variable duration parsing works correctly.\n');

  // Test 4: shouldAdvancePhase time and readiness check
  console.log('4. Testing shouldAdvancePhase eligibility check...');
  const baseTime = 1000000000000;
  const mockOrder = {
    id: 999,
    faseActual: 'PENDIENTE',
    listoParaLavar: true,
    updatedAt: new Date(baseTime),
  };

  // Not ready to wash: must never advance
  assert.strictEqual(shouldAdvancePhase({ ...mockOrder, listoParaLavar: false }, baseTime + 120000, 60000), false);
  // Not enough time passed (30s < 60s)
  assert.strictEqual(shouldAdvancePhase(mockOrder, baseTime + 30000, 60000), false);
  // Exactly enough time passed (60s == 60s)
  assert.strictEqual(shouldAdvancePhase(mockOrder, baseTime + 60000, 60000), true);
  // More than enough time passed (120s > 60s)
  assert.strictEqual(shouldAdvancePhase(mockOrder, baseTime + 120000, 60000), true);

  // Orders in 'LISTO' must never advance
  const mockOrderDone = {
    id: 999,
    faseActual: 'LISTO',
    listoParaLavar: true,
    updatedAt: new Date(baseTime),
  };
  assert.strictEqual(shouldAdvancePhase(mockOrderDone, baseTime + 200000, 60000), false);
  console.log('  ✅ Eligibility, unready skipping, and LISTO skipping validated.\n');

  // Test 5: End-to-end database simulation flow
  console.log('5. Testing database order lifecycle advancement...');
  const testPlaca = `TEST-${Date.now().toString().slice(-4)}`;
  const vehicle = await prisma.vehicle.create({
    data: {
      placa: testPlaca,
      marca: 'TestMarca',
      modelo: 'TestModel',
      color: 'Blanco',
      ownerName: 'Simulation Owner',
      nivelSuciedad: 'Severo',
    },
  });

  const order = await prisma.serviceOrder.create({
    data: {
      vehicleId: vehicle.id,
      faseActual: 'PENDIENTE',
      porcentajeProgreso: 10,
      listoParaLavar: true,
    },
  });

  try {
    const startTime = Date.now();

    // 5a. Not enough time: should not advance
    const noAdvance = await advanceOrderPhase(order, { now: startTime + 1000, durationMs: 60000 });
    assert.strictEqual(noAdvance, null);

    // 5b. Advance PENDIENTE -> REMOJO
    const advancedToRemojo = await advanceOrderPhase(order, { now: startTime + 61000, durationMs: 60000 });
    assert.ok(advancedToRemojo);
    assert.strictEqual(advancedToRemojo.faseActual, 'REMOJO');
    assert.strictEqual(advancedToRemojo.porcentajeProgreso, 30);

    // 5c. Advance REMOJO -> LAVADO
    const advancedToLavado = await advanceOrderPhase(advancedToRemojo, { now: startTime + 122000, durationMs: 60000 });
    assert.ok(advancedToLavado);
    assert.strictEqual(advancedToLavado.faseActual, 'LAVADO');
    assert.strictEqual(advancedToLavado.porcentajeProgreso, 55);

    // 5d. Advance LAVADO -> SECADO
    const advancedToSecado = await advanceOrderPhase(advancedToLavado, { now: startTime + 183000, durationMs: 60000 });
    assert.ok(advancedToSecado);
    assert.strictEqual(advancedToSecado.faseActual, 'SECADO');
    assert.strictEqual(advancedToSecado.porcentajeProgreso, 80);

    // 5e. Advance SECADO -> LISTO
    const advancedToListo = await advanceOrderPhase(advancedToSecado, { now: startTime + 244000, durationMs: 60000 });
    assert.ok(advancedToListo);
    assert.strictEqual(advancedToListo.faseActual, 'LISTO');
    assert.strictEqual(advancedToListo.porcentajeProgreso, 100);

    // 5f. Attempting to advance LISTO order returns null
    const noAdvanceFromListo = await advanceOrderPhase(advancedToListo, { now: startTime + 350000, durationMs: 60000 });
    assert.strictEqual(noAdvanceFromListo, null);

    // Check DB state directly
    const finalOrder = await prisma.serviceOrder.findUnique({ where: { id: order.id } });
    assert.strictEqual(finalOrder.faseActual, 'LISTO');
    assert.strictEqual(finalOrder.porcentajeProgreso, 100);

    console.log('  ✅ Full lifecycle from PENDIENTE to LISTO completed and verified in DB.\n');
  } finally {
    // Cleanup test data
    await prisma.phaseEvent.deleteMany({ where: { orderId: order.id } });
    await prisma.serviceOrder.deleteMany({ where: { vehicleId: vehicle.id } });
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    await prisma.$disconnect();
  }

  console.log('🎉 All 5 simulation test suites passed successfully!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
