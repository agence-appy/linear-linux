const { app, BrowserWindow, session, globalShortcut, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let stateFilePath;

const LINEAR_URL = "https://linear.app";

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

const createWindow = () => {
    let state = {};
    const focusedWindow = BrowserWindow.getFocusedWindow();

    if (focusedWindow) {
        const bounds = focusedWindow.getBounds();
        state = {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x + 30,
            y: bounds.y + 30
        };
    } else {
        state = loadWindowState();
    }

    const windowOptions = {
        width: state.width || 800,
        height: state.height || 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        partition: 'persist:linear'
    };

    if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
        windowOptions.x = state.x;
        windowOptions.y = state.y;
    }

    const win = new BrowserWindow(windowOptions);
    win.setMenu(null);
    win.loadURL(LINEAR_URL);

    const authPatterns = ['/oauth', '/auth', '/login', '/signin', '/sso', '/saml', '/callback'];
    win.webContents.setWindowOpenHandler(({ url }) => {
        const isAuth = authPatterns.some(p => url.includes(p));
        if (isAuth) return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Uncomment to open debugging tools in development mode
    win.webContents.openDevTools();

    win.on('close', () => {
        saveWindowState(win.getBounds());
    });
};

app.commandLine.appendSwitch("ozone-platform-hint", "auto");

app.whenReady().then(() => {
    stateFilePath = path.join(app.getPath('userData'), 'window-state.json');

    session.defaultSession.setPermissionRequestHandler((_, permission, callback, details) => {
        const origin = details?.requestingUrl || '';
        const isLinear = origin.startsWith(LINEAR_URL);
        return callback(isLinear && allowedPermissions.has(permission));
    });

    createWindow();

    globalShortcut.register(
        "CommandOrControl+Shift+N",
        createWindow
    );

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
