// Inject into CLI subprocesses only; connecting to MongoDB remains permitted.
require('node:net').Server.prototype.listen = function () {
  throw new Error('ADMIN_CLI_ATTEMPTED_HTTP_LISTEN');
};
