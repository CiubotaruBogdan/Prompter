#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('(?-i:^[a-p]{32}$)')]
    [string] $StoreExtensionId
)

$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'Build the Windows helper on 64-bit Windows.' }

$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
if (!(Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw 'The 64-bit .NET Framework C# compiler was not found.'
}

$source = Join-Path $PSScriptRoot 'windows\PrompturiHost.cs'
$output = Join-Path $PSScriptRoot 'windows'
if ($StoreExtensionId) {
    $output = Join-Path $PSScriptRoot "dist\windows-store-$StoreExtensionId"
}
$null = New-Item -ItemType Directory -Path $output -Force
$executable = Join-Path $output 'PrompturiHost.exe'
$compilerArguments = @(
    '/nologo', '/target:winexe', '/optimize+', '/warnaserror+', "/out:$executable",
    '/r:System.Windows.Forms.dll', '/r:System.Web.Extensions.dll',
    "/r:$framework\WPF\UIAutomationClient.dll", "/r:$framework\WPF\UIAutomationTypes.dll",
    "/r:$framework\WPF\WindowsBase.dll", $source
)

$identity = $null
try {
    if ($StoreExtensionId) {
        $identity = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($identity, @"
internal static class StoreIdentity
{
    internal const string ExtensionId = "$StoreExtensionId";
}
"@)
        $compilerArguments += '/define:STORE_BUILD', $identity
    }
    & $compiler @compilerArguments
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the Windows helper.' }
} finally {
    if ($identity) { [System.IO.File]::Delete($identity) }
}

Get-FileHash -Algorithm SHA256 -LiteralPath $executable
