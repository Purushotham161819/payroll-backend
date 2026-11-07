import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  graphResponseDetails,
  GraphResponseDetails,
  tokenIdentitySummary,
} from './graph-diagnostics';
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}
export class EmailFailure extends Error {
  constructor(
    message: string,
    public readonly explanation?: string,
    public readonly graph?: GraphResponseDetails,
  ) {
    super(message);
  }
}
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private cached?: { value: string; expires: number };
  private pending?: Promise<string>;
  onModuleInit() {
    this.validate();
  }
  private validate() {
    if (
      process.env.EMAIL_ENABLED !== undefined &&
      !['true', 'false'].includes(process.env.EMAIL_ENABLED)
    )
      throw new EmailFailure('EMAIL_ENABLED must be true or false');
    if (process.env.EMAIL_ENABLED === 'false') return;
    if (process.env.EMAIL_PROVIDER !== 'microsoft_graph')
      throw new EmailFailure(
        'EMAIL_PROVIDER must be microsoft_graph; configure the private backend .env or deployment environment (not .env.example)',
      );
    for (const key of [
      'MICROSOFT_TENANT_ID',
      'MICROSOFT_CLIENT_ID',
      'MICROSOFT_CLIENT_SECRET',
      'EMAIL_FROM_ADDRESS',
    ])
      if (!process.env[key]?.trim())
        throw new EmailFailure('Missing email configuration: ' + key);
    for (const key of ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID'])
      if (!/^[a-f0-9-]{36}$/i.test(process.env[key]!))
        throw new EmailFailure('Invalid email configuration: ' + key);
    if (process.env.EMAIL_FROM_ADDRESS !== 'ps-noreply@excelhire.us')
      throw new EmailFailure(
        'Sender must be ps-noreply@excelhire.us; review RBAC before changing',
      );
    const origin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200';
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    )
      throw new EmailFailure('Invalid FRONTEND_ORIGIN');
  }
  private async request(url: string, init: RequestInit) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
    } catch {
      throw new EmailFailure('network_or_timeout_unknown');
    }
  }
  private async acquire() {
    const response = await this.request(
      'https://login.microsoftonline.com/' +
        process.env.MICROSOFT_TENANT_ID +
        '/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      },
    );
    if (!response.ok) {
      let codes: number[] = [];
      try {
        const error = (await response.json()) as { error_codes?: unknown };
        if (Array.isArray(error.error_codes))
          codes = error.error_codes
            .filter(
              (code): code is number =>
                Number.isSafeInteger(code) && code > 0 && code < 1000000000,
            )
            .slice(0, 5);
      } catch {
        /* Never expose a raw OAuth error response. */
      }
      const explanations: Record<number, string> = {
        7000215:
          'Invalid client secret. Configure the secret Value, not its ID, for the existing application.',
        7000222:
          'Client secret has expired. Rotate it on the existing application.',
        700016:
          'Application not found in this tenant. Verify the tenant and existing client IDs.',
        90002: 'Tenant not found. Verify MICROSOFT_TENANT_ID.',
        7000218:
          'Client credentials are required. Verify MICROSOFT_CLIENT_SECRET.',
      };
      throw new EmailFailure(
        'token_http_' +
          response.status +
          codes.map((code) => ' AADSTS' + code).join(''),
        explanations[codes[0]] ??
          'Microsoft rejected client credentials. Verify the existing app configuration and tenant sign-in logs.',
      );
    }
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (
      !data.access_token ||
      !Number.isFinite(Number(data.expires_in)) ||
      Number(data.expires_in) <= 60
    )
      throw new EmailFailure('invalid_token_response');
    this.cached = {
      value: data.access_token,
      expires: Date.now() + (Number(data.expires_in) - 60) * 1000,
    };
    return data.access_token;
  }
  private async token() {
    if (this.cached && this.cached.expires > Date.now())
      return this.cached.value;
    if (!this.pending)
      this.pending = this.acquire().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  async checkAuthentication() {
    this.validate();
    if (process.env.EMAIL_ENABLED === 'false')
      throw new EmailFailure('disabled');
    const token = await this.token();
    return {
      status: 'authenticated' as const,
      identity: tokenIdentitySummary(token),
    };
  }
  async send(to: string, content: EmailContent) {
    const attempt = randomUUID();
    try {
      if (process.env.EMAIL_ENABLED === 'false')
        throw new EmailFailure('disabled');
      this.validate();
      let refreshed = false;
      for (let retry = 0; retry < 3; retry++) {
        const response = await this.request(
          'https://graph.microsoft.com/v1.0/users/' +
            encodeURIComponent(process.env.EMAIL_FROM_ADDRESS!) +
            '/sendMail',
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + (await this.token()),
              'Content-Type': 'text/plain',
              'client-request-id': attempt,
            },
            body: mimeMessage(to, content, attempt),
          },
        );
        if (response.status === 202) {
          this.logger.log('email_attempt=' + attempt + ' status=accepted');
          return { status: 'accepted' as const };
        }
        if (response.status === 401 && !refreshed && retry < 2) {
          this.cached = undefined;
          refreshed = true;
          continue;
        }
        if (response.status === 429 && retry < 2) {
          const header = response.headers.get('Retry-After');
          const seconds = header
            ? /^\d+$/.test(header)
              ? Number(header)
              : Math.ceil((Date.parse(header) - Date.now()) / 1000)
            : 1;
          if (!Number.isFinite(seconds) || seconds < 0 || seconds > 10)
            throw new EmailFailure('throttled_retry_later');
          await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
          continue;
        }
        // No idempotency guarantee: never retry ambiguous sendMail 5xx/network failures.
        const explanations: Record<number, string> = {
          401: 'Graph rejected the application token after refresh. Verify tenant and client configuration.',
          403: 'Graph denied this mailbox send. Verify scoped Exchange Application Mail.Send authorization and propagation; SMTP SendAs grants alone are insufficient.',
          429: 'Graph throttled the request. Wait before requesting another send.',
        };
        throw new EmailFailure(
          'graph_http_' + response.status,
          explanations[response.status] ??
            'Graph did not accept the request. For network or server errors acceptance may be unknown; inspect message trace before resending.',
          await graphResponseDetails(response, [
            process.env.MICROSOFT_CLIENT_SECRET ?? '',
            this.cached?.value ?? '',
            to,
          ]),
        );
      }
      throw new EmailFailure('retry_exhausted');
    } catch (error) {
      const reason =
        error instanceof EmailFailure
          ? error.message
          : 'invalid_configuration_or_response';
      this.logger.warn(
        'email_attempt=' + attempt + ' status=failed reason=' + reason,
      );
      throw new EmailFailure(
        reason,
        error instanceof EmailFailure ? error.explanation : undefined,
        error instanceof EmailFailure ? error.graph : undefined,
      );
    }
  }
  async passwordChanged(to: string, at = new Date()) {
    try {
      await this.send(
        to,
        securityEmail(
          'Your PayStream Password Was Changed',
          'The password for ' +
            to +
            ' was changed on ' +
            at.toISOString() +
            '. If you did not make this change, contact your organization administrator or support team immediately.',
        ),
      );
    } catch {
      /* Change remains committed; send logs failure. */
    }
  }
}
export function securityEmail(
  subject: string,
  text: string,
  url?: string,
): EmailContent {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  return {
    subject,
    text: text + (url ? '\n' + url : ''),
    html:
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f2;font-family:Segoe UI,Arial,sans-serif;color:#16261f"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="560" style="width:100%;max-width:560px;background:white"><tr><td style="padding:24px;background:#12292b;color:#c6eba6"><strong>PayStream</strong></td></tr><tr><td style="padding:28px"><h1>' +
      escape(subject) +
      '</h1><p>' +
      escape(text) +
      '</p>' +
      (url
        ? '<p><a style="display:inline-block;background:#1f4a3a;color:white;padding:14px 24px" href="' +
          escape(url) +
          '">Reset Password</a></p><p>Or copy this secure link: ' +
          escape(url) +
          '</p>'
        : '') +
      '<p>Contact your organization administrator for support.</p><p>PayStream &middot; An Excelhire Product</p></td></tr></table></td></tr></table></body></html>',
  };
}

