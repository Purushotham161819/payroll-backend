import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import request from 'supertest';
import { StatutoryDeductionsService } from './statutory-deductions.service';
import { StatutoryDeductionsController } from './statutory-deductions.controller';
import { StatutoryDeductions } from './statutory-deductions.schema';

describe('Statutory settings with hidden legacy employee fields', () => {
  let app: INestApplication;
  let saved: Record<string, unknown> | null;
  const config = {
    wageCap: 180000.25,
    annualEsiCeilingLimit: 252000.5,
    epfEmployerContributionPercentage: 3.67,
    epsEmployerContributionPercentage: 8.33,
    esiEmployerContributionPercentage: 3.25,
  };
  const update = jest.fn((_filter, patch) => ({
    lean: () => ({
      exec: async () => {
        saved = { ...(saved ?? patch.$setOnInsert), ...patch.$set };
        return saved;
      },
    }),
  }));
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StatutoryDeductionsController],
      providers: [
        StatutoryDeductionsService,
        {
          provide: getModelToken(StatutoryDeductions.name),
          useValue: {
            findOneAndUpdate: update,
            findById: () => ({ lean: () => ({ exec: async () => saved }) }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    saved = null;
    update.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  it('saves first-time settings without hidden fields and initializes only legacy fields to zero', async () => {
    const result = await request(app.getHttpServer())
      .put('/settings/statutory-deductions')
      .send(config)
      .expect(200);
    expect(result.body).toEqual({
      ...config,
      epfEmployeeContributionPercentage: 0,
      esiEmployeeContributionPercentage: 0,
    });
    expect(update.mock.calls[0][1].$set).toEqual(config);
  });
  it('preserves existing legacy values when the new UI omits them', async () => {
    saved = {
      ...config,
      epfEmployeeContributionPercentage: 12,
      esiEmployeeContributionPercentage: 0.75,
    };
    const result = await request(app.getHttpServer())
      .put('/settings/statutory-deductions')
      .send({ ...config, wageCap: 200000 })
      .expect(200);
    expect(result.body).toMatchObject({
      wageCap: 200000,
      epfEmployeeContributionPercentage: 12,
      esiEmployeeContributionPercentage: 0.75,
    });
    const loaded = await request(app.getHttpServer())
      .get('/settings/statutory-deductions')
      .expect(200);
    expect(loaded.body).toEqual(result.body);
  });
  it('accepts existing clients including explicit zero without conflicting update paths', async () => {
    const values = {
      ...config,
      epfEmployeeContributionPercentage: 0,
      esiEmployeeContributionPercentage: 0.5,
    };
    await request(app.getHttpServer())
      .put('/settings/statutory-deductions')
      .send(values)
      .expect(200);
    expect(saved).toEqual(values);
    expect(update.mock.calls[0][1].$setOnInsert).toEqual({});
  });
  it.each([
    { epfEmployeeContributionPercentage: null },
    { esiEmployeeContributionPercentage: 101 },
    { epfEmployeeContributionPercentage: -1 },
    { esiEmployeeContributionPercentage: '1' },
    { epfEmployerContributionPercentage: 101 },
    { wageCap: 1.234 },
  ])('still validates provided values %p', async (invalid) => {
    await request(app.getHttpServer())
      .put('/settings/statutory-deductions')
      .send({ ...config, ...invalid })
      .expect(400);
    expect(update).not.toHaveBeenCalled();
  });
});
