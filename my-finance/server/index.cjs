const path = require('node:path');
const loadLocalEnv = require('../scripts/load-local-env.cjs');

const projectRoot = path.join(__dirname, '..');
loadLocalEnv(projectRoot);

const mysqlServer = require('./mysql-server.cjs');
module.exports = mysqlServer;

if (require.main === module) mysqlServer.start();
