import { EmployeeIdentifierService } from './employee-identifier.service';
import { getModelToken } from '@nestjs/mongoose';
import { Employee } from './schemas/employee.schema';
import { Test } from '@nestjs/testing';
import { EmployeesService } from './employees.service';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';

describe('EmployeesService', () => {
  let service: EmployeesService;
  const executeFind = jest.fn();
  const model = {
    create: jest.fn(),
    find: jest.fn(() => ({ exec: executeFind })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        EmployeesService,
        {
          provide: EmployeeIdentifierService,
          useValue: { nextId: async () => 'EMP001' },
        },
        { provide: getModelToken(Employee.name), useValue: model },
      ],
    }).compile();
    service = module.get(EmployeesService);
  });

  it('returns an empty array when the database query finds no employees', async () => {
    executeFind.mockResolvedValueOnce([]);
    await expect(service.findAll()).resolves.toEqual([]);
    expect(model.find).toHaveBeenCalledWith();
  });

  it('returns a safe HTTP 503 exception when reading fails', async () => {
    executeFind.mockRejectedValueOnce(new Error('private connection details'));
    await expect(service.findAll()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('returns a safe HTTP 503 exception when saving fails', async () => {
    // No database connection or employee fixture is used in this unit test.
    model.create.mockRejectedValueOnce(new Error('private connection details'));
    await expect(service.create(new CreateEmployeeDto())).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('maps a database duplicate-key error to HTTP 409', async () => {
    model.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    try {
      await service.create(new CreateEmployeeDto());
      throw new Error('Expected a conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).message).toBe(
        'An employee with this email address already exists.',
      );
    }
  });
});
