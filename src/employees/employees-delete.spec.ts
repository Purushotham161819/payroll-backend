import { EmployeeIdentifierService } from './employee-identifier.service';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { Employee } from './schemas/employee.schema';
const id = '507f1f77bcf86cd799439011',
  other = '507f1f77bcf86cd799439012';
describe('Employee DELETE HTTP contract', () => {
  let app: INestApplication, records: any[];
  const remove = jest.fn((key: string) => ({
    exec: async () => {
      const index = records.findIndex((r) => r._id === key.toLowerCase());
      return index < 0 ? null : records.splice(index, 1)[0];
    },
  }));
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeesController],
      providers: [
        EmployeesService,
        {
          provide: EmployeeIdentifierService,
          useValue: { nextId: async () => 'EMP001' },
        },
        {
          provide: getModelToken(Employee.name),
          useValue: {
            findByIdAndDelete: remove,
            find: () => ({ exec: async () => records }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    records = [
      { _id: id, firstName: 'Delete', lastName: 'Target' },
      { _id: other, firstName: 'Keep', lastName: 'Employee' },
    ];
    remove.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  it('deletes exactly the requested document and refreshes the existing list API without cascading', async () => {
    const result = await request(app.getHttpServer())
      .delete('/employees/' + id)
      .expect(200);
    expect(result.body).toEqual({
      message: 'Employee deleted successfully.',
      deletedId: id,
    });
    expect(remove).toHaveBeenCalledWith(id);
    expect(
      (await request(app.getHttpServer()).get('/employees').expect(200)).body,
    ).toEqual([{ _id: other, firstName: 'Keep', lastName: 'Employee' }]);
    await request(app.getHttpServer())
      .delete('/employees/' + id)
      .expect(404);
    expect(records).toHaveLength(1);
  });
  it('rejects invalid IDs without accessing the database', async () => {
    const result = await request(app.getHttpServer())
      .delete('/employees/not-an-id')
      .expect(400);
    expect(result.body.message).toBe('Invalid employee ID.');
    expect(remove).not.toHaveBeenCalled();
  });
  it('returns 404 for a valid but missing ID', async () => {
    await request(app.getHttpServer())
      .delete('/employees/507f1f77bcf86cd799439099')
      .expect(404);
    expect(records).toHaveLength(2);
  });
  it('sanitizes database failures and preserves existing records', async () => {
    remove.mockImplementationOnce(() => ({
      exec: async () => {
        throw new Error('private database credentials');
      },
    }));
    const result = await request(app.getHttpServer())
      .delete('/employees/' + id)
      .expect(503);
    expect(result.body.message).toBe(
      'Unable to delete employee. Please try again later.',
    );
    expect(records).toHaveLength(2);
  });
});
