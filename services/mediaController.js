const { spawn } = require('child_process');

class MediaController {
  constructor() {
    this.ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1

function Await($t, $r) {
  $asTask = $asTaskGeneric.MakeGenericMethod($r)
  $net = $asTask.Invoke($null, @($t))
  $net.Wait(1500) | Out-Null
  return $net.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType=WindowsRuntime] | Out-Null
$w = New-Object -ComObject WScript.Shell

function GetSession {
  try {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $s = $mgr.GetCurrentSession()
    if (-not $s) {
      $sessions = $mgr.GetSessions()
      if ($sessions.Count -gt 0) { $s = $sessions[0] }
    }
    return $s
  } catch {
    return $null
  }
}

while ($line = [Console]::ReadLine()) {
  try {
    $s = GetSession
    if ($line -eq 'play') {
      if ($s) { $s.TryTogglePlayPauseAsync() | Out-Null }
      $w.SendKeys([char]179)
    } elseif ($line -eq 'next') {
      if ($s) { $s.TrySkipNextAsync() | Out-Null }
      $w.SendKeys([char]176)
      $w.SendKeys('+N')
    } elseif ($line -eq 'prev') {
      if ($s) { $s.TrySkipPreviousAsync() | Out-Null }
      $w.SendKeys([char]177)
      $w.SendKeys('+P')
    } elseif ($line -eq 'forward') {
      if ($s) { $s.TryFastForwardAsync() | Out-Null }
      $w.SendKeys('{RIGHT}')
      $w.SendKeys('l')
    } elseif ($line -eq 'rewind') {
      if ($s) { $s.TryRewindAsync() | Out-Null }
      $w.SendKeys('{LEFT}')
      $w.SendKeys('j')
    }
  } catch {}
}
      `
    ]);
  }

  send(action) {
    if (this.ps && this.ps.stdin && this.ps.stdin.writable) {
      this.ps.stdin.write(action + '\n');
    }
  }

  stop() {
    if (this.ps) {
      try { this.ps.kill(); } catch (_) {}
    }
  }
}

module.exports = new MediaController();
