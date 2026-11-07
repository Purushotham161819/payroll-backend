import { environmentLoad } from './environment';
import { isEmail } from 'class-validator';
import {
  EmailFailure,
  EmailService,
  securityEmail,
} from './auth/email.service';

// Standalone diagnostic: use the runtime loader/provider without starting Nest,
// opening MongoDB, creating users or generating account tokens.
export async function emailDiagnostics(
  args = process.argv.slice(2),
  report = (value: unknown) => console.log(JSON.stringify(value, null, 2)),
) {
  let recipient: string | undefined;
  if (args.length) {
    if (
      args.length !== 2 ||
      args[0] !== '--to' ||
      !isEmail(args[1]) ||
      /[\r\n<>]/.test(args[1])
    ) {
      report({
        error:
          'Usage: npm.cmd run email:diagnostics [-- --to approved-recipient@example.com]',
      });
      return 1;
    }
    recipient = args[1];
  }
  const present = (key: string) =>
    process.env[key]?.trim()
      ? 'present'
      : process.env[key] === undefined
        ? 'missing'
        : 'empty';
  report({
    environmentFile: environmentLoad.file,
    environmentFileLoaded: environmentLoad.loaded,
    precedence:
      'Existing shell/deployment values override private .env, including explicit empty values.',
    provider:
      process.env.EMAIL_PROVIDER === 'microsoft_graph'
        ? 'microsoft_graph'
        : present('EMAIL_PROVIDER') === 'present'
          ? 'invalid'
          : present('EMAIL_PROVIDER'),
    enabled:
      process.env.EMAIL_ENABLED === undefined
        ? 'true (default)'
        : ['true', 'false'].includes(process.env.EMAIL_ENABLED)
          ? process.env.EMAIL_ENABLED
          : 'invalid',
    tenantId: present('MICROSOFT_TENANT_ID'),
    clientId: present('MICROSOFT_CLIENT_ID'),
    clientSecret: present('MICROSOFT_CLIENT_SECRET'),
    sender:
      process.env.EMAIL_FROM_ADDRESS === 'ps-noreply@excelhire.us'
        ? process.env.EMAIL_FROM_ADDRESS
        : present('EMAIL_FROM_ADDRESS') === 'present'
          ? 'invalid'
          : present('EMAIL_FROM_ADDRESS'),
    exchangeApplicationRbac:
      'not verified: an administrator must audit grants and run positive/negative Test-ServicePrincipalAuthorization checks from the integration guide',
  });
  const email = new EmailService();
  let phase = 'configuration';
  try {
    email.onModuleInit();
    if (process.env.EMAIL_ENABLED === 'false') {
      report({
        configuration: 'valid; explicitly disabled',
        oauth: 'not attempted',
        testEmail: 'not sent',
      });
      return 0;
    }
    report({ configuration: 'valid' });
    phase = 'oauth';
    const authentication = await email.checkAuthentication();
    report({
      oauth: 'authenticated; no token displayed',
      tokenIdentity: authentication.identity,
    });
    if (!recipient) {
      report({
        testEmail:
          'not sent; supply --to with an approved recipient to test sendMail',
      });
      return 0;
    }
    phase = 'sendMail';
    await email.send(
      recipient,
      securityEmail(
        'PayStream Email Integration Test',
        'This is an explicitly requested PayStream email diagnostic. No password or account token is included. Sent at ' +
          new Date().toISOString(),
      ),
    );
    report({
      sendMail: 'HTTP 202 Accepted',
      recipientDelivery: 'unverified; check the recipient inbox and formatting',
      exchangeApplicationRbac:
        'scope isolation still unverified; a successful send does not establish absence of unrestricted grants',
    });
    return 0;
  } catch (error) {
    report({
      phase,
      status: 'failed',
      reason:
        error instanceof EmailFailure
          ? error.message
          : 'invalid_configuration_or_response',
      explanation:
        error instanceof EmailFailure ? error.explanation : undefined,
      graph: error instanceof EmailFailure ? error.graph : undefined,
    });
    return 1;
  }
}

if (require.main === module) {
  void emailDiagnostics()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error(
        'Email diagnostics failed unexpectedly. No credentials displayed.',
      );
      process.exitCode = 1;
    });
}
