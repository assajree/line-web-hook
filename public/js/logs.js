const container = document.getElementById('content');

loadLogs();

async function loadLogs() {
    try {
        const res = await fetch('/api/logs/options');
        const data = await res.json();
        renderLogs(data.groups || []);
    } catch (_err) {
        container.innerHTML = '<p class="error">โหลดรายการ log ไม่สำเร็จ</p>';
    }
}

function renderLogs(groups) {
    if (!groups.length) {
        container.innerHTML = '<p>No groups found.</p>';
        return;
    }

    container.innerHTML = groups.map(group => {
        const files = group.files || [];
        const body = files.length
            ? '<ul>' + files.map(fileName => {
                const downloadUrl = '/logs/download/' + encodeURIComponent(group.name) + '/' + encodeURIComponent(fileName);
                return '<li><span>' + escapeHtml(fileName) + '</span><a href="' + downloadUrl + '" target="_blank" rel="noopener">Download</a></li>';
              }).join('') + '</ul>'
            : '<p>No log files for this group.</p>';

        return '<section class="group-box"><h2>Group: ' + escapeHtml(group.name) + '</h2>' + body + '</section>';
    }).join('');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
