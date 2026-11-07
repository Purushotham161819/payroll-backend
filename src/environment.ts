import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

// Both src/environment.ts and dist/environment.js live one level below the
// backend root. Never select a different .env based on the caller's directory.
export const backendEnvironmentFile = resolve(__dirname, '..', '.env');

export function loadEnvironment(file = backendEnvironmentFile) {
  try {
    // Node preserves shell/deployment values, including explicitly empty ones.
    // This loader never reads .env.example or copies credentials from it.
    loadEnvFile(file);
    return { file, loaded: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { file, loaded: false };
    // Do not print parser errors that could contain environment-file contents.
    throw new Error(
      'Unable to load backend .env; check file permissions and syntax.',
    );
  }
}

export const environmentLoad = loadEnvironment();
