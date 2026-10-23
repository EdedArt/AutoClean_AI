const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yaml = require('js-yaml');

process.env.PORT = '3099';
process.env.SIMULATION_PHASE_DURATION_MS = '60000';

const { app, server, simulationInterval } = require('../server');
const packageJson = require('../package.json');

function makeRequest(method, reqPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3099,
      path: reqPath,
      method,
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
    req.end();
  });
}

function extractExpressRoutes(expressApp) {
  const routes = [];

  function traverseStack(stack, basePath = '') {
    stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const fullPath = (basePath + layer.route.path).replace(/\/+$/, '') || '/';
        const normalizedPath = fullPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
        const methods = Object.keys(layer.route.methods).map((m) => m.toLowerCase());
        methods.forEach((method) => {
          routes.push({ method, path: normalizedPath, originalPath: fullPath });
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        let routerPath = '';
        if (layer.regexp) {
          const match = layer.regexp.source
            .replace('^\\/', '/')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/\^/g, '')
            .replace(/\$/g, '');
          routerPath = match;
        }
        traverseStack(layer.handle.stack, basePath + routerPath);
      }
    });
  }

  traverseStack(expressApp._router.stack);
  return routes;
}

async function runOpenApiTests() {
  console.log('🧪 Starting OpenAPI & Swagger Documentation Test Suite...\n');

  try {
    // 1. Validate openapi.yaml syntax and core metadata
    console.log('1. Validating docs/openapi.yaml file structure and metadata...');
    const yamlPath = path.join(__dirname, '../docs/openapi.yaml');
    assert.ok(fs.existsSync(yamlPath), 'docs/openapi.yaml does not exist');

    const fileContent = fs.readFileSync(yamlPath, 'utf8');
    const spec = yaml.load(fileContent);
    assert.ok(spec, 'Parsed OpenAPI spec is empty');

    // (a) openapi 3.0.x
    assert.ok(spec.openapi && spec.openapi.startsWith('3.0.'), `Expected OpenAPI 3.0.x, got ${spec.openapi}`);
    assert.strictEqual(spec.info.title, 'AutoClean AI API');
    assert.strictEqual(spec.info.version, packageJson.version);
    assert.ok(spec.info.description && spec.info.description.length > 0, 'Info description is missing');

    const serverUrls = (spec.servers || []).map((s) => s.url);
    assert.ok(serverUrls.includes('http://localhost:3000'), 'Server URL http://localhost:3000 missing');

    const expectedTags = [
      'Health',
      'Vehicles',
      'Bays',
      'Packages',
      'Orders',
      'Simulation',
      'Prediction',
      'Evidence',
    ];
    const registeredTags = (spec.tags || []).map((t) => t.name);
    for (const tag of expectedTags) {
      assert.ok(registeredTags.includes(tag), `Required tag "${tag}" is missing from spec`);
    }
    console.log('  ✅ OpenAPI 3.0.x metadata, info, servers, and tags validated successfully.');

    // 2. Validate schemas and reusable components
    console.log('\n2. Validating required components, schemas, and error responses...');
    assert.ok(spec.components, 'Missing components in OpenAPI spec');
    assert.ok(spec.components.schemas, 'Missing components.schemas');

    const expectedSchemas = [
      'Phase',
      'Vehicle',
      'Bay',
      'Package',
      'ServiceOrder',
      'Prediction',
      'Evidence',
      'CreateVehicleRequest',
      'CreateOrderRequest',
      'UpdatePhaseRequest',
      'ErrorResponse',
    ];
    for (const schema of expectedSchemas) {
      assert.ok(spec.components.schemas[schema], `Required schema "${schema}" is missing`);
    }

    assert.ok(spec.components.responses, 'Missing components.responses');
    const expectedResponses = ['ValidationError', 'NotFound', 'Conflict'];
    for (const resName of expectedResponses) {
      assert.ok(spec.components.responses[resName], `Required reusable response "${resName}" is missing`);
    }
    console.log('  ✅ All required schemas and reusable error responses present.');

    // 3. Walk Express router stack and enforce 100% spec coverage
    console.log('\n3. Walking Express router stack and verifying route coverage in OpenAPI spec...');
    const allRoutes = extractExpressRoutes(app);
    const apiRoutes = allRoutes.filter((r) => !r.path.startsWith('/api/docs'));

    assert.ok(apiRoutes.length >= 16, `Expected at least 16 API routes, found ${apiRoutes.length}`);

    for (const route of apiRoutes) {
      const specPath = spec.paths[route.path];
      assert.ok(
        specPath,
        `Route path "${route.path}" is registered in Express but missing from openapi.yaml spec`
      );
      const operation = specPath[route.method];
      assert.ok(
        operation,
        `Method ${route.method.toUpperCase()} for path "${route.path}" is missing from openapi.yaml spec`
      );
      console.log(`  ✔ [COVERAGE] ${route.method.toUpperCase().padEnd(6)} ${route.path.padEnd(38)} -> documented`);
    }
    console.log(`  ✅ 100% Express route coverage verified (${apiRoutes.length} operations match).`);

    // 4. Test GET /api/docs.json returns valid JSON spec
    console.log('\n4. Testing GET /api/docs.json endpoint...');
    const docsJsonRes = await makeRequest('GET', '/api/docs.json');
    assert.strictEqual(docsJsonRes.status, 200);
    assert.ok(
      docsJsonRes.headers['content-type'].includes('application/json'),
      `Expected application/json content-type, got ${docsJsonRes.headers['content-type']}`
    );
    assert.strictEqual(docsJsonRes.body.openapi, spec.openapi);
    assert.strictEqual(docsJsonRes.body.info.title, 'AutoClean AI API');
    assert.strictEqual(docsJsonRes.body.info.version, packageJson.version);
    assert.deepStrictEqual(Object.keys(docsJsonRes.body.paths), Object.keys(spec.paths));
    console.log('  ✅ GET /api/docs.json returned 200 with matching valid OpenAPI JSON spec.');

    // 5. Test GET /api/docs returns Swagger UI
    console.log('\n5. Testing GET /api/docs Swagger UI HTML endpoint...');
    // Note: swagger-ui redirects /api/docs to /api/docs/ with 301
    let docsUiRes = await makeRequest('GET', '/api/docs/');
    if (docsUiRes.status === 301 || docsUiRes.status === 302) {
      const redirectLocation = docsUiRes.headers.location;
      docsUiRes = await makeRequest('GET', redirectLocation);
    }
    assert.strictEqual(docsUiRes.status, 200);
    assert.ok(
      typeof docsUiRes.raw === 'string' && docsUiRes.raw.includes('AutoClean AI API'),
      'Swagger UI HTML does not contain custom title "AutoClean AI API"'
    );
    console.log('  ✅ Swagger UI serves HTML correctly with custom title.');

    console.log('\n🎉 All OpenAPI & Swagger Documentation tests passed successfully!');
  } finally {
    if (simulationInterval) clearInterval(simulationInterval);
    if (server) server.close();
  }
}

runOpenApiTests().catch((err) => {
  console.error('\n❌ OpenAPI test failed:', err);
  if (simulationInterval) clearInterval(simulationInterval);
  if (server) server.close();
  process.exit(1);
});
