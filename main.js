const { app, BrowserWindow, WebContentsView, session, globalShortcut, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

let stateFilePath;

const LINEAR_URL = "https://linear.app";
const PARTITION = 'persist:linear';
const TAB_BAR_HEIGHT = 40;

const CONTENT_PRELOAD = path.join(__dirname, 'preload.js');
const TABBAR_PRELOAD = path.join(__dirname, 'tabbar', 'preload.js');
const TABBAR_HTML = path.join(__dirname, 'tabbar', 'index.html');

// URLs that must be handled inside the app (auth flows) rather than the browser.
const authPatterns = ['/oauth', '/auth', '/login', '/signin', '/sso', '/saml', '/callback'];

const allowedPermissions = new Set([
    'notifications',
    'clipboard-read',
    'clipboard-write',
    'clipboard-sanitized-write'
]);

const loadWindowState = () => {
    if (!stateFilePath) return {};
    try {
        const raw = fs.readFileSync(stateFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        const { width, height, x, y } = parsed;
        if (Number.isFinite(width) && Number.isFinite(height)) {
            return {
                width,
                height,
                x: Number.isFinite(x) ? x : undefined,
                y: Number.isFinite(y) ? y : undefined,
            };
        }
    } catch (_) {
        // Ignore malformed or missing state and fall back to defaults.
    }
    return {};
};

const saveWindowState = (bounds) => {
    if (!stateFilePath || !bounds) return;
    try {
        fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
        fs.writeFileSync(stateFilePath, JSON.stringify(bounds), 'utf8');
    } catch (_) {
        // Persisting state is best-effort; ignore write failures.
    }
};

const isAuthUrl = (url) => authPatterns.some(p => url.includes(p));
const isLinearUrl = (url) => {
    try {
        return new URL(url).origin === LINEAR_URL;
    } catch (_) {
        return false;
    }
};

// Registry mapping a tab-bar webContents id to its owning TabbedWindow, so IPC
// messages coming from a tab bar can be routed to the right window.
const windowsByTabBar = new Map();

class TabbedWindow {
    constructor() {
        this.tabs = [];          // { id, view, title }
        this.activeTabId = null;
        this.tabSeq = 0;
        this.ready = false;

        const state = loadWindowState();
        const focused = BrowserWindow.getFocusedWindow();
        let bounds = state;
        if (focused) {
            const b = focused.getBounds();
            bounds = { width: b.width, height: b.height, x: b.x + 30, y: b.y + 30 };
        }

        const windowOptions = {
            width: bounds.width || 1200,
            height: bounds.height || 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
            },
        };
        if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
            windowOptions.x = bounds.x;
            windowOptions.y = bounds.y;
        }

        const win = new BrowserWindow(windowOptions);
        this.win = win;
        win.setMenu(null);

        // Tab bar (chrome UI) rendered from a local page.
        this.tabBarView = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: TABBAR_PRELOAD,
            },
        });
        win.contentView.addChildView(this.tabBarView);
        windowsByTabBar.set(this.tabBarView.webContents.id, this);

        this.tabBarView.webContents.loadFile(TABBAR_HTML);
        this.tabBarView.webContents.once('did-finish-load', () => {
            this.ready = true;
            this.createTab(LINEAR_URL);
        });

        win.on('resize', () => this.layout());
        win.on('enter-full-screen', () => this.layout());
        win.on('leave-full-screen', () => this.layout());

        win.on('close', () => saveWindowState(win.getBounds()));
        win.on('closed', () => {
            windowsByTabBar.delete(this.tabBarView.webContents.id);
        });
    }

    createTab(url = LINEAR_URL, { background = false } = {}) {
        if (!this.ready) return null;

        const view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: CONTENT_PRELOAD,
                partition: PARTITION,
            },
        });

        const id = ++this.tabSeq;
        const tab = { id, view, title: 'Linear' };
        this.tabs.push(tab);
        this.win.contentView.addChildView(view);
        this.setupTabWebContents(tab);
        view.webContents.loadURL(url);

        if (background && this.activeTabId != null) {
            view.setVisible(false);
            this.layout();
            this.sendTabState();
        } else {
            this.activateTab(id);
        }
        return tab;
    }

    setupTabWebContents(tab) {
        const wc = tab.view.webContents;

        wc.setWindowOpenHandler(({ url, disposition }) => {
            if (isAuthUrl(url)) return { action: 'allow' };

            // Middle-click and ctrl/cmd-click surface as background/foreground tab
            // dispositions. Keep Linear links inside the app as new tabs.
            if (isLinearUrl(url)) {
                const background = disposition === 'background-tab';
                this.createTab(url, { background });
                return { action: 'deny' };
            }

            shell.openExternal(url);
            return { action: 'deny' };
        });

        wc.on('page-title-updated', (_event, title) => {
            tab.title = title || 'Linear';
            this.sendTabState();
        });

        wc.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown') return;
            const mod = input.control || input.meta;
            if (!mod) return;
            const key = (input.key || '').toLowerCase();

            if (key === 't' && !input.shift) {
                event.preventDefault();
                this.createTab(LINEAR_URL);
            } else if (key === 'w' && !input.shift) {
                event.preventDefault();
                this.closeTab(this.activeTabId);
            } else if (key === 'tab' || key === 'pagedown' || key === 'pageup') {
                event.preventDefault();
                const forward = key === 'tab' ? !input.shift : key === 'pagedown';
                this.cycleTab(forward ? 1 : -1);
            }
        });

        // wc.openDevTools();
    }

    activateTab(id) {
        const exists = this.tabs.some(t => t.id === id);
        if (!exists) return;
        this.activeTabId = id;
        for (const t of this.tabs) {
            t.view.setVisible(t.id === id);
        }
        this.layout();
        const active = this.tabs.find(t => t.id === id);
        active?.view.webContents.focus();
        this.sendTabState();
    }

    closeTab(id) {
        const index = this.tabs.findIndex(t => t.id === id);
        if (index === -1) return;

        const [tab] = this.tabs.splice(index, 1);
        this.win.contentView.removeChildView(tab.view);
        const wc = tab.view.webContents;
        if (wc && !wc.isDestroyed()) wc.close();

        if (this.tabs.length === 0) {
            this.win.close();
            return;
        }

        if (this.activeTabId === id) {
            const next = this.tabs[index] || this.tabs[index - 1];
            this.activateTab(next.id);
        } else {
            this.layout();
            this.sendTabState();
        }
    }

    cycleTab(step) {
        if (this.tabs.length < 2) return;
        const current = this.tabs.findIndex(t => t.id === this.activeTabId);
        if (current === -1) return;
        const next = (current + step + this.tabs.length) % this.tabs.length;
        this.activateTab(this.tabs[next].id);
    }

    layout() {
        if (this.win.isDestroyed()) return;
        const { width, height } = this.win.getContentBounds();
        this.tabBarView.setBounds({ x: 0, y: 0, width, height: TAB_BAR_HEIGHT });
        const contentBounds = {
            x: 0,
            y: TAB_BAR_HEIGHT,
            width,
            height: Math.max(0, height - TAB_BAR_HEIGHT),
        };
        for (const t of this.tabs) {
            t.view.setBounds(contentBounds);
        }
    }

    sendTabState() {
        if (this.tabBarView.webContents.isDestroyed()) return;
        const tabs = this.tabs.map(t => ({
            id: t.id,
            title: t.title,
            active: t.id === this.activeTabId,
        }));
        this.tabBarView.webContents.send('tabs:updated', tabs);
    }
}

const createWindow = () => new TabbedWindow();

const windowForSender = (event) => windowsByTabBar.get(event.sender.id) || null;

ipcMain.on('tab:create', (event) => {
    windowForSender(event)?.createTab(LINEAR_URL);
});
ipcMain.on('tab:close', (event, id) => {
    windowForSender(event)?.closeTab(id);
});
ipcMain.on('tab:activate', (event, id) => {
    windowForSender(event)?.activateTab(id);
});

app.commandLine.appendSwitch("ozone-platform-hint", "auto");

app.whenReady().then(() => {
    stateFilePath = path.join(app.getPath('userData'), 'window-state.json');

    session.fromPartition(PARTITION).setPermissionRequestHandler((_, permission, callback, details) => {
        const origin = details?.requestingUrl || '';
        const isLinear = origin.startsWith(LINEAR_URL);
        return callback(isLinear && allowedPermissions.has(permission));
    });

    createWindow();

    globalShortcut.register("CommandOrControl+Shift+N", createWindow);

    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
