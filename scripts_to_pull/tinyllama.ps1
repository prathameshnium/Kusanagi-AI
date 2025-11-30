# 1. Get the script's current directory
$CurrentDir = $PSScriptRoot

# --- PATH CONFIGURATION ---

# 2. Define path to the MODELS folder (Relative)
$ModelDirRel = "..\models"
$ModelDirPath = Join-Path -Path $CurrentDir -ChildPath $ModelDirRel
$AbsModelPath = (Resolve-Path -Path $ModelDirPath).Path

# 3. Define path to the OLLAMA EXECUTABLE (Relative)
# NOTE: Check if ollama.exe is directly inside 'ollama_main' or a subfolder!
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
$OllamaProcess = Start-Process -FilePath $AbsOllamaExe -ArgumentList "serve" -PassThru -WindowStyle Hidden

# 6. Wait for initialization
Write-Host "   Waiting 5 seconds for server to wake up..."
Start-Sleep -Seconds 5

# 7. Pull the model (Using the specific portable EXE)
Write-Host "3. Pulling TinyLlama..." -ForegroundColor Cyan
# We use '&' to run the command located at the variable path
& $AbsOllamaExe pull tinyllama

Write-Host "Done! Check the folder." -ForegroundColor Green