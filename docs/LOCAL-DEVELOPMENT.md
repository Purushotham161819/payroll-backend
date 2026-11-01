# Local development

The active AppModule connects to mongodb://127.0.0.1:27017/payroll_db by default.
See AUTHENTICATION.md for required SESSION_SECRET, login, and initial administrator setup.
Run npm.cmd run create-admin for masked first-account prompts. After login,
administrators can open User Management. See USER-MANAGEMENT.md for daily use
and the controlled npm.cmd run recover-admin recovery command.
Install MongoDB Community Server and start mongod before starting the API.
To use another database, set MONGODB_URI in the shell before starting:

    $env:MONGODB_URI = 'mongodb://127.0.0.1:27017/payroll_db'
    npm run start:dev

Backend startup and administrator commands load .env from the working directory
before reading configuration. Existing shell variables take precedence.
The ignored local .env supplies SESSION_SECRET; keep it private and stable.
Generate a replacement with:

    node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"

Store that value as SESSION_SECRET in .env, never in .env.example or source.
SESSION_SECRET must still contain at least 32 characters. The runtime requires
Node.js 20.12+ for native environment loading (local verification uses Node 24).
The server listens on PORT (default 3000).
The connection is checked during startup and closed during shutdown.

POST /employees accepts firstName, lastName, dateOfBirth and hireDate (ISO date
strings), and annualCtc (a nonnegative number). GET /employees lists employees.
Use the returned _id for GET, PATCH and DELETE /employees/:id.
Malformed IDs return 400; missing employees return 404.

Run npm run build, npm test -- --runInBand, and npm run test:e2e -- --runInBand.
The end-to-end suite requires a running MongoDB server.

## Session configuration and password minimum update

The private local .env now contains a cryptographically generated 64-character
SESSION_SECRET. Its value is not included in source, examples or reports.
Existing .gitignore entries already exclude .env and .env.* while allowing
.env.example; no unrelated ignore entries were changed. Production should use
its own independently generated secret through deployment configuration.

Passwords now require 8-128 characters for administrator setup/recovery, user
creation, password reset and login. Password hashing, roles, CSRF, cookies,
rate limiting and session invalidation are unchanged.

Restart commands, each in its own repository terminal:

    # payroll-backend (the verified local backend is currently running)
    npm.cmd run start:dev

    # payroll-frontend
    npm.cmd start

For production builds use npm.cmd run build in both repositories, followed by
npm.cmd run start:prod in the backend. Run backend commands from its repository
root so its local .env is found. Shell values override .env, so remove or correct
an existing invalid SESSION_SECRET shell variable if one is set.

Actual verification for this update:

- Backend and frontend production builds passed. Frontend retains its existing
  bundle-size and PDF dependency CommonJS warning categories.
- Backend unit/regression suite: 224 passed, 4 pre-existing mandatory BASIC/DA
  fixture failures, 14 optional tests skipped.
- Backend authentication/user-management end-to-end suite: 20 passed. It now
  uses 8-character passwords for administrator bootstrap/recovery, user creation,
  login and password reset, and explicitly rejects 7-character inputs.
- Frontend unit/regression suite: 72 passed, including creation/reset boundaries.
- Real startup with missing and too-short secrets failed with the expected
  32-character validation error. Local .env loading was checked without printing
  the secret. The existing backend watcher was identified and restarted; startup
  succeeded on port 3000 and GET /employees still returned 401 without a session.

Files changed in this update:

- Backend: src/environment.ts (new); src/main.ts;
  src/auth/admin-provisioning.ts; src/auth/auth.controller.ts;
  src/auth/users.dto.ts; scripts/admin.ps1; private ignored .env (new);
  .env.example; AUTHENTICATION.md; USER-MANAGEMENT.md; LOCAL-DEVELOPMENT.md.
- Backend tests: src/auth/password-validation.spec.ts (new);
  src/auth/http-security.spec.ts (new); test/auth.e2e-spec.ts;
  test/users.e2e-spec.ts.
- Frontend: src/app/auth/login.ts; src/app/auth/auth.spec.ts;
  src/app/users/users.ts; src/app/users/users.html; src/app/users/users.spec.ts.

No payroll source, existing user password, business record, dependency or Git
history was changed. No changes were committed or pushed.
