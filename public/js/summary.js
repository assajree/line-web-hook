const groupSelect = document.getElementById('groupSelect');
const monthSelect = document.getElementById('monthSelect');
const summaryButton = document.getElementById('summaryButton');
const summaryOutput = document.getElementById('summaryOutput');
const statusText = document.getElementById('status');
let groups = [];

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
        statusText.textContent = groups.length ? '' : 'ยังไม่มี log สำหรับสรุปรายการแจ้งปัญหา';
        summaryButton.disabled = !groups.length;
    } catch (_err) {
        setError('โหลดรายการ group ไม่สำเร็จ');
        summaryButton.disabled = true;
    }
}

function renderMonths() {
    const selected = groups.find(group => group.name === groupSelect.value);
    const months = selected ? selected.months : [];
    monthSelect.innerHTML = months.map(month => '<option value="' + escapeAttr(month) + '">' + escapeHtml(month) + '</option>').join('');
    summaryButton.disabled = !groups.length || !months.length;
}

async function summarize() {
    summaryButton.disabled = true;
    summaryOutput.value = '';
    summaryOutput.placeholder = 'กำลังสรุปรายการแจ้งปัญหา...';
    statusText.className = 'status';
    statusText.textContent = 'กำลังสรุปรายการแจ้งปัญหา...';

    try {
        const res = await fetch('/api/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupName: groupSelect.value, month: monthSelect.value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Summary failed');
        summaryOutput.value = data.summary || '';
        summaryOutput.placeholder = 'ผลลัพธ์จาก AI จะแสดงที่นี่';
        statusText.textContent = summaryOutput.value ? 'สรุปรายการแจ้งปัญหาเสร็จแล้ว' : 'AI ไม่ได้ส่งผลลัพธ์กลับมา';
    } catch (err) {
        setError(err.message || 'สรุปรายการแจ้งปัญหาไม่สำเร็จ');
        summaryOutput.placeholder = 'ไม่สามารถแสดงผลลัพธ์ได้';
    } finally {
        renderMonths();
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
