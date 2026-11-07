import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
const root = resolve(__dirname, '..');
describe('Backend environment loader', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'paystream-env-test-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  function run(script: string, overrides: NodeJS.ProcessEnv = {}) {
    const result = spawnSync(
      process.execPath,
      ['-r', require.resolve('ts-node/register/transpile-only'), '-e', script],
      {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...overrides,
          TS_NODE_PROJECT: join(root, 'tsconfig.json'),
        },
      },
    );
    if (result.status !== 0)
      throw new Error(
        'Isolated loader test failed without displaying environment contents',
      );
    return JSON.parse(result.stdout);
  }
  const load =
    'const loader=require(' +
    JSON.stringify(join(root, 'src/environment.ts')) +
    ');';
  it('resolves the backend .env instead of an unrelated working-directory file', () => {
    writeFileSync(
      join(directory, '.env'),
      'PAYSTREAM_UNTRUSTED_CWD_SENTINEL=wrong-directory',
    );
    const result = run(
      load +
        'console.log(JSON.stringify({file:loader.backendEnvironmentFile,wrong:process.env.PAYSTREAM_UNTRUSTED_CWD_SENTINEL}));',
    );
    expect(result.file).toBe(join(root, '.env'));
    expect(result.wrong).toBeUndefined();
  });
  it('loads quoted values and whitespace using native Node parsing', () => {
    const fixture = join(directory, 'fixture.env');
    writeFileSync(
      fixture,
      'PAYSTREAM_ENV_TEST_QUOTED = "fixture-value"\nPAYSTREAM_ENV_TEST_EMPTY=\n',
    );
    const result = run(
      load +
        'loader.loadEnvironment(' +
        JSON.stringify(fixture) +
        ');console.log(JSON.stringify({value:process.env.PAYSTREAM_ENV_TEST_QUOTED,empty:process.env.PAYSTREAM_ENV_TEST_EMPTY}));',
    );
    expect(result).toEqual({ value: 'fixture-value', empty: '' });
  });
  it('preserves deployment overrides even when the file is empty', () => {
    const fixture = join(directory, 'fixture.env');
    writeFileSync(
      fixture,
      'PAYSTREAM_ENV_TEST_OVERRIDE=\nPAYSTREAM_ENV_TEST_EXPLICIT_EMPTY=file-value',
    );
    const result = run(
      load +
        'loader.loadEnvironment(' +
        JSON.stringify(fixture) +
        ');console.log(JSON.stringify({value:process.env.PAYSTREAM_ENV_TEST_OVERRIDE,empty:process.env.PAYSTREAM_ENV_TEST_EXPLICIT_EMPTY}));',
      {
        PAYSTREAM_ENV_TEST_OVERRIDE: 'deployment-value',
        PAYSTREAM_ENV_TEST_EXPLICIT_EMPTY: '',
      },
    );
    expect(result).toEqual({ value: 'deployment-value', empty: '' });
  });
  it('allows an absent optional file and never falls back to .env.example', () => {
    const missing = join(directory, 'missing.env');
    writeFileSync(
      join(directory, '.env.example'),
      'PAYSTREAM_EXAMPLE_SENTINEL=must-not-load',
    );
    const result = run(
      load +
        'const result=loader.loadEnvironment(' +
        JSON.stringify(missing) +
        ');console.log(JSON.stringify({loaded:result.loaded,example:process.env.PAYSTREAM_EXAMPLE_SENTINEL}));',
    );
    expect(result).toEqual({ loaded: false });
  });
  it('reports unreadable files without echoing parser contents', () => {
    const result = run(
      load +
        'try{loader.loadEnvironment(' +
        JSON.stringify(directory) +
        ');}catch(error){console.log(JSON.stringify({message:error.message}));}',
    );
    expect(result.message).toBe(
      'Unable to load backend .env; check file permissions and syntax.',
    );
  });
  it('keeps credential placeholders empty in the tracked example', () => {
    const example = parseEnv(readFileSync(join(root, '.env.example'), 'utf8'));
    for (const key of [
      'MICROSOFT_TENANT_ID',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
    ])
      expect(example[key] === '').toBe(true);
  });
});
