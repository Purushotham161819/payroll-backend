import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Error as MongooseError } from 'mongoose';
import { Employee } from './schemas/employee.schema';
import { CreateEmployeeDto } from './dto/create-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(@InjectModel(Employee.name) private readonly employees: Model<Employee>) {}

  async create(dto: CreateEmployeeDto) {
    try {
      return await this.employees.create(dto);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('An employee with this email address already exists.');
      }
      if (error instanceof MongooseError.ValidationError) {
        throw new BadRequestException('Employee data is invalid');
      }
      throw new ServiceUnavailableException('Unable to save employee. Please try again later.');
    }
  }

  async findAll() {
    try {
      return await this.employees.find().exec();
    } catch {
      throw new ServiceUnavailableException('Unable to retrieve employees. Please try again later.');
    }
  }
}
