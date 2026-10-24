process.env.NODE_ENV = 'test';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const { decidePhase, derivePhase } = require('../src/services/ai/phaseRules');

async function runPhaseRulesTests() {
  console.log('🧪 Starting Phase Decision Rules Unit Test Suite...\n');

  // 1. Foam in any phase -> LAVADO (foam wins over everything)
  console.log('1. Testing Rule 1: soapFoamVisible takes absolute precedence in any phase -> LAVADO...');
  const phasesToTestFoam = ['PENDIENTE', 'REMOJO', 'LAVADO', 'SECADO', 'LISTO'];
  for (const phase of phasesToTestFoam) {
    const res = decidePhase(
      {
        soapFoamVisible: true,
        waterOnCar: true,
        dryingInProgress: false,
        visibleDirt: 'none',
        cleanAndGlossy: false,
      },
      { currentPhase: phase, modelPhase: phase, modelConfidence: 0.92 }
    );
    assert.strictEqual(res.phase, 'LAVADO', `Foam must yield LAVADO when currentPhase is ${phase}`);
    assert.strictEqual(res.source, 'rules');
    assert.strictEqual(res.confidence, 0.92);
  }

  const foamWinsOverAll = decidePhase(
    {
      soapFoamVisible: true,
      waterOnCar: true,
      dryingInProgress: true,
      visibleDirt: 'none',
      cleanAndGlossy: true,
    },
    { currentPhase: 'SECADO', modelPhase: 'SECADO', modelConfidence: 0.99 }
  );
  assert.strictEqual(foamWinsOverAll.phase, 'LAVADO', 'Foam must win even when drying or glossy is true');
  assert.strictEqual(foamWinsOverAll.source, 'rules');
  assert.strictEqual(foamWinsOverAll.confidence, 0.95, 'Rule confidence must cap at 0.95');
  console.log('  ✅ Foam wins over all competing signals in any phase and resolves to LAVADO.\n');

  // 2. waterOnCar && dryingInProgress -> SECADO
  console.log('2. Testing Rule 2: waterOnCar && dryingInProgress -> SECADO...');
  const secado = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: true,
      dryingInProgress: true,
      visibleDirt: 'none',
      cleanAndGlossy: false,
    },
    { currentPhase: 'REMOJO', modelPhase: 'REMOJO', modelConfidence: 0.92 }
  );
  assert.strictEqual(secado.phase, 'SECADO');
  assert.strictEqual(secado.source, 'rules');
  assert.strictEqual(secado.confidence, 0.92);
  console.log('  ✅ Wet vehicle with drying in progress resolves to SECADO.\n');

  // 3. waterOnCar && !dryingInProgress (no foam) -> REMOJO
  console.log('3. Testing Rule 3: waterOnCar && !dryingInProgress -> REMOJO...');
  const remojo = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: true,
      dryingInProgress: false,
      visibleDirt: 'light',
      cleanAndGlossy: false,
    },
    { currentPhase: 'LAVADO', modelPhase: 'LAVADO', modelConfidence: 0.88 }
  );
  assert.strictEqual(remojo.phase, 'REMOJO');
  assert.strictEqual(remojo.source, 'rules');
  assert.strictEqual(remojo.confidence, 0.88);
  console.log('  ✅ Wet vehicle without foam or drying resolves to REMOJO.\n');

  // 4. Dry car with currentPhase SECADO -> LISTO even with visibleDirt "heavy"
  console.log('4. Testing Rule 4a: Dry car with currentPhase SECADO -> LISTO even with visibleDirt "heavy"...');
  const listoFromSecadoHeavy = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'heavy',
      cleanAndGlossy: false,
      observationNotes: 'Vehicle has dried, monitoring car wash progression, not auditing quality',
    },
    { currentPhase: 'SECADO', modelPhase: 'PENDIENTE', modelConfidence: 0.98 }
  );
  assert.strictEqual(listoFromSecadoHeavy.phase, 'LISTO', 'Dry car after SECADO must resolve to LISTO even if dirty');
  assert.strictEqual(listoFromSecadoHeavy.source, 'rules');
  assert.strictEqual(listoFromSecadoHeavy.confidence, 0.95, 'Rule confidence capped at 0.95');
  assert.ok(listoFromSecadoHeavy.reason.includes('SECADO -> LISTO'), 'Reason must mention order context');
  console.log('  ✅ Dry car after SECADO resolves to LISTO regardless of dirt or gloss.\n');

  // 5. Dry car with currentPhase LISTO -> LISTO
  console.log('5. Testing Rule 4b: Dry car with currentPhase LISTO -> LISTO...');
  const listoFromListo = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'none',
      cleanAndGlossy: true,
    },
    { currentPhase: 'LISTO', modelPhase: 'LISTO', modelConfidence: 0.94 }
  );
  assert.strictEqual(listoFromListo.phase, 'LISTO');
  assert.strictEqual(listoFromListo.source, 'rules');
  assert.ok(listoFromListo.reason.includes('LISTO -> LISTO'));
  console.log('  ✅ Dry car in LISTO stays LISTO.\n');

  // 6. Dry car with currentPhase PENDIENTE -> PENDIENTE (even if cleanAndGlossy is true)
  console.log('6. Testing Rule 4c: Dry car with currentPhase PENDIENTE -> PENDIENTE (even if cleanAndGlossy is true)...');
  const dryInPendiente = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'none',
      cleanAndGlossy: true,
      observationNotes: 'Car is clean and glossy but has not started wash process',
    },
    { currentPhase: 'PENDIENTE', modelPhase: 'LISTO', modelConfidence: 0.95 }
  );
  assert.strictEqual(dryInPendiente.phase, 'PENDIENTE', 'Dry car in PENDIENTE must NEVER jump to LISTO even if glossy');
  assert.strictEqual(dryInPendiente.source, 'rules');
  assert.ok(dryInPendiente.reason.includes('PENDIENTE -> keep PENDIENTE'), 'Reason must document keeping PENDIENTE');
  console.log('  ✅ Dry clean glossy car in PENDIENTE stays PENDIENTE without jumping to LISTO.\n');

  // 7. Dry car with REMOJO/LAVADO -> unchanged
  console.log('7. Testing Rule 4d: Dry car with REMOJO/LAVADO -> unchanged...');
  const dryInRemojo = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'light',
      cleanAndGlossy: false,
    },
    { currentPhase: 'REMOJO', modelPhase: 'LISTO', modelConfidence: 0.90 }
  );
  assert.strictEqual(dryInRemojo.phase, 'REMOJO', 'Dry car in REMOJO must stay REMOJO');
  assert.strictEqual(dryInRemojo.source, 'rules');
  assert.ok(dryInRemojo.reason.includes('REMOJO -> keep REMOJO'));

  const dryInLavado = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'none',
      cleanAndGlossy: true,
    },
    { currentPhase: 'LAVADO', modelPhase: 'LISTO', modelConfidence: 0.90 }
  );
  assert.strictEqual(dryInLavado.phase, 'LAVADO', 'Dry car in LAVADO must stay LAVADO');
  assert.strictEqual(dryInLavado.source, 'rules');
  assert.ok(dryInLavado.reason.includes('LAVADO -> keep LAVADO'));
  console.log('  ✅ Dry car in REMOJO and LAVADO remains unchanged.\n');

  // 8. Dry car with no context -> never LISTO
  console.log('8. Testing Rule 4e: Dry car with no context -> never LISTO...');
  const noContextDirty = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'heavy',
      cleanAndGlossy: false,
    },
    {}
  );
  assert.strictEqual(noContextDirty.phase, 'PENDIENTE');
  assert.strictEqual(noContextDirty.source, 'rules');

  const noContextClean = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'none',
      cleanAndGlossy: true,
    },
    {},
    'LISTO',
    0.95
  );
  assert.strictEqual(noContextClean.phase, 'PENDIENTE', 'Without order context, dry car must NEVER return LISTO');
  assert.strictEqual(noContextClean.source, 'rules');
  assert.ok(noContextClean.confidence <= 0.70, 'Lower confidence applied when no context and visibleDirt is none');

  const nullContextClean = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: false,
      visibleDirt: 'none',
      cleanAndGlossy: true,
    },
    null,
    'LISTO',
    0.95
  );
  assert.strictEqual(nullContextClean.phase, 'PENDIENTE', 'Null context must never return LISTO');
  assert.ok(nullContextClean.confidence <= 0.70);
  console.log('  ✅ Without order context, LISTO is never returned.\n');

  // 9. Ambiguous / contradictory -> capped confidence 0.7
  console.log('9. Testing Rule 5: Ambiguous / contradictory cases fallback to model capped at 0.7...');
  // Contradictory: dry car with drying in progress
  const contradictory = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: true,
      visibleDirt: 'none',
      cleanAndGlossy: false,
    },
    { currentPhase: 'PENDIENTE', modelPhase: 'LAVADO', modelConfidence: 0.95 }
  );
  assert.strictEqual(contradictory.phase, 'LAVADO');
  assert.strictEqual(contradictory.source, 'model');
  assert.strictEqual(contradictory.confidence, 0.7, 'Contradictory confidence capped at 0.7');

  // Ambiguous with model proposing LISTO without SECADO/LISTO context
  const ambiguousNoListoContext = decidePhase(
    {
      soapFoamVisible: false,
      waterOnCar: false,
      dryingInProgress: true, // Contradictory
      visibleDirt: 'none',
      cleanAndGlossy: false,
    },
    { currentPhase: 'PENDIENTE', modelPhase: 'LISTO', modelConfidence: 0.95 }
  );
  assert.notStrictEqual(ambiguousNoListoContext.phase, 'LISTO', 'Ambiguous case must not yield LISTO without order in SECADO');
  assert.strictEqual(ambiguousNoListoContext.confidence, 0.7);

  // Missing / null observations
  const nullObs = decidePhase(null, { currentPhase: 'REMOJO', modelPhase: 'REMOJO', modelConfidence: 0.92 });
  assert.strictEqual(nullObs.phase, 'REMOJO');
  assert.strictEqual(nullObs.source, 'model');
  assert.strictEqual(nullObs.confidence, 0.7);

  // Alias verification: derivePhase aliases decidePhase
  assert.strictEqual(derivePhase, decidePhase, 'derivePhase must be an alias of decidePhase');
  console.log('  ✅ Ambiguous, contradictory, and missing observation cases fallback to model phase with confidence capped at 0.7.\n');

  console.log('🎉 ALL PHASE DECISION RULES TESTS PASSED SUCCESSFULLY!\n');
}

if (require.main === module) {
  runPhaseRulesTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Phase rules tests failed:', err);
      process.exit(1);
    });
}

module.exports = { runPhaseRulesTests };
