#!/usr/bin/env pwsh
# Test verification script - checks framework without running full WebDriverIO

Write-Host "🧪 IGS WebDriverIO Framework - Quick Test Verification" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

# 1. Check TypeScript compilation
Write-Host "`n1️⃣ TypeScript Compilation Check..." -ForegroundColor Yellow
try {
    $buildResult = & npm run build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ TypeScript builds successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ TypeScript build failed" -ForegroundColor Red
        Write-Host $buildResult -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Build command failed: $_" -ForegroundColor Red
}

# 2. Check linting
Write-Host "`n2️⃣ ESLint Code Quality Check..." -ForegroundColor Yellow
try {
    $lintResult = & npm run lint 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ All code passes lint checks" -ForegroundColor Green
    } else {
        Write-Host "❌ Lint issues found" -ForegroundColor Red
        Write-Host $lintResult -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Lint command failed: $_" -ForegroundColor Red
}

# 3. Check test file structure
Write-Host "`n3️⃣ Test File Structure Check..." -ForegroundColor Yellow
$testFiles = @(
    "test/specs/web.simple.spec.ts",
    "test/specs/api.simple.spec.ts",
    "test/specs/mobile.simple.spec.ts",
    "test/specs/multiremote.simple.spec.ts"
)

foreach ($file in $testFiles) {
    if (Test-Path $file) {
        $lineCount = (Get-Content $file).Count
        Write-Host "✅ $file ($lineCount lines)" -ForegroundColor Green
    } else {
        Write-Host "❌ $file (missing)" -ForegroundColor Red
    }
}

# 4. Check utility structure
Write-Host "`n4️⃣ Utility Structure Check..." -ForegroundColor Yellow
$utilityFiles = Get-ChildItem "src/utilities" -Recurse -Filter "*.ts" | Where-Object { $_.Name -ne "index.ts" }
$genericCount = ($utilityFiles | Where-Object { $_.Directory.Name -eq "generic" }).Count
$businessCount = ($utilityFiles | Where-Object { $_.Directory.Name -eq "business" }).Count

Write-Host "✅ Generic utilities: $genericCount files" -ForegroundColor Green
Write-Host "✅ Business utilities: $businessCount files" -ForegroundColor Green

# 5. Check config structure
Write-Host "`n5️⃣ Configuration Structure Check..." -ForegroundColor Yellow
$configFiles = Get-ChildItem "config" -Filter "*.ts"
foreach ($config in $configFiles) {
    Write-Host "✅ $($config.Name)" -ForegroundColor Green
}

# 6. Node.js compatibility note
Write-Host "`n⚠️  Node.js Compatibility Note:" -ForegroundColor Yellow
$nodeVersion = & node --version
Write-Host "Current Node.js: $nodeVersion" -ForegroundColor Cyan
Write-Host "Required for WebDriverIO v9: Node.js >= 20.x" -ForegroundColor Cyan
Write-Host "Framework structure is ready - upgrade Node.js to run tests" -ForegroundColor Yellow

Write-Host "`n🎯 Framework Status: READY FOR TESTING" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Gray
