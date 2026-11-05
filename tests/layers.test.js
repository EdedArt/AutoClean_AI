const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Starting Architectural Layer Boundary Test Suite...\n');

// Controllers not yet migrated to the service layer.
// Passes 2 and 3 will empty this list; an empty allowlist is the end state.
const PRISMA_CONTROLLER_ALLOWLIST = ['ai', 'evidence'];

const ROOT_DIR = path.resolve(__dirname, '..');
const CONTROLLERS_DIR = path.join(ROOT_DIR, 'src', 'controllers');
const ROUTES_DIR = path.join(ROOT_DIR, 'src', 'routes');
const SERVICES_DIR = path.join(ROOT_DIR, 'src', 'services');

/**
 * Recursively list all .js files in a directory
 */
function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

let totalTests = 0;
let passedTests = 0;

function runCheck(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    throw err;
  }
}

// 1. Verify allowlist controllers actually exist so list cannot rot
runCheck('Verify all controllers in allowlist exist on disk', () => {
  for (const name of PRISMA_CONTROLLER_ALLOWLIST) {
    const filename = `${name}.controller.js`;
    const filePath = path.join(CONTROLLERS_DIR, filename);
    assert.strictEqual(
      fs.existsSync(filePath),
      true,
      `Controller on allowlist does not exist: ${filename}`
    );
  }
});

// 2. Controllers layer: no Prisma references outside allowlist
runCheck('Controllers layer: no Prisma references outside allowlist', () => {
  const controllerFiles = getJsFiles(CONTROLLERS_DIR);
  const violations = [];

  for (const filePath of controllerFiles) {
    const filename = path.basename(filePath);
    if (filename === '.gitkeep') continue;

    const controllerName = filename.replace('.controller.js', '');
    const isAllowlisted = PRISMA_CONTROLLER_ALLOWLIST.includes(controllerName);

    if (isAllowlisted) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const hasPrismaImport =
      /require\(['"][^'"]*config\/db[^'"]*['"]\)/.test(content) ||
      /require\(['"]@prisma\/client['"]\)/.test(content);
    const hasPrismaReference =
      /\bprisma\./.test(content) || /\bnew\s+PrismaClient\b/.test(content);

    if (hasPrismaImport || hasPrismaReference) {
      violations.push(`${filename}: direct Prisma access detected in non-allowlisted controller`);
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Prisma access found in unapproved controllers:\n${violations.join('\n')}`
  );
});

// 3. Routes layer: zero Prisma references across all routes
runCheck('Routes layer: zero Prisma references across all route files', () => {
  const routeFiles = getJsFiles(ROUTES_DIR);
  const violations = [];

  for (const filePath of routeFiles) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    const hasPrismaImport =
      /require\(['"][^'"]*config\/db[^'"]*['"]\)/.test(content) ||
      /require\(['"]@prisma\/client['"]\)/.test(content);
    const hasPrismaReference =
      /\bprisma\./.test(content) || /\bnew\s+PrismaClient\b/.test(content);

    if (hasPrismaImport || hasPrismaReference) {
      violations.push(`${filename}: Prisma access detected in route file`);
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Prisma access found in route files:\n${violations.join('\n')}`
  );
});

// 4. Services layer: zero express imports and no req/res parameters
runCheck('Services layer: zero express imports and no req/res parameters', () => {
  const serviceFiles = getJsFiles(SERVICES_DIR);
  const violations = [];

  for (const filePath of serviceFiles) {
    const relative = path.relative(ROOT_DIR, filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    // Check express import
    const hasExpress = /require\(['"]express['"]\)/.test(content);
    if (hasExpress) {
      violations.push(`${relative}: imports express`);
    }

    // Check req / res parameters in function signatures
    const paramRegexes = [
      /function\s*[a-zA-Z0-9_$]*\s*\(([^)]*)\)/g,
      /\(([^)]*)\)\s*=>/g,
      /(?:async\s+)?function\s*\w*\s*\(([^)]*)\)/g,
      /(?:async\s+)?\(([^)]*)\)\s*=>/g,
    ];

    for (const regex of paramRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const params = match[1].split(',').map((p) => p.trim());
        for (const p of params) {
          if (/^req(\b|=|\s|$)/.test(p) || /^res(\b|=|\s|$)/.test(p)) {
            violations.push(`${relative}: function parameter '${p}' detected`);
          }
        }
      }
    }
  }

  assert.strictEqual(
    violations.length,
    0,
    `Express/HTTP contamination found in services layer:\n${violations.join('\n')}`
  );
});

console.log(`\n🎉 All ${passedTests}/${totalTests} architectural layer checks passed successfully!\n`);
