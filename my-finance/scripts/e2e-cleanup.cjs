const path = require('node:path');
const loadLocalEnv = require('./load-local-env.cjs');

module.exports = async function cleanupMySqlE2eAccount() {
  const projectRoot = path.join(__dirname, '..');
  loadLocalEnv(projectRoot);
  if (process.env.NODE_ENV === 'production') throw new Error('E2E cleanup cannot target a production database.');
  const runId = process.env.MYSQL_E2E_RUN_ID;
  if (!runId) return;

  const { db } = require('../server/mysql-server.cjs');
  try {
    const googleSub = `playwright-test-${runId}`;
    const email = `${googleSub}@example.invalid`;
    const [users] = await db.execute('SELECT id FROM users WHERE google_sub=? AND email=?', [googleSub, email]);
    for (const user of users) {
      const userId = Number(user.id);
      await db.execute('DELETE FROM transactions WHERE user_id=?', [userId]);
      await db.execute('DELETE FROM calendar_plans WHERE user_id=?', [userId]);
      await db.execute('DELETE FROM categories WHERE user_id=?', [userId]);
      await db.execute('DELETE FROM settings WHERE user_id=?', [userId]);
      await db.execute('DELETE FROM auth_sessions WHERE user_id=?', [userId]);
      await db.execute('DELETE FROM users WHERE id=?', [userId]);
    }
  } catch (error) {
    console.error('MySQL E2E cleanup failed:', error.code || 'UNKNOWN');
    throw error;
  } finally {
    await db.end();
  }
};
