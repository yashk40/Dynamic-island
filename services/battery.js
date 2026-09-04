const si = require('systeminformation');

let intervalId = null;
let lastData = null;

async function poll(callback) {
  try {
    const battery = await si.battery();
    const data = {
      hasBattery: battery.hasBattery,
      percent: Math.round(battery.percent),
      isCharging: battery.isCharging,
      acConnected: battery.acConnected,
      timeRemaining: battery.timeRemaining, // minutes
    };
    const json = JSON.stringify(data);
    if (json !== lastData) {
      lastData = json;
      callback(data);
    }
  } catch (e) {
    // Desktop PC with no battery
    callback({ hasBattery: false, percent: 100, isCharging: false, acConnected: true });
  }
}

function start(callback) {
  poll(callback);
  intervalId = setInterval(() => poll(callback), 10000); // every 10s
}

function stop() {
  if (intervalId) clearInterval(intervalId);
}

module.exports = { start, stop };
