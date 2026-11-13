<#
    easy-control virtual gamepad - driver setup

        easy-control-gamepad-setup.ps1 install      (as administrator)
        easy-control-gamepad-setup.ps1 install -Force
        easy-control-gamepad-setup.ps1 uninstall    (as administrator)
        easy-control-gamepad-setup.ps1 status       prints JSON

    install does not replace a newer installed version (exit code 2): a newer
    driver serves older apps too (see common/easycontrol_pad.h), and other apps
    on the machine may need it. -Force installs this one anyway.

    Gamepad.installDriver() runs it elevated, behind one UAC prompt.

    install:
      1. copies the driver package and the service into Program Files, where
         only administrators can change them
      2. makes a code signing certificate for this machine, trusts it
         (LocalMachine Root and TrustedPublisher), signs the driver package
         with it, and deletes its private key, so it can sign nothing else
      3. installs the driver package (pnputil) and the broker service, which
         signed-in users may start but not stop or change
    The driver runs in user mode (UMDF), so it needs no Microsoft signature.

    uninstall removes all of it, the certificate included.
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet("install", "uninstall", "status")]
    [string]$Action = "status",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3

# filled in by src/build-gamepad-win.js from common/easycontrol_pad.h
$PadVersion = '3'

# without a \\?\ prefix, which the FileSystem provider cannot take apart
$Here = $PSScriptRoot -replace '^\\\\\?\\UNC\\', '\\' -replace '^\\\\\?\\', ''
$ServiceName = "EasyControlGamepad"
$InstallDir = Join-Path $env:ProgramFiles "easy-control\gamepad"
$DriverDir = Join-Path $InstallDir "driver"
$RegistryKey = "HKLM:\SOFTWARE\easy-control\Gamepad"
$CertSubject = "CN=easy-control local driver signer"
# the driver packages, one per device of a pad; every one names the driver binary
$Packages = @("easycontrol_gamepad", "easycontrol_xusb")
$PackageMarker = "easycontrol_gamepad.dll"
$LogFile = Join-Path $env:ProgramData "easy-control\gamepad-setup.log"
# the exit code of install when a newer version is installed
$ExitNewerInstalled = 2
$script:ExitCode = 0

function Write-Log([string]$Message) {
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $Message
    Write-Host $Message
    try {
        New-Item -ItemType Directory -Force (Split-Path $LogFile) | Out-Null
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch {}
}

function Assert-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run as administrator"
    }
}

# runs a console program, throws if it fails
function Invoke-Tool([string]$File, [string[]]$Arguments, [int[]]$OkCodes = @(0)) {
    $output = & $File @Arguments 2>&1 | Out-String
    if ($OkCodes -notcontains $LASTEXITCODE) {
        throw "$File $($Arguments -join ' ') failed ($LASTEXITCODE): $output"
    }
    return $output
}

# the driver store copies of our package (oemNN.inf), found by content so it
# does not depend on pnputil's localised output
function Get-InstalledInfs {
    Get-ChildItem (Join-Path $env:windir "INF") -Filter "oem*.inf" -ErrorAction SilentlyContinue | Where-Object {
        Select-String -Path $_.FullName -SimpleMatch $PackageMarker -Quiet
    }
}

function Get-OurCertificates {
    foreach ($store in @("Root", "TrustedPublisher", "My")) {
        Get-ChildItem "Cert:\LocalMachine\$store" | Where-Object { $_.Subject -like "$CertSubject*" }
    }
}

function Add-ToStore($Certificate, [string]$StoreName) {
    $store = New-Object Security.Cryptography.X509Certificates.X509Store($StoreName, "LocalMachine")
    $store.Open("ReadWrite")
    try { $store.Add($Certificate) } finally { $store.Close() }
}

# the installed version (the registry's, written last by install); $null when none
function Get-InstalledVersion {
    if (-not (Test-Path $RegistryKey)) {
        return $null
    }
    return (Get-ItemProperty $RegistryKey -Name "Version" -ErrorAction SilentlyContinue).Version
}

