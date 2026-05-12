const DEFAULT_OLLAMA_URL = 'http://localhost:11434/api/chat';

const urlInput = document.getElementById('ollamaUrl');
const groupSelect = document.getElementById('groupSelect');
const monthSelect = document.getElementById('monthSelect');
const summaryButton = document.getElementById('summaryButton');
const summaryOutput = document.getElementById('summaryOutput');
const statusText = document.getElementById('status');
let groups = [];

urlInput.value = localStorage.getItem('OLLAMA_URL') || DEFAULT_OLLAMA_URL;
urlInput.addEventListener('input', () => localStorage.setItem('OLLAMA_URL', urlInput.value.trim()));
groupSelect.addEventListener('change', renderMonths);
summaryButton.addEventListener('click', summarize);

loadOptions();

async function loadOptions() {
    try {
        const res = await fetch('/api/summary/options');
        const data = await res.json();
        groups = data.groups || [];
        groupSelect.innerHTML = groups.map(group => '<option value="' + escapeAttr(group.name) + '">' + escapeHtml(group.name) + '</option>').join('');
        renderMonths();
        statusText.textContent = groups.length ? '' : 'ยังไม่มี log สำหรับสรุป';
    } catch (_err) {
        setError('โหลดรายการ group ไม่สำเร็จ');
    }
}

function renderMonths() {
    const selected = groups.find(group => group.name === groupSelect.value);
    const months = selected ? selected.months : [];
    monthSelect.innerHTML = months.map(month => '<option value="' + escapeAttr(month) + '">' + escapeHtml(month) + '</option>').join('');
}

async function summarize() {
    const ollamaUrl = urlInput.value.trim();
    localStorage.setItem('OLLAMA_URL', ollamaUrl);
    summaryButton.disabled = true;
    summaryOutput.value = '';
    statusText.className = 'status';
    statusText.textContent = 'กำลังสรุปข้อมูล...';

    try {
        const res = await fetch('/api/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ollamaUrl, groupName: groupSelect.value, month: monthSelect.value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Summary failed');
        summaryOutput.value = data.summary || '';
        statusText.textContent = 'สรุปข้อมูลเสร็จแล้ว';
    } catch (err) {
        setError(err.message || 'สรุปข้อมูลไม่สำเร็จ');
    } finally {
        summaryButton.disabled = false;
    }
}

function setError(message) {
    statusText.className = 'status error';
    statusText.textContent = message;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeAttr(value) {
    return escapeHtml(value);
}
