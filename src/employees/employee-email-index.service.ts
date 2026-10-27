import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { isEmail } from 'class-validator';
import { Employee } from './schemas/employee.schema';

@Injectable()
export class EmployeeEmailIndexService implements OnModuleInit {
  private readonly logger = new Logger(EmployeeEmailIndexService.name);

  constructor(@InjectModel(Employee.name) private readonly employees: Model<Employee>) {}

  async onModuleInit() {
    // Audit raw stored values: hydration could conceal unnormalized legacy emails.
    const records = await this.employees.collection.find({}, { projection: { email: 1 } }).toArray();
    const seen = new Set<string>();
    const conflicts: string[] = [];
    const missing: string[] = [];
    for (const record of records) {
      if (typeof record.email !== 'string' || !record.email.trim()) {
        missing.push(String(record._id));
        continue;
      }
      const normalized = record.email.trim().toLowerCase();
      if (!isEmail(normalized) || record.email !== normalized || seen.has(normalized)) {
        conflicts.push(String(record._id));
      }
      seen.add(normalized);
    }
    if (missing.length) {
      this.logger.warn(`Existing employees need email addresses; records were not changed: ${missing.join(', ')}`);
    }
    if (conflicts.length || missing.length > 1) {
      throw new Error(`Employee email index blocked. Resolve missing, invalid, unnormalized or duplicate emails manually. Record IDs: ${[...missing, ...conflicts].join(', ')}`);
    }
    // Never drop existing indexes or modify employee records.
    await this.employees.collection.createIndex({ email: 1 }, { unique: true, name: 'email_1' });
    const indexes = await this.employees.collection.indexes();
    if (!indexes.some(index => index.unique === true && index.key.email === 1 && Object.keys(index.key).length === 1 && !index.sparse && !index.partialFilterExpression)) {
      throw new Error('Employee email unique index could not be verified');
    }
    this.logger.log('Employee email unique index verified');
  }
}
