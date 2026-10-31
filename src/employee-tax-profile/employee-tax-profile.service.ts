import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Schema } from 'mongoose';
import { Employee } from '../employees/schemas/employee.schema';
import { tenantContext } from '../organizations/tenant-context';
import { businessModel } from '../organizations/business-models.module';
import {
  TaxConfigurationService,
  taxOrganization,
} from '../tax-configuration/tax-configuration.service';
import type { TaxYear } from '../income-tax/tax.types';
import { TaxWriteLock } from '../tax-configuration/tax-write-lock.service';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ProfileSchema = new Schema(
  {
    organizationId: { type: String, required: true },
    employeeId: { type: String, required: true },
    yearCode: { type: String, required: true },
    version: { type: Number, required: true },
    regime: { type: String, enum: ['old', 'new'], required: true },
    tdsApplicable: { type: Boolean, required: true },
    resident: Boolean,
    salaryOnly: Boolean,
    panOperative: Boolean,
    fullYearEmployment: Boolean,
    exemptionConditionsConfirmed: Boolean,
    reason: String,
    audit: [Schema.Types.Mixed],
  },
  { collection: 'employee_tax_profiles', timestamps: true },
);
ProfileSchema.index(
  { organizationId: 1, employeeId: 1, yearCode: 1 },
  { unique: true },
);

