import { FORMULA_VARIABLES } from './formula-registry';
import { parseFormula } from './formula-parser';
import { StatutoryDeductionsService } from '../statutory-deductions/statutory-deductions.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SalaryComponent } from './salary-component.schema';
import {
  CreateSalaryComponentDto,
  UpdateSalaryComponentDto,
} from './salary-component.dto';
import { validateFormulaGraph } from './formula-graph';
import {
  MANDATORY_COMPONENTS,
  mandatoryComponent,
} from './mandatory-components';

@Injectable()
export class SalaryComponentsService implements OnModuleInit {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    @InjectModel(SalaryComponent.name)
    private readonly model: Model<SalaryComponent>,
    @Optional() private readonly statutory?: StatutoryDeductionsService,
  ) {}
  async onModuleInit() {
    await this.model.createIndexes();
    for (const component of MANDATORY_COMPONENTS) {
      const update = {
        $set: {
          name: component.name,
          isSystemDefined: true,
          status: 'active',
          category: 'earning',
        },
        $setOnInsert: {
          code: component.code,
          calculationBaseType: 'annual_ctc',
          calculationBaseComponentId: null,
          calculationType: 'percentage',
          calculationValue: null,
          fixedAmountPeriod: null,
          showInPayslip: true,
        },
      };
      try {
        await this.model
          .updateOne({ code: component.code }, update, { upsert: true })
          .exec();
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 11000
        )
          throw error;
        await this.model
          .updateOne({ code: component.code }, update, { upsert: false })
          .exec();
      }
      // Preserve old fixed formulas without interpreting an amount as a percentage.
      await this.model
        .updateOne(
          { code: component.code, calculationType: { $ne: 'percentage' } },
          [
            {
              $set: {
                legacyCalculation: {
                  calculationType: '$calculationType',
                  calculationValue: '$calculationValue',
                  fixedAmountPeriod: '$fixedAmountPeriod',
                },
                calculationType: 'percentage',
                calculationValue: null,
                fixedAmountPeriod: null,
              },
            },
          ],
          { updatePipeline: true },
        )
        .exec();
    }
  }
  findAll() {
    return this.model.find().sort({ createdAt: 1, _id: 1 }).exec();
  }
  async formulaVariables() {
    const [components, settings] = await Promise.all([
      this.findAll(),
      this.statutory?.get(),
    ]);
    const allowanceIds = components
      .filter((c) => c.status === 'active' && c.category === 'allowance')
      .map((c) => 'component_' + c._id.toString());
    const available = (id: string): boolean => {
      const v = FORMULA_VARIABLES.find((v) => v.id === id);
      if (!v) return false;
      if (v.setting) {
        const value = settings?.[v.setting as keyof typeof settings];
        return (
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0 &&
          (v.valueType !== 'rate' || value <= 100)
        );
      }
      if (v.componentCode)
        return components.some(
          (c) =>
            c.code === v.componentCode &&
            c.status === 'active' &&
            typeof c.calculationValue === 'number',
        );
      if (id === 'annualCtc') return true;
      if (id === 'annualGrossWages')
        return (
          !!settings &&
          [
            'annualBasicSalary',
            'annualDearnessAllowance',
            'annualRetainingAllowance',
          ].every(available)
        );
      const dependencies = v.dependencies.filter(
        (dep) =>
          !(
            dep === 'annualEpfCeilingLimit' && !settings?.isEpfCeilingApplicable
          ) &&
          !(
            dep === 'annualEsiCeilingLimit' &&
            settings?.annualEsiCeilingLimit === undefined
          ),
      );
      return dependencies.every(
        (dep) => dep === 'allowance_components' || available(dep),
      );
    };
    const builtins = FORMULA_VARIABLES.map((v) => ({
      ...v,
      dependencies: v.dependencies.flatMap((id) =>
        id === 'allowance_components' ? allowanceIds : [id],
      ),
      available: available(v.id),
    }));
    return [
      ...builtins,
      ...components
        .filter((c) => c.status === 'active')
        .map((c) => ({
          id: 'component_' + c._id.toString(),
          label: c.name + ' (' + c.code + ')',
          valueType: 'amount' as const,
          dependencies:
            c.calculationType === 'formula'
              ? parseFormula(c.formula).variables
              : c.calculationBaseType === 'salary_component'
                ? ['component_' + c.calculationBaseComponentId?.toString()]
                : [
                    c.calculationBaseType === 'gross_wages'
                      ? 'annualGrossWages'
                      : c.calculationBaseType === 'core_wages'
                        ? 'annualCoreWages'
                        : 'annualCtc',
                  ],
          available: true,
        })),
    ];
  }
  create(dto: CreateSalaryComponentDto) {
    return this.write(undefined, {
      ...dto,
      showInPayslip: dto.showInPayslip ?? true,
      status: dto.status ?? 'active',
    });
  }
  update(id: string, dto: UpdateSalaryComponentDto) {
    return this.write(id, dto);
  }

  remove(id: string) {
    const operation = this.pending.then(async () => {
      if (!Types.ObjectId.isValid(id))
        throw new BadRequestException('Invalid salary component ID.');
      id = new Types.ObjectId(id).toHexString();
      try {
        const component = await this.model.findById(id).exec();
        if (!component)
          throw new NotFoundException('Salary component not found.');
        if (mandatoryComponent(component.code) || component.isSystemDefined)
          throw new ConflictException(
            'Mandatory salary components cannot be deleted.',
          );
        const records = await this.model.find().lean().exec();
        const dependents: string[] = [];
        for (const record of records) {
          if (record._id.toString() === id) continue;
          let referenced =
            record.calculationBaseType === 'salary_component' &&
            record.calculationBaseComponentId?.toString() === id;
          if (record.calculationType === 'formula') {
            try {
              referenced =
                referenced ||
                parseFormula(record.formula).variables.includes(
                  'component_' + id.toLowerCase(),
                );
            } catch {
              throw new ConflictException(
                'Cannot verify dependencies: repair the invalid formula in ' +
                  record.name +
                  ' (' +
                  record.code +
                  ') before deleting a component.',
              );
            }
          }
          if (referenced)
            dependents.push(record.name + ' (' + record.code + ')');
        }
        if (dependents.length)
          throw new ConflictException(
            'Cannot delete this component. Remove references from: ' +
              dependents.join(', ') +
              '.',
          );
        const deleted = await this.model.findByIdAndDelete(id).exec();
        if (!deleted)
          throw new NotFoundException('Salary component not found.');
        return {
          message: 'Salary component deleted successfully.',
          deletedId: deleted._id.toString(),
        };
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof NotFoundException ||
          error instanceof ConflictException
        )
          throw error;
        throw new ServiceUnavailableException(
          'Unable to delete salary component. Please try again later.',
        );
      }
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  // Serialize graph edits in this application process, including status changes.
  private write(id: string | undefined, dto: UpdateSalaryComponentDto) {
    const operation = this.pending.then(async () => {
      if (id && !Types.ObjectId.isValid(id))
        throw new BadRequestException('Invalid salary component ID.');
      const existing = id ? await this.model.findById(id).exec() : null;
      if (id && !existing)
        throw new NotFoundException('Salary component not found.');
      const mandatory = existing
        ? mandatoryComponent(existing.code)
        : undefined;
      if (!existing && dto.code && mandatoryComponent(dto.code))
        throw new ConflictException(
          'This mandatory component already exists. Edit its configured percentage instead.',
        );
      if (existing && !mandatory && dto.code && mandatoryComponent(dto.code))
        throw new BadRequestException(
          'Mandatory component codes are reserved.',
        );
      if (mandatory) {
        if (
          (dto.name !== undefined && dto.name !== mandatory.name) ||
          (dto.code !== undefined && dto.code !== mandatory.code)
        )
          throw new BadRequestException(
            'Mandatory component names and codes cannot be changed.',
          );
        if (
          (dto.status !== undefined && dto.status !== 'active') ||
          (dto.calculationType !== undefined &&
            dto.calculationType !== 'percentage') ||
          (dto.category !== undefined && dto.category !== 'earning')
        )
          throw new BadRequestException(
            'Mandatory components must remain active percentage-based earnings.',
          );
      }
      const data = { ...(existing?.toObject() ?? {}), ...dto };
      if (
        mandatory &&
        (data.calculationValue === null || data.calculationValue === undefined)
      )
        throw new BadRequestException(
          `Configure the percentage for ${mandatory.code} before saving this component.`,
        );
      if (data.calculationType === 'formula') {
        data.calculationValue = null;
        data.fixedAmountPeriod = null;
        data.calculationBaseType = 'annual_ctc';
        data.calculationBaseComponentId = null;
      } else {
        data.formula = null;
        if (
          typeof data.calculationValue !== 'number' ||
          !Number.isFinite(data.calculationValue) ||
          data.calculationValue < 0
        )
          throw new BadRequestException(
            'Enter a non-negative calculation value.',
          );
      }
      if (data.calculationBaseType === 'annual_ctc')
        data.calculationBaseComponentId = null;
      if (data.calculationType === 'percentage') data.fixedAmountPeriod = null;
      if (
        data.calculationType === 'fixed' &&
        !['annual', 'monthly'].includes(data.fixedAmountPeriod ?? '')
      )
        throw new BadRequestException(
          'Select an annual or monthly fixed amount period.',
        );
      if (
        data.calculationType === 'percentage' &&
        (data.calculationValue ?? 0) > 100
      )
        throw new BadRequestException('Percentage must be between 0 and 100.');
      const records = await this.model.find().lean().exec();
      const candidateId = id ?? new Types.ObjectId().toString();
      const candidate = { ...data, _id: new Types.ObjectId(candidateId) };
      const graph = new Map<string, any>(
        records.map((c) => [c._id.toString(), c]),
      );
      graph.set(candidateId, candidate);
      if ([...graph.values()].some((c) => c.calculationType === 'formula'))
        validateFormulaGraph([...graph.values()], candidateId);
      else {
        for (const [nodeId, node] of graph) {
          const path = new Set<string>([nodeId]);
          let current = node;
          while (current.calculationBaseType === 'salary_component') {
            const baseId = current.calculationBaseComponentId?.toString();
            if (!baseId || !graph.has(baseId))
              throw new BadRequestException('Calculation base does not exist.');
            if (path.has(baseId))
              throw new BadRequestException(
                'Circular salary component dependencies are not allowed.',
              );
            path.add(baseId);
            const base = graph.get(baseId);
            const preserving =
              existing &&
              nodeId === candidateId &&
              existing.calculationBaseComponentId?.toString() === baseId &&
              candidate.status === 'inactive';
            if (
              current.status === 'active' &&
              base.status !== 'active' &&
              !preserving
            )
              throw new BadRequestException(
                'Active components require active bases. Deactivate dependent components first.',
              );
            if (
              nodeId === candidateId &&
              base.status !== 'active' &&
              !preserving
            )
              throw new BadRequestException(
                'An inactive component cannot be selected as a new calculation base.',
              );
            current = base;
          }
        }
      }
      try {
        if (existing) {
          existing.set(data);
          return await existing.save();
        }
        return await this.model.create(candidate);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 11000
        )
          throw new ConflictException(
            'A salary component with this code already exists.',
          );
        throw error;
      }
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
