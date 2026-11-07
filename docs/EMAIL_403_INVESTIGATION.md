# Microsoft Graph HTTP 403 investigation

Date: 5 November 2026 (America/Chicago)

## Outcome

The existing implementation successfully sent the approved test message from `ps-noreply@excelhire.us` to the recipient supplied by the user. Microsoft Graph returned **HTTP 202 Accepted**. The user subsequently confirmed **Received; sender and formatting look correct**. This is recipient confirmation, not merely an OAuth success or an API acceptance assumption.

No email transport, credential, endpoint, mailbox permission, service principal or RBAC assignment was changed to achieve that success. The successful request used the original implementation before the observability changes described below. There is no basis for granting unrestricted Graph Mail.Send or recreating the already-configured scoped assignment.

## Root cause: what the evidence establishes

**The historical 403's exact root cause cannot be established from the available record.** The previous diagnostic discarded Graph's error body and correlation headers. The reported failure is no longer reproducible: the first live send from an unrestricted network context succeeded unchanged. Labeling a particular tenant setting as its proven cause would be speculation.

A transient Exchange authorization cache/propagation delay is consistent with the reported sequence (new scoped assignment, PowerShell InScope=True, earlier live denial, later unchanged live success), but is **not proven**. Microsoft's documentation states authorization changes can be cached for 30 minutes to 2 hours and that the PowerShell test bypasses that cache. Thus the original positive test and an earlier API denial are not contradictory. No historical timestamp/correlation data was supplied to establish that as the definitive explanation.

A separate, directly reproduced limitation affected this agent's sandbox: its first attempt failed at OAuth with `network_or_timeout_unknown`, before any Graph send request. Running the explicitly authorized diagnostic with network access then succeeded. This network restriction does **not** explain or reclassify the user's earlier HTTP 403.

## Identity and request evidence

A fresh token-only check after the accepted message produced the following selected, nonsecret claim summary. No raw token, client secret or full claims were displayed.

| Check | Actual result |
|---|---|
| Application ID from token | f283ee4e-49c5-4a92-b674-9e699c600983 |
| Matches private configured client ID | True |
| Matches user-supplied Exchange app ID | True |
| Tenant ID from token | 7fc34dce-41ae-45a4-a13b-e3bbccafe150 |
| Matches private configured tenant ID | True |
| Token service-principal object ID | ae21cf95-77ac-469b-be92-af3e7abd0b9e |
| Matches user-supplied Exchange principal identity | True |
| Audience is Microsoft Graph | True |
| Token type claim | app |
| Delegated scopes present | False |
| Token roles | Empty list |
| Sender configured | ps-noreply@excelhire.us |
| Environment file | D:\projects\payroll-backend\.env, loaded successfully |

Claims were decoded locally for diagnostics; no separate JWT signature-validation feature was added. The token was obtained directly over HTTPS from Microsoft's token endpoint, and Graph accepted it. The diagnostic does not use decoded claims as an authorization decision.

The actual implementation uses:

- OAuth `POST https://login.microsoftonline.com/{configured tenant}/oauth2/v2.0/token` with URL-encoded client_id, client_secret, grant_type=client_credentials, scope=https://graph.microsoft.com/.default.
- Graph `POST https://graph.microsoft.com/v1.0/users/ps-noreply%40excelhire.us/sendMail`. The encoded @ is the same mailbox identifier, not a different endpoint. `/me/sendMail` is never used.
- `Authorization: Bearer` with the acquired application token. It is never logged.
- `Content-Type: text/plain`, with a base64-encoded RFC 5322 multipart/alternative MIME body containing HTML and plain text. Graph explicitly supports this format; it is not required to be JSON. Changing to JSON would not explain the observed unchanged success.
- Sender fixed to the designated mailbox, configurable display name PayStream; approved recipient passed explicitly to the standalone diagnostic.
- Token caching with expiry headroom, coalesced acquisition, one 401 refresh, bounded explicit-429 retries, no automatic retry of ambiguous network/5xx failures.

An empty token roles list does not invalidate scoped Exchange authorization: Exchange RBAC grants are independent of Entra app-role grants. The accepted message is direct evidence that the current token can send from this mailbox. The empty roles list provides no evidence of an unrestricted Graph Mail.Send grant in this fresh token, but it is not a complete tenant permission inventory or a negative-mailbox test.

## Live verification

Executed once with an approved recipient and network access:

```powershell
npm.cmd run email:diagnostics -- --to purushotham.abntech@gmail.com
```

Result: configuration valid; OAuth authenticated; `sendMail: HTTP 202 Accepted`. Application attempt ID: `b20e5af1-e3cd-415a-bb28-b6c1d2458684`. This is an application correlation ID, not a captured Microsoft response request ID. The original provider did not retain success response headers, so no Microsoft request ID was reconstructed or invented.

The recipient independently confirmed receipt, correct sender and correct formatting in this chat. No mailbox content was accessed by the agent. A subsequent diagnostic without --to inspected token identity without sending another message. No duplicate live send was performed for repeated verification.

