# PayStream email integration guide

## Runtime and configuration

PayStream uses one `EmailService` with built-in Node fetch and OAuth client credentials. Existing `InvitationMail` is a compatibility adapter, not a separate provider. No SMTP connection or delegated sign-in is used. Graph receives base64 MIME with HTML and plain-text alternatives. A 202 response means **accepted**, never confirmed delivery.

Copy the email placeholders from `.env.example` into the ignored local `.env` or deployment secrets manager. Required when enabled: `EMAIL_PROVIDER=microsoft_graph`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `EMAIL_FROM_ADDRESS=ps-noreply@excelhire.us`. Optional display name: `EMAIL_FROM_NAME=PayStream`. Use the exact `FRONTEND_ORIGIN`; production requires HTTPS. `EMAIL_ENABLED=false` explicitly disables email for isolated local development; invitation attempts then report failure and reset requests remain generic. Enabled configuration is validated at startup. Nothing belongs in Angular or API responses. `.gitignore` excludes `.env` and `.env.*`, except `.env.example`.

Configuration repair inspection found that the private backend .env had no email settings, while the example file contained populated credentials. The example has been restored to placeholders. Rotate the secret exposed in that example and store the new Value only in the ignored private .env or secrets manager. No private .env credentials were changed. No Microsoft 365 tenant connection or permission modification was performed.

1. Open Entra admin center > App registrations > existing **PayStream Email Service**. Copy Application (client) ID and Directory (tenant) ID into the private configuration.
2. Certificates & secrets > Client secrets > New client secret. Use an appropriate short lifetime and store the **Value**, not the secret ID, immediately in the approved secrets manager as `MICROSOFT_CLIENT_SECRET`. Never paste it into chat, source, command history or Angular.
3. Enterprise applications > existing application > Properties provides the **enterprise application object ID**. This differs from the app registration object ID. Reuse the existing Exchange pointer.
4. Run the following tenant audit/setup in an administrator PowerShell terminal with ExchangeOnlineManagement and Microsoft.Graph.Applications installed. Administrative interactive sign-in is for setup only; application runtime is noninteractive.

## Configuration loading and safe diagnostics

The single loader is src/environment.ts, imported first by main.ts and by the standalone diagnostic. It uses Node's native loadEnvFile, not dotenv or Nest ConfigModule/ConfigService. Both src/environment.ts and dist/environment.js resolve ../.env relative to their own directory, so launching from another directory cannot select that directory's .env. The example file is never a runtime source. Existing shell/deployment settings retain precedence, including empty settings; remove an accidental shell override rather than silently masking it. Native Node parsing handles ordinary quoted values and surrounding assignment whitespace. Provider and enable flag values themselves remain strict: microsoft_graph and true/false, respectively.

Save the actual backend .env editor buffer before running. In PowerShell on this machine use npm.cmd to avoid the unrelated unsigned npm.ps1 policy issue:

```powershell
Set-Location D:\projects\payroll-backend
npm.cmd run email:diagnostics
# No message is sent by the default command. An approved recipient is explicit:
$recipient = Read-Host 'Approved test recipient'
npm.cmd run email:diagnostics -- --to $recipient
npm.cmd run start:dev
```

The diagnostic opens no database and creates no user records or account tokens. It reports the exact resolved environment path, file presence, sanitized provider/enabled/sender status, credential presence only, validation result and OAuth success/failure. IDs, secrets, token responses and message contents are never printed. Exit 1 means invalid config/OAuth/send failure; exit 0 means the requested checks passed or email was explicitly disabled (reported as not tested). Explicit EMAIL_ENABLED=false remains supported for isolated local work; missing/invalid provider is never replaced by SMTP or silently disabled.

The diagnostic uses the same EmailService token acquisition/cache/refresh and sender as the application. Microsoft OAuth failures expose numeric AADSTS codes plus a fixed explanation, never error_description or the raw response: AADSTS7000215 means invalid secret Value; AADSTS7000222 means expired secret; AADSTS700016 means app/tenant mismatch. A test send reports 202 Accepted separately from recipient receipt. A 403 points to mailbox authorization; do not assume old SMTP FullAccess/SendAs grants are sufficient. A successful OAuth token alone cannot establish mailbox access, and a successful send cannot establish mailbox-only scope isolation. The diagnostic always directs the administrator to the checks below; it does not request extra tenant-wide read permissions to impersonate a tenant audit.

See [Microsoft Entra error reference](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes) for the numeric error meanings.

## Audit existing authorization and scope

