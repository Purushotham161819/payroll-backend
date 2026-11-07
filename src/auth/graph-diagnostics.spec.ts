import {
  graphResponseDetails,
  tokenIdentitySummary,
} from './graph-diagnostics';
describe('Safe Graph evidence', () => {
  it('captures selected error fields and correlation IDs while redacting credentials and addresses', async () => {
    const requestId = '11111111-1111-1111-1111-111111111111';
    const clientId = '22222222-2222-2222-2222-222222222222';
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'ErrorAccessDenied',
          message: 'Denied recipient@example.test secret-fixture token-fixture',
          innerError: {
            'request-id': requestId,
            'client-request-id': clientId,
          },
        },
      }),
      {
        status: 403,
        headers: {
          'request-id': requestId,
          date: 'Thu, 05 Nov 2026 12:00:00 GMT',
          'x-sensitive': 'must-not-log',
        },
      },
    );
    const details = await graphResponseDetails(response, [
      'secret-fixture',
      'token-fixture',
    ]);
    expect(details).toMatchObject({
      httpStatus: 403,
      code: 'ErrorAccessDenied',
      requestId,
      clientRequestId: clientId,
    });
    expect(details.message).toContain('[redacted]');
    expect(JSON.stringify(details)).not.toMatch(
      /secret-fixture|token-fixture|recipient@example.test|must-not-log/,
    );
  });
  it('never prints non-JSON proxy or error page contents', async () => {
    const details = await graphResponseDetails(
      new Response('private error page', { status: 403 }),
      [],
    );
    expect(details.httpStatus).toBe(403);
    expect(JSON.stringify(details)).not.toContain('private error page');
  });
  it('compares token identity without disclosing full token, user claims or assuming empty roles are invalid', () => {
    const old = { ...process.env };
    try {
      process.env.MICROSOFT_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
      process.env.MICROSOFT_TENANT_ID = '22222222-2222-2222-2222-222222222222';
      const claims = {
        appid: process.env.MICROSOFT_CLIENT_ID,
        tid: process.env.MICROSOFT_TENANT_ID,
        aud: '00000003-0000-0000-c000-000000000000',
        idtyp: 'app',
        name: 'private user',
        email: 'private@example.test',
      };
      const token =
        'header.' +
        Buffer.from(JSON.stringify(claims)).toString('base64url') +
        '.signature';
      const summary = tokenIdentitySummary(token);
      expect(summary).toMatchObject({
        applicationMatchesConfigured: true,
        tenantMatchesConfigured: true,
        audienceIsMicrosoftGraph: true,
        delegatedScopesPresent: false,
        roles: [],
      });
      expect(JSON.stringify(summary)).not.toMatch(
        /private user|private@example.test/,
      );
      expect(JSON.stringify(summary)).not.toContain(token);
    } finally {
      process.env = old;
    }
  });
});
