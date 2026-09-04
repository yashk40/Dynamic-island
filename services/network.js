const si = require('systeminformation');

let smoothRx = 0;
let smoothTx = 0;

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 100) return '0.0 KB/s';
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

let isPolling = false;

async function poll(callback) {
  if (isPolling) return;
  isPolling = true;
  try {
    const nets = await si.networkStats();
    isPolling = false;
    if (!nets || nets.length === 0) return;

    // Sum across all active interfaces
    let rawRx = 0, rawTx = 0;
    for (const net of nets) {
      rawRx += net.rx_sec || 0;
      rawTx += net.tx_sec || 0;
    }

    // Exponential moving average for smooth, non-jittery readouts
    smoothRx = smoothRx === 0 ? rawRx : (smoothRx * 0.65 + rawRx * 0.35);
    smoothTx = smoothTx === 0 ? rawTx : (smoothTx * 0.65 + rawTx * 0.35);

    const data = {
      download: formatSpeed(smoothRx),
      upload: formatSpeed(smoothTx),
      downloadRaw: Math.round(smoothRx),
      uploadRaw: Math.round(smoothTx),
    };
    callback(data);
  } catch (e) {
    isPolling = false;
    callback({ download: '0.0 KB/s', upload: '0.0 KB/s', downloadRaw: 0, uploadRaw: 0 });
  }
}

function start(callback) {
  // First call after 1s (systeminformation needs a baseline)
  setTimeout(() => {
    poll(callback);
    intervalId = setInterval(() => poll(callback), 3000);
  }, 1000);
}

function stop() {
  if (intervalId) clearInterval(intervalId);
}

module.exports = { start, stop };
