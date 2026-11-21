#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidatePattern('(?-i:^[a-p]{32}$)')]
    [string] $StoreExtensionId
)

$ErrorActionPreference = 'Stop'
$extension = Join-Path $PSScriptRoot 'extensie'
$output = Join-Path $PSScriptRoot 'dist'
$manifest = Get-Content -LiteralPath (Join-Path $extension 'manifest.json') -Raw | ConvertFrom-Json -AsHashtable
$version = $manifest.version
if ($version -notmatch '^\d+(\.\d+){1,3}$') { throw 'Invalid extension version.' }
$manifest.Remove('key')
$manifestText = $manifest | ConvertTo-Json -Depth 12

$background = Get-Content -LiteralPath (Join-Path $extension 'background.js') -Raw
$developmentHost = 'const host = "ro.prompturi.chrome";'
if (!$background.Contains($developmentHost)) { throw 'The local native host setting could not be found.' }
$storeBackground = $background.Replace($developmentHost, 'const host = "ro.prompturi.chrome.store";')
$utf8 = [System.Text.UTF8Encoding]::new($false)
$archiveBytes = [System.IO.MemoryStream]::new()
try {
    $archive = [System.IO.Compression.ZipArchive]::new($archiveBytes, 'Create', $true)
    try {
        $textFiles = @{ 'manifest.json' = $manifestText; 'background.js' = $storeBackground }
        foreach ($name in $textFiles.Keys) {
            $entry = $archive.CreateEntry($name, 'Optimal')
            $writer = [System.IO.StreamWriter]::new($entry.Open(), $utf8)
            try { $writer.Write($textFiles[$name]) }
            finally { $writer.Dispose() }
        }
        foreach ($name in 'popup.html', 'popup.css', 'popup.js', 'icons/16.png', 'icons/32.png', 'icons/48.png', 'icons/128.png') {
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, (Join-Path $extension $name), $name, 'Optimal'
            )
        }
    } finally {
        $archive.Dispose()
    }
    $null = New-Item -ItemType Directory -Path $output -Force
    $package = Join-Path $output "Prompts-$version-store-draft.zip"
    [System.IO.File]::WriteAllBytes($package, $archiveBytes.ToArray())
} finally {
    $archiveBytes.Dispose()
}
Get-FileHash -Algorithm SHA256 -LiteralPath $package

if ($StoreExtensionId) {
    & (Join-Path $PSScriptRoot 'Build-Windows.ps1') -StoreExtensionId $StoreExtensionId
}
