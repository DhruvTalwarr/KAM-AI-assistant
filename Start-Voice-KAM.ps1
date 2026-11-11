$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$secureKey = Read-Host 'Enter a NEW Groq API key (input hidden)' -AsSecureString
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
    $env:GROQ_API_KEY = $plainKey
    $env:PORT = '4175'
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $nodePath = $nodeCmd.Source
    } else {
        $bundledNode = 'C:\Users\ASUS\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if (-not (Test-Path -LiteralPath $bundledNode)) { throw 'Node.js was not found. Install Node.js 20 or newer, then rerun this script.' }
        $nodePath = $bundledNode
    }
    $server = Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $scriptDir -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            $null = Invoke-WebRequest -Uri 'http://127.0.0.1:4175/' -UseBasicParsing -TimeoutSec 2
            $ready = $true
            break
        } catch { }
    }
    if (-not $ready) { throw "The local server did not start. Process ID: $($server.Id)." }
    Start-Process 'http://127.0.0.1:4175/'
    Write-Host 'The voice assistant is running at http://127.0.0.1:4175/'
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
    Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
    $plainKey = $null
}
