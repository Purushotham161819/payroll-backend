import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createConnection, Connection } from 'mongoose';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import request from 'supertest';
import { UserSchema } from '../src/auth/auth.schema';
import { configureSecurity } from '../src/auth/http-security';

describe('Startup with initialized accounts and an unverified existing lock',()=>{
  const database=`payroll_startup_lock_test_${randomBytes(8).toString('hex')}`;
  const uri=`mongodb://127.0.0.1:27017/${database}`;
  const password=randomBytes(24).toString('base64url');
  const headers={Origin:'http://localhost:4200','X-Payroll-Request':'1'};
  let observer:Connection,app:NestExpressApplication,second:NestExpressApplication;
  const lock={_id:'accounts',owner:'unverified-legacy-test-owner',createdAt:new Date(0)};
  async function start(){
    const {AppModule}=require('../src/app.module') as typeof import('../src/app.module');
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();
    const instance=module.createNestApplication<NestExpressApplication>();
    configureSecurity(instance);instance.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await instance.init();return instance;
  }
  beforeAll(async()=>{
    process.env.MONGODB_URI=uri;process.env.SESSION_SECRET=randomBytes(48).toString('hex');process.env.FRONTEND_ORIGIN=headers.Origin;
    observer=await createConnection(uri).asPromise();
    const users=observer.model('AuthUser',UserSchema);await users.init();
    await users.create({email:'startup@example.test',passwordHash:await argon2.hash(password),role:'admin',active:true});
    await observer.collection<{_id:string;owner:string;createdAt:Date}>('auth_management_locks').insertOne(lock);
    app=await start();
  },30000);
  afterAll(async()=>{
    await second?.close();await app?.close();
    if(observer?.name===database&&database.startsWith('payroll_startup_lock_test_'))await observer.dropDatabase();
    await observer?.close();
  });
  it('starts repeatedly while preserving the existing lock and all accounts',async()=>{
    second=await start();
    expect(await observer.collection('auth_management_locks').findOne({_id:'accounts'} as any)).toEqual(lock);
    expect(await observer.collection('authusers').countDocuments()).toBe(1);
    await request(app.getHttpServer()).get('/users').expect(401);
    await request(second.getHttpServer()).get('/users').expect(401);
  },30000);
  it('allows login and account reads, keeps writes locked, and preserves logout',async()=>{
    const result=await request(app.getHttpServer()).post('/auth/login').set(headers).send({email:'startup@example.test',password}).expect(200);
    const cookie=result.headers['set-cookie'][0].split(';')[0];
    await request(app.getHttpServer()).get('/users').set('Cookie',cookie).expect(200);
    await request(app.getHttpServer()).post('/users').set(headers).set('Cookie',cookie).send({email:'must-not-create@example.test',password,role:'user',active:true}).expect(409);
    expect(await observer.collection('authusers').countDocuments()).toBe(1);
    expect(await observer.collection('auth_management_locks').findOne({_id:'accounts'} as any)).toEqual(lock);
    await request(app.getHttpServer()).post('/auth/logout').set(headers).set('Cookie',cookie).expect(204);
    await request(app.getHttpServer()).get('/users').set('Cookie',cookie).expect(401);
  });
});
