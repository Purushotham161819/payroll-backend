export interface GraphResponseDetails {
  httpStatus: number;
  code?: string;
  message?: string;
  requestId?: string;
  clientRequestId?: string;
  responseDate?: string;
  retryAfter?: string;
}

// Only explicitly selected fields may leave a Graph response. Never log headers
// wholesale, raw bodies, recipient identities or the token's full JWT claims.
export async function graphResponseDetails(
  response: Response,
  sensitive: string[],
): Promise<GraphResponseDetails> {
  const redact = (input: unknown) => {
    if (typeof input !== 'string') return undefined;
    let value = input;
    for (const secret of sensitive.filter(Boolean))
      value = value.split(secret).join('[redacted]');
    return value
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(
        /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g,
        '[redacted-token]',
      )
      .replace(
        /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi,
        '[redacted-address]',
      )
      .replace(/[\r\n\x00-\x1f]/g, ' ')
      .slice(0, 1000);
  };
  const identifier = (value: unknown) =>
    typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)
      ? value
      : undefined;
  let error: Record<string, unknown> = {};
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body?.error && typeof body.error === 'object')
      error = body.error as Record<string, unknown>;
  } catch {
    /* Non-JSON error pages are never printed. */
  }
  const inner =
    error.innerError && typeof error.innerError === 'object'
      ? (error.innerError as Record<string, unknown>)
      : {};
  return {
    httpStatus: response.status,
    code: redact(error.code),
    message: redact(error.message),
    requestId:
      identifier(response.headers.get('request-id')) ??
      identifier(inner['request-id']),
    clientRequestId:
      identifier(response.headers.get('client-request-id')) ??
      identifier(inner['client-request-id']),
    responseDate: redact(response.headers.get('date') ?? inner.date),
    retryAfter: redact(response.headers.get('Retry-After')),
  };
}

export function tokenIdentitySummary(token: string) {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const guid = (value: unknown) =>
      typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value)
        ? value
        : undefined;
    const appId = guid(claims.appid ?? claims.azp);
    const tenantId = guid(claims.tid);
    return {
      inspection:
        'decoded claims for diagnostics; signature not independently validated here',
      applicationId: appId,
      tenantId,
      servicePrincipalObjectId: guid(claims.oid),
      applicationMatchesConfigured:
        !!appId &&
        appId.toLowerCase() === process.env.MICROSOFT_CLIENT_ID?.toLowerCase(),
      tenantMatchesConfigured:
        !!tenantId &&
        tenantId.toLowerCase() ===
          process.env.MICROSOFT_TENANT_ID?.toLowerCase(),
      audienceIsMicrosoftGraph:
        claims.aud === 'https://graph.microsoft.com' ||
        claims.aud === 'https://graph.microsoft.com/' ||
        claims.aud === '00000003-0000-0000-c000-000000000000',
      delegatedScopesPresent: typeof claims.scp === 'string' && !!claims.scp,
      tokenType: claims.idtyp === 'app' ? 'app' : 'unspecified',
      roles: Array.isArray(claims.roles)
        ? claims.roles
            .filter(
              (role): role is string =>
                typeof role === 'string' &&
                /^[A-Za-z]+(?:\.[A-Za-z]+)+$/.test(role),
            )
            .slice(0, 100)
        : [],
      authorizationNote:
        'Exchange Application RBAC grants are evaluated by Exchange and need not appear in token roles. Token roles alone cannot audit every effective tenant grant.',
    };
  } catch {
    return { inspection: 'token claims not readable; token was not displayed' };
  }
}
