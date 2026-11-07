import { EmailService } from './email.service';
const content = { subject: 'Test', text: 'Test', html: '<p>Test</p>' };
describe('Microsoft Graph provider', () => {
  const original = { ...process.env };
  let fetcher: jest.SpyInstance;
  let service: EmailService;
  const token = () =>
    new Response(
      JSON.stringify({ access_token: 'controlled-token', expires_in: 3600 }),
      { status: 200 },
    );
  beforeEach(() => {
    process.env = {
      ...original,
      EMAIL_ENABLED: 'true',
      EMAIL_PROVIDER: 'microsoft_graph',
      MICROSOFT_TENANT_ID: '11111111-1111-1111-1111-111111111111',
      MICROSOFT_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
      MICROSOFT_CLIENT_SECRET: 'controlled-secret',
      EMAIL_FROM_ADDRESS: 'ps-noreply@excelhire.us',
      FRONTEND_ORIGIN: 'https://paystream.example',
    };
    service = new EmailService();
    fetcher = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });
  it('requires mandatory configuration at startup', () => {
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(() => service.onModuleInit()).toThrow('MICROSOFT_CLIENT_SECRET');
  });
  it.each(['', 'smtp', 'MICROSOFT_GRAPH', ' microsoft_graph '])(
    'rejects invalid provider configuration without falling back',
    (provider) => {
      process.env.EMAIL_PROVIDER = provider;
      expect(() => service.onModuleInit()).toThrow('private backend .env');
    },
  );
  it('permits explicit disabling but rejects an invalid enable flag', () => {
    process.env.EMAIL_ENABLED = 'false';
    delete process.env.EMAIL_PROVIDER;
    expect(() => service.onModuleInit()).not.toThrow();
    process.env.EMAIL_ENABLED = 'off';
    expect(() => service.onModuleInit()).toThrow('EMAIL_ENABLED');
  });
  it('rejects unauthorized configured senders', () => {
    process.env.EMAIL_FROM_ADDRESS = 'other@example.test';
    expect(() => service.onModuleInit()).toThrow('Sender');
  });
  it('acquires and caches a token and sends from the designated mailbox', async () => {
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValue(new Response(null, { status: 202 }));
    await service.send('user@example.test', content);
    await service.send('second@example.test', content);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1].body).toContain(
      'grant_type=client_credentials',
    );
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toContain('ps-noreply%40excelhire.us/sendMail');
    const mime = Buffer.from(init.body, 'base64').toString('utf8');
    expect(mime).toContain('To: <user@example.test>');
    expect(mime).toContain('<ps-noreply@excelhire.us>');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime).toContain(Buffer.from(content.html).toString('base64'));
  });
  it('coalesces concurrent token acquisition', async () => {
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValue(new Response(null, { status: 202 }));
    await Promise.all([
      service.send('a@example.test', content),
      service.send('b@example.test', content),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('refreshes near expiration', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await service.send('a@example.test', content);
    jest.spyOn(Date, 'now').mockReturnValue(now + 3600000);
    await service.send('a@example.test', content);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects invalid client credentials', async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 400 }));
    await expect(service.send('a@example.test', content)).rejects.toThrow(
      'token_http_400',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([7000215, 7000222, 700016])(
    'reports safe Microsoft error code AADSTS%s without raw error text',
    async (code) => {
      fetcher.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_codes: [code],
            error_description:
              'controlled-secret controlled-token must never be printed',
          }),
          { status: 400 },
        ),
      );
      const failure = await service
        .checkAuthentication()
        .catch((error) => error);
      expect(failure.message).toContain('AADSTS' + code);
      expect(failure.explanation).toBeTruthy();
      expect(failure.message + failure.explanation).not.toContain(
        'controlled-secret',
      );
      expect(failure.message + failure.explanation).not.toContain(
        'controlled-token',
      );
    },
  );
  it.each([403, 500, 503])(
    'does not retry permanent or ambiguous HTTP %s failures',
    async (status) => {
      fetcher
        .mockResolvedValueOnce(token())
        .mockResolvedValue(new Response(null, { status }));
      await expect(service.send('a@example.test', content)).rejects.toThrow(
        'graph_http_' + status,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it('preserves sanitized Graph 403 details through the provider error boundary',async()=>{
    fetcher.mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'ErrorAccessDenied',message:'Denied user@example.test controlled-secret controlled-token'}}),{status:403,headers:{'request-id':'11111111-1111-1111-1111-111111111111'}}));
    const failure=await service.send('user@example.test',content).catch(error=>error);
    expect(failure.graph).toMatchObject({httpStatus:403,code:'ErrorAccessDenied',requestId:'11111111-1111-1111-1111-111111111111'});
    expect(JSON.stringify(failure.graph)).not.toMatch(/user@example.test|controlled-secret|controlled-token/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refreshes once on Graph 401', async () => {
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await service.send('a@example.test', content);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('honors explicit throttling and bounds retries', async () => {
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
      );
    await expect(service.send('a@example.test', content)).rejects.toThrow(
      'graph_http_429',
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('does not shorten a long Retry-After', async () => {
    fetcher
      .mockResolvedValueOnce(token())
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
      );
    await expect(service.send('a@example.test', content)).rejects.toThrow(
      'throttled_retry_later',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry ambiguous network timeouts', async () => {
    fetcher
      .mockResolvedValueOnce(token())
      .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    await expect(service.send('a@example.test', content)).rejects.toThrow(
      'network_or_timeout_unknown',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
});