// Graph accepts base64 RFC 5322 MIME, providing a real multipart plain-text alternative.
export function mimeMessage(
  to: string,
  content: EmailContent,
  attempt: string,
) {
  if (!/^[^<>\s\r\n]+@[^<>\s\r\n]+$/.test(to))
    throw new EmailFailure('invalid_recipient');
  const encoded = (value: string) =>
    Array.from(value)
      .reduce<string[]>((parts, c, i) => {
        const index = Math.floor(i / 10);
        parts[index] = (parts[index] || '') + c;
        return parts;
      }, [])
      .map((part) => '=?UTF-8?B?' + Buffer.from(part).toString('base64') + '?=')
      .join('\r\n ');
  const body = (value: string) =>
    Buffer.from(value)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? '';
  const boundary = 'paystream_' + attempt;
  const lines = [
    'From: ' +
      encoded(process.env.EMAIL_FROM_NAME || 'PayStream') +
      ' <' +
      process.env.EMAIL_FROM_ADDRESS +
      '>',
    'To: <' + to + '>',
    'Subject: ' + encoded(content.subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + attempt + '@excelhire.us>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
  ];
  for (const [type, value] of [
    ['plain', content.text],
    ['html', content.html],
  ])
    lines.push(
      '--' + boundary,
      'Content-Type: text/' + type + '; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      body(value),
    );
  lines.push('--' + boundary + '--', '');
  return Buffer.from(lines.join('\r\n')).toString('base64');
}
