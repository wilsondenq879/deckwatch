'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('deckWatch',Object.freeze({
  config:()=>ipcRenderer.invoke('deck:config'),
  interval:seconds=>ipcRenderer.invoke('deck:interval',seconds),
  status:()=>ipcRenderer.invoke('deck:status'),
  pair:input=>ipcRenderer.invoke('deck:pair',input),
  fullscreen:()=>ipcRenderer.invoke('deck:fullscreen'),
  awake:enabled=>ipcRenderer.invoke('deck:awake',enabled),
  quit:()=>ipcRenderer.invoke('deck:quit')
}));
