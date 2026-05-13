(function () {
    const mount = document.getElementById('appHeader');

    if (!mount) {
        return;
    }

    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    const links = [
        { href: '/', label: 'Home' },
        { href: '/logs', label: 'Logs' },
        { href: '/summary', label: 'Summary' },
        { href: '/issue-summary', label: 'Issue Summary' },
        { href: '/config', label: 'Config' }
    ];

    const navLinks = links.map((link) => {
        const isCurrent = currentPath === link.href;
        const currentAttr = isCurrent ? ' aria-current="page"' : '';
        return `<a class="app-header__link" href="${link.href}"${currentAttr}>${link.label}</a>`;
    }).join('');

    mount.innerHTML = `
        <header class="app-header">
            <div class="app-header__inner">
                <a class="app-header__brand" href="/" aria-label="Go to Home">
                    <span class="app-header__mark" aria-hidden="true">LW</span>
                    <span>Line Webhook</span>
                </a>
                <nav class="app-header__nav" aria-label="Main navigation">
                    ${navLinks}
                </nav>
            </div>
        </header>
    `;
}());
