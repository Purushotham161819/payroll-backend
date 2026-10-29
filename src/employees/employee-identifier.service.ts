import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Employee } from './schemas/employee.schema';
@Injectable()
export class EmployeeIdentifierService implements OnModuleInit {
  private ready?: Promise<void>;
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<Employee>,
  ) {}
  onModuleInit() {
    return this.initialize();
  }
  initialize() {
    return (this.ready ??= this.prepare());
  }
  private get counter() {
    return this.employees.db.collection<{ _id: string; value: number }>(
      'employee_counters',
    );
  }
  private async reserve(): Promise<string> {
    const counter = await this.counter.findOneAndUpdate(
      { _id: 'employee', value: { $lt: Number.MAX_SAFE_INTEGER } },
      { $inc: { value: 1 } },
      { returnDocument: 'after' },
    );
    if (!counter || !Number.isSafeInteger(counter.value) || counter.value < 1)
      throw new Error('Employee ID counter is exhausted or invalid.');
    return 'EMP' + String(counter.value).padStart(3, '0');
  }
  async nextId() {
    await this.initialize();
    return this.reserve();
  }
  private async prepare() {
    const records = await this.employees.collection
      .find({}, { projection: { employeeId: 1, createdAt: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const used = new Set<string>();
    let maximum = 0;
    for (const record of records) {
      if (
        record.employeeId === undefined ||
        record.employeeId === null ||
        record.employeeId === ''
      )
        continue;
      const value = record.employeeId;
      const sequence =
        typeof value === 'string' && /^EMP\d{3,}$/.test(value)
          ? Number(value.slice(3))
          : NaN;
      if (
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        value !== 'EMP' + String(sequence).padStart(3, '0') ||
        used.has(value)
      )
        throw new Error(
          'Employee ID migration blocked by invalid or duplicate existing employee IDs. No IDs were reassigned.',
        );
      used.add(value);
      maximum = Math.max(maximum, sequence);
    }
    await this.employees.collection.createIndex(
      { employeeId: 1 },
      {
        unique: true,
        name: 'employeeId_unique',
        partialFilterExpression: { employeeId: { $type: 'string', $gt: '' } },
      },
    );
    try {
      await this.counter.updateOne(
        { _id: 'employee' },
        { $max: { value: maximum } },
        { upsert: true },
      );
    } catch (error) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ))
        throw error;
      await this.counter.updateOne(
        { _id: 'employee' },
        { $max: { value: maximum } },
      );
    }
    for (const record of records) {
      if (
        record.employeeId !== undefined &&
        record.employeeId !== null &&
        record.employeeId !== ''
      )
        continue;
      const employeeId = await this.reserve();
      // A conditional raw update preserves concurrent assignments and original timestamps.
      await this.employees.collection.updateOne(
        {
          _id: record._id,
          $or: [
            { employeeId: { $exists: false } },
            { employeeId: null },
            { employeeId: '' },
          ],
        },
        { $set: { employeeId } },
      );
    }
  }
}
