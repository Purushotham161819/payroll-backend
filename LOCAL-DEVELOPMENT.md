# Local development

The backend connects to mongodb://127.0.0.1:27017/payroll by default.
Install MongoDB Community Server and start mongod before starting the API.
To use another database, set MONGODB_URI in the shell before starting:

    $env:MONGODB_URI = 'mongodb://127.0.0.1:27017/payroll'
    npm run start:dev

No .env file is loaded automatically. The server listens on PORT (default 3000).
The connection is checked during startup and closed during shutdown.

POST /employees accepts firstName, lastName, dateOfBirth and hireDate (ISO date
strings), and annualCtc (a nonnegative number). GET /employees lists employees.
Use the returned _id for GET, PATCH and DELETE /employees/:id.
Malformed IDs return 400; missing employees return 404.

Run npm run build, npm test -- --runInBand, and npm run test:e2e -- --runInBand.
The end-to-end suite requires a running MongoDB server.