```powershell
Connect-ExchangeOnline
Connect-MgGraph -Scopes 'Application.Read.All'
# Read the actual configured client ID; do not use a fabricated example ID.
$appId = Read-Host 'Existing PayStream Application (client) ID'
$entra = @(Get-MgServicePrincipal -Filter "appId eq '$appId'")
if ($entra.Count -ne 1) { throw 'Expected exactly one existing enterprise application' }
$exo = @(Get-ServicePrincipal | Where-Object { $_.AppId -eq $appId })
if ($exo.Count -ne 1) { throw 'Expected the existing Exchange service principal; investigate, do not create duplicates' }
$entra | Format-List Id,AppId,DisplayName
$exo | Format-List Identity,ObjectId,AppId,DisplayName
Get-ManagementScope -Identity 'PayStream-Mailbox-Scope' -ErrorAction SilentlyContinue | Format-List Name,RecipientFilter
Get-ManagementRoleAssignment -RoleAssignee $exo[0].ObjectId | Format-List Name,Role,CustomResourceScope,RecipientWriteScope
# Audit ALL direct Entra application grants, including Exchange SMTP and broad Graph roles.
$grants = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $entra[0].Id -All
$inventory = foreach ($grant in $grants) {
    $resource = Get-MgServicePrincipal -ServicePrincipalId $grant.ResourceId
    $role = $resource.AppRoles | Where-Object Id -eq $grant.AppRoleId
    [pscustomobject]@{ AssignmentId=$grant.Id; Resource=$resource.DisplayName; Permission=$role.Value; ResourceId=$grant.ResourceId }
}
$inventory | Format-Table -AutoSize
Get-MailboxPermission -Identity 'ps-noreply@excelhire.us' | Format-Table User,AccessRights,Deny
Get-RecipientPermission -Identity 'ps-noreply@excelhire.us' | Format-Table Trustee,AccessRights
```

Save this inventory securely. Stop rollout if unrestricted Entra Graph `Mail.Send` or other broad Exchange roles authorize additional mailboxes. Entra and Exchange Application RBAC grants are additive. Exchange authorization tests exclude Entra grants, so an `InScope=False` alone does not prove complete denial. Do not add tenant-wide Graph `Mail.Send` or enable SMTP AUTH/Security Defaults changes.

## Create only missing scoped Exchange configuration

The correct current cmdlet is `New-ManagementRoleAssignment`, **not** `New-ApplicationRoleAssignment` (the latter was suggested in the request). Verify the existing scope filter and every assignment before creating anything. If an existing scope has a different filter, investigate its consumers before changing it.

```powershell
$scope = Get-ManagementScope -Identity 'PayStream-Mailbox-Scope' -ErrorAction SilentlyContinue
if (!$scope) {
    New-ManagementScope -Name 'PayStream-Mailbox-Scope' -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'ps-noreply@excelhire.us'"
}
$scope = Get-ManagementScope -Identity 'PayStream-Mailbox-Scope'
Get-Recipient -RecipientPreviewFilter $scope.RecipientFilter | Format-Table PrimarySmtpAddress
# Preview MUST resolve to only the designated mailbox. Inspect existing assignments above.
# Run this only if no equivalent scoped Application Mail.Send assignment already exists:
New-ManagementRoleAssignment -Name 'PayStream-Scoped-Mail.Send' -Role 'Application Mail.Send' -App $exo[0].ObjectId -CustomResourceScope 'PayStream-Mailbox-Scope'
Test-ServicePrincipalAuthorization -Identity $exo[0].ObjectId -Resource 'ps-noreply@excelhire.us' | Format-Table RoleName,GrantedPermissions,AllowedResourceScope,InScope
$unrelatedMailbox = Read-Host 'Actual unrelated mailbox address for negative authorization test'
if ($unrelatedMailbox -eq 'ps-noreply@excelhire.us') { throw 'Use a different existing mailbox' }
Test-ServicePrincipalAuthorization -Identity $exo[0].ObjectId -Resource $unrelatedMailbox | Format-Table RoleName,GrantedPermissions,AllowedResourceScope,InScope
```

Require `Application Mail.Send` InScope=True for the sender and no sending grant in scope for the unrelated mailbox. Review/remove any broad EXO assignment through your change process; do not automatically remove unrelated permissions. Allow Microsoft authorization propagation/cache time before retesting.

## Real delivery acceptance test

1. Configure credentials and scope, restart backend, and use an approved test recipient controlled by your organization. An approved recipient was supplied during the configuration-repair follow-up; use an explicit --to argument for that test.
2. As an organization administrator, create a disposable test user in that same organization. Confirm account creation and Graph-accepted feedback. Check sanitized `email_attempt` logs for `status=accepted` (HTTP 202).
3. In the recipient mailbox confirm sender **PayStream <ps-noreply@excelhire.us>**, subject, HTML/text formatting and environment URL. Check junk/quarantine or Exchange message trace if missing. A Graph 202 is not evidence of receipt.
4. Follow Set Password, verify single use, then sign in. After a minute resend another pending invitation and confirm its earlier link is invalid.
5. Request Forgot Password. Unknown and known accounts return the same generic response. Reset link expires after 30 minutes, is single-use, revokes sessions and triggers a security notification. Test expired/used links and verify the notification is received once.
6. Record actual acceptance, recipient confirmation and negative authorization evidence in the implementation report. These remain **not performed** until an administrator runs them.

## Failure handling and operations

