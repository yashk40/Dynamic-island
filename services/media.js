const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Write the PS script to a temp file to avoid backtick conflicts in JS strings
const PS_SCRIPT_PATH = path.join(os.tmpdir(), 'dynamic_island_media.ps1');

const PS_SCRIPT_CONTENT = [
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '',
  '$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
  '  $_.Name -eq "AsTask" -and',
  '  $_.IsGenericMethodDefinition -and',
  '  $_.GetParameters().Count -eq 1',
  '} | Select-Object -First 1',
  '',
  'function Await($WinRtTask, $ResultType) {',
  '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
  '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
  '  $netTask.Wait(1200) | Out-Null',
  '  return $netTask.Result',
  '}',
  '',
  'try {',
  '  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType=WindowsRuntime] | Out-Null',
  '  $asyncOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()',
  '  $manager = Await $asyncOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  '',
  '  $sessions = $manager.GetSessions()',
  '  if ($sessions.Count -eq 0) {',
  '    Write-Output "SESSION::None|||0|0"',
  '  } else {',
  '    foreach ($s in $sessions) {',
  '      $propsOp = $s.TryGetMediaPropertiesAsync()',
  '      $props = Await $propsOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  '      $info = $s.GetPlaybackInfo()',
  '      $status = $info.PlaybackStatus.ToString()',
  '      $title = if ($props.Title) { $props.Title -replace "\\|", "-" } else { "" }',
  '      $artist = if ($props.Artist) { $props.Artist -replace "\\|", "-" } else { "" }',
  '      $t = $s.GetTimelineProperties()',
  '      $pos = if ($t) { [Math]::Round($t.Position.TotalSeconds) } else { 0 }',
  '      $dur = if ($t) { [Math]::Round($t.EndTime.TotalSeconds) } else { 0 }',
  '      Write-Output "SESSION::$status|$title|$artist|$pos|$dur"',
  '    }',
  '  }',
  '} catch {',
  '  Write-Output "SESSION::None|||0|0"',
  '}',
].join('\n');

// Write script to temp file once
try {
  fs.writeFileSync(PS_SCRIPT_PATH, PS_SCRIPT_CONTENT, 'utf8');
} catch (e) {
  console.error('Failed to write media PS script:', e);
}

let intervalId = null;
let lastData = null;
let activeTrack = null;

const https = require('https');
const thumbCache = {};

function fetchThumbnail(title, artist, cb) {
  if (!title) return cb(null);
  const key = `${title}-${artist}`.trim();
  if (thumbCache[key] !== undefined) return cb(thumbCache[key]);

  const query = encodeURIComponent(`${title} ${artist}`.trim());
  const url = `https://www.youtube.com/results?search_query=${query}`;

  const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
    let html = '';
    res.on('data', c => html += c);
    res.on('end', () => {
      const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      if (match) {
        const thumbUrl = `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
        thumbCache[key] = thumbUrl;
        cb(thumbUrl);
      } else {
        thumbCache[key] = null;
        cb(null);
      }
    });
  });
  req.on('error', () => {
    thumbCache[key] = null;
    cb(null);
  });
  req.setTimeout(3500, () => {
    req.destroy();
    cb(null);
  });
}

let isPolling = false;

function poll(callback) {
  if (isPolling) return; // Strictly prevent multiple powershell instances from running concurrently
  isPolling = true;

  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', PS_SCRIPT_PATH,
    ],
    { timeout: 3500 },
    (err, stdout, stderr) => {
      isPolling = false;
      if (err) {
        // Keep previous state on transient timeouts or spawn errors — do not flicker to None!
        return;
      }

      const lines = (stdout || '').trim().split(/\r?\n/);
      const sessions = [];

      for (const line of lines) {
        if (!line.startsWith('SESSION::')) continue;
        const raw = line.slice(9);
        const parts = raw.split('|');
        const status = parts[0] || 'None';
        const title = parts[1] || '';
        const artist = parts[2] || '';
        const position = parseInt(parts[3], 10) || 0;
        const duration = parseInt(parts[4], 10) || 0;

        if (title) {
          sessions.push({ status, title, artist, position, duration });
        }
      }

      if (sessions.length === 0) {
        activeTrack = null;
        const empty = { status: 'None', title: '', artist: '', position: 0, duration: 0, thumbnail: null };
        const json = JSON.stringify(empty);
        if (json !== lastData) {
          lastData = json;
          callback(empty);
        }
        return;
      }

      // ─── Intelligent Session Arbitration ────────────────────────
      // Priority 1: If current active track is STILL 'Playing', DO NOT let a thumbnail hover preview steal focus!
      let winner = null;
      const playingSessions = sessions.filter(s => s.status === 'Playing');

      if (playingSessions.length > 0) {
        if (activeTrack) {
          const stillPlayingCurrent = playingSessions.find(s => s.title === activeTrack.title);
          if (stillPlayingCurrent) {
            // Current video is still actively playing: stay on it!
            winner = stillPlayingCurrent;
          }
        }

        // If current track wasn't playing or not found, pick the best playing session
        if (!winner) {
          // Prefer the session with real media duration (> 30s) over micro-previews
          const substantial = playingSessions.find(s => s.duration > 30);
          winner = substantial || playingSessions[0];
        }
      } else {
        // Priority 2: If NO session is Playing, check if activeTrack is in Paused sessions
        if (activeTrack) {
          const pausedCurrent = sessions.find(s => s.title === activeTrack.title);
          if (pausedCurrent) {
            winner = pausedCurrent;
          }
        }
        if (!winner) {
          winner = sessions[0];
        }
      }

      // Set winner as active track
      activeTrack = winner;

      const key = `${winner.title}-${winner.artist}`.trim();
      const existingThumb = thumbCache[key];

      const data = {
        status: winner.status,
        title: winner.title,
        artist: winner.artist,
        position: winner.position,
        duration: winner.duration,
        thumbnail: existingThumb || null,
      };

      // Only push update if data genuinely changed
      const json = JSON.stringify(data);
      if (json !== lastData) {
        lastData = json;
        callback(data);
      }

      // If thumbnail not yet cached, fetch it in background
      if (winner.title && thumbCache[key] === undefined) {
        fetchThumbnail(winner.title, winner.artist, (thumbUrl) => {
          if (thumbUrl) {
            data.thumbnail = thumbUrl;
            lastData = JSON.stringify(data);
            callback(data);
          }
        });
      }
    }
  );
}

function start(callback) {
  poll(callback);
  intervalId = setInterval(() => poll(callback), 3000);
}

function stop() {
  if (intervalId) clearInterval(intervalId);
  // Cleanup temp file
  try { fs.unlinkSync(PS_SCRIPT_PATH); } catch (_) {}
}

module.exports = { start, stop };
