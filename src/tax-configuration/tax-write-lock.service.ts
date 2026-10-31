import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { tenantContext } from '../organizations/tenant-context';

// No time-based expiry: a slow submission must never outlive its lock and race
// a rule/profile update. A process crash deliberately requires operator review.
@Injectable()
export class TaxWriteLock {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    const organizationId = tenantContext.getStore()?.organizationId ?? 'legacy';
    const collection = this.connection.collection('tax_operation_locks');
    const owner = randomUUID();
    const key = `tax:${organizationId}`;
    for (let attempt = 0; ; attempt++) {
      try {
        await collection.insertOne({
          _id: key as any,
          owner,
          acquiredAt: new Date(),
          processId: process.pid,
        });
        break;
      } catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        if (attempt >= 100)
          throw new ConflictException(
            'Another tax configuration or payroll submission operation is running. Retry shortly; persistent locks require operator review.',
          );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await work();
    } finally {
      await collection.deleteOne({ _id: key as any, owner });
    }
  }
}
