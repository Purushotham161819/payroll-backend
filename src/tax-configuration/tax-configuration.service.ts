import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { businessModel } from '../organizations/business-models.module';
import { tenantContext } from '../organizations/tenant-context';
import { validateRules } from '../income-tax/tax-engine';
import type { TaxRevision, TaxYear } from '../income-tax/tax.types';
import { TaxWriteLock } from './tax-write-lock.service';
import { SalaryComponentsService } from '../salary-components/salary-components.service';

const RegistrySchema = new Schema(
  {
    organizationId: { type: String, required: true, unique: true },
    version: { type: Number, required: true },
    years: { type: [Schema.Types.Mixed], default: [] },
    revisions: { type: [Schema.Types.Mixed], default: [] },
    published: { type: Schema.Types.Mixed, default: {} },
    audit: { type: [Schema.Types.Mixed], default: [] },
  },
  { collection: 'tax_configuration_registry', timestamps: true },
);

export function taxOrganization() {
  return tenantContext.getStore()?.organizationId ?? 'legacy';
}
export function dateOnly(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(new Date(value).getTime()) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Use a valid ISO date (YYYY-MM-DD).');
  return value;
}
@Injectable()
export class TaxConfigurationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly lock: TaxWriteLock,
    private readonly components: SalaryComponentsService,
  ) {}
  private model() {
    return businessModel(
      this.connection,
      'TaxConfigurationRegistry',
      RegistrySchema,
      tenantContext.getStore()?.organizationId,
    );
  }
  async get(): Promise<any> {
    const saved = await this.model()
      .findOne({ organizationId: taxOrganization() })
      .lean()
      .exec();
    return saved
      ? {
          ...saved,
          published: saved.published ?? {},
          years: saved.years ?? [],
          revisions: saved.revisions ?? [],
          audit: saved.audit ?? [],
        }
      : {
          organizationId: taxOrganization(),
          version: 0,
          years: [],
          revisions: [],
          published: {},
          audit: [],
        };
  }
  private async write(
    state: any,
    changes: Record<string, unknown>,
    actor: string,
    action: string,
  ) {
    return this.lock.run(() => this.writeLocked(state, changes, actor, action));
  }
  private async writeLocked(
    state: any,
    changes: Record<string, unknown>,
    actor: string,
    action: string,
  ) {
    const model = this.model();
    await model.createIndexes();
    if (
      Buffer.byteLength(JSON.stringify({ ...state, ...changes })) >
      8 * 1024 * 1024
    )
      throw new BadRequestException(
        'Tax registry storage limit reached; archive support is required.',
      );
    const update = {
      ...changes,
      version: state.version + 1,
      audit: [...state.audit, { actor, action, at: new Date().toISOString() }],
    };
    try {
      if (!state.version) {
        await model.create({ organizationId: taxOrganization(), ...update });
      } else {
        const result = await model.updateOne(
          { organizationId: taxOrganization(), version: state.version },
          { $set: update },
        );
        if (!result.modifiedCount)
          throw new ConflictException(
            'Tax configuration changed. Reload and retry.',
          );
      }
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new ConflictException(
          'Tax configuration changed. Reload and retry.',
        );
      throw e;
    }
    return this.get();
  }
  private version(state: any, value: unknown) {
    if (!Number.isSafeInteger(value) || value !== state.version)
      throw new ConflictException(
        'Reload the current tax configuration version.',
      );
  }
  async saveYear(body: any, actor: string) {
    const state = await this.get();
    this.version(state, body?.version);
    const submittedYear: TaxYear = body?.year;
    const year = submittedYear && {
      ...submittedYear,
      code:
        typeof submittedYear.code === 'string'
          ? submittedYear.code.trim()
          : submittedYear.code,
    };
    if (body.createOnly !== undefined && typeof body.createOnly !== 'boolean')
      throw new BadRequestException('Create-only must be a boolean.');
    if (
      !year ||
      typeof year.code !== 'string' ||
      !/^[A-Za-z0-9 _-]{3,30}$/.test(year.code)
    )
      throw new BadRequestException(
        'Financial year code must contain 3–30 letters, numbers, spaces, hyphens or underscores.',
      );
    if (
      typeof year.name !== 'string' ||
      !year.name.trim() ||
      year.name.length > 100 ||
      typeof year.legislation !== 'string' ||
      !year.legislation.trim() ||
      year.legislation.length > 500 ||
      typeof year.ruleVersion !== 'string' ||
      !year.ruleVersion.trim() ||
      year.ruleVersion.length > 100
    )
      throw new BadRequestException(
        'Year code, name, legislation and rule version are required.',
      );
    dateOnly(year.startDate);
    dateOnly(year.endDate);
    if (year.startDate >= year.endDate)
      throw new BadRequestException(
        'Financial year start must precede its end.',
      );
    // Version 1 supports a complete twelve-month calendar, not partial years.
    const start = new Date(year.startDate + 'T00:00:00Z');
    const expectedEnd = new Date(
      Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0),
    )
      .toISOString()
      .slice(0, 10);
    if (start.getUTCDate() !== 1 || year.endDate !== expectedEnd)
      throw new BadRequestException(
        'Version 1 requires twelve complete calendar months.',
      );
    const existing = state.years.find((y: TaxYear) => y.code === year.code);
    if (existing && body.createOnly)
      throw new ConflictException(
        'A financial year with this code already exists.',
      );
    if (
      existing &&
      state.revisions.some((r: TaxRevision) => r.yearCode === year.code)
    )
      throw new ConflictException(
        'A year with configuration history is immutable.',
      );
    if (
      state.years.some(
        (y: TaxYear) =>
          y.code !== year.code &&
          y.startDate <= year.endDate &&
          y.endDate >= year.startDate,
      )
    )
      throw new BadRequestException('Financial years cannot overlap.');
    const record = {
      code: year.code,
      name: year.name.trim(),
      startDate: year.startDate,
      endDate: year.endDate,
      legislation: year.legislation.trim(),
      ruleVersion: year.ruleVersion.trim(),
      active: existing?.active ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: existing?.createdBy ?? actor,
      updatedBy: actor,
    };
    return this.write(
      state,
      {
        years: [
          ...state.years.filter((y: TaxYear) => y.code !== year.code),
          record,
        ],
      },
      actor,
      `save-year:${year.code}`,
    );
  }
  async activateYear(code: string, body: any, actor: string) {
    const state = await this.get();
    this.version(state, body?.version);
    if (typeof body?.active !== 'boolean')
      throw new BadRequestException('Active must be a boolean.');
    if (!state.years.some((y: TaxYear) => y.code === code))
      throw new NotFoundException('Financial year not found.');
    return this.write(
      state,
      {
        years: state.years.map((y: TaxYear) => ({
          ...y,
          active:
            y.code === code ? body.active : body.active ? false : y.active,
        })),
      },
      actor,
      `year-status:${code}:${body.active}`,
    );
  }
  async saveRevision(body: any, actor: string) {
    const state = await this.get();
    this.version(state, body?.version);
    const year = state.years.find((y: TaxYear) => y.code === body.yearCode);
    if (!year || !['old', 'new'].includes(body.regime))
      throw new BadRequestException(
        'Select an existing financial year and regime.',
      );
    dateOnly(body.effectiveDate);
    if (body.effectiveDate !== year.startDate)
      throw new BadRequestException(
        'Version 1 supports full-year rules effective on the year start only.',
      );
    const components = await this.components.findAll();
    const taxable = components.filter(
      (c) => c.status === 'active' && c.category !== 'deduction',
    );
    if (Array.isArray(body.rules?.mappings)) {
      for (const mapping of body.rules.mappings) {
        const component = taxable.find(
          (c) => c._id.toString() === mapping?.componentId,
        );
        if (!component) continue;
        if (
          !['taxable', 'exempt', 'partial', 'conditional'].includes(
            mapping.type,
          )
        )
          throw new BadRequestException(
            `Select a reviewed taxability treatment for ${component.name}.`,
          );
        if (
          typeof mapping.legalReference !== 'string' ||
          !mapping.legalReference.trim()
        )
          throw new BadRequestException(
            `Legal reference is required for ${component.name}.`,
          );
      }
    }
    const rules = validateRules(body.rules);
    if (
      rules.mappings.some(
        (m) => !taxable.some((c) => c._id.toString() === m.componentId),
      ) ||
      taxable.some(
        (c) => !rules.mappings.some((m) => m.componentId === c._id.toString()),
      )
    )
      throw new BadRequestException(
        'Map every active earning/allowance component from this organization exactly once. Payroll deduction components cannot be mapped.',
      );
    // Snapshot canonical product names from tenant-owned records, never from
    // client labels. Future renames/inactivation do not rewrite this history.
    rules.mappings = rules.mappings.map((mapping) => ({
      ...mapping,
      componentName: taxable.find(
        (c) => c._id.toString() === mapping.componentId,
      )!.name,
    }));
    const revision: TaxRevision = {
      id: randomUUID(),
      yearCode: year.code,
      regime: body.regime,
      version:
        state.revisions.filter(
          (r: TaxRevision) =>
            r.yearCode === year.code && r.regime === body.regime,
        ).length + 1,
      effectiveDate: body.effectiveDate,
      rules,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    };
    return this.write(
      state,
      { revisions: [...state.revisions, revision] },
      actor,
      `create-revision:${revision.id}`,
    );
  }
  async publish(id: string, body: any, actor: string) {
    const state = await this.get();
    this.version(state, body?.version);
    const r: TaxRevision | undefined = state.revisions.find(
      (r: TaxRevision) => r.id === id,
    );
    if (!r) throw new NotFoundException('Tax revision not found.');
    validateRules(r.rules);
    const components = (await this.components.findAll()).filter(
      (component) =>
        component.status === 'active' && component.category !== 'deduction',
    );
    if (
      r.rules.mappings.some(
        (mapping) =>
          !components.some(
            (component) => component._id.toString() === mapping.componentId,
          ),
      ) ||
      components.some(
        (component) =>
          !r.rules.mappings.some(
            (mapping) => mapping.componentId === component._id.toString(),
          ),
      )
    )
      throw new BadRequestException(
        'Salary components changed. Load current salary components and save a new revision before activation. Existing history is preserved.',
      );
    return this.write(
      state,
      { published: { ...state.published, [`${r.yearCode}:${r.regime}`]: id } },
      actor,
      `publish:${id}`,
    );
  }
}
