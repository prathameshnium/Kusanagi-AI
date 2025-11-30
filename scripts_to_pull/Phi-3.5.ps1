# 1. Get the script's current directory
$CurrentDir = $PSScriptRoot

# --- PATH CONFIGURATION ---

# 2. Define path to the MODELS folder (Relative)
$ModelDirRel = "..\models"
$ModelDirPath = Join-Path -Path $CurrentDir -ChildPath $ModelDirRel

# Ensure model directory exists (Create it if missing to prevent errors)
if (-not (Test-Path $ModelDirPath)) {
    New-Item -ItemType Directory -Force -Path $ModelDirPath | Out-Null
}
$AbsModelPath = (Resolve-Path -Path $ModelDirPath).Path

# 3. Define path to the OLLAMA EXECUTABLE (Relative)
$OllamaExeRel = "..\ollama_main\ollama.exe" 
$OllamaExePathRaw = Join-Path -Path $CurrentDir -ChildPath $OllamaExeRel

# Check if the .exe actually exists there
if (-not (Test-Path $OllamaExePathRaw)) {
    Write-Error "Could not find ollama.exe at: $OllamaExePathRaw"
    Write-Warning "Please make sure ollama.exe is inside the 'ollama_main' folder!"
    exit
}
$AbsOllamaExe = (Resolve-Path -Path $OllamaExePathRaw).Path

# --- EXECUTION ---

# 4. Set the environment variable for the models
$env:OLLAMA_MODELS = $AbsModelPath
Write-Host "1. Models will be stored in: $AbsModelPath" -ForegroundColor Cyan

# 5. Start the Ollama server (Using the specific portable EXE)
Write-Host "2. Starting Portable Ollama Server..." -ForegroundColor Cyan
# WindowStyle Hidden keeps it running in background without cluttering
$OllamaProcess = Start-Process -FilePath $AbsOllamaExe -ArgumentList "serve" -PassThru -WindowStyle Hidden

# 6. Wait for initialization
# Increased to 10 seconds to allow your system (RAM/Disk) to catch up
Write-Host "   Waiting 10 seconds for server to wake up..."
Start-Sleep -Seconds 10

# 7. Pull the model (Microsoft Phi-3.5 Mini)
Write-Host "3. Downloading Microsoft Phi-3.5 Mini (Reasoning/Research)..." -ForegroundColor Cyan
Write-Host "   (This may take a few minutes depending on internet speed)" -ForegroundColor Gray

# The Ollama tag for Phi-3.5 Mini Instruct is simply 'phi3.5'
& $AbsOllamaExe pull phi3.5

Write-Host "Done! The model is saved." -ForegroundColor Green
Write-Host "To chat with it later, use: & '$AbsOllamaExe' run phi3.5" -ForegroundColor Yellow