# 0. Safety Check: Stop any running Ollama instances
# This ensures the server restarts with the NEW folder path we are about to set.
Write-Host "Stopping any running Ollama instances..." -ForegroundColor Yellow
Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# 1. Get the script's current directory
$CurrentDir = $PSScriptRoot

# --- PATH CONFIGURATION ---

# 2. Define path to the EMBEDDING MODELS folder
# Target: Portable_AI_Assets\models
$ModelDirRel = "..\models"
$ModelDirPath = Join-Path -Path $CurrentDir -ChildPath $ModelDirRel

# Create the directory if it doesn't exist
if (-not (Test-Path $ModelDirPath)) {
    New-Item -ItemType Directory -Force -Path $ModelDirPath | Out-Null
    Write-Host "Created directory: $ModelDirPath"
}
$AbsModelPath = (Resolve-Path -Path $ModelDirPath).Path

# 3. Define path to the OLLAMA EXECUTABLE
$OllamaExeRel = "..\ollama_main\ollama.exe" 
$OllamaExePathRaw = Join-Path -Path $CurrentDir -ChildPath $OllamaExeRel

if (-not (Test-Path $OllamaExePathRaw)) {
    Write-Error "Could not find ollama.exe at: $OllamaExePathRaw"
    exit
}
$AbsOllamaExe = (Resolve-Path -Path $OllamaExePathRaw).Path

# --- EXECUTION ---

# 4. Set the environment variable
$env:OLLAMA_MODELS = $AbsModelPath
Write-Host "1. Target Folder: $AbsModelPath" -ForegroundColor Cyan

# 5. Start the Portable Ollama Server
Write-Host "2. Starting Ollama Server..." -ForegroundColor Cyan
$OllamaProcess = Start-Process -FilePath $AbsOllamaExe -ArgumentList "serve" -PassThru -WindowStyle Hidden

# 6. Wait for initialization
Write-Host "   Waiting 5 seconds..."
Start-Sleep -Seconds 5

# 7. Pull the embedding model (mxbai-embed-large)
Write-Host "3. Pulling mxbai-embed-large..." -ForegroundColor Cyan
& $AbsOllamaExe pull mxbai-embed-large

Write-Host "Done! Embedding model saved." -ForegroundColor Green

# Optional: Stop the server when finished so you can run other scripts
# Stop-Process -Id $OllamaProcess.Id -Force