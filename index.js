require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const app = express();
const cache = new NodeCache();

// ================= CONFIG =================
const ChannelSecret = process.env.CHANNEL_SECRET;
const ChannelAccessToken = process.env.CHANNEL_ACCESS_TOKEN;
const AdminUserID = process.env.ADMIN_USER_ID;
const OllamaUrl = process.env.OLLAMA_URL;
const OllamaModel = process.env.OLLAMA_MODEL;
const Port = process.env.PORT || 5000;
const LogFormat = process.env.LOG_FORMAT || 'csv'; // 'txt' or 'csv'
// =========================================

// Middleware to parse raw body for signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-line-signature'];
        const body = req.body;

        // Verify Signature
        if (!verifySignature(body, ChannelSecret, signature)) {
            return res.status(401).send('Unauthorized');
        }

        const json = JSON.parse(body.toString());
        const events = json.events;

        if (!events || events.length === 0) {
            return res.status(200).send('OK');
        }

        for (const ev of events) {
            if (ev.type !== 'message') continue;

            const message = ev.message;
            if (message.type !== 'text') continue;

            const replyToken = ev.replyToken;
            const userText = message.text;
            const timestamp = ev.timestamp;

            const dateTime = dayjs(timestamp);
            const timeText = dateTime.format('YYYY-MM-DD HH:mm:ss');

            const source = ev.source;
            const sourceType = source.type;

            if (sourceType === 'group') {
                const groupId = source.groupId;
                const userId = source.userId;

                const groupCacheKey = `group:${groupId}`;
                const userCacheKey = `user:${groupId}:${userId}`;

                // ===== GROUP NAME =====
                let groupName = cache.get(groupCacheKey);
                if (!groupName) {
                    groupName = await getGroupName(groupId) || groupId;
                    cache.set(groupCacheKey, groupName, 86400); // 24 hours
                }

                // ===== USER NAME =====
                let displayName = cache.get(userCacheKey);
                if (!displayName) {
                    displayName = await getGroupMemberName(groupId, userId) || userId;
                    cache.set(userCacheKey, displayName, 86400); // 24 hours
                }

                // ===== LOG =====
                const safeGroupName = sanitizeFolderName(groupName);
                const logDir = path.join(__dirname, 'Logs', safeGroupName);

                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const fileExt = LogFormat.toLowerCase() === 'csv' ? 'csv' : 'txt';
                const logFile = path.join(logDir, `${dayjs().format('YYYY-MM')}.${fileExt}`);

                let logLine = '';
                if (fileExt === 'csv') {
                    const escapeCsv = (str) => `"${String(str).replace(/"/g, '""')}"`;
                    logLine = `${escapeCsv(timeText)},${escapeCsv(groupName)},${escapeCsv(displayName)},${escapeCsv(userText)}`;
                    if (!fs.existsSync(logFile)) {
                        fs.writeFileSync(logFile, '\ufeff"Time","Group","Name","Message"\n', 'utf8');
                    }
                } else {
                    logLine = `[Time : ${timeText}] [Group : ${groupName}] [Name : ${displayName}] : ${userText}`;
                }

                console.log(logLine);

                try {
                    fs.appendFileSync(logFile, logLine + '\n', 'utf8');
                } catch (ex) {
                    console.log('LOG WRITE ERROR: ' + ex.message);
                }
            } else if (sourceType === 'user') {
                const userId = source.userId;
                if (userId === AdminUserID) {
                    const { action, groupName, month } = await parseCommand(userText);
                    if (action === 'summarize' && groupName && month) {
                        if (!summaryLogExists(groupName, month)) {
                            await replyText(replyToken, `ไม่พบข้อมูลของกลุ่ม ${groupName} เดือน ${month}`);
                            return res.status(200).send('OK');
                        }

                        const summary = await summarizeLog(groupName, month);
                        await replyText(replyToken, summary);
                    } else {
                        await replyText(replyToken, `ไม่พบข้อมูล`);
                    }
                }
            }
        }

        return res.status(200).send('OK');
    } catch (ex) {
        console.log('ERROR: ' + ex.message);
        return res.status(400).send(ex.message);
    }
});

