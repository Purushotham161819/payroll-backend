import { ConflictException } from '@nestjs/common';
import { Model } from 'mongoose';
import { initializeUserIndexes, withAccountLock } from './account-storage';
import { User } from './auth.schema';

describe('Account lock cleanup and startup readiness', () => {
  const ready = [{key:{_id:1}}, {key:{email:1},unique:true}];
  let record: { _id:string; owner:string; createdAt:Date } | undefined;
  let indexes: any[];
  let model: Model<User>;
  const insertOne = jest.fn(), deleteOne = jest.fn(), dropIndex = jest.fn(), createIndex = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();record=undefined;indexes=[...ready];
    insertOne.mockImplementation(async doc=>{if(record)throw Object.assign(new Error('duplicate'),{code:11000});record=doc;});
    deleteOne.mockImplementation(async filter=>{if(record?.owner===filter.owner)record=undefined;});
    dropIndex.mockImplementation(async name=>{indexes=indexes.filter(index=>index.name!==name);});
    createIndex.mockResolvedValue('email_1');
    model={init:jest.fn().mockResolvedValue(undefined),db:{collection:()=>({insertOne,deleteOne})},collection:{indexes:async()=>indexes,dropIndex,createIndex}} as unknown as Model<User>;
  });
  it('starts repeatedly after initialization without taking an account write lock',async()=>{
    await initializeUserIndexes(model);await initializeUserIndexes(model);
    expect(insertOne).not.toHaveBeenCalled();expect(dropIndex).not.toHaveBeenCalled();expect(createIndex).not.toHaveBeenCalled();
  });
  it('preserves an active or legacy abandoned lock when indexes are already ready',async()=>{
    const existing={_id:'accounts',owner:'unknown-legacy-owner',createdAt:new Date(0)};record=existing;
    await initializeUserIndexes(model);
    expect(record).toBe(existing);expect(insertOne).not.toHaveBeenCalled();expect(deleteOne).not.toHaveBeenCalled();
    await expect(withAccountLock(model,async()=>{})).rejects.toBeInstanceOf(ConflictException);
    expect(record).toBe(existing);
  });
  it('releases only its own lock after success',async()=>{
    await expect(withAccountLock(model,async()=>{expect(record).toBeDefined();return 42;})).resolves.toBe(42);
    expect(record).toBeUndefined();expect(deleteOne).toHaveBeenCalledTimes(1);
    expect(deleteOne.mock.calls[0][0].owner).toBe(insertOne.mock.calls[0][0].owner);
  });
  it('releases the lock after failure and allows a subsequent operation',async()=>{
    await expect(withAccountLock(model,async()=>{throw new Error('operation failed');})).rejects.toThrow('operation failed');
    expect(record).toBeUndefined();await expect(withAccountLock(model,async()=>42)).resolves.toBe(42);
  });
  it('rejects a simultaneous writer without releasing the active writer lock',async()=>{
    let finish!:()=>void;
    const first=withAccountLock(model,()=>new Promise<void>(resolve=>{finish=resolve;}));
    await Promise.resolve();await Promise.resolve();
    const owner=record?.owner;
    await expect(withAccountLock(model,async()=>{})).rejects.toBeInstanceOf(ConflictException);
    expect(record?.owner).toBe(owner);expect(deleteOne).not.toHaveBeenCalled();
    finish();await first;expect(record).toBeUndefined();
  });
  it('performs an actual legacy index migration under the write lock',async()=>{
    indexes.push({name:'role_1',key:{role:1},unique:true});
    await initializeUserIndexes(model);
    expect(insertOne).toHaveBeenCalledTimes(1);expect(dropIndex).toHaveBeenCalledWith('role_1');expect(record).toBeUndefined();
    await initializeUserIndexes(model);expect(insertOne).toHaveBeenCalledTimes(1);
  });
  it('waits for a concurrent initializer and accepts its completed indexes without stealing its lock',async()=>{
    indexes.push({name:'role_1',key:{role:1},unique:true});
    const existing={_id:'accounts',owner:'active-initializer',createdAt:new Date()};record=existing;
    let attempted!:()=>void;const blocked=new Promise<void>(resolve=>{attempted=resolve;});
    insertOne.mockImplementationOnce(async()=>{attempted();throw Object.assign(new Error('duplicate'),{code:11000});});
    const initialization=initializeUserIndexes(model);
    await blocked;indexes=[...ready];
    await initialization;expect(record).toBe(existing);expect(insertOne).toHaveBeenCalledTimes(1);expect(deleteOne).not.toHaveBeenCalled();
  });
  it('fails clearly for incomplete indexes with an unverified owner and never expires its lock',async()=>{
    indexes.push({name:'role_1',key:{role:1},unique:true});
    const existing={_id:'accounts',owner:'legacy-owner',createdAt:new Date(0)};record=existing;
    let now=0;const time=jest.spyOn(Date,'now').mockImplementation(()=>{now+=6000;return now;});
    try{await expect(initializeUserIndexes(model)).rejects.toThrow('User index initialization is incomplete');}
    finally{time.mockRestore();}
    expect(record).toBe(existing);expect(deleteOne).not.toHaveBeenCalled();
  });
});