Token refresh is coalesced per process with 60 seconds of expiry headroom. Requests time out after 10 seconds; redirects are rejected. A Graph 401 permits one refresh; 403 and other permanent errors stop. Explicit 429 permits at most two retries and respects numeric or date `Retry-After` up to 10 seconds per retry. Longer/invalid delays fail for later manual action. Ambiguous 5xx/timeouts are never automatically retried: Graph sendMail has no idempotency key. Message-ID/request IDs aid correlation, not deduplication guarantees. Logs contain random attempt IDs and sanitized reasons, never recipients, email contents, tokens or secrets. Export application logs to your normal durable log sink.

Invitation records retain the existing legacy `sent` enum/API flag for compatibility; it now means **Graph accepted**. Successful UI feedback explicitly says delivery is unconfirmed. Failed invitations retain the user and can be resent after cooldown. Password changes remain successful if the security notification fails, with a sanitized failure log. Logs require operational monitoring; there is no automatic replay or delivered/read callback.

Forgot Password uses a bounded 100-item in-memory queue so the HTTP response is independent of lookup/send latency. The queue is deliberately not durable: restart or overload can lose a request, and an existing account-management lock may cause a generic logged failure. Request again later. IP rate limiting is 10 attempts/15 minutes; persisted per-account cooldown is one minute across workers. Public inspect/complete routes also share that limit. Multi-instance deployments should place shared rate limiting at the gateway; the current IP limiter is per process. No raw reset/invitation tokens are persisted. For guaranteed processing, a future durable encrypted outbox and distributed limiter require separate deployment infrastructure.

Common diagnostics: token HTTP 400/401 => IDs/secret value/expiration; Graph 401 => token or tenant; Graph 403 => scoped role, propagation, mailbox and direct-grant audit; 429 => wait then request again; network/5xx => acceptance unknown, check message trace before manual resend. Never turn on SMTP AUTH to troubleshoot Graph.

## Credential rotation and sender changes

Create an overlapping secret on the existing app, update secrets manager, restart all backend workers to drop cached tokens, test acceptance/receipt, then remove the old secret in Entra. Set expiry monitoring. Certificate or workload identity is preferable for production, but this implementation supports client-secret authentication only; no certificate signing/key-vault architecture existed to reuse.

Changing sender requires an administrator to establish/retest a mailbox-only scope, inspect all additive grants, change the backend's explicit sender allowlist and MIME Message-ID domain if necessary, update `EMAIL_FROM_ADDRESS`, restart and test positive/negative authorization and receipt. Changing an environment variable alone cannot bypass the allowlist.

## SMTP cleanup: only AFTER real Graph verification

No tenant permission was removed. Nodemailer dependency is retained pending real Graph validation; no runtime SMTP adapter remains. `.env.example` now documents Graph only. Preserve any private legacy config until verification, then remove obsolete SMTP variables from private environment/deployment settings.

Record exact original grants, intended removals and reason (old SMTP-only transport), confirm no other consumer uses them, and obtain your normal tenant change approval. Then in the administrator terminal:

```powershell
# Reconnect with write permission only for this explicit administrator cleanup.
Connect-MgGraph -Scopes 'AppRoleAssignment.ReadWrite.All','Application.Read.All'
# Use the reviewed inventory above; select the EXACT assignment ID, never all grants.
$obsoleteAssignmentId = Read-Host 'Reviewed obsolete SMTP.SendAsApp assignment ID (or conflicting Mail.Send ID)'
$selected = @($inventory | Where-Object AssignmentId -eq $obsoleteAssignmentId)
if ($selected.Count -ne 1 -or $selected[0].Permission -notin @('SMTP.SendAsApp','Mail.Send')) { throw 'Not an approved obsolete email grant' }
Remove-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $entra[0].Id -AppRoleAssignmentId $obsoleteAssignmentId
# Only if these exact mailbox grants were solely for the previous SMTP implementation:
Remove-MailboxPermission -Identity 'ps-noreply@excelhire.us' -User $exo[0].ObjectId -AccessRights FullAccess
Remove-RecipientPermission -Identity 'ps-noreply@excelhire.us' -Trustee $exo[0].ObjectId -AccessRights SendAs
```

Conflicting unrestricted Mail.Send blocks a scoped-only rollout: document it and schedule removal before declaring mailbox isolation verified. After cleanup repeat positive/negative scope tests, direct-grant inventory, and real receipt test. Keep the service principal and Entra application. Record each removal and exact grant ID in your tenant change log. Uninstall unused nodemailer only after verification (`npm.cmd uninstall nodemailer`), review lockfile and rebuild.

References: [Exchange Application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [Graph sendMail including MIME and 202 semantics](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Verified current send and 403 evidence

The current integration was live-tested successfully on 5 November 2026: Graph returned 202 and the approved recipient confirmed receipt, sender and formatting. No endpoint, credential or permission change was needed to obtain this result. See EMAIL_403_INVESTIGATION.md for token identity matches, historical-403 evidence limits and the exact remaining read-only scope-isolation audit using the existing principal/assignment. The enhanced diagnostic now reports selected decoded token identity claims and sanitized Graph error code/message/correlation headers when a send fails. An empty roles claim alone does not invalidate Exchange Application RBAC. Historical sections describing missing private configuration or unperformed receipt tests describe earlier execution stages and are superseded by this verification.
