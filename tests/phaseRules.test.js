process.env.NODE_ENV = 'test';
process.env.AI_MODE = 'simulated';
process.env.GEMINI_API_KEY = '';

const assert = require('assert');
const { derivePhase } = require('../src/services/ai/phaseRules');

async function runPhaseRulesTests() {
  console.log('🧪 Starting Phase Decision Rules Unit Test Suite...\n');

  // 1. Row 1: Foam wins over everything -> LAVADO
  console.log('1. Testing Rule 1: soapFoamVisible takes absolute precedence -> LAVADO...');
  const foamOnly = derivePhase({
    soapFoamVisible: true,
    waterOnCar: false,
    dryingInProgress: false,
    visibleDirt: 'none',
    cleanAndGlossy: false,
  }, 'PENDIENTE', 0.90);
  assert.strictEqual(foamOnly.phase, 'LAVADO');
  assert.strictEqual(foamOnly.source, 'rules');
  assert.strictEqual(foamOnly.confidence, 0.90);

  const foamWinsOverAll = derivePhase({
    soapFoamVisible: true,
    waterOnCar: true,
    dryingInProgress: true,
    visibleDirt: 'none',
    cleanAndGlossy: true,
  }, 'SECADO', 0.99);
  assert.strictEqual(foamWinsOverAll.phase, 'LAVADO', 'Foam must win even when drying or glossy is true');
  assert.strictEqual(foamWinsOverAll.source, 'rules');
  assert.strictEqual(foamWinsOverAll.confidence, 0.95, 'Rule confidence must cap at 0.95');
  console.log('  ✅ Foam wins over all competing signals and resolves to LAVADO.\n');

  // 2. Row 2: waterOnCar && dryingInProgress -> SECADO
  console.log('2. Testing Rule 2: waterOnCar && dryingInProgress -> SECADO...');
  const secado = derivePhase({
    soapFoamVisible: false,
    waterOnCar: true,
    dryingInProgress: true,
    visibleDirt: 'none',
    cleanAndGlossy: false,
  }, 'REMOJO', 0.92);
  assert.strictEqual(secado.phase, 'SECADO');
  assert.strictEqual(secado.source, 'rules');
  assert.strictEqual(secado.confidence, 0.92);
  console.log('  ✅ Wet vehicle with drying in progress resolves to SECADO.\n');

  // 3. Row 3: waterOnCar && !dryingInProgress -> REMOJO
  console.log('3. Testing Rule 3: waterOnCar && !dryingInProgress -> REMOJO...');
  const remojo = derivePhase({
    soapFoamVisible: false,
    waterOnCar: true,
    dryingInProgress: false,
    visibleDirt: 'light',
    cleanAndGlossy: false,
  }, 'LAVADO', 0.88);
  assert.strictEqual(remojo.phase, 'REMOJO');
  assert.strictEqual(remojo.source, 'rules');
  assert.strictEqual(remojo.confidence, 0.88);
  console.log('  ✅ Wet vehicle without foam or drying resolves to REMOJO.\n');

  // 4. Row 4: Dry, clean and glossy car resolves to LISTO (even if model guessed PENDIENTE)
  console.log('4. Testing Rule 4: Dry clean glossy car resolves to LISTO (fixing PENDIENTE misclassification)...');
  const listoFixed = derivePhase({
    soapFoamVisible: false,
    waterOnCar: false,
    dryingInProgress: false,
    visibleDirt: 'none',
    cleanAndGlossy: true,
    observationNotes: 'Clean, polished, shiny car body',
  }, 'PENDIENTE', 0.96);
  assert.strictEqual(listoFixed.phase, 'LISTO', 'Dry, clean and glossy car MUST resolve to LISTO, fixing PENDIENTE confusion');
  assert.strictEqual(listoFixed.source, 'rules');
  assert.strictEqual(listoFixed.confidence, 0.95, 'Rule confidence capped at 0.95');
  console.log('  ✅ Clean and glossy vehicle correctly resolves to LISTO even when model guessed PENDIENTE.\n');

  // 5. Row 5: !waterOnCar && (visibleDirt === 'light' | 'heavy') && !cleanAndGlossy -> PENDIENTE
  console.log('5. Testing Rule 5: Dry dirty vehicle resolves to PENDIENTE...');
  const pendienteLight = derivePhase({
    soapFoamVisible: false,
    waterOnCar: false,
    dryingInProgress: false,
    visibleDirt: 'light',
    cleanAndGlossy: false,
  }, 'LISTO', 0.91);
  assert.strictEqual(pendienteLight.phase, 'PENDIENTE');
  assert.strictEqual(pendienteLight.source, 'rules');
  assert.strictEqual(pendienteLight.confidence, 0.91);

  const pendienteHeavy = derivePhase({
    soapFoamVisible: false,
    waterOnCar: false,
    dryingInProgress: false,
    visibleDirt: 'heavy',
    cleanAndGlossy: false,
  }, 'PENDIENTE', 0.97);
  assert.strictEqual(pendienteHeavy.phase, 'PENDIENTE');
  assert.strictEqual(pendienteHeavy.source, 'rules');
  assert.strictEqual(pendienteHeavy.confidence, 0.95);
  console.log('  ✅ Dry vehicle with visible dirt correctly resolves to PENDIENTE.\n');

  // 6. Row 6: Ambiguous / contradictory cases -> fallback to model phase capped at 0.7
  console.log('6. Testing Row 6: Ambiguous / contradictory cases fallback to model phase capped at 0.7...');
  // Contradiction A: dry, heavy dirt, but cleanAndGlossy = true
  const contradictory = derivePhase({
    soapFoamVisible: false,
    waterOnCar: false,
    dryingInProgress: false,
    visibleDirt: 'heavy',
    cleanAndGlossy: true,
  }, 'LAVADO', 0.95);
  assert.strictEqual(contradictory.phase, 'LAVADO', 'Contradictory state falls back to model phase');
  assert.strictEqual(contradictory.source, 'model');
  assert.strictEqual(contradictory.confidence, 0.7, 'Contradictory confidence must be capped at 0.7');

  // Contradiction B: dry, no dirt, but not glossy
  const ambiguousDry = derivePhase({
    soapFoamVisible: false,
    waterOnCar: false,
    dryingInProgress: false,
    visibleDirt: 'none',
    cleanAndGlossy: false,
  }, 'SECADO', 0.85);
  assert.strictEqual(ambiguousDry.phase, 'SECADO');
  assert.strictEqual(ambiguousDry.source, 'model');
  assert.strictEqual(ambiguousDry.confidence, 0.7);

  // Missing observations object
  const nullObs = derivePhase(null, 'REMOJO', 0.92);
  assert.strictEqual(nullObs.phase, 'REMOJO');
  assert.strictEqual(nullObs.source, 'model');
  assert.strictEqual(nullObs.confidence, 0.7);
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
