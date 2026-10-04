/* eslint-disable @typescript-eslint/no-require-imports -- Node CLI integration test. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
test('offline backup restores into a new directory and refuses overwrites', async () => {
  const dir = mkdtempSync('/private/tmp/vendra-backup-test-');
  const source=join(dir,'source'), archive=join(dir,'backup.tar.gz'), target=join(dir,'restored');
  const db=await PGlite.create(source);
  await db.exec('CREATE TABLE rooms (id int); CREATE TABLE occupants (id int); CREATE TABLE room_assignments (id int); INSERT INTO rooms VALUES (101); INSERT INTO occupants VALUES (1), (2);');
  await db.close();
  const run = (mode,from,to) => execFileSync(process.execPath,['--import','tsx','scripts/backup.mts',mode,from,to,'--offline'],{encoding:'utf8',stdio:'pipe'});
  assert.match(run('backup',source,archive),/Backup written/);
  assert.match(run('restore',archive,target),/Restored to new directory/);
  const restored=await PGlite.create(target);
  assert.deepEqual((await restored.query('SELECT * FROM rooms')).rows,[{id:101}]);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM occupants')).rows[0].n,2);
  await restored.close();
  assert.throws(()=>run('restore',archive,target),/Target already exists/);
});