function Install-Gamepad {
    Assert-Administrator
    $installed = Get-InstalledVersion
    if (($null -ne $installed) -and ([int]$installed -gt [int]$PadVersion) -and -not $Force) {
        Write-Log "Not installing version $PadVersion over the newer $installed, which serves this app too (-Force does)"
        $script:ExitCode = $ExitNewerInstalled
        return
    }
    Write-Log "Installing the easy-control virtual gamepad $PadVersion"

    # an earlier version goes first, so nothing of it is left behind
    Uninstall-Gamepad -Quiet

    # 1. files
    New-Item -ItemType Directory -Force $DriverDir | Out-Null
    foreach ($file in @($Packages | ForEach-Object { "$_.inf"; "$_.cat" }) + "easycontrol_gamepad.dll") {
        Copy-Item (Join-Path $Here $file) $DriverDir -Force
    }
    Copy-Item (Join-Path $Here "easy-control-gamepad-service.exe") $InstallDir -Force

    # the logs' folder: the service (as SYSTEM) and administrators write it,
    # users may read it
    $logDir = Split-Path $LogFile
    New-Item -ItemType Directory -Force $logDir | Out-Null
    Invoke-Tool (Join-Path $env:windir "System32\icacls.exe") @($logDir, "/inheritance:r",
        "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)RX") | Out-Null

    # 2. certificate: code signing only, not a CA, its key never leaves this machine
    $cert = New-SelfSignedCertificate -Type CodeSigningCert `
        -Subject "$CertSubject ($env:COMPUTERNAME)" `
        -CertStoreLocation "Cert:\LocalMachine\My" `
        -KeyExportPolicy NonExportable -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(20) `
        -TextExtension @("2.5.29.19={critical}{text}ca=0")
    try {
        $public = New-Object Security.Cryptography.X509Certificates.X509Certificate2(, $cert.Export("Cert"))
        Add-ToStore $public "Root"
        Add-ToStore $public "TrustedPublisher"

        $signed = @($Packages | ForEach-Object { Join-Path $DriverDir "$_.cat" }) + @(
            (Join-Path $DriverDir "easycontrol_gamepad.dll"),
            (Join-Path $InstallDir "easy-control-gamepad-service.exe")
        )
        foreach ($file in $signed) {
            $signature = Set-AuthenticodeSignature -FilePath $file -Certificate $cert -HashAlgorithm SHA256
            if ($signature.Status -ne "Valid") {
                throw "Signing $file failed: $($signature.Status) $($signature.StatusMessage)"
            }
        }
    } finally {
        # the private key goes as soon as the package is signed
        Remove-Item "Cert:\LocalMachine\My\$($cert.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue
    }
    Write-Log "Signed the driver package with $($cert.Thumbprint)"

    # 3. driver packages and service
    # the XUSB device has Microsoft's xinputhid filter on it, whose service
    # Windows registers only once an Xbox controller has been plugged in;
    # it is Windows' own, so uninstall leaves it
    # Windows Server editions lack the filter altogether: the service then
    # makes the XUSB device without it (XInput only)
    if (-not (Test-Path (Join-Path $env:windir "System32\drivers\xinputhid.sys"))) {
        Write-Log "No xinputhid.sys here: the gamepad works with XInput, Windows.Gaming.Input will not see it"
    } elseif (-not (Get-Service -Name "xinputhid" -ErrorAction SilentlyContinue)) {
        Invoke-Tool (Join-Path $env:windir "System32\sc.exe") @("create", "xinputhid", "type=", "kernel", "start=", "demand",
            "binPath=", "System32\drivers\xinputhid.sys", "DisplayName=", "XINPUT HID Filter Driver") | Out-Null
        Write-Log "Registered the xinputhid service"
    }
    $pnputil = Join-Path $env:windir "System32\pnputil.exe"
    foreach ($package in $Packages) {
        Invoke-Tool $pnputil @("/add-driver", (Join-Path $DriverDir "$package.inf"), "/install") @(0, 259, 3010) | Out-Null
        Write-Log "Added the driver package $package"
    }

    $binary = '"' + (Join-Path $InstallDir "easy-control-gamepad-service.exe") + '"'
    New-Service -Name $ServiceName -BinaryPathName $binary -DisplayName "easy-control Virtual Gamepad" `
        -Description "Plugs in easy-control virtual gamepads for applications that ask for one." `
        -StartupType Manual | Out-Null
    # signed-in users (IU) may start and query it; only administrators and
    # the system may stop, change or delete it
    $sddl = "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"
    Invoke-Tool (Join-Path $env:windir "System32\sc.exe") @("sdset", $ServiceName, $sddl) | Out-Null
    Write-Log "Added the service"

    New-Item -Force $RegistryKey | Out-Null
    Set-ItemProperty $RegistryKey -Name "Version" -Value ([int]$PadVersion) -Type DWord
    Set-ItemProperty $RegistryKey -Name "InstallDir" -Value $InstallDir
    Write-Log "Installed"
}