app.get('/', (req, res) => {
    res.send('<h1>Server is running!</h1>');
});

const basicAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login === 'system' && password === 'csi@') {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="401"');
    res.status(401).send('Authentication required.');
};

app.use('/logs', basicAuth);
app.use('/summary', basicAuth);
app.use('/api/summary', basicAuth);

app.get('/summary', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'summary.html'));
});

app.get('/api/summary/options', (req, res) => {
    res.json(getSummaryOptions());
});

app.post('/api/summary', async (req, res) => {
    try {
        const { ollamaUrl, groupName, month } = req.body || {};

        if (!ollamaUrl || !groupName || !month) {
            return res.status(400).json({ error: 'กรุณาระบุ OLLAMA_URL, group และเดือนให้ครบ' });
        }

        if (!summaryLogExists(groupName, month)) {
            return res.status(404).json({ error: `ไม่พบข้อมูลของกลุ่ม ${groupName} เดือน ${month}` });
        }

        const summary = await summarizeLog(groupName, month, ollamaUrl);
        res.json({ summary });
    } catch (ex) {
        console.log('SUMMARY API ERROR: ' + ex.message);
        res.status(500).json({ error: 'ไม่สามารถสรุปข้อมูลได้ในขณะนี้' });
    }
});

app.get('/logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'logs.html'));
});

app.get('/api/logs/options', (req, res) => {
    res.json(getLogOptions());
});

