'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Data fetching
  fetchHeroStats:   (...args)       => ipcRenderer.invoke('fetch-hero-stats',  ...args),
  fetchHeroBuild:   (heroId)        => ipcRenderer.invoke('fetch-hero-build',  heroId),
  fetchItemStats:   (heroId, badge) => ipcRenderer.invoke('fetch-item-stats',  heroId, badge),
  fetchLeaderboard: (region, badge) => ipcRenderer.invoke('fetch-leaderboard', region, badge),
  fetchHeroCounters:  (heroId, badge) => ipcRenderer.invoke('fetch-hero-counters',  heroId, badge),
  fetchHeroSynergies: (heroId, badge) => ipcRenderer.invoke('fetch-hero-synergies', heroId, badge),
  fetchPatchNotes:  ()              => ipcRenderer.invoke('fetch-patch-notes'),
  getAppVersion:    ()              => ipcRenderer.invoke('get-app-version'),
  getIsPackaged:    ()              => ipcRenderer.invoke('get-is-packaged'),

  // App auto-updater
  checkForUpdate:   ()  => ipcRenderer.invoke('check-for-update'),
  downloadUpdate:   ()  => ipcRenderer.invoke('download-update'),
  installUpdate:    ()  => ipcRenderer.send('install-update'),

  // Listeners
  onAutoUpdate: (cb) => {
    ipcRenderer.on('auto-update-tick', cb);
    return () => ipcRenderer.removeListener('auto-update-tick', cb);
  },
  onAppUpdateAvailable:    (cb) => ipcRenderer.on('app-update-available',     (_, info) => cb(info)),
  onAppUpdateNotAvailable: (cb) => ipcRenderer.on('app-update-not-available', cb),
  onAppUpdateProgress:     (cb) => ipcRenderer.on('app-update-progress',      (_, pct)  => cb(pct)),
  onAppUpdateDownloaded:   (cb) => ipcRenderer.on('app-update-downloaded',    cb),
  onAppUpdateError:        (cb) => ipcRenderer.on('app-update-error',         (_, msg)  => cb(msg)),

  platform: process.platform,
});
