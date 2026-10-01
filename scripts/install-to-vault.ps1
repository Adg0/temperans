[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$VaultPath
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$vault = Resolve-Path -LiteralPath $VaultPath -ErrorAction Stop
$obsidianDirectory = Join-Path $vault.Path ".obsidian"

if (-not (Test-Path -LiteralPath $obsidianDirectory -PathType Container)) {
  throw "'$($vault.Path)' is not an Obsidian vault because its .obsidian directory is missing."
}

$requiredFiles = @("main.js", "manifest.json", "styles.css")
foreach ($name in $requiredFiles) {
  $source = Join-Path $projectRoot $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing '$name'. Run 'pnpm build' in '$projectRoot' first."
  }
}

$pluginDirectory = Join-Path $obsidianDirectory "plugins\temperans-habits"
New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
foreach ($name in $requiredFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $pluginDirectory $name) -Force
}

# Obsidian loads only plugin IDs listed here. Add ours without touching data.json
# or other plugins, so updates remain active after an app restart.
$pluginId = "temperans-habits"
$enabledPluginsPath = Join-Path $obsidianDirectory "community-plugins.json"
$enabledPlugins = @()
$canUpdateEnabledPlugins = $true
$shouldWriteEnabledPlugins = -not (Test-Path -LiteralPath $enabledPluginsPath -PathType Leaf)
if (Test-Path -LiteralPath $enabledPluginsPath -PathType Leaf) {
  try {
    $parsed = Get-Content -LiteralPath $enabledPluginsPath -Raw | ConvertFrom-Json -ErrorAction Stop
    $enabledPlugins = @($parsed | ForEach-Object { [string]$_ })
    # A valid Obsidian config is a JSON array. Normalize an older scalar value.
    if ($parsed -isnot [System.Array]) { $shouldWriteEnabledPlugins = $true }
  } catch {
    $canUpdateEnabledPlugins = $false
    Write-Warning "Could not read community-plugins.json, so the plugin was copied but not auto-enabled. Enable Temperans Habits in Obsidian Settings."
  }
}
if ($canUpdateEnabledPlugins -and $enabledPlugins -notcontains $pluginId) {
  $enabledPlugins = @($enabledPlugins) + $pluginId
  $shouldWriteEnabledPlugins = $true
}
if ($canUpdateEnabledPlugins -and $shouldWriteEnabledPlugins) {
  ConvertTo-Json -InputObject ([object[]]$enabledPlugins) | Set-Content -LiteralPath $enabledPluginsPath -Encoding utf8
}

Write-Host "Temperans Habits installed in $pluginDirectory"
if ($canUpdateEnabledPlugins) {
  Write-Host "Temperans Habits is registered to load automatically when Obsidian reopens."
}
