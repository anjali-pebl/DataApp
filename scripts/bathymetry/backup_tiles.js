// Bulk-download a tile folder from Supabase Storage into a local mirror, for backup before overwriting.
// Usage:  node backup_tiles.js <folder-name> [<folder-name> ...]
// Output: ../../tile_backups/<folder-name>/<z>/<x>/<y>.png
//
// Concurrency: up to 20 parallel downloads. Tracks ok / fail / skipped (already-on-disk) counts.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = 'bathymetry-tiles';
const OUT_ROOT = path.resolve(__dirname, '..', '..', 'tile_backups');
const CONCURRENCY = 20;

async function listAll(folder) {
  // Recursively list every .png under the given folder
  const stack = [folder];
  const files = [];
  while (stack.length) {
    const cur = stack.pop();
    const { data, error } = await sb.storage.from(BUCKET).list(cur, { limit: 1000 });
    if (error) { console.error(`list ${cur}: ${error.message}`); continue; }
    for (const e of data) {
      const child = `${cur}/${e.name}`;
      if (e.id) files.push(child); else stack.push(child);
    }
  }
  return files;
}

async function downloadOne(remote, localPath) {
  if (fs.existsSync(localPath)) return 'skipped';
  const { data, error } = await sb.storage.from(BUCKET).download(remote);
  if (error) return 'fail: ' + error.message;
  const buf = Buffer.from(await data.arrayBuffer());
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buf);
  return 'ok';
}

async function backupFolder(folder) {
  console.log(`\n=== backing up ${folder} ===`);
  const files = await listAll(folder);
  console.log(`  ${files.length} tiles to fetch`);
  let ok = 0, fail = 0, skip = 0;
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const remote = files[idx];
      const local = path.join(OUT_ROOT, remote);
      const result = await downloadOne(remote, local);
      if (result === 'ok') ok++;
      else if (result === 'skipped') skip++;
      else { fail++; console.error('  ' + remote + ' -> ' + result); }
      if ((idx + 1) % 500 === 0) console.log(`  ... ${idx + 1}/${files.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`  done: ok=${ok} skipped=${skip} fail=${fail}`);
  return { ok, skip, fail };
}

(async () => {
  const folders = process.argv.slice(2);
  if (!folders.length) {
    console.error('Usage: node backup_tiles.js <folder> [<folder> ...]');
    process.exit(2);
  }
  for (const f of folders) await backupFolder(f);
})();
