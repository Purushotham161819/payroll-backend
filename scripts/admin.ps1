param([ValidateSet('create', 'recover')][string]$Mode = 'create', [switch]$UseEnvironment)
$ErrorActionPreference = 'Stop'
$previousEmail = $env:BOOTSTRAP_ADMIN_EMAIL
$previousPassword = $env:BOOTSTRAP_ADMIN_PASSWORD
$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$passwordInput = $null
$confirmationInput = $null
$backendRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $backendRoot
try {
  if (-not $UseEnvironment) {
  $env:BOOTSTRAP_ADMIN_EMAIL = Read-Host 'Administrator email'
  $passwordInput = Read-Host 'Password (8-128 characters)' -AsSecureString
  $confirmationInput = Read-Host 'Confirm password' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordInput)
  $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmationInput)
  $env:BOOTSTRAP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($env:BOOTSTRAP_ADMIN_PASSWORD -cne [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)) {
    throw 'Passwords do not match'
  }
  }
  # Invoke this repository's standalone CLI directly, never an npm start script.
  & node (Join-Path $PSScriptRoot 'admin-cli.cjs') $Mode
  $commandExitCode = $LASTEXITCODE
} finally {
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
  if ($null -ne $passwordInput) { $passwordInput.Dispose() }
  if ($null -ne $confirmationInput) { $confirmationInput.Dispose() }
  $env:BOOTSTRAP_ADMIN_EMAIL = $previousEmail
  $env:BOOTSTRAP_ADMIN_PASSWORD = $previousPassword
  $previousPassword = $null
  Pop-Location
}
exit $commandExitCode
