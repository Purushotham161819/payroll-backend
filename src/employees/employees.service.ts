import { EmployeeIdentifierService } from './employee-identifier.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, Error as MongooseError } from 'mongoose';
import { Employee } from './schemas/employee.schema';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { DEFAULT_PAY_FREQUENCY } from './pay-frequency';
import {
  RehireEmployeeDto,
  TerminateEmployeeDto,
  TERMINATION_REASONS,
} from './dto/lifecycle.dto';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(Employee.name) private readonly employees: Model<Employee>,
    private readonly identifiers: EmployeeIdentifierService,
  ) {}

  async create(dto: CreateEmployeeDto) {
    try {
      return await this.employees.create({
        ...dto,
        employeeId: await this.identifiers.nextId(),
        payFrequency: dto.payFrequency ?? DEFAULT_PAY_FREQUENCY,
        status: 'Active',
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'An employee with this email address already exists.',
        );
      }
      if (error instanceof MongooseError.ValidationError) {
        throw new BadRequestException('Employee data is invalid');
      }
      throw new ServiceUnavailableException(
        'Unable to save employee. Please try again later.',
      );
    }
  }

  async findAll() {
    try {
      return await this.employees.find().exec();
    } catch {
      throw new ServiceUnavailableException(
        'Unable to retrieve employees. Please try again later.',
      );
    }
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid employee ID.');
    try {
      const employee = await this.employees.findByIdAndDelete(id).exec();
      if (!employee) throw new NotFoundException('Employee not found.');
      return {
        message: 'Employee deleted successfully.',
        deletedId: employee._id.toString(),
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException(
        'Unable to delete employee. Please try again later.',
      );
    }
  }

  private lifecycleDate(value: string): Date {
    const date = new Date(value);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        'Enter a valid calendar date (YYYY-MM-DD).',
      );
    }
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (value > today)
      throw new BadRequestException(
        'Future lifecycle dates are not supported. Confirm this change on its effective date.',
      );
    return date;
  }

  async terminate(id: string, dto: TerminateEmployeeDto) {
    const date = this.lifecycleDate(dto.terminationDate);
    if (!TERMINATION_REASONS.includes(dto.reason))
      throw new BadRequestException('Select a valid termination reason.');
    if (
      dto.explanation !== undefined &&
      (typeof dto.explanation !== 'string' || dto.explanation.length > 250)
    ) {
      throw new BadRequestException(
        'Explanation must be at most 250 characters.',
      );
    }
    return this.changeLifecycle(id, 'terminate', date, dto);
  }

  async rehire(id: string, dto: RehireEmployeeDto) {
    return this.changeLifecycle(
      id,
      'rehire',
      this.lifecycleDate(dto.rehireDate),
    );
  }

  private async changeLifecycle(
    id: string,
    action: 'terminate' | 'rehire',
    date: Date,
    dto?: TerminateEmployeeDto,
  ) {
    if (!/^[a-f\d]{24}$/i.test(id))
      throw new BadRequestException('Invalid employee ID.');
    try {
      const employee = await this.employees.findById(id).lean().exec();
      if (!employee) throw new NotFoundException('Employee not found.');
      const status = employee.status ?? 'Active';
      if (
        (action === 'terminate' && status !== 'Active') ||
        (action === 'rehire' && status !== 'Terminated')
      ) {
        throw new ConflictException(
          `Cannot ${action} an employee who is ${status}. Refresh the list.`,
        );
      }
      const now = new Date();
      const history = employee.employmentHistory?.length
        ? employee.employmentHistory.map((period) => ({ ...period }))
        : [
            {
              startDate: employee.hireDate,
              recordedAt: employee.createdAt ?? now,
            },
          ];
      const current = history[history.length - 1];
      if (action === 'terminate') {
        if (
          current.endDate ||
          date <
            new Date(new Date(current.startDate).toISOString().slice(0, 10))
        ) {
          throw new BadRequestException(
            'Termination date cannot precede the current employment period.',
          );
        }
        current.endDate = date;
        current.terminationReason = dto!.reason;
        current.terminatedAt = now;
        if (dto!.reason === 'Other' && dto!.explanation?.trim())
          current.explanation = dto!.explanation.trim();
      } else {
        if (!current.endDate || date <= new Date(current.endDate)) {
          throw new BadRequestException(
            'Rehire date must be after the previous termination date.',
          );
        }
        history.push({ startDate: date, recordedAt: now });
      }
      // Compare-and-swap covers legacy records without a version and concurrent lifecycle requests.
      const version = employee.lifecycleVersion;
      const updated = await this.employees
        .findOneAndUpdate(
          {
            _id: employee._id,
            lifecycleVersion:
              version === undefined ? { $exists: false } : version,
            hireDate: employee.hireDate,
          },
          {
            $set: {
              status: action === 'terminate' ? 'Terminated' : 'Active',
              employmentHistory: history,
              ...(action === 'rehire' ? { rehireDate: date } : {}),
            },
            $inc: { lifecycleVersion: 1 },
          },
          { returnDocument: 'after', runValidators: true },
        )
        .exec();
      if (!updated)
        throw new ConflictException(
          'Employee changed during this request. Refresh and try again.',
        );
      return updated;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      )
        throw error;
      throw new ServiceUnavailableException(
        'Unable to update employee lifecycle. Please try again later.',
      );
    }
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid employee ID.');
    try {
      const fields = Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      );
      const query =
        dto.hireDate !== undefined
          ? this.employees.findOneAndUpdate(
              {
                _id: id,
                $or: [
                  { hireDate: new Date(dto.hireDate) },
                  { 'employmentHistory.0': { $exists: false } },
                ],
              },
              { $set: fields },
              { returnDocument: 'after', runValidators: true },
            )
          : this.employees.findByIdAndUpdate(
              id,
              { $set: fields },
              { returnDocument: 'after', runValidators: true },
            );
      const employee = await query.exec();
      if (!employee) {
        if (
          dto.hireDate !== undefined &&
          (await this.employees.exists({ _id: id }))
        ) {
          throw new ConflictException(
            'Original hire date cannot be changed after employment history has been recorded.',
          );
        }
        throw new NotFoundException('Employee not found.');
      }
      return employee;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      )
        throw error;
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw new ConflictException(
          'An employee with this email address already exists.',
        );
      if (error instanceof MongooseError.ValidationError)
        throw new BadRequestException('Employee data is invalid');
      throw new ServiceUnavailableException(
        'Unable to save employee. Please try again later.',
      );
    }
  }
}
