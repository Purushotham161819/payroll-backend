import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Observable } from 'rxjs';
import { tenantContext } from './tenant-context';
import { businessModel } from './business-models.module';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import {
  SalaryComponent,
  SalaryComponentSchema,
} from '../salary-components/salary-component.schema';
import { EmployeeEmailIndexService } from '../employees/employee-email-index.service';
import { SalaryComponentsService } from '../salary-components/salary-components.service';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  private readonly ready = new Map<string, Promise<void>>();
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private prepare(id: string) {
    let ready = this.ready.get(id);
    if (!ready) {
      ready = (async () => {
        const employees = businessModel(
          this.connection,
          Employee.name,
          EmployeeSchema,
          id,
        );
        // Initialize only this organization's indexes and mandatory defaults.
        await new EmployeeEmailIndexService(employees).onModuleInit();
        await new SalaryComponentsService(
          businessModel(
            this.connection,
            SalaryComponent.name,
            SalaryComponentSchema,
            id,
          ),
        ).onModuleInit();
      })().catch((error) => {
        this.ready.delete(id);
        throw error;
      });
      this.ready.set(id, ready);
    }
    return ready;
  }
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest().account;
    return new Observable((subscriber) => {
      let subscription: { unsubscribe(): void } | undefined;
      tenantContext.run({ organizationId: user?.organizationId }, () => {
        const path = context.switchToHttp().getRequest().path as string;
        const business = [
          '/employees',
          '/salary-components',
          '/payroll/',
          '/settings/statutory-deductions',
        ].some((prefix) => path.startsWith(prefix));
        const ready =
          user?.organizationId && business
            ? this.prepare(user.organizationId)
            : Promise.resolve();
        void ready.then(
          () => {
            if (!subscriber.closed)
              subscription = next.handle().subscribe(subscriber);
          },
          (error) => subscriber.error(error),
        );
      });
      return () => subscription?.unsubscribe();
    });
  }
}
