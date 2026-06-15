const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const previewRoot = path.resolve(
  process.env.MDZIP_WIN_PREV_DIR || path.join(root, '..', 'mdzip-win-prev')
);
const project = path.join(previewRoot, 'src', 'mdz.WinPrev', 'mdz.WinPrev.csproj');
const output = path.join(root, 'build', 'preview-handler');

if (!fs.existsSync(project)) {
  throw new Error(
    `MDZip preview handler project not found at ${project}. `
    + 'Set MDZIP_WIN_PREV_DIR to its repository root.'
  );
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const result = spawnSync(
  'dotnet',
  [
    'publish',
    project,
    '--configuration', 'Release',
    '--framework', 'net8.0-windows',
    '--runtime', 'win-x64',
    '--self-contained', 'false',
    '--output', output,
  ],
  { cwd: root, stdio: 'inherit' }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const comHost = path.join(output, 'mdz.WinPrev.comhost.dll');
if (!fs.existsSync(comHost)) {
  throw new Error(`Preview handler publish did not produce ${comHost}.`);
}

console.log(`Preview handler published to ${output}`);
