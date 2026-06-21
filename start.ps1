# Unbored launcher for Windows PowerShell — `./start.ps1`.
Set-Location $PSScriptRoot
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py run.py @args
