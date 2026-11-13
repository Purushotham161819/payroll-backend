import { UnauthorizedException } from '@nestjs/common';
import { Connection } from 'mongoose';
import { User } from './auth.schema';
import { businessModel } from '../organizations/business-models.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';

// Resolve from persisted account fields, never from request parameters or tenant headers.
export async function linkedEmployee(connection: Connection, user: User) {
  if (
    user.role !== 'employee' ||
    !/^ORG\d{6,}$/.test(user.organizationId ?? '') ||
    !/^[a-f\d]{24}$/i.test(user.employeeRecordId ?? '')
  )
    throw new UnauthorizedException(
      'Employee access is unavailable. Contact your administrator.',
    );
  const employee = await businessModel(
    connection,
    Employee.name,
    EmployeeSchema,
    user.organizationId,
  )
    .findById(user.employeeRecordId)
    .lean()
    .exec();
  if (
    !employee ||
    (employee.status ?? 'Active') !== 'Active' ||
    (employee.lifecycleVersion ?? 0) !== user.employeeLifecycleVersion ||
    employee.email?.trim().toLowerCase() !== user.email
  )
    throw new UnauthorizedException(
      'Employee access is unavailable. Contact your administrator.',
    );
  return employee;
}

export function employeeRequestAllowed(
  method: string,
  path: string,
  employeeId: string,
) {
  if (path === '/employee-portal/private-mode') return method === 'GET';
  if (['/employee-portal/private-mode/request', '/employee-portal/private-mode/verify', '/employee-portal/private-mode/lock'].includes(path)) return method === 'POST';
  if (method !== 'GET') return false;
  return (
    path === '/employee-portal/profile' ||
    path === '/settings/organization' ||
    path === `/payroll/employees/${employeeId}/checks` ||
    new RegExp(`^/payroll/runs/\\d{4}-\\d{2}/checks/${employeeId}/pdf$`).test(
      path,
    )
  );
}
