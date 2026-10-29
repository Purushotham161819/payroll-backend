import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('Deployment organization display configuration', () => {
  const original = process.env.ORGANIZATION_NAME;
  const controller = new AppController(new AppService());
  afterEach(() => {
    if (original === undefined) delete process.env.ORGANIZATION_NAME;
    else process.env.ORGANIZATION_NAME = original;
  });
  it('uses the requested initial name when no customer name is configured', async () => {
    delete process.env.ORGANIZATION_NAME;
    expect(await controller.organization()).toEqual({
      displayName: 'PayStream, An Excelhire Product',
    });
    process.env.ORGANIZATION_NAME = '   ';
    expect((await controller.organization()).displayName).toBe(
      'PayStream, An Excelhire Product',
    );
  });
  it('reads the configured customer identity without changing component source or accounts', async () => {
    process.env.ORGANIZATION_NAME = '  Example Customer Organization  ';
    expect(await controller.organization()).toEqual({
      displayName: 'Example Customer Organization',
    });
    process.env.ORGANIZATION_NAME = 'Another Customer';
    expect((await controller.organization()).displayName).toBe(
      'Another Customer',
    );
  });
});
