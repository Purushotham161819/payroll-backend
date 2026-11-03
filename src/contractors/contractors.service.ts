import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { businessModel } from '../organizations/business-models.module';
import {
  ContractorSchema,
  ContractorComponentSchema,
  ContractorPaymentSchema,
  ContractorCounterSchema,
} from './contractor.schemas';
import {
  AssignmentDto,
  ContractorComponentDto,
  ContractorComponentUpdateDto,
  ContractorDto,
  ContractorPaymentDto,
  ContractorUpdateDto,
  ContractorStatusDto,
} from './contractor.dto';
import { validatePaymentDate } from './contractor-payment';
import {
  calculateContractorPayment,
  validateDeductionRule,
} from './contractor-deductions';
@Injectable()
export class ContractorsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private readonly ready = new Map<string, Promise<unknown>>();
  private transactionSupport?: Promise<boolean>;
  private supportsTransactions() {
    return this.transactionSupport ??= this.connection.db!.admin().command({ hello: 1 })
      .then(hello => !!hello.setName || hello.msg === 'isdbgrid')
      .catch(error => { this.transactionSupport = undefined; throw error; });
  }
  models(org: string) {
    if (!/^ORG\d{6,}$/.test(org || ''))
      throw new ForbiddenException('An organization account is required.');
    return {
      contractors: businessModel(
        this.connection,
        'Contractor',
        ContractorSchema,
        org,
      ),
      components: businessModel(
        this.connection,
        'ContractorComponent',
        ContractorComponentSchema,
        org,
      ),
      payments: businessModel(
        this.connection,
        'ContractorPayment',
        ContractorPaymentSchema,
        org,
      ),
      counters: businessModel(
        this.connection,
        'ContractorCounter',
        ContractorCounterSchema,
        org,
      ),
    };
  }
  private async initialize(org: string) {
    const models = this.models(org);
    let ready = this.ready.get(org);
    if (!ready) {
      ready = Promise.all(
        [models.contractors, models.components, models.payments].map((m) =>
          m.createIndexes(),
        ),
      ).catch((e) => {
        this.ready.delete(org);
        throw e;
      });
      this.ready.set(org, ready);
    }
    await ready;
    return models;
  }
  private id(value: string) {
    if (!/^[a-f\d]{24}$/i.test(value))
      throw new BadRequestException('Invalid contractor reference.');
    return new Types.ObjectId(value);
  }
  private async next(org: string, kind: 'contractor' | 'payment') {
    const { counters } = this.models(org);
    let counter;
    try {
      counter = await counters
        .findOneAndUpdate(
          { _id: kind },
          { $inc: { value: 1 } },
          { upsert: true, returnDocument: 'after' },
        )
        .lean();
    } catch (e) {
      if ((e as any).code !== 11000) throw e;
      counter = await counters
        .findOneAndUpdate(
          { _id: kind },
          { $inc: { value: 1 } },
          { returnDocument: 'after' },
        )
        .lean();
    }
    if (!counter || !Number.isSafeInteger(counter.value))
      throw new ConflictException('Identifier sequence unavailable.');
    return (
      (kind === 'contractor' ? 'CON' : 'CPAY') +
      String(counter.value).padStart(3, '0')
    );
  }
  private async duplicate<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (e) {
      if ((e as any).code === 11000)
        throw new ConflictException(
          'That email or component code already exists in this organization.',
        );
      throw e;
    }
  }
  async list(org: string) {
    const { contractors } = await this.initialize(org);
    return contractors
      .find({ organizationId: org })
      .sort({ firstName: 1, lastName: 1, _id: 1 })
      .lean();
  }
  async get(org: string, id: string) {
    const { contractors } = await this.initialize(org);
    const row = await contractors
      .findOne({ _id: this.id(id), organizationId: org })
      .lean();
    if (!row) throw new NotFoundException('Contractor not found.');
    return row;
  }
  async create(org: string, actor: string, dto: ContractorDto) {
    const { contractors } = await this.initialize(org);
    const contractorId = await this.next(org, 'contractor');
    return this.duplicate(() =>
      contractors.create({
        ...dto,
        organizationId: org,
        contractorId,
        createdBy: actor,
        updatedBy: actor,
      }),
    );
  }
  async update(
    org: string,
    id: string,
    actor: string,
    dto: ContractorUpdateDto,
  ) {
    await this.get(org, id);
    const { contractors } = this.models(org);
    const { version, ...fields } = dto;
    const row = await this.duplicate(() =>
      contractors
        .findOneAndUpdate(
          { _id: this.id(id), organizationId: org, version },
          { $set: { ...fields, updatedBy: actor }, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        )
        .lean(),
    );
    if (!row)
      throw new ConflictException('Contractor changed. Reload before saving.');
    return row;
  }
  async components(org: string) {
    const { components } = await this.initialize(org);
    return components
      .find({ organizationId: org })
      .sort({ name: 1, _id: 1 })
      .lean();
  }
  async changeStatus(org: string, id: string, actor: string, dto: ContractorStatusDto) {
    await this.get(org, id);
    const { contractors } = this.models(org);
    const saved = await contractors.findOneAndUpdate(
      { _id: this.id(id), organizationId: org, version: dto.version },
      { $set: { status: dto.status, updatedBy: actor }, $inc: { version: 1 } },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!saved) throw new ConflictException('Contractor changed. Reload before saving status.');
    return saved;
  }
  async remove(org: string, id: string) {
    const contractor = await this.get(org, id);
    id = String(contractor._id);
    if (!(await this.supportsTransactions()))
      throw new ServiceUnavailableException('Safe contractor deletion requires MongoDB transactions (a replica set or sharded deployment). No records were changed.');
    const { contractors, payments } = this.models(org);
    return this.connection.transaction(async session => {
      const removed = await contractors.deleteOne({ _id: this.id(id), organizationId: org }, { session });
      if (removed.deletedCount !== 1) throw new NotFoundException('Contractor not found.');
      const affected = await payments.find({ organizationId: org, 'entries.contractorId': id }).select('_id').session(session).lean();
      // The only authorized mutation of a payment envelope: permanently remove
      // this contractor's entries while preserving every other snapshot verbatim.
      await payments.collection.updateMany(
        { organizationId: org, 'entries.contractorId': id },
        { $pull: { entries: { contractorId: id } } } as any,
        { session },
      );
      await payments.collection.deleteMany({ _id: { $in: affected.map(batch => batch._id) }, organizationId: org, entries: { $size: 0 } }, { session });
      return { deleted: true };
    });
  }
  private configuration(dto: ContractorComponentDto) {
    try {
      validateDeductionRule(dto);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return {
      name: dto.name,
      code: dto.code,
      classification: 'deduction',
      status: dto.status,
      calculationType: dto.calculationType,
      calculationValue: ['fixed', 'percentage'].includes(dto.calculationType)
        ? dto.calculationValue
        : null,
      formula: dto.calculationType === 'formula' ? dto.formula : '',
      calculationBase: 'grossPay',
    };
  }
  async addComponent(org: string, actor: string, dto: ContractorComponentDto) {
    const { components } = await this.initialize(org);
    return this.duplicate(() =>
      components.create({
        ...this.configuration(dto),
        organizationId: org,
        createdBy: actor,
        updatedBy: actor,
      }),
    );
  }
  async updateComponent(
    org: string,
    id: string,
    actor: string,
    dto: ContractorComponentUpdateDto,
  ) {
    const { components } = await this.initialize(org);
    if (!(await components.exists({ _id: this.id(id), organizationId: org })))
      throw new NotFoundException('Component not found.');
    const row = await this.duplicate(() =>
      components
        .findOneAndUpdate(
          { _id: this.id(id), organizationId: org, version: dto.version },
          {
            $set: { ...this.configuration(dto), updatedBy: actor },
            $inc: { version: 1 },
          },
          { returnDocument: 'after', runValidators: true },
        )
        .lean(),
    );
    if (!row)
      throw new ConflictException('Component changed. Reload before saving.');
    return row;
  }
  async assign(org: string, id: string, actor: string, dto: AssignmentDto) {
    const contractor = await this.get(org, id);
    const { components, contractors } = this.models(org);
    const rows = await components
      .find({
        organizationId: org,
        _id: { $in: dto.componentIds.map((x) => this.id(x)) },
      })
      .lean();
    if (
      rows.length !== dto.componentIds.length ||
      rows.some(
        (c) =>
          c.classification !== 'deduction' ||
          (c.status !== 'active' &&
            !contractor.componentIds.includes(String(c._id))),
      )
    )
      throw new BadRequestException(
        'Select available contractor components from this organization.',
      );
    for (const component of rows) {
      if (!contractor.componentIds.includes(String(component._id))) {
        try {
          validateDeductionRule(component);
        } catch (error) {
          throw new BadRequestException((error as Error).message);
        }
      }
    }
    const row = await contractors
      .findOneAndUpdate(
        { _id: this.id(id), organizationId: org, version: dto.version },
        {
          $set: {
            componentIds: [
              ...new Set([
                ...(await this.legacyAssignments(org, contractor.componentIds)),
                ...dto.componentIds,
              ]),
            ],
            updatedBy: actor,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean();
    if (!row)
      throw new ConflictException('Contractor changed. Reload before saving.');
    return row;
  }
  private async legacyAssignments(org: string, ids: string[]) {
    const { components } = this.models(org);
    const rows = await components
      .find({
        organizationId: org,
        _id: { $in: ids.map((id) => this.id(id)) },
        classification: { $ne: 'deduction' },
      })
      .lean();
    return rows.map((row) => String(row._id));
  }
  async pay(org: string, actor: string, dto: ContractorPaymentDto) {
    validatePaymentDate(dto.paymentDate);
    const { payments, components, contractors } = await this.initialize(org);
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          calculationVersion: 2,
          paymentDate: dto.paymentDate,
          description: dto.description,
          entries: dto.entries,
        }),
      )
      .digest('hex');
    const replay = (saved: any) => {
      if (saved.inputHash !== inputHash)
        throw new ConflictException(
          'This submission key was already used for different payment details.',
        );
      return saved;
    };
    const existing = await payments
      .findOne({ organizationId: org, idempotencyKey: dto.idempotencyKey })
      .lean();
    if (existing) return replay(existing);
    if (
      new Set(dto.entries.map((e) => e.contractorId)).size !==
      dto.entries.length
    )
      throw new BadRequestException('Select each contractor only once.');
    const entries = [];
    for (const entry of dto.entries) {
      const description = entry.description ?? dto.description;
      if (typeof description !== 'string' || !description.trim() || description.length > 1000)
        throw new BadRequestException('Enter a description for each selected contractor.');
      const contractor = await this.get(org, entry.contractorId);
      if (contractor.status === 'Inactive')
        throw new BadRequestException('Inactive contractors cannot receive new payments.');
      if (contractor.version !== entry.contractorVersion)
        throw new ConflictException(
          'Contractor assignments changed. Reload and review the payment.',
        );
      if (
        new Set(entry.components.map((c) => c.componentId)).size !==
        entry.components.length
      )
        throw new BadRequestException('Duplicate payment component.');
      const configured = await components
        .find({
          organizationId: org,
          _id: {
            $in: contractor.componentIds.map((id: string) => this.id(id)),
          },
        })
        .lean();
      if (configured.length !== contractor.componentIds.length)
        throw new ConflictException(
          'An assigned component is no longer available. Review contractor assignments before payment.',
        );
      const assigned = configured
        .filter(
          (c) => c.classification === 'deduction' && c.status === 'active',
        )
        .sort((a, b) => String(a._id).localeCompare(String(b._id)));
      const requested = new Map(
        entry.components.map((line) => [
          line.componentId,
          line.componentVersion,
        ]),
      );
      if (
        requested.size !== assigned.length ||
        assigned.some((c) => !requested.has(String(c._id)))
      )
        throw new BadRequestException(
          'Include exactly the active deduction components assigned to this contractor.',
        );
      if (assigned.some((c) => requested.get(String(c._id)) !== c.version))
        throw new ConflictException(
          'Deduction configuration changed. Reload and review the payment.',
        );
      let totals;
      try {
        totals = calculateContractorPayment(entry.grossPay, assigned);
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
      if (totals.netPayment < 0)
        throw new BadRequestException(
          'Total deductions cannot exceed Gross Pay.',
        );
      const snapshots = assigned.map((component, index) => ({
        componentId: String(component._id),
        componentVersion: component.version,
        name: component.name,
        code: component.code,
        classification: 'deduction',
        amount: totals.amounts[index],
        calculationType: component.calculationType,
        calculationValue: component.calculationValue,
        calculationBase: 'grossPay',
        formula: component.formula,
      }));
      entries.push({
        description,
        paymentId: await this.next(org, 'payment'),
        contractorId: String(contractor._id),
        contractorCode: contractor.contractorId,
        firstName: contractor.firstName,
        lastName: contractor.lastName,
        email: contractor.email,
        calculationVersion: 2,
        grossPay: totals.grossPay,
        components: snapshots,
        totalDeductions: totals.totalDeductions,
        netPayment: totals.netPayment,
      });
    }
    try {
      const record = {
        organizationId: org,
        idempotencyKey: dto.idempotencyKey,
        inputHash,
        paymentDate: dto.paymentDate,
        description: dto.description,
        entries,
        recordedBy: actor,
      };
      if (!(await this.supportsTransactions())) return await payments.create(record);
      // Serialize new payments with status changes and permanent deletion on
      // transaction-capable deployments without altering calculation or IDs.
      return await this.connection.transaction(async session => {
        for (const entry of dto.entries) {
          const locked = await contractors.updateOne(
            { _id: this.id(entry.contractorId), organizationId: org, version: entry.contractorVersion, status: { $ne: 'Inactive' } },
            { $inc: { paymentWriteVersion: 1 } }, { session },
          );
          if (locked.matchedCount !== 1)
            throw new ConflictException('Contractor is inactive, deleted or changed. Reload before recording payment.');
        }
        return (await payments.create([record], { session }))[0];
      });
    } catch (e) {
      if ((e as any).code !== 11000) throw e;
      const saved = await payments
        .findOne({ organizationId: org, idempotencyKey: dto.idempotencyKey })
        .lean();
      if (!saved) throw e;
      return replay(saved);
    }
  }
  async history(org: string, id: string) {
    const contractor = await this.get(org, id);
    id = String(contractor._id);
    const { payments } = this.models(org);
    const batches = await payments
      .find({ organizationId: org, 'entries.contractorId': id })
      .sort({ paymentDate: -1, createdAt: -1, _id: -1 })
      .lean();
    return batches.flatMap((b) =>
      b.entries
        .filter((e: any) => e.contractorId === id)
        .map((e: any) => ({
          ...e,
          paymentDate: b.paymentDate,
          description: e.description ?? b.description,
          recordedAt: b.createdAt,
          status: 'Recorded',
        })),
    );
  }
}
