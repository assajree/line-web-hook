const form = document.getElementById('configForm');
const reloadButton = document.getElementById('reloadButton');
const saveButton = document.getElementById('saveButton');
const statusText = document.getElementById('status');

const fields = {
    CHANNEL_SECRET: document.getElementById('channelSecret'),
    CHANNEL_ACCESS_TOKEN: document.getElementById('channelAccessToken'),
    ADMIN_USER_ID: document.getElementById('adminUserId'),
    OLLAMA_URL: document.getElementById('ollamaUrl'),
    OLLAMA_MODEL: document.getElementById('ollamaModel'),
    LOG_FORMAT: document.getElementById('logFormat')
};

reloadButton.addEventListener('click', loadConfig);
form.addEventListener('submit', saveConfig);

loadConfig();

async function loadConfig() {
    setStatus('กำลังโหลดค่า config...', '');
    setBusy(true);
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'โหลดค่า config ไม่สำเร็จ');
        fillForm(data.values || {});
        setStatus('โหลดค่า config สำเร็จ', 'success');
    } catch (err) {
        setStatus(err.message || 'โหลดค่า config ไม่สำเร็จ', 'error');
    } finally {
        setBusy(false);
    }
}

async function saveConfig(event) {
    event.preventDefault();
    setStatus('กำลังบันทึก...', '');
    setBusy(true);
    try {
        const payload = {
            CHANNEL_SECRET: fields.CHANNEL_SECRET.value.trim(),
            CHANNEL_ACCESS_TOKEN: fields.CHANNEL_ACCESS_TOKEN.value.trim(),
            ADMIN_USER_ID: fields.ADMIN_USER_ID.value.trim(),
            OLLAMA_URL: fields.OLLAMA_URL.value.trim(),
            OLLAMA_MODEL: fields.OLLAMA_MODEL.value.trim(),
            LOG_FORMAT: fields.LOG_FORMAT.value.trim()
        };

        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'บันทึก config ไม่สำเร็จ');
        setStatus('บันทึก config สำเร็จ', 'success');
        await loadConfig();
    } catch (err) {
        setStatus(err.message || 'บันทึก config ไม่สำเร็จ', 'error');
        setBusy(false);
    }
}

function fillForm(values) {
    fields.CHANNEL_SECRET.value = values.CHANNEL_SECRET || '';
    fields.CHANNEL_ACCESS_TOKEN.value = values.CHANNEL_ACCESS_TOKEN || '';
    fields.ADMIN_USER_ID.value = values.ADMIN_USER_ID || '';
    fields.OLLAMA_URL.value = values.OLLAMA_URL || '';
    fields.OLLAMA_MODEL.value = values.OLLAMA_MODEL || '';
    fields.LOG_FORMAT.value = values.LOG_FORMAT || 'csv';
}

function setBusy(isBusy) {
    saveButton.disabled = isBusy;
    reloadButton.disabled = isBusy;
}

function setStatus(message, type) {
    statusText.className = 'status' + (type ? ' ' + type : '');
    statusText.textContent = message;
}
