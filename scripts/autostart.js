const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const appDir = path.resolve(__dirname, '..');
const electronPath = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const shortcutPath = path.join(startupDir, 'DynamicIsland.lnk');

function enable() {
  const psCommands = [
    `$WshShell = New-Object -ComObject WScript.Shell`,
    `$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
    `$Shortcut.TargetPath = '${electronPath.replace(/'/g, "''")}'`,
    `$Shortcut.Arguments = '"${appDir.replace(/"/g, '`"')}"'`,
    `$Shortcut.WorkingDirectory = '${appDir.replace(/'/g, "''")}'`,
    `$Shortcut.Description = 'Dynamic Island for Windows'`,
    `$Shortcut.Save()`,
    `Write-Output 'OK'`
  ].join('; ');

  const res = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommands], { encoding: 'utf8' });

  if (fs.existsSync(shortcutPath)) {
    console.log('✅ Success! Dynamic Island will now start automatically when PC turns on!');
    console.log(`📍 Startup Shortcut created: ${shortcutPath}`);
  } else {
    console.error('❌ Failed to create shortcut:', res.stderr || res.stdout);
  }
}

function disable() {
  try {
    if (fs.existsSync(shortcutPath)) {
      fs.unlinkSync(shortcutPath);
      console.log('✅ Disabled autostart.');
    }
  } catch (e) {
    console.error('Failed to disable autostart:', e);
  }
}

function isEnabled() {
  return fs.existsSync(shortcutPath);
}

module.exports = { enable, disable, isEnabled };

if (require.main === module) {
  const arg = (process.argv[2] || 'enable').toLowerCase();
  if (arg === 'disable') {
    disable();
  } else {
    enable();
  }
}
