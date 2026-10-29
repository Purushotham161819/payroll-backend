import { loadEnvFile } from 'node:process';

// Load local configuration before modules read process.env. Shell/deployment
// variables retain precedence; a missing optional .env is handled by validation.
try {
  loadEnvFile('.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
