const tabsContainer = document.getElementById('tabs');
const newTabButton = document.getElementById('new-tab');

newTabButton.addEventListener('click', () => window.tabsAPI.createTab());

function renderTabs(tabs) {
    tabsContainer.innerHTML = '';

    for (const tab of tabs) {
        const el = document.createElement('div');
        el.className = 'tab' + (tab.active ? ' active' : '');
        el.title = tab.title;

        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = tab.title || 'Linear';

        const close = document.createElement('span');
        close.className = 'close';
        close.textContent = '\u00d7'; // ×
        close.title = 'Close tab (Ctrl+W)';

        el.appendChild(title);
        el.appendChild(close);

        // Left-click activates, middle-click closes (like a browser).
        // Use mousedown so activation is instant; the close button is handled
        // separately below (activating re-renders the bar, which would cancel a
        // later click event on the close button).
        el.addEventListener('mousedown', (event) => {
            if (event.target.closest('.close')) return;
            if (event.button === 0) {
                window.tabsAPI.activateTab(tab.id);
            } else if (event.button === 1) {
                event.preventDefault();
                window.tabsAPI.closeTab(tab.id);
            }
        });

        close.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            window.tabsAPI.closeTab(tab.id);
        });

        tabsContainer.appendChild(el);
    }
}

window.tabsAPI.onTabsUpdated(renderTabs);
