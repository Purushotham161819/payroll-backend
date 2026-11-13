import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { mergeMap } from 'rxjs';
import { PrivateModeService, PrivateRequest } from './private-mode.service';

const profileFields = [
  '_id',
  'employeeId',
  'email',
  'firstName',
  'lastName',
  'contactNumber',
  'designation',
  'dateOfBirth',
  'hireDate',
  'payFrequency',
  'status',
  'employmentHistory',
  'rehireDate',
  'lifecycleVersion',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'country',
  'createdAt',
  'updatedAt',
];
const checkFields = [
  'employeeId',
  'employeeCode',
  'firstName',
  'lastName',
  'period',
  'paymentDate',
  'submittedAt',
  'paymentStatus',
  'payrollStatus',
  'submissionId',
];
const paycheckAmountFields = ['grossPay', 'employerContributions', 'deductions', 'netPay', 'tds'];
const pick = (data: any, fields: string[]) =>
  Object.fromEntries(
    fields
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
@Injectable()
export class PrivateModeInterceptor implements NestInterceptor {
  constructor(private readonly privacy: PrivateModeService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<PrivateRequest>();
    if (req.account?.role !== 'employee' || req.method !== 'GET')
      return next.handle();
    const profile = req.path === '/employee-portal/profile';
    const checks =
      req.path ===
      `/payroll/employees/${(req.account as any).employeeRecordId}/checks`;
    if (!profile && !checks) return next.handle();
    return next.handle().pipe(
      mergeMap(async (data: any) => {
        const until = await this.privacy.authorization(req);
        if (until)
          return profile
            ? { ...pick(data, [...profileFields, 'annualCtc']), privateMode: false, sensitiveAccessExpiresAt: until }
            : data.map((check: any) => pick(check, [...checkFields, ...paycheckAmountFields]));
        if (profile)
          return {
            ...pick(data, profileFields),
            annualCtc: null,
            privateMode: true,
            sensitiveAccessExpiresAt: null,
          };
        return data.map((check: any) => ({
          ...pick(check, checkFields),
          grossPay: null,
          employerContributions: null,
          deductions: null,
          netPay: null,
          tds: null,
          privateMode: true,
        }));
      }),
    );
  }
}
