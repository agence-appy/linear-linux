const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabsAPI', {
    createTab: () => ipcRenderer.send('tab:create'),
    closeTab: (id) => ipcRenderer.send('tab:close', id),
    activateTab: (id) => ipcRenderer.send('tab:activate', id),
    onTabsUpdated: (callback) => {
        ipcRenderer.on('tabs:updated', (_event, tabs) => callback(tabs));
    },
});
