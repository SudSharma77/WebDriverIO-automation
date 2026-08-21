#!/usr/bin/env pwsh
# Comprehensive workspace cleanup script to prevent file resurrection

Write-Host "🧹 Starting comprehensive workspace cleanup..." -ForegroundColor Yellow

# 1. Clear npm cache
Write-Host "Clearing npm cache..." -ForegroundColor Cyan
npm cache clean --force

# 2. Clear TypeScript service cache (if exists)
Write-Host "Clearing TypeScript cache..." -ForegroundColor Cyan
$tsCacheDir = Join-Path $env:TEMP "tscache"
if (Test-Path $tsCacheDir) {
    Remove-Item $tsCacheDir -Recurse -Force -ErrorAction SilentlyContinue
}

# 3. Remove node_modules and reinstall (clean slate)
Write-Host "Removing node_modules..." -ForegroundColor Cyan
if (Test-Path "node_modules") {
    Remove-Item "node_modules" -Recurse -Force
}

# 4. Remove any potential VS Code workspace cache
Write-Host "Cleaning VS Code workspace data..." -ForegroundColor Cyan
$vsCodeWorkspaceFile = ".vscode/workspace-state.json"
if (Test-Path $vsCodeWorkspaceFile) {
    Remove-Item $vsCodeWorkspaceFile -Force -ErrorAction SilentlyContinue
}

# 5. Remove unwanted directories if they exist
$unwantedDirs = @("src/helpers", "src/utils", "src/config")
foreach ($dir in $unwantedDirs) {
    if (Test-Path $dir) {
        Write-Host "Removing $dir..." -ForegroundColor Red
        Remove-Item $dir -Recurse -Force
    }
}

# 6. Remove unwanted files with pattern matching
Write-Host "Removing backup and unwanted files..." -ForegroundColor Cyan
Get-ChildItem -Recurse -File | Where-Object {
    $_.Name -match '_fixed|_corrected|\.old$|\.bak$' -or
    $_.Name -eq 'MultiremoteHelper.ts' -and $_.DirectoryName -notlike "*generic*"
} | Remove-Item -Force -ErrorAction SilentlyContinue

# 7. Reinstall dependencies
Write-Host "Installing fresh dependencies..." -ForegroundColor Cyan
npm install

# 8. Build to ensure everything is clean
Write-Host "Building project..." -ForegroundColor Cyan
npm run build

# 9. Run lint check
Write-Host "Running lint check..." -ForegroundColor Cyan
npm run lint

Write-Host "✅ Cleanup complete! Please reload VS Code workspace." -ForegroundColor Green
Write-Host "📝 To reload: Ctrl+Shift+P > Developer: Reload Window" -ForegroundColor Yellow
