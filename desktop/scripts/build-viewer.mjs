// Puts the viewer into app/viewer: the standalone (offline) edition built for "/" by ../build-offline.sh, without
// source maps and without dist/ort, the ONNX runtime (about 97 MB) that this edition never loads.
// Usage: npm run viewer        build platform/app/dist, then copy it (needs yarn install at the repository root)
//        npm run viewer:copy   copy a build that is already there (CI builds it in another step)
// The main viewer's build writes platform/app/dist too, so build right before copying.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(desktop);
const dist = path.join(repo, 'platform', 'app', 'dist');
const target = path.join(desktop, 'app', 'viewer');

if (!process.argv.includes('--copy-only')) {
  execFileSync('bash', [path.join(repo, 'build-offline.sh'), '/'], { cwd: repo, stdio: 'inherit' });
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
if (!read(path.join(dist, 'index.html')).includes('src="/app-config.js"') || !read(path.join(dist, 'app-config.js')).includes('config/offline.js')) {
  console.error('platform/app/dist is not the offline edition built for "/". Run ./build-offline.sh / (or npm run viewer).');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(dist, target, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(dist, source).split(path.sep).join('/');
    return relative !== 'ort' && !relative.startsWith('ort/') && !relative.endsWith('.map');
  },
});

// The web build's init-service-worker.js only removes old service workers. The app:// scheme has none, and the
// call fails there with a page error, so the app gets an empty module in its place.
fs.writeFileSync(path.join(target, 'init-service-worker.js'), '// Spectra Desktop has no service workers (desktop/scripts/build-viewer.mjs).\n');

let files = 0;
let bytes = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files += 1;
      bytes += fs.statSync(full).size;
    }
  }
};
walk(target);
console.log(`Copied the viewer into app/viewer: ${files} files, ${(bytes / 1048576).toFixed(1)} MB.`);
