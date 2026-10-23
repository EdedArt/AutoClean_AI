const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const openapiPath = path.join(__dirname, '../../docs/openapi.yaml');
const openapiSpec = yaml.load(fs.readFileSync(openapiPath, 'utf8'));

module.exports = openapiSpec;
