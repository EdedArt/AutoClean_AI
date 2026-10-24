require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { analyze } = require('../src/services/ai');

async function runSmoke() {
  const photoPath = process.argv[2];

  if (!photoPath) {
    console.error('Usage: npm run ai:smoke -- <path-to-photo.jpg|png|webp>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), photoPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Photo file not found at: ${resolvedPath}`);
    process.exit(1);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  let mimeType = 'image/jpeg';
  if (ext === '.png') mimeType = 'image/png';
  if (ext === '.webp') mimeType = 'image/webp';

  const buffer = fs.readFileSync(resolvedPath);

  console.log(`Analyzing image (${buffer.length} bytes, ${mimeType})...`);

  try {
    const analysis = await analyze({
      buffer,
      mimeType,
      expectedPlate: null,
      currentPhase: 'PENDIENTE',
    });

    console.log('\n--- AI Vision Analysis Result ---');
    console.log(`Provider:      ${analysis.provider}`);
    console.log(`Model:         ${analysis.model}`);
    console.log(`Fallback used: ${analysis.fallbackUsed}`);
    console.log(`Latency:       ${analysis.latencyMs} ms`);
    console.log('Structured Output:');
    console.log(JSON.stringify(analysis.result, null, 2));
    console.log('---------------------------------\n');
  } catch (err) {
    // Sanitize any potential key leak from error message before displaying
    let safeMessage = err.message || String(err);
    if (process.env.GEMINI_API_KEY) {
      safeMessage = safeMessage.split(process.env.GEMINI_API_KEY).join('[REDACTED]');
    }
    safeMessage = safeMessage.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED]');

    console.error('\n❌ Smoke test failed:');
    console.error(safeMessage);
    process.exit(1);
  }
}

runSmoke();
