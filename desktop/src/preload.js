'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('meter', {
  onState: fn => ipcRenderer.on('state', (_e, s) => fn(s)),
  refresh: () => ipcRenderer.send('refresh'),
  openUsagePage: () => ipcRenderer.send('open-usage-page'),
  renew: () => ipcRenderer.send('renew'),
  signIn: () => ipcRenderer.send('sign-in'),
  menu: () => ipcRenderer.send('menu'),
  minimize: () => ipcRenderer.send('minimize'),
  quit: () => ipcRenderer.send('quit'),
  resize: h => ipcRenderer.send('resize', h),
})
