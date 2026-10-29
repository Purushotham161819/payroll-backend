import { EmployeeIdentifierService } from './employee-identifier.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { Employee } from './schemas/employee.schema';

// HTTP contract checks only: the model is replaced, so nothing is inserted.
describe('Employee POST HTTP contract without database writes', () => {
  let app: INestApplication;
  const create = jest.fn();
  const body = {
    firstName: 'Request',
    lastName: 'Validation',
    email: '  Request@Example.com  ',
    dateOfBirth: '1995-04-15',
    hireDate: '2026-01-01',
    annualCtc: 0,
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EmployeesController],
      providers: [
        EmployeesService,
        {
          provide: EmployeeIdentifierService,
          useValue: { nextId: async () => 'EMP001' },
        },
        { provide: getModelToken(Employee.name), useValue: { create } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => create.mockReset());
  afterAll(async () => {
    await app.close();
  });

  it('returns 201 after the model resolves and passes normalized email', async () => {
    create.mockResolvedValueOnce({ email: 'request@example.com' });
    await request(app.getHttpServer())
      .post('/employees')
      .send(body)
      .expect(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'request@example.com' }),
    );
  });

  it('returns 409 for a database duplicate-key rejection', async () => {
    create.mockRejectedValueOnce(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    const response = await request(app.getHttpServer())
      .post('/employees')
      .send(body)
      .expect(409);
    expect(response.body.message).toBe(
      'An employee with this email address already exists.',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects client-assigned employee IDs on create and update', async () => {
    await request(app.getHttpServer())
      .post('/employees')
      .send({ ...body, employeeId: 'EMP999' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/employees/507f1f77bcf86cd799439011')
      .send({ employeeId: 'EMP999' })
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('returns 400 for invalid email without calling the model', async () => {
    await request(app.getHttpServer())
      .post('/employees')
      .send({ ...body, email: 'invalid' })
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
});
