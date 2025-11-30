# 1. Get the script's current directory
$CurrentDir = $PSScriptRoot

# --- PATH CONFIGURATION ---

# 2. Define path to the MODELS folder (Relative)
$ModelDirRel = "..\models"
$ModelDirPath = Join-Path -Path $CurrentDir -ChildPath $ModelDirRel

# Ensure model directory exists
if (-not (Test-Path $ModelDirPath)) {
    New-Item -ItemType Directory -Force -Path $ModelDirPath | Out-Null
}
$AbsModelPath = (Resolve-Path -Path $ModelDirPath).Path

# 3. Define path to the OLLAMA EXECUTABLE (Relative)
$OllamaExeRel = "..\ollama_main\ollama.exe" 
$OllamaExePathRaw = Join-Path -Path $CurrentDir -ChildPath $OllamaExeRel

if (-not (Test-Path $OllamaExePathRaw)) {
    Write-Error "Could not find ollama.exe at: $OllamaExePathRaw"
    exit
}
$AbsOllamaExe = (Resolve-Path -Path $OllamaExePathRaw).Path

# --- EXECUTION ---

# 4. Set the environment variable for the models
$env:OLLAMA_MODELS = $AbsModelPath
Write-Host "1. Models will be stored in: $AbsModelPath" -ForegroundColor Cyan

# 5. Start the Ollama server
Write-Host "2. Starting Portable Ollama Server..." -ForegroundColor Cyan
$OllamaProcess = Start-Process -FilePath $AbsOllamaExe -ArgumentList "serve" -PassThru -WindowStyle Hidden

# 6. Wait for initialization (Keeping 10s because your RAM is full)
Write-Host "   Waiting 10 seconds for server to wake up..."
Start-Sleep -Seconds 10

# 7. Pull the model
# Option A: Llama 3.2 1B (Smartest option that fits ~1.3GB)
Write-Host "3. Downloading Llama 3.2 1B (Lightweight & Smart)..." -ForegroundColor Cyan
& $AbsOllamaExe pull llama3.2:1b

# Option B: ULTRA TINY Backup (Uncomment the line below if Llama is still too slow)
# Write-Host "Downloading SmolLM2 360M (Ultra Tiny backup)..."
# & $AbsOllamaExe pull smollm2:360m

Write-Host "Done!" -ForegroundColor Green
Write-Host "To chat, use: & '$AbsOllamaExe' run llama3.2:1b" -ForegroundColor Yellow