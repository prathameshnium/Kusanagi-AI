# This script robustly pulls the 'all-minilm' model into the project's portable models directory.
# It temporarily starts the Ollama server if it's not already running.

# --- 1. Define Paths ---
# Get the directory where this script is located
try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
} catch {
    # Fallback for running in ISE or other hosts
    $scriptDir = $PSScriptRoot
}


# Navigate up two levels to get to the project root
$projectRoot = Resolve-Path -Path (Join-Path $scriptDir "..\..")

# Define the paths for the models directory and the Ollama executable
$modelsDir = Join-Path $projectRoot "Portable_AI_Assets\models"
$ollamaExe = Join-Path $projectRoot "Portable_AI_Assets\ollama_main\ollama.exe"

# Verify that the Ollama executable exists
if (-not (Test-Path $ollamaExe)) {
    Write-Error "Ollama executable not found at '$ollamaExe'. Please check the path."
    exit 1
}

# --- 2. Set Environment for Ollama ---
# Set the environment variable to ensure Ollama uses the portable models directory
$env:OLLAMA_MODELS = $modelsDir
Write-Host "Set OLLAMA_MODELS environment variable to: '$modelsDir'" -ForegroundColor Green

# --- 3. Check if Ollama Server is Running ---
$serverProcess = $null
$serverWasAlreadyRunning = $false

Write-Host "Checking for a running Ollama server..." -ForegroundColor Cyan
try {
    # Use a quick, lightweight request to check the server status
    Invoke-WebRequest -Uri "http://127.0.0.1:11434" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
    $serverWasAlreadyRunning = $true
    Write-Host "Found existing Ollama server." -ForegroundColor Green
}
catch {
    Write-Host "Ollama server not found. Starting a temporary one..." -ForegroundColor Yellow
    # Start the server process and keep its handle so we can stop it later
    try {
        $serverProcess = Start-Process -FilePath $ollamaExe -ArgumentList "serve" -PassThru -WindowStyle Hidden
    } catch {
        Write-Error "Failed to start the Ollama server process. Please check permissions or run as Administrator."
        exit 1
    }
    
    # Wait for the server to become responsive
    $maxWaitSeconds = 60
    $waitTime = 0
    $serverReady = $false
    while ($waitTime -lt $maxWaitSeconds) {
        Write-Host "   - Waiting for server to respond... ($($waitTime)s)"
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:11434" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
            Write-Host "   - Server is responsive!" -ForegroundColor Green
            $serverReady = $true
            break
        }
        catch {
            Start-Sleep -Seconds 2
            $waitTime += 2
        }
    }

    if (-not $serverReady) {
        Write-Error "Server did not start within $maxWaitSeconds seconds. Aborting."
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        exit 1
    }
}

# --- 4. Pull the Model ---
Write-Host "Pulling model 'all-minilm'. This may take several minutes..." -ForegroundColor Cyan
# Execute the pull command
& $ollamaExe pull all-minilm

# Check if the pull command was successful
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to pull 'all-minilm'. Please check for errors above."
} else {
    Write-Host "Successfully pulled 'all-minilm'." -ForegroundColor Green
}

# --- 5. Clean Up ---
# If we started a temporary server, stop it now.
if ($serverProcess -ne $null) {
    Write-Host "Stopping the temporary Ollama server..." -ForegroundColor Yellow
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Cleanup complete." -ForegroundColor Green
}

# --- Done ---
Read-Host -Prompt "Press Enter to exit"