import { emailDiagnostics } from './email-diagnostics';
import { EmailService } from './auth/email.service';
describe('Safe email diagnostic', () => {
  const original = { ...process.env };
  let fetcher: jest.SpyInstance;
  let reports: unknown[];
  const report = (value: unknown) => reports.push(value);
  beforeEach(() => {
    process.env = {
      ...original,
      EMAIL_ENABLED: 'true',
      EMAIL_PROVIDER: 'microsoft_graph',
      MICROSOFT_TENANT_ID: '11111111-1111-1111-1111-111111111111',
      MICROSOFT_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
      MICROSOFT_CLIENT_SECRET: 'controlled-diagnostic-secret',
      EMAIL_FROM_ADDRESS: 'ps-noreply@excelhire.us',
      FRONTEND_ORIGIN: 'https://paystream.example',
    };
    fetcher = jest.spyOn(globalThis, 'fetch');
    reports = [];
  });
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });
  it('checks authentication without sending and never exposes credentials or tokens', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'controlled-diagnostic-token',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );
    expect(await emailDiagnostics([], report)).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const output = JSON.stringify(reports);
    expect(output).toContain('authenticated');
    expect(output).toContain('not verified');
    expect(output).not.toContain('controlled-diagnostic-secret');
    expect(output).not.toContain('controlled-diagnostic-token');
  });
  it('requires an explicit valid recipient before sending', async () => {
    expect(await emailDiagnostics(['--to', 'invalid'], report)).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports 202 as acceptance, not delivered or verified RBAC', async () => {
    fetcher
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'controlled-diagnostic-token',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect(
      await emailDiagnostics(['--to', 'approved@example.test'], report),
    ).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(reports.at(-1)).toMatchObject({
      sendMail: 'HTTP 202 Accepted',
      recipientDelivery: expect.stringContaining('unverified'),
      exchangeApplicationRbac: expect.stringContaining('still unverified'),
    });
  });
  it('reports an exact missing setting without making a network request', async () => {
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(await emailDiagnostics([], report)).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(reports.at(-1)).toMatchObject({
      phase: 'configuration',
      reason: expect.stringContaining('MICROSOFT_CLIENT_SECRET'),
    });
  });
  it('honors explicit disable without weakening validation of invalid flags', async () => {
    process.env.EMAIL_ENABLED = 'false';
    expect(await emailDiagnostics([], report)).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    process.env.EMAIL_ENABLED = 'off';
    expect(await emailDiagnostics([], report)).toBe(1);
  });
});