## Files modified for this investigation

- `src/auth/graph-diagnostics.ts` (new): selects Graph HTTP status, error code/message, request/client request IDs, response date and Retry-After; redacts known credentials/tokens/recipient and email addresses; never dumps raw error pages or full headers. Adds a bounded, selected token identity summary with configuration comparisons, Graph audience, token type, scopes-presence flag and roles.
- `src/auth/graph-diagnostics.spec.ts` (new): redaction, selected-header handling, non-JSON error safety, token identity checks and empty-role handling.
- `src/auth/email.service.ts`: preserves safe Graph failure details through EmailFailure; token-only authentication check returns the selected identity summary. Normal application logs still contain only sanitized attempt/status information. The send endpoint, MIME payload, sender, credentials, invitation/reset integration and retry policy are unchanged.
- `src/auth/email.service.spec.ts`: provider-boundary Graph error detail and redaction regression coverage.
- `src/email-diagnostics.ts`: prints selected token identity and safe Graph failure details for future failures.
- `docs/EMAIL_INTEGRATION_GUIDE.md`, `docs/EMAIL_IMPLEMENTATION_REPORT.md`, and this report: current evidence and remaining scope validation.

The private `.env` was neither modified nor overwritten. No tenant setting, permission, service principal or RBAC assignment was created, removed or changed. No payroll functionality or unrelated test was modified. No commit or push was performed.

## Remaining administrator action

**No administrator change is required to repair the currently working sender.** Do not create duplicate principals/assignments or add tenant-wide Graph Mail.Send. Complete the remaining read-only scope-isolation audit, which was not accessible using this application's sending-only credentials:

```powershell
Connect-ExchangeOnline
$spId = 'ae21cf95-77ac-469b-be92-af3e7abd0b9e'
Get-ServicePrincipal -Identity $spId | Format-List AppId,ObjectId,Identity,DisplayName
Get-ManagementRoleAssignment -Identity 'PayStream-MailSend-Assignment' | Format-List Name,Role,RoleAssignee,CustomResourceScope
Get-ManagementRoleAssignment -RoleAssignee $spId | Format-List Name,Role,CustomResourceScope,RecipientWriteScope
$scope = Get-ManagementScope -Identity 'PayStream-Mailbox-Scope'
$scope | Format-List Name,RecipientFilter
Get-Recipient -RecipientPreviewFilter $scope.RecipientFilter | Format-Table PrimarySmtpAddress
# Preview must include only the designated mailbox.
Test-ServicePrincipalAuthorization -Identity $spId -Resource 'ps-noreply@excelhire.us' | Format-Table RoleName,GrantedPermissions,AllowedResourceScope,InScope
$unrelated = Read-Host 'Actual unrelated mailbox for the negative scope test'
if ($unrelated -eq 'ps-noreply@excelhire.us') { throw 'Use a different existing mailbox' }
Test-ServicePrincipalAuthorization -Identity $spId -Resource $unrelated | Format-Table RoleName,GrantedPermissions,AllowedResourceScope,InScope

# Read-only inventory of direct Entra application grants; this does not modify
# PayStream app permissions. Use an administrator authorized to read applications.
Connect-MgGraph -Scopes 'Application.Read.All'
$grants = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $spId -All
foreach ($grant in $grants) {
    $resource = Get-MgServicePrincipal -ServicePrincipalId $grant.ResourceId
    $role = $resource.AppRoles | Where-Object Id -eq $grant.AppRoleId
    [pscustomobject]@{ Resource=$resource.DisplayName; Permission=$role.Value; AssignmentId=$grant.Id }
}
```

The negative test must show no effective sending role in scope for the unrelated mailbox. Review all direct grants and Exchange role assignments for broad access. The PowerShell authorization test excludes separate Entra grants, so the negative test alone cannot certify the absence of additive grants. No unrelated mailbox was supplied for a live negative test; no message was sent to or from an unrelated mailbox. The existing sender allowlist remains intact.

If a 403 recurs, run the enhanced diagnostic once and retain its redacted Graph code/message, request ID, client request ID and date. Those are the concrete evidence needed to attribute that incident. After an ambiguous timeout/5xx, check message trace before manually retrying; 202 and user-confirmed receipt have already been obtained here.

References: [Exchange Application RBAC, cache limits and test behavior](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [Graph sendMail MIME and acceptance semantics](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Focused automated verification

Seven email-focused suites passed: 50 tests passed, one optional browser test skipped. These cover environment loading, OAuth/token caching, safe Graph evidence, the diagnostic, invitation delivery adapter, invitation/reset completion and password-change notification integration. No unrelated payroll/TDS/employee/contractor/organization regression was run. `git diff --check` passed. Backend build result is recorded below after completion.

Final HTTP 403 investigation verification: backend build passed; 50 focused email tests passed, one optional browser test skipped. Live Graph returned HTTP 202 Accepted, and the user independently confirmed receipt with correct sender and formatting. No private configuration or tenant permissions were changed.