function Uninstall-Gamepad([switch]$Quiet) {
    Assert-Administrator
    if (-not $Quiet) {
        Write-Log "Removing the easy-control virtual gamepad"
    }

    # the service: stopping it unplugs every pad
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -ne "Stopped") {
            Stop-Service -Name $ServiceName -Force
            $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15))
        }
        Invoke-Tool (Join-Path $env:windir "System32\sc.exe") @("delete", $ServiceName) | Out-Null
    }

    # the devices Windows still remembers, then the driver package
    $pnputil = Join-Path $env:windir "System32\pnputil.exe"
    # the pads' devices and the HID collections Windows made as their children
    Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
        $_.InstanceId -like "SWD\EASYCONTROL*" -or $_.InstanceId -like "HID\EASYCONTROL*"
    } | ForEach-Object {
        & $pnputil /remove-device $_.InstanceId | Out-Null
    }
    foreach ($inf in @(Get-InstalledInfs)) {
        Invoke-Tool $pnputil @("/delete-driver", $inf.Name, "/uninstall", "/force") @(0, 3010) | Out-Null
        Write-Log "Removed the driver package $($inf.Name)"
    }

    foreach ($cert in @(Get-OurCertificates)) {
        Remove-Item $cert.PSPath -DeleteKey -ErrorAction SilentlyContinue
        Remove-Item $cert.PSPath -ErrorAction SilentlyContinue
    }

    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force
    }
    if (Test-Path $RegistryKey) {
        Remove-Item $RegistryKey -Recurse -Force
    }
    # the service's logs; the setup log stays, it tells of this too
    foreach ($log in @("gamepad-service.log", "gamepad-service.log.old")) {
        Remove-Item (Join-Path (Split-Path $LogFile) $log) -Force -ErrorAction SilentlyContinue
    }
    if (-not $Quiet) {
        Write-Log "Removed"
    }
}

function Get-GamepadStatus {
    $version = Get-InstalledVersion
    [ordered]@{
        "installed" = ($null -ne $version) -and ($null -ne (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue))
        "version" = $version
        "packageVersion" = [int]$PadVersion
        "driverPackages" = @(Get-InstalledInfs | ForEach-Object { $_.Name })
        # what the driver store holds, from each package's DriverVer
        # ("date,<easy-control version>.<pad version>"): the version that binds
        "driverVersions" = @(Get-InstalledInfs | ForEach-Object {
            $line = Select-String -Path $_.FullName -Pattern '^\s*DriverVer\s*=\s*(.+)$' | Select-Object -First 1
            if ($null -ne $line) { $line.Matches[0].Groups[1].Value.Trim() }
        })
        "certificates" = @(Get-OurCertificates | ForEach-Object { $_.PSParentPath.Split("\")[-1] + ":" + $_.Thumbprint })
    } | ConvertTo-Json -Compress
}

try {
    switch ($Action) {
        "install" { Install-Gamepad }
        "uninstall" { Uninstall-Gamepad }
        "status" { Get-GamepadStatus }
    }
    exit $script:ExitCode
} catch {
    Write-Log ("Failed: " + $_.Exception.Message + "`r`n" + $_.InvocationInfo.PositionMessage + "`r`n" + $_.ScriptStackTrace)
    exit 1
}
