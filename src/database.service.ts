import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { Employee } from './employees/entities/employee.entity';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new MongoClient(
    process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/payroll',
    { serverSelectionTimeoutMS: 5000 },
  );

  get employees() {
    return this.client.db().collection<Employee>('employees');
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      await this.client.db().command({ ping: 1 });
    } catch (error) {
      await this.client.close();
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
