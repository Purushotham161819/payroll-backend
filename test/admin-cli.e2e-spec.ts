import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MongoClient } from 'mongodb';
import * as argon2 from 'argon2';

describe('Standalone administrator CLI with the existing backend left running', () => {
  const root = resolve(__dirname, '..');
  const database = `payroll_cli_test_${randomBytes(8).toString('hex')}`;
  const uri = `mongodb://127.0.0.1:27017/${database}`;
  const email = 'cli-admin@example.test';
  const password = randomBytes(8).toString('hex').slice(0,8);
  const replacement = randomBytes(8).toString('hex').slice(0,8);
  const client = new MongoClient(uri);
  let listeners: string;
  const listener = () => process.platform === 'win32'
    ? execFileSync('netstat',['-ano','-p','tcp'],{encoding:'utf8'}).split(/\r?\n/).filter(line=>/:3000\s+.*LISTENING/.test(line)).map(line=>line.trim().split(/\s+/).at(-1)).sort().join(',') : '';
  const run = (mode='create', input=password, databaseUri=uri, target=email) => spawnSync(process.execPath,[resolve(root,'scripts/admin-cli.cjs'),mode],{
    cwd:tmpdir(),encoding:'utf8',timeout:20000,windowsHide:true,
    env:{...process.env,MONGODB_URI:databaseUri,BOOTSTRAP_ADMIN_EMAIL:target,BOOTSTRAP_ADMIN_PASSWORD:input,SESSION_SECRET:'',NODE_OPTIONS:`--require=${resolve(__dirname,'admin-cli-no-listen.cjs')}`},
  });
  beforeAll(async()=>{await client.connect();listeners=listener();});
  afterAll(async()=>{if(database.startsWith('payroll_cli_test_'))await client.db(database).dropDatabase();await client.close();});
  afterEach(()=>{expect(listener()).toBe(listeners);});
  it('runs the actual npm create-admin command on a test DB while port 3000 stays occupied',()=>{
    if(process.platform!=='win32')return;
    const result=spawnSync(process.env.ComSpec ?? 'cmd.exe',['/d','/s','/c','npm.cmd run create-admin -- -UseEnvironment'],{
      cwd:root,encoding:'utf8',timeout:25000,windowsHide:true,
      env:{...process.env,MONGODB_URI:uri,BOOTSTRAP_ADMIN_EMAIL:email,BOOTSTRAP_ADMIN_PASSWORD:password,SESSION_SECRET:'',NODE_OPTIONS:`--require=${resolve(__dirname,'admin-cli-no-listen.cjs')}`},
    });
    expect(result.status).toBe(0);expect(result.stdout).toContain('Administrator created');
    expect(result.stdout+result.stderr).not.toMatch(/EADDRINUSE|ADMIN_CLI_ATTEMPTED_HTTP_LISTEN/);
    expect(result.stdout+result.stderr).not.toContain(password);
  },30000);
  it('creates an active admin with an Argon2id hash and closes its process/connection',async()=>{
    if(process.platform!=='win32')expect(run().status).toBe(0);
    const admin=await client.db(database).collection('authusers').findOne({email});
    expect(admin).toMatchObject({role:'admin',active:true});
    expect(admin!.passwordHash).toMatch(/^\$argon2id\$/);expect(await argon2.verify(admin!.passwordHash,password)).toBe(true);
    expect(await client.db(database).collection('authusers').countDocuments()).toBe(1);
  });
  it('rejects duplicate setup without changing any account and explains explicit recovery',async()=>{
    const before=await client.db(database).collection('authusers').find().toArray();
    const result=run('create',replacement);
    expect(result.status).toBe(1);expect(result.stderr).toContain('npm.cmd run recover-admin');
    expect(await client.db(database).collection('authusers').find().toArray()).toEqual(before);
  });
  it('rejects invalid input and reports database failures safely',()=>{
    const short=run('create','1234567');expect(short.status).toBe(1);expect(short.stderr).toContain('8-128');
    const invalid=run('create',password,uri,'bad-email');expect(invalid.status).toBe(1);expect(invalid.stderr).toContain('BOOTSTRAP_ADMIN_EMAIL');
    const offline=run('create',password,'mongodb://127.0.0.1:1/unavailable');expect(offline.status).toBe(1);expect(offline.stderr).toContain('Cannot connect to MongoDB');
    expect(offline.stderr).not.toContain(password);
  },30000);
  it('preserves explicit recovery without starting HTTP',async()=>{
    const result=run('recover',replacement);expect(result.status).toBe(0);
    const admin=await client.db(database).collection('authusers').findOne({email});
    expect(await argon2.verify(admin!.passwordHash,replacement)).toBe(true);expect(admin!.sessionVersion).toBe(1);
    expect(run('recover',replacement,uri,'missing@example.test').status).toBe(1);
  },30000);
  it('allows only one administrator during concurrent initial setup',async()=>{
    const raceDatabase=`payroll_cli_race_test_${randomBytes(8).toString('hex')}`;
    const raceUri=`mongodb://127.0.0.1:27017/${raceDatabase}`;
    const start=(target:string)=>new Promise<number|null>((resolveCode,reject)=>{
      const child=spawn(process.execPath,[resolve(root,'scripts/admin-cli.cjs'),'create'],{cwd:tmpdir(),windowsHide:true,stdio:'ignore',env:{...process.env,MONGODB_URI:raceUri,BOOTSTRAP_ADMIN_EMAIL:target,BOOTSTRAP_ADMIN_PASSWORD:password,NODE_OPTIONS:`--require=${resolve(__dirname,'admin-cli-no-listen.cjs')}`}});
      child.on('error',reject);child.on('exit',resolveCode);
    });
    try {
      expect((await Promise.all([start('first@example.test'),start('second@example.test')])).sort()).toEqual([0,1]);
      expect(await client.db(raceDatabase).collection('authusers').countDocuments({role:'admin'})).toBe(1);
    } finally {if(raceDatabase.startsWith('payroll_cli_race_test_'))await client.db(raceDatabase).dropDatabase();}
  },30000);
  it('checks masked password confirmation before any database write',()=>{
    if(process.platform!=='win32')return;
    const command=`function global:Read-Host { param([string]$Prompt,[switch]$AsSecureString) if(-not $AsSecureString){return $env:BOOTSTRAP_ADMIN_EMAIL}; if($Prompt -eq 'Confirm password'){return (ConvertTo-SecureString $env:CLI_CONFIRMATION -AsPlainText -Force)}; return (ConvertTo-SecureString $env:BOOTSTRAP_ADMIN_PASSWORD -AsPlainText -Force) }; & '${resolve(root,'scripts/admin.ps1')}'`;
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',command],{
      cwd:tmpdir(),encoding:'utf8',timeout:15000,windowsHide:true,
      env:{...process.env,MONGODB_URI:uri,BOOTSTRAP_ADMIN_EMAIL:email,BOOTSTRAP_ADMIN_PASSWORD:password,CLI_CONFIRMATION:replacement},
    });
    expect(result.status).not.toBe(0);expect(result.stderr).toContain('Passwords do not match');expect(result.stderr).not.toContain(password);
    const matching=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',command],{
      cwd:tmpdir(),encoding:'utf8',timeout:20000,windowsHide:true,
      env:{...process.env,MONGODB_URI:uri,BOOTSTRAP_ADMIN_EMAIL:email,BOOTSTRAP_ADMIN_PASSWORD:password,CLI_CONFIRMATION:password,NODE_OPTIONS:`--require=${resolve(__dirname,'admin-cli-no-listen.cjs')}`},
    });
    expect(matching.status).toBe(1);expect(matching.stderr).toContain('An administrator already exists');expect(matching.stderr).not.toContain(password);
  });
  it('leaves the original backend responsive after the command exits',async()=>{
    if(listeners)expect((await fetch('http://localhost:3000/employees')).status).toBe(401);
  });
});