app.get('/logs/download/:groupName/:fileName', (req, res) => {
    const groupName = req.params.groupName.replace(/\.\./g, "").replace(/\//g, "").replace(/\\/g, "");
    const fileName = req.params.fileName.replace(/\.\./g, "").replace(/\//g, "").replace(/\\/g, "");

    const filePath = path.join(__dirname, 'Logs', groupName, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Log file not found.');
    }

    res.download(filePath, fileName);
});

app.listen(Port, () => {
    console.log(`Server is running at http://localhost:${Port}`);
});

// ================= FUNCTIONS =================

function verifySignature(body, secret, signature) {
    const hash = crypto.createHmac('sha256', secret).update(body).digest('base64');
    return hash === signature;
}

async function getGroupMemberName(groupId, userId) {
    try {
        const res = await axios.get(`https://api.line.me/v2/bot/group/${groupId}/member/${userId}`, {
            headers: {
                Authorization: `Bearer ${ChannelAccessToken}`
            }
        });
        return res.data.displayName;
    } catch (ex) {
        return null;
    }
}

async function getGroupName(groupId) {
    try {
        const res = await axios.get(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
            headers: {
                Authorization: `Bearer ${ChannelAccessToken}`
            }
        });
        return res.data.groupName;
    } catch (ex) {
        return null;
    }
}

function sanitizeFolderName(name) {
    // Regex for invalid filename chars: < > : " / \ | ? *
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function getPreferredLogExtensions() {
    const preferredExt = LogFormat.toLowerCase() === 'csv' ? 'csv' : 'txt';
    const fallbackExt = preferredExt === 'csv' ? 'txt' : 'csv';
    return [preferredExt, fallbackExt];
}

function getLogFilePath(groupName, month) {
    const safeGroupName = sanitizeFolderName(groupName);
    const groupDir = path.join(__dirname, 'Logs', safeGroupName);

    for (const fileExt of getPreferredLogExtensions()) {
        const logPath = path.join(groupDir, `${month}.${fileExt}`);
        if (fs.existsSync(logPath)) {
            return logPath;
        }
    }

    return path.join(groupDir, `${month}.${getPreferredLogExtensions()[0]}`);
}

function summaryLogExists(groupName, month) {
    return fs.existsSync(getLogFilePath(groupName, month));
}

async function summarizeLog(groupName, month, ollamaUrl = OllamaUrl) {
    const chatText = fs.readFileSync(getLogFilePath(groupName, month), 'utf8');
    const prompt = buildSummaryPrompt(groupName, chatText);
    return askOllama("", prompt, false, ollamaUrl);
}

function buildSummaryPrompt(groupName, chatText) {
    return `
คุณคือผู้ช่วยสรุปบทสนทนา LINE group สำหรับงานบริษัท ชื่อ "${groupName}"

กติกา:
- สรุปเฉพาะสาระสำคัญ
- แยกเป็นหัวข้อ bullet
- ใช้ภาษาไทย สุภาพ เป็นกลาง
- ห้ามใช้คำหยาบ แม้ในแชทจะมี
- ระบุ Time และ Name เฉพาะข้อความที่สำคัญ
- รวมข้อความที่ความหมายซ้ำกัน
- ไม่ต้องเล่าทุกบรรทัด
- สรุปให้กระชับ ไม่ต้องทุกบรรทัด

รูปแบบคำตอบ:
สรุปบทสนทนา:
- [Time] [Name] : ใจความสรุป

บทสนทนา:
${chatText}
`;
}

function getSummaryOptions() {
    const logPath = path.join(__dirname, 'Logs');
    if (!fs.existsSync(logPath)) {
        return { groups: [] };
    }

    const groups = fs.readdirSync(logPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => {
            const groupDir = path.join(logPath, dirent.name);
            const months = fs.readdirSync(groupDir)
                .filter(fileName => fileName.endsWith('.txt') || fileName.endsWith('.csv'))
                .map(fileName => path.basename(fileName, path.extname(fileName)))
                .sort()
                .reverse();

            return { name: dirent.name, months };
        });

    return { groups };
}

function getLogOptions() {
    const logPath = path.join(__dirname, 'Logs');
    if (!fs.existsSync(logPath)) {
        return { groups: [] };
    }

    const groups = fs.readdirSync(logPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => {
            const groupDir = path.join(logPath, dirent.name);
            const files = fs.readdirSync(groupDir)
                .filter(fileName => fileName.endsWith('.txt') || fileName.endsWith('.csv'))
                .sort()
                .reverse();

            return { name: dirent.name, files };
        });

    return { groups };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

async function replyText(replyToken, text) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/reply', {
            replyToken: replyToken,
            messages: [{ type: 'text', text: text }]
        }, {
            headers: {
                Authorization: `Bearer ${ChannelAccessToken}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (ex) {
        console.log('REPLY ERROR: ', ex.message);
    }
}

async function askOllama(userText, systemPrompt, isJSONResponse, ollamaUrl = OllamaUrl) {
    console.log(`userText: ${userText}`);
    console.log(`systemPrompt: ${systemPrompt}`);

    try {
        const payload = {
            model: OllamaModel,
            format: isJSONResponse ? "json" : undefined,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: (!userText || userText.trim() === '') ? "ทำงานตาม system prompt" : userText
                }
            ],
            stream: false
        };

        const res = await axios.post(ollamaUrl, payload);
        console.log(`Ollama raw response received`);

        return res.data?.message?.content || "ขออภัยค่ะ ระบบไม่สามารถตอบได้ในขณะนี้";
    } catch (ex) {
        console.log('OLLAMA ERROR: ', ex.message);
        return "ขออภัยค่ะ ระบบไม่สามารถตอบได้ในขณะนี้";
    }
}

async function parseCommand(text) {
    const logPath = path.join(__dirname, 'Logs');
    let groupList = [];
    if (fs.existsSync(logPath)) {
        groupList = fs.readdirSync(logPath, { withFileTypes: true }).filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);
    }

    const prompt = `
        You classify the user's intent from a LINE private message.

        Reply with JSON only. Do not include any text outside JSON.

        JSON shape:
        {
          "action": "summarize" | "none",
          "groupName": "string" | null,
          "month": "yyyy-MM" | null
        }

        Rules:
        - action:
          - Use "summarize" when the user asks to summarize chat data.
          - Otherwise use "none".
        - groupName:
          - Must match one of the allowed group names exactly.
          - If there is no match, return null.
          Allowed groups:
          [${groupList.join(', ')}]
        - month:
          - Extract only from the user's message.
          - If missing or unclear, return null.

        User message:
        ${text}
    `;

    const result = await askOllama("", prompt, true);

    try {
        const json = JSON.parse(result);
        return {
            action: json.action,
            groupName: json.groupName,
            month: json.month
        };
    } catch (ex) {
        return { action: null, groupName: null, month: null };
    }
}