@Injectable()
export class EmployeeTaxProfileService {
  private readonly workflowSecret =
    process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Employee.name) private readonly employees: Model<Employee>,
    private readonly configuration: TaxConfigurationService,
    private readonly lock: TaxWriteLock,
  ) {}
  private model() {
    return businessModel(
      this.connection,
      'EmployeeTaxProfile',
      ProfileSchema,
      tenantContext.getStore()?.organizationId,
    );
  }
  async employee(id: string) {
    if (!/^[a-f\d]{24}$/i.test(id))
      throw new BadRequestException('Invalid employee ID.');
    const employee = await this.employees.findById(id).lean().exec();
    if (!employee)
      throw new NotFoundException('Employee not found in this organization.');
    return employee;
  }
  async get(id: string, yearCode: string) {
    await this.employee(id);
    return this.model()
      .findOne({ organizationId: taxOrganization(), employeeId: id, yearCode })
      .lean()
      .exec();
  }
  async list(id: string) {
    await this.employee(id);
    return this.model()
      .find({ organizationId: taxOrganization(), employeeId: id })
      .select('yearCode regime version updatedAt')
      .sort({ updatedAt: -1, _id: -1 })
      .lean()
      .exec();
  }
  regimeSelection(state: any, yearCode: string, previous?: any) {
    const configured = ['old', 'new'].filter((regime) =>
      state.revisions.some(
        (r: any) =>
          r.id === state.published[`${yearCode}:${regime}`] &&
          r.yearCode === yearCode &&
          r.regime === regime,
      ),
    );
    if (!state.years.some((y: TaxYear) => y.code === yearCode))
      return {
        regime: null,
        message: 'Financial year not found.',
        availableRegimes: configured,
      };
    if (previous)
      return configured.includes(previous.regime)
        ? { regime: previous.regime, message: '', availableRegimes: configured }
        : {
            regime: null,
            message:
              'The saved tax regime has no published configuration for this financial year. Review Tax Configuration before saving.',
            availableRegimes: configured,
          };
    if (configured.length === 1)
      return {
        regime: configured[0],
        message: '',
        availableRegimes: configured,
      };
    return {
      regime: null,
      availableRegimes: configured,
      message: configured.length
        ? 'Both tax regimes are configured. A new profile requires a single published regime for this financial year.'
        : 'Publish a valid Tax Configuration for this financial year before saving the profile.',
    };
  }
  private token(payload: object) {
    const value = Buffer.from(
      JSON.stringify({ ...payload, expires: Date.now() + 10 * 60 * 1000 }),
    ).toString('base64url');
    return (
      value +
      '.' +
      createHmac('sha256', this.workflowSecret)
        .update(value)
        .digest('base64url')
    );
  }
  private verifyToken(value: unknown, expected: Record<string, unknown>) {
    if (typeof value !== 'string' || value.length > 4000)
      throw new ConflictException(
        'Click Edit before updating the saved tax profile.',
      );
    const [payload, signature, ...extra] = value.split('.');
    const expectedSignature = createHmac('sha256', this.workflowSecret)
      .update(payload ?? '')
      .digest();
    const supplied = Buffer.from(signature ?? '', 'base64url');
    if (
      extra.length ||
      supplied.length !== expectedSignature.length ||
      !timingSafeEqual(supplied, expectedSignature)
    )
      throw new ConflictException(
        'The profile edit session is invalid. Click Edit again.',
      );
    let decoded: any;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new ConflictException(
        'The profile edit session is invalid. Click Edit again.',
      );
    }
    if (
      !Number.isFinite(decoded.expires) ||
      decoded.expires < Date.now() ||
      Object.entries(expected).some(([key, v]) => decoded[key] !== v)
    )
      throw new ConflictException(
        'The profile edit session expired or changed. Reload and click Edit again.',
      );
    return decoded;
  }
  async beginEdit(
    id: string,
    yearCode: string,
    version: unknown,
    actor: string,
  ) {
    return this.lock.run(async () => {
      const previous: any = await this.get(id, yearCode);
      if (!previous || previous.version !== version)
        throw new ConflictException('Tax profile changed. Reload and retry.');
      return {
        editToken: this.token({
          kind: 'edit',
          organizationId: taxOrganization(),
          employeeId: id,
          yearCode,
          version: previous.version,
          actor,
        }),
      };
    });
  }
  async changeYear(id: string, target: string, body: any, actor: string) {
    return this.lock.run(async () => {
      if (
        typeof body?.fromYearCode !== 'string' ||
        !Number.isSafeInteger(body?.fromVersion) ||
        body.fromVersion < 1
      )
        throw new BadRequestException(
          'Select the saved source financial year and profile version.',
        );
      const previous: any = await this.get(id, body?.fromYearCode);
      if (
        !previous ||
        previous.version !== body?.fromVersion ||
        target === body?.fromYearCode
      )
        throw new ConflictException(
          'Select another financial year from the saved profile.',
        );
      const state = await this.configuration.get(),
        existing = await this.get(id, target);
      const selection = this.regimeSelection(state, target, existing);
      if (!selection.regime) throw new BadRequestException(selection.message);
      return {
        yearCode: target,
        changeYearToken: this.token({
          kind: 'change-year',
          organizationId: taxOrganization(),
          employeeId: id,
          yearCode: target,
          version: 0,
          fromYearCode: body.fromYearCode,
          fromVersion: previous.version,
          actor,
        }),
      };
    });
  }
  async saveFromEditor(id: string, yearCode: string, body: any, actor: string) {
    return this.lock.run(async () => {
      if (body?.yearCode !== undefined && body.yearCode !== yearCode)
        throw new BadRequestException(
          'Financial year is locked. Use Change Financial Year.',
        );
      const previous: any = await this.get(id, yearCode);
      const expected = {
        organizationId: taxOrganization(),
        employeeId: id,
        yearCode,
        actor,
      };
      if (previous)
        this.verifyToken(body?.editToken, {
          ...expected,
          kind: 'edit',
          version: previous.version,
        });
      else if ((await this.list(id)).length) {
        const permission = this.verifyToken(body?.changeYearToken, {
          ...expected,
          kind: 'change-year',
          version: 0,
        });
        const source: any = await this.get(id, permission.fromYearCode);
        if (!source || source.version !== permission.fromVersion)
          throw new ConflictException(
            'The source tax profile changed. Start Change Financial Year again.',
          );
      }
      return this.saveLocked(id, yearCode, body, actor);
    });
  }
  async save(id: string, yearCode: string, body: any, actor: string) {
    return this.lock.run(() => this.saveLocked(id, yearCode, body, actor));
  }
  private async saveLocked(
    id: string,
    yearCode: string,
    body: any,
    actor: string,
  ) {
    await this.employee(id);
    const state = await this.configuration.get();
    if (!state.years.some((y: TaxYear) => y.code === yearCode))
      throw new BadRequestException('Financial year not found.');
    const previous: any = await this.get(id, yearCode);
    const selection = this.regimeSelection(state, yearCode, previous);
    if (!selection.regime) throw new BadRequestException(selection.message);
    if (body?.regime !== undefined && body.regime !== selection.regime)
      throw new BadRequestException(
        'Tax regime is derived from Tax Configuration and cannot be changed manually.',
      );
    if (typeof body?.tdsApplicable !== 'boolean')
      throw new BadRequestException(
        'Select a tax regime and TDS applicability.',
      );
    const fields = [
      'resident',
      'salaryOnly',
      'panOperative',
      'fullYearEmployment',
      'exemptionConditionsConfirmed',
    ];
    if (fields.some((f) => typeof body[f] !== 'boolean'))
      throw new BadRequestException(
        'Complete all tax eligibility confirmations.',
      );
    if (
      !body.tdsApplicable &&
      (typeof body.reason !== 'string' || !body.reason.trim())
    )
      throw new BadRequestException(
        'A reason is required when TDS is disabled.',
      );
    const model = this.model();
    await model.createIndexes();
    if (
      !Number.isSafeInteger(body.version) ||
      body.version !== (previous?.version ?? 0)
    )
      throw new ConflictException('Tax profile changed. Reload and retry.');
    const values = {
      regime: selection.regime,
      tdsApplicable: body.tdsApplicable,
      ...Object.fromEntries(fields.map((f) => [f, body[f]])),
      reason: String(body.reason ?? '').slice(0, 1000),
    };
    const audit = [
      ...(previous?.audit ?? []),
      {
        ...values,
        version: body.version + 1,
        actor,
        at: new Date().toISOString(),
      },
    ];
    if (audit.length > 1000)
      throw new BadRequestException('Profile history limit reached.');
    try {
      if (!previous)
        await model.create({
          organizationId: taxOrganization(),
          employeeId: id,
          yearCode,
          ...values,
          version: 1,
          audit,
        });
      else {
        const result = await model.updateOne(
          { _id: previous._id, version: body.version },
          { $set: { ...values, audit }, $inc: { version: 1 } },
        );
        if (!result.modifiedCount)
          throw new ConflictException('Tax profile changed. Reload and retry.');
      }
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new ConflictException('Tax profile changed. Reload and retry.');
      throw e;
    }
    return this.get(id, yearCode);
  }
}
