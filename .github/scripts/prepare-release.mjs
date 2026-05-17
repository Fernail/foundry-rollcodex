import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const moduleJsonPath = resolve(repoRoot, 'module.json');
const rollcodexScriptPath = resolve(repoRoot, 'scripts/rollcodex.js');
const measuresScriptPath = resolve(repoRoot, 'scripts/rollcodex-measures.js');

function bumpPatchVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Version module.json invalide: ${version}`);
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function replaceRequired(content, pattern, replacement, label) {
  const next = content.replace(pattern, replacement);
  if (next === content) {
    throw new Error(`Remplacement introuvable dans ${label}`);
  }
  return next;
}

const moduleJson = JSON.parse(readFileSync(moduleJsonPath, 'utf8'));
const nextVersion = bumpPatchVersion(moduleJson.version);
const nextTag = `v${nextVersion}`;
const nextZipName = `rollcodex-${nextTag}.zip`;

moduleJson.version = nextVersion;
moduleJson.download = `https://github.com/Fernail/foundry-rollcodex/releases/download/${nextTag}/rollcodex-${nextTag}.zip`;

writeFileSync(moduleJsonPath, `${JSON.stringify(moduleJson, null, 2)}\n`);

const rollcodexScript = readFileSync(rollcodexScriptPath, 'utf8');
const nextRollcodexScript = replaceRequired(
  rollcodexScript,
  /const MODULE_VERSION = '[^']+';/,
  `const MODULE_VERSION = '${nextVersion}';`,
  'scripts/rollcodex.js',
);
writeFileSync(rollcodexScriptPath, nextRollcodexScript);

const measuresScript = readFileSync(measuresScriptPath, 'utf8');
let nextMeasuresScript = replaceRequired(
  measuresScript,
  /RollCodex Measures Extension - Phase 1b \(v[^)]+\)/,
  `RollCodex Measures Extension - Phase 1b (${nextTag})`,
  'scripts/rollcodex-measures.js',
);
nextMeasuresScript = replaceRequired(
  nextMeasuresScript,
  /@version [^\n]+/,
  `@version ${nextVersion} - Phase 1b (${new Date().toISOString().slice(0, 10)})`,
  'scripts/rollcodex-measures.js',
);
writeFileSync(measuresScriptPath, nextMeasuresScript);

const releaseInfo = {
  version: nextVersion,
  tag: nextTag,
  zip_name: nextZipName,
};

if (process.argv.includes('--github-output')) {
  process.stdout.write(Object.entries(releaseInfo).map(([key, value]) => `${key}=${value}`).join('\n'));
} else {
  process.stdout.write(JSON.stringify(releaseInfo));
}