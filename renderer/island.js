/* ─────────────────────────────────────────────────────────────
   Dynamic Island — GSAP-Powered Activity Manager
   
   All morphing (width, height, borderRadius) is driven by
   GSAP with Apple-accurate spring easing. Content panels
   fade/slide in with staggered timelines.
   
   Activities (priority, high→low):
   1. notification  (flash, auto-dismiss after 4s)
   2. timer         (while countdown active)
   3. music         (while music playing)
   4. battery       (low/charging alert)
   5. network       (on hover / cycle)
   6. stats         (on hover / cycle)
───────────────────────────────────────────────────────────── */

const island = document.getElementById('island');
const bridge = window.islandBridge;

// ─── Sizes (px) ─────────────────────────────────────────────
const SIZE = {
  compact:      { w: 126,  h: 37,  r: 20 },
  compactMedia: { w: 204,  h: 37,  r: 20 },
  music:        { w: 350,  h: 154, r: 42 },
  quick:        { w: 404,  h: 84,  r: 42 },
  battery:      { w: 260,  h: 90,  r: 36 },
  network:      { w: 220,  h: 80,  r: 34 },
  timer:        { w: 280,  h: 110, r: 38 },
  notification: { w: 300,  h: 72,  r: 34 },
  stats:        { w: 240,  h: 80,  r: 34 },
};

// ─── GSAP defaults ──────────────────────────────────────────
// Apple Dynamic Island easing — smooth deceleration, no overshoot
const APPLE_EASE = 'power4.out';
const MORPH_DURATION = 0.55;
const CONTENT_DURATION = 0.35;

// ─── State ───────────────────────────────────────────────────
let currentActivity = 'compact';
let hovering = false;
let lockedActivity = null;
let lockReleaseTimer = null; // auto-collapse if mouse leaves locked island

// Live data
let mediaData   = { status: 'None', title: '', artist: '' };
let batteryData = { hasBattery: false, percent: 100, isCharging: false };
let networkData = { download: '0 B/s', upload: '0 B/s' };

// Timer state
let timerSeconds = 0;
let timerMax = 5 * 60;
let timerRunning = false;
let timerInterval = null;
let timerActive = false;

// Clock
let clockInterval = null;

// Active GSAP timeline
let morphTween = null;
let contentTimeline = null;

// ─── Helpers ────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${pad(m)}:${pad(s % 60)}`;
}

// ─── Activity resolver ───────────────────────────────────────
function resolveActivity() {
  if (lockedActivity && hovering) return lockedActivity;

  const isPlaying = (mediaData.status === 'Playing');

  if (hovering) {
    if (timerActive && timerRunning) return 'timer';
    // When music is playing, expand to music card
    if (isPlaying) return 'music';
    // If battery is low, show battery
    if (batteryData.hasBattery && batteryData.percent < 20 && !batteryData.isCharging) return 'battery';
    // Normal hover: Show Quick Actions Hub (YouTube, Snip, Calc, Files, Lock, Power)
    return 'quick';
  }

  if (timerActive && timerRunning) return 'timer';
  if (isPlaying) {
    showCompactMusic(true);
    return 'compactMedia';
  }
  showCompactMusic(false);
  return 'compact';
}

// ─── GSAP Morph Engine (Apple-accurate snappy spring) ────────
function morphIsland(targetSize, onComplete) {
  if (morphTween) morphTween.kill();

  const isCollapsing = targetSize.w < island.offsetWidth;
  const duration = isCollapsing ? 0.32 : 0.38;
  const morphEase = 'power3.out';

  morphTween = gsap.to(island, {
    width: targetSize.w,
    height: targetSize.h,
    borderRadius: targetSize.r,
    duration: duration,
    ease: morphEase,
    onComplete: function () {
      if (onComplete) onComplete();
    },
  });
}

// ─── GSAP Content Transitions ────────────────────────────────
function fadeOutState(stateEl, cb) {
  if (!stateEl || gsap.getProperty(stateEl, 'opacity') === 0) {
    if (cb) cb();
    return;
  }
  gsap.to(stateEl, {
    opacity: 0,
    scale: 0.96,
    duration: 0.12,
    ease: 'power2.in',
    onComplete: () => {
      stateEl.classList.remove('active');
      gsap.set(stateEl, { clearProps: 'all' });
      if (cb) cb();
    },
  });
}

function fadeInState(stateEl) {
  if (!stateEl) return;
  stateEl.classList.add('active');
  gsap.fromTo(
    stateEl,
    { opacity: 0, scale: 0.96 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.22,
      ease: 'power2.out',
      delay: 0.04,
    }
  );
}

// ─── Show Activity (main entry) ─────────────────────────────
function showActivity(name, animate = true) {
  if (currentActivity === name && animate) return;
  currentActivity = name;

  const isCompact = (name === 'compact' || name === 'compactMedia');
  const targetStateId = isCompact ? 'compact-state' : `${name}-expanded`;
  const targetState = document.getElementById(targetStateId);

  // Get target size
  const targetSize = SIZE[name] || SIZE.compact;
  const isPlaying = mediaData.status === 'Playing';
  const islandClasses = `island ${isCompact ? 'compact ' + name : 'expanded ' + name} ${isPlaying ? 'playing' : ''}`;

  // Report active pixel bounds to main process for OS cursor tracking
  if (bridge && bridge.reportBounds) {
    bridge.reportBounds({ width: targetSize.w, height: targetSize.h, isExpanded: !isCompact });
  }

  // Kill running animations on all states to eliminate race conditions
  document.querySelectorAll('.state').forEach(el => {
    gsap.killTweensOf(el);
  });

  if (!animate) {
    document.querySelectorAll('.state').forEach(el => {
      if (el.id !== targetStateId) {
        el.classList.remove('active');
        gsap.set(el, { opacity: 0 });
      }
    });
    if (targetState) {
      targetState.classList.add('active');
      gsap.set(targetState, { opacity: 1, scale: 1 });
    }
    gsap.set(island, {
      width: targetSize.w,
      height: targetSize.h,
      borderRadius: targetSize.r,
    });
    island.className = islandClasses;
    return;
  }

  // Update island class
  island.className = islandClasses;

  // Immediately fade out all inactive states
  document.querySelectorAll('.state').forEach(el => {
    if (el.id !== targetStateId) {
      gsap.to(el, {
        opacity: 0,
        scale: 0.96,
        duration: 0.12,
        ease: 'power2.in',
        onComplete: () => {
          el.classList.remove('active');
        },
      });
    }
  });

  // Start morphing island shell
  morphIsland(targetSize);

  // Bring in target state cleanly
  if (targetState) {
    targetState.classList.add('active');
    gsap.fromTo(
      targetState,
      { opacity: 0, scale: 0.96 },
      {
        opacity: 1,
        scale: 1,
        duration: 0.22,
        ease: 'power3.out',
        delay: 0.04,
      }
    );
  }
}

// ─── Interaction & Auto-Collapse Engine ──────────────────────
let collapseTimer = null;

function cancelCollapseTimer() {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
}

function collapseIsland() {
  cancelCollapseTimer();
  togglePowerConfirm(false);
  lockedActivity = null;
  hovering = false;
  update();
}

function scheduleAutoCollapse(customDelayMs) {
  cancelCollapseTimer();
  const delaySec = (appSettings && appSettings.collapse) ? appSettings.collapse : 1.5;
  const delayMs = customDelayMs !== undefined ? customDelayMs : Math.max(800, delaySec * 1000);

  collapseTimer = setTimeout(() => {
    collapseIsland();
  }, delayMs);
}

// OS Hardware Cursor Tracking events (from main process global watcher)
if (bridge && bridge.onCursorEnter) {
  bridge.onCursorEnter(() => {
    cancelCollapseTimer();
    if (!hovering) {
      hovering = true;
      update();
    }
  });
}

if (bridge && bridge.onCursorLeave) {
  bridge.onCursorLeave(() => {
    scheduleAutoCollapse();
  });
}

// Local in-window mousemove handler for instant hover response
window.addEventListener('mousemove', (e) => {
  const rect = island.getBoundingClientRect();
  const isOver = (
    e.clientX >= rect.left - 4 &&
    e.clientX <= rect.right + 4 &&
    e.clientY >= rect.top - 2 &&
    e.clientY <= rect.bottom + 6
  );

  if (isOver) {
    cancelCollapseTimer();
    if (!hovering) {
      hovering = true;
      update();
    }
  } else {
    scheduleAutoCollapse(800);
  }
});

// Window/Document boundary exits
window.addEventListener('mouseleave', () => scheduleAutoCollapse(400));
document.addEventListener('mouseleave', () => scheduleAutoCollapse(400));
window.addEventListener('blur', () => collapseIsland());

// Escape key collapses immediately
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    collapseIsland();
  }
});

// Click on document outside island → collapse immediately
document.addEventListener('click', (e) => {
  if (!e.target.closest('#island')) {
    collapseIsland();
  }
});

// Click on island shell
island.addEventListener('click', (e) => {
  // If clicking on interactive controls (buttons, scrubber, tiles), cancel collapse timer and stay open
  if (e.target.closest('button') || e.target.closest('.ctrl-btn') || e.target.closest('#scrub-track') || e.target.closest('.timer-btn') || e.target.closest('.quick-tile') || e.target.closest('.power-btn')) {
    cancelCollapseTimer();
    return;
  }

  const isCurrentlyCompact = (currentActivity === 'compact' || currentActivity === 'compactMedia');
  if (isCurrentlyCompact) {
    cancelCollapseTimer();
    hovering = true;
    let act = resolveActivity();
    if (act === 'compact' || act === 'compactMedia') {
      act = (mediaData.status === 'Playing') ? 'music' : 'quick';
    }
    lockedActivity = act;
    showActivity(act);
  } else {
    // Clicking the background of an expanded island collapses it cleanly!
    collapseIsland();
  }
});

// Safety watchdog: ensures island never remains stuck open
setInterval(() => {
  const isCompact = (currentActivity === 'compact' || currentActivity === 'compactMedia');
  if (!isCompact && !hovering && !collapseTimer) {
    collapseIsland();
  }
}, 2000);

// ─── Main update loop ────────────────────────────────────────
function update() {
  const act = resolveActivity();
  showActivity(act);
}

// ─── Compact music / timer indicators ────────────────────────
function showCompactMusic(on) {
  island.classList.toggle('playing', on);
}

// ─── Clock ───────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('compact-time');
  if (!el) return;
  const now = new Date();
  el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

updateClock();
clockInterval = setInterval(updateClock, 10000);

// ─── MEDIA ───────────────────────────────────────────────────
let lastMediaPlaying = null;

// Vibrant Apple palette for fallback or hashing
const VIBRANT_PALETTE = [
  { color: '#ff2d55', glow: 'rgba(255, 45, 85, 0.5)' },
  { color: '#ff375f', glow: 'rgba(255, 55, 95, 0.5)' },
  { color: '#ff9f0a', glow: 'rgba(255, 159, 10, 0.5)' },
  { color: '#30d158', glow: 'rgba(48, 209, 88, 0.5)' },
  { color: '#0a84ff', glow: 'rgba(10, 132, 255, 0.5)' },
  { color: '#bf5af2', glow: 'rgba(191, 90, 242, 0.5)' },
  { color: '#ff3b30', glow: 'rgba(255, 59, 48, 0.5)' },
  { color: '#5e5ce6', glow: 'rgba(94, 92, 230, 0.5)' },
];

function stringHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function setMediaAccent(color, glow) {
  document.documentElement.style.setProperty('--media-accent', color);
  document.documentElement.style.setProperty('--media-accent-glow', glow);
}

function extractColorFromImg(imgEl) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 16, 16);
    const imgData = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      const br = (imgData[i] + imgData[i+1] + imgData[i+2]) / 3;
      if (br > 40 && br < 225) {
        r += imgData[i];
        g += imgData[i+1];
        b += imgData[i+2];
        count++;
      }
    }
    if (count > 0) {
      const rgb = `rgb(${Math.round(r/count)}, ${Math.round(g/count)}, ${Math.round(b/count)})`;
      const rgba = `rgba(${Math.round(r/count)}, ${Math.round(g/count)}, ${Math.round(b/count)}, 0.55)`;
      setMediaAccent(rgb, rgba);
    }
  } catch (e) {
    // Cross-origin fallback
  }
}

function updateMusicUI(data) {
  const title = data.title || 'Not Playing';
  const artist = data.artist || (data.title ? 'Media' : 'Apple Music');
  document.getElementById('music-title').textContent  = title;
  document.getElementById('music-artist').textContent = artist;

  const compactImg = document.getElementById('compact-thumb-img');
  const compactDefault = document.getElementById('compact-music-default-icon');
  const expandedImg = document.getElementById('expanded-thumb-img');
  const expandedPlaceholder = document.getElementById('album-art-placeholder');

  if (data.thumbnail) {
    if (compactImg) {
      compactImg.crossOrigin = 'Anonymous';
      compactImg.src = data.thumbnail;
      compactImg.style.display = 'block';
      compactImg.onload = () => extractColorFromImg(compactImg);
    }
    if (compactDefault) compactDefault.style.display = 'none';

    if (expandedImg) {
      expandedImg.src = data.thumbnail;
      expandedImg.style.display = 'block';
    }
    if (expandedPlaceholder) expandedPlaceholder.style.display = 'none';
  } else {
    if (compactImg) compactImg.style.display = 'none';
    if (compactDefault) compactDefault.style.display = 'block';
    if (expandedImg) expandedImg.style.display = 'none';
    if (expandedPlaceholder) expandedPlaceholder.style.display = 'flex';

    if (title && title !== 'Not Playing') {
      const pal = VIBRANT_PALETTE[stringHash(title) % VIBRANT_PALETTE.length];
      setMediaAccent(pal.color, pal.glow);
    }
  }

  // Ingest real video/track timeline duration and position from OS
  if (data.duration && data.duration > 0) {
    musicTotal = data.duration;
    if (data.position !== undefined && data.position >= 0) {
      musicElapsed = data.position;
    }
    updateMusicTimes();
  }

  const playing = data.status === 'Playing';
  island.classList.toggle('playing', playing);
  showCompactMusic(playing);

  // Only trigger layout update when PLAYING state changes (e.g., music started or stopped)
  if (lastMediaPlaying !== playing) {
    lastMediaPlaying = playing;
    if (!hovering && !lockedActivity) {
      update();
    }
  }
}

bridge.onMedia((data) => {
  mediaData = data;
  updateMusicUI(data);
});

// ─── BATTERY ─────────────────────────────────────────────────
let lastKnownCharging = null;
let lastKnownLow = false;

function updateBatteryUI(data) {
  const pct = data.percent || 0;

  const fill = document.getElementById('battery-fill');
  if (fill) gsap.to(fill, { width: `${pct}%`, duration: 0.8, ease: 'power2.out' });

  const pctText = document.getElementById('battery-percent-text');
  if (pctText) pctText.textContent = `${pct}%`;

  const status = document.getElementById('battery-status-text');
  if (status) {
    if (!data.hasBattery)     status.textContent = 'Desktop PC';
    else if (data.isCharging) status.textContent = '⚡ Charging';
    else if (pct < 10)        status.textContent = '⚠️ Critical';
    else if (pct < 20)        status.textContent = '🔴 Low Battery';
    else                      status.textContent = 'On Battery';
  }

  const bar = document.getElementById('battery-bar-fill');
  if (bar) {
    gsap.to(bar, { width: `${pct}%`, duration: 0.8, ease: 'power2.out' });
    bar.style.background = pct < 20 ? '#ff3b30' : pct < 40 ? '#ff9f0a' : '#34c759';
  }

  island.classList.toggle('charging', data.isCharging);
  island.classList.toggle('low-battery', pct < 20 && !data.isCharging);

  // Only trigger battery alert toast when state TRANSITIONS (e.g. charger newly plugged in),
  // NEVER repeatedly trigger every poll interval!
  if (data.hasBattery) {
    const isNewPlugIn = lastKnownCharging === false && data.isCharging === true;
    const isNewLow = pct < 20 && !data.isCharging && !lastKnownLow;

    if ((isNewPlugIn || isNewLow) && !hovering && !lockedActivity) {
      showActivity('battery');
      setTimeout(() => {
        if (!hovering && !lockedActivity) showActivity('compact');
      }, 4000);
    }

    lastKnownCharging = data.isCharging;
    lastKnownLow = pct < 20;
  }
}

bridge.onBattery((data) => {
  batteryData = data;
  updateBatteryUI(data);
});

// ─── NETWORK ─────────────────────────────────────────────────
bridge.onNetwork((data) => {
  networkData = data;
  document.getElementById('net-download').textContent = data.download;
  document.getElementById('net-upload').textContent   = data.upload;
});

// ─── TIMER ───────────────────────────────────────────────────
const TIMER_CIRCUMFERENCE = 2 * Math.PI * 34;

function updateTimerRing() {
  const prog = document.getElementById('timer-ring-progress');
  if (!prog) return;
  const ratio = timerMax > 0 ? timerSeconds / timerMax : 0;
  gsap.to(prog, {
    attr: { 'stroke-dashoffset': TIMER_CIRCUMFERENCE * (1 - ratio) },
    duration: 0.8,
    ease: 'power2.out',
  });
}

function updateTimerDisplay() {
  const el = document.getElementById('timer-display');
  if (el) el.textContent = fmtTime(timerSeconds);
  updateTimerRing();
}

window.timerControl = function (action) {
  if (action === 'toggle') {
    if (!timerActive) {
      timerSeconds = timerMax;
      timerActive = true;
    }
    timerRunning = !timerRunning;

    const btn = document.getElementById('timer-start-btn');
    if (btn) btn.textContent = timerRunning ? 'Pause' : 'Resume';

    if (timerRunning) {
      timerInterval = setInterval(() => {
        timerSeconds = Math.max(0, timerSeconds - 1);
        updateTimerDisplay();
        if (timerSeconds === 0) {
          timerRunning = false;
          timerActive = false;
          clearInterval(timerInterval);
          if (btn) btn.textContent = 'Start';
          showNotification('⏱️', 'Timer', 'Time is up!');
        }
      }, 1000);
    } else {
      clearInterval(timerInterval);
    }
    updateTimerDisplay();
  } else if (action === 'reset') {
    clearInterval(timerInterval);
    timerRunning = false;
    timerActive = false;
    timerSeconds = timerMax;
    const btn = document.getElementById('timer-start-btn');
    if (btn) btn.textContent = 'Start';
    updateTimerDisplay();
  }
};

updateTimerDisplay();

// ─── NOTIFICATION ─────────────────────────────────────────────
let notifTimeout = null;

function showNotification(icon, title, body) {
  document.getElementById('notif-icon').textContent  = icon;
  document.getElementById('notif-title').textContent = title;
  document.getElementById('notif-body').textContent  = body;

  showActivity('notification');

  if (notifTimeout) clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => {
    if (currentActivity === 'notification' && !lockedActivity) {
      showActivity('compact');
    }
  }, 4000);
}

// Demo notification
setTimeout(() => {
  showNotification('👋', 'Dynamic Island', 'Welcome! Hover to explore activities.');
}, 2500);

// ─── Initial state ────────────────────────────────────────────
showActivity('compact', false);
bridge.setIgnoreMouse(true);

// ─── Appearance Settings (from Settings window) ───────────────
let appSettings = {
  opacity: 65, blur: 24, saturation: 180, brightness: 88,
  tint: '10,10,12', tintOpacity: 0,
  border: 12, shadow: 50, glow: 12, collapse: 1.5,
};

function applyAppSettings(s) {
  appSettings = Object.assign({}, appSettings, s);

  const baseA    = (appSettings.opacity / 100).toFixed(3);
  const tintA    = (appSettings.tintOpacity / 100).toFixed(3);
  const borderA  = (appSettings.border / 100).toFixed(3);
  const shadowA  = (appSettings.shadow / 100).toFixed(3);
  const glowA    = (appSettings.glow / 100).toFixed(3);

  const bg = parseFloat(tintA) > 0
    ? `rgba(${appSettings.tint}, ${Math.max(parseFloat(baseA), parseFloat(tintA))})`
    : `rgba(12, 12, 16, ${baseA})`;

  const bf = `blur(${appSettings.blur}px) saturate(${appSettings.saturation}%) brightness(${appSettings.brightness}%)`;

  // Apply to island
  island.style.background = bg;
  island.style.border = `0.5px solid rgba(255, 255, 255, ${borderA})`;
  island.style.boxShadow = `0 8px 32px rgba(0, 0, 0, ${shadowA}), inset 0 1px 0 rgba(255, 255, 255, ${glowA})`;

  // Also update CSS vars for override consistency
  document.documentElement.style.setProperty('--island-bg', bg);
}

// Listen for settings updates from main process
bridge.onSettings(function(s) {
  applyAppSettings(s);
  try {
    localStorage.setItem('dynamic_island_settings', JSON.stringify(appSettings));
  } catch (e) {}
});

// Restore saved settings immediately from localStorage if present
try {
  const cachedSettings = localStorage.getItem('dynamic_island_settings');
  if (cachedSettings) {
    Object.assign(appSettings, JSON.parse(cachedSettings));
  }
} catch (e) {}

// Apply settings immediately
applyAppSettings(appSettings);

// ─── Media controls (IPC to Windows hardware media keys) ────
window.mediaControl = function (action) {
  if (action === 'play') {
    // Instant optimistic UI toggle in 0ms!
    const isNowPlaying = !island.classList.contains('playing');
    island.classList.toggle('playing', isNowPlaying);
    showCompactMusic(isNowPlaying);
    mediaData.status = isNowPlaying ? 'Playing' : 'Paused';
  } else if (action === 'forward') {
    musicElapsed = Math.min(musicTotal, musicElapsed + 10);
    updateMusicTimes();
  } else if (action === 'rewind') {
    musicElapsed = Math.max(0, musicElapsed - 10);
    updateMusicTimes();
  }

  if (bridge && bridge.mediaControl) {
    bridge.mediaControl(action);
  }
};

// Interactive scrubber seeking
window.seekScrubber = function (e) {
  const track = document.getElementById('scrub-track');
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const pct = clickX / rect.width;
  musicElapsed = Math.round(pct * musicTotal);
  updateMusicTimes();

  // Trigger media seek
  if (bridge && bridge.mediaControl) {
    bridge.mediaControl('forward');
  }
};

// Real-time progress bar & timestamps (supports both short songs and 2+ hour long videos)
let musicElapsed = 0;
let musicTotal = 0;

function formatTime(totalSec) {
  if (!totalSec || isNaN(totalSec) || totalSec < 0) return '0:00';
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = Math.floor(totalSec % 60);

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${mins}:${pad(secs)}`;
}

function updateMusicTimes() {
  const currEl = document.getElementById('music-time-current');
  const totalEl = document.getElementById('music-time-total');
  const fillEl = document.getElementById('progress-fill');
  if (!currEl || !totalEl || !fillEl) return;

  currEl.textContent = formatTime(musicElapsed);

  const rem = Math.max(0, musicTotal - musicElapsed);
  totalEl.textContent = `-${formatTime(rem)}`;

  const pct = musicTotal > 0 ? Math.min(100, (musicElapsed / musicTotal) * 100) : 0;
  fillEl.style.width = `${pct}%`;
}

updateMusicTimes();

setInterval(() => {
  if (island.classList.contains('playing') && musicTotal > 0) {
    musicElapsed = Math.min(musicTotal, musicElapsed + 1);
    updateMusicTimes();
  }
}, 1000);

// ─── Quick Utility Actions (YouTube, Snip, Calc, Files, Lock, Power) ─
window.triggerQuickAction = function (action) {
  if (bridge && bridge.quickAction) {
    bridge.quickAction(action);
  }

  // Collapse island back smoothly after launching an app
  if (action === 'youtube' || action === 'calc' || action === 'screenshot' || action === 'files' || action === 'lock' || action === 'sleep') {
    togglePowerConfirm(false);
    lockedActivity = null;
    hovering = false;
    update();
  }
};

window.togglePowerConfirm = function (show) {
  const mainGrid = document.getElementById('quick-main-grid');
  const powerPanel = document.getElementById('power-confirm-panel');
  if (mainGrid && powerPanel) {
    mainGrid.style.display = show ? 'none' : 'flex';
    powerPanel.style.display = show ? 'flex' : 'none';
  }
};
