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
const CONFIG_PATH = path.join(__dirname, 'config.local.json');
const LOGS_FOLDER_NAME = 'logs';
const LOGS_PATH = path.join(__dirname, LOGS_FOLDER_NAME);
const CONFIG_FIELDS = [
    'CHANNEL_SECRET',
    'CHANNEL_ACCESS_TOKEN',
    'ADMIN_USER_ID',
    'OLLAMA_URL',
    'OLLAMA_MODEL',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'ASK_AI',
    'LOG_FORMAT'
];
const SECRET_CONFIG_FIELDS = ['CHANNEL_SECRET', 'CHANNEL_ACCESS_TOKEN', 'GEMINI_API_KEY'];

let configStore = loadConfigFromFile();
const Port = getPortFromArgs(process.argv);
// =========================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'home.html'));
});

// Middleware to parse raw body for signature verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/webhook', async (req, res) => {
    try {
        const { CHANNEL_SECRET: channelSecret, ADMIN_USER_ID: adminUserId, LOG_FORMAT: logFormat } = getConfig();
        const signature = req.headers['x-line-signature'];
        const body = req.body;

        // Verify Signature
        if (!verifySignature(body, channelSecret, signature)) {
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

            const dateTime = dayjs(timestamp).add(7, 'hour');
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
                const logDir = path.join(LOGS_PATH, safeGroupName);

                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }

                const fileExt = (logFormat || 'csv').toLowerCase() === 'csv' ? 'csv' : 'txt';
                const logFile = path.join(logDir, `${dateTime.format('YYYY-MM')}.${fileExt}`);

                let logLine = '';
                if (fileExt === 'csv') {
                    const escapeCsv = (str) => `"${String(str).replace(/"/g, '""')}"`;
                    logLine = `${escapeCsv(timeText)},${escapeCsv(displayName)},${escapeCsv(userText)}`;
                    if (!fs.existsSync(logFile)) {
                        fs.writeFileSync(logFile, '\ufeff"Time","Name","Message"\n', 'utf8');
                    }
                } else {
                    logLine = `[Time : ${timeText}] [Name : ${displayName}] : ${userText}`;
                }

                console.log(logLine);

                try {
                    fs.appendFileSync(logFile, logLine + '\n', 'utf8');
                } catch (ex) {
                    console.log('LOG WRITE ERROR: ' + ex.message);
                }
            } else if (sourceType === 'user') {
                const userId = source.userId;
                console.log('userId', userId);
                if (userId === adminUserId) {
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
app.use('/issue-summary', basicAuth);
app.use('/api/issue-summary', basicAuth);
app.use('/config', basicAuth);
app.use('/api/config', basicAuth);

app.get('/summary', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'summary.html'));
});

app.get('/api/summary/options', (req, res) => {
    res.json(getSummaryOptions());
});

app.get('/issue-summary', (req, res) => {
    res.redirect('/summary');
});

app.get('/api/issue-summary/options', (req, res) => {
    res.json(getSummaryOptions());
});

app.post('/api/issue-summary', async (req, res) => {
    return handleIssueSummaryRequest(req, res);
});

app.post('/api/summary', async (req, res) => {
    return handleIssueSummaryRequest(req, res);
});

async function handleIssueSummaryRequest(req, res) {
    try {
        const { groupName, month } = req.body || {};

        if (!groupName || !month) {
            return res.status(400).json({ error: 'กรุณาระบุ group และเดือนให้ครบ' });
        }

        if (!summaryLogExists(groupName, month)) {
            return res.status(404).json({ error: `ไม่พบข้อมูลของกลุ่ม ${groupName} เดือน ${month}` });
        }

        const summary = await summarizeIssues(groupName, month);
        res.json({ summary });
    } catch (ex) {
        console.log('SUMMARY API ERROR: ' + ex.message);
        res.status(ex.statusCode || 500).json({ error: ex.message || 'ไม่สามารถสรุปรายการแจ้งปัญหาได้ในขณะนี้' });
    }
}

app.get('/logs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'logs.html'));
});

app.get('/config', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'config.html'));
});

app.get('/api/config', (req, res) => {
    const config = getConfig();
    res.json({
        values: {
            CHANNEL_SECRET: maskSecret(config.CHANNEL_SECRET),
            CHANNEL_ACCESS_TOKEN: maskSecret(config.CHANNEL_ACCESS_TOKEN),
            ADMIN_USER_ID: config.ADMIN_USER_ID || '',
            OLLAMA_URL: config.OLLAMA_URL || '',
            OLLAMA_MODEL: config.OLLAMA_MODEL || '',
            GEMINI_API_KEY: maskSecret(config.GEMINI_API_KEY),
            GEMINI_MODEL: config.GEMINI_MODEL || '',
            ASK_AI: config.ASK_AI || 'ollama',
            LOG_FORMAT: config.LOG_FORMAT || 'csv'
        }
    });
});

app.post('/api/config', (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid payload' });
        }

        const updates = {};
        for (const field of CONFIG_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;
            updates[field] = String(req.body[field] ?? '').trim();
        }

        validateConfigUpdates(updates);
        updateConfig(updates);
        res.json({ success: true });
    } catch (ex) {
        res.status(400).json({ error: ex.message || 'Invalid configuration' });
    }
});

app.get('/api/logs/options', (req, res) => {
    res.json(getLogOptions());
});

app.get('/logs/view/:groupName/:fileName', (req, res) => {
    const filePath = getRequestedLogFilePath(req.params.groupName, req.params.fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Log file not found.');
    }

    res.type('text/plain; charset=utf-8');
    res.send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/logs/download/:groupName/:fileName', (req, res) => {
    const filePath = getRequestedLogFilePath(req.params.groupName, req.params.fileName);
    const downloadFileName = getDownloadLogFileName(req.params.groupName, filePath);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Log file not found.');
    }

    res.download(filePath, downloadFileName);
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
    const { CHANNEL_ACCESS_TOKEN: channelAccessToken } = getConfig();
    try {
        const res = await axios.get(`https://api.line.me/v2/bot/group/${groupId}/member/${userId}`, {
            headers: {
                Authorization: `Bearer ${channelAccessToken}`
            }
        });
        return res.data.displayName;
    } catch (ex) {
        return null;
    }
}

async function getGroupName(groupId) {
    const { CHANNEL_ACCESS_TOKEN: channelAccessToken } = getConfig();
    try {
        const res = await axios.get(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
            headers: {
                Authorization: `Bearer ${channelAccessToken}`
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

function sanitizeDownloadFileNamePart(value) {
    return String(value || '').replace(/[<>:"/\\|?*]/g, '').trim();
}

function getDownloadLogFileName(groupName, filePath) {
    const originalFileName = path.basename(filePath);
    const fileExt = path.extname(originalFileName);
    const month = path.basename(originalFileName, fileExt).replace(/-/g, '');
    const safeGroupName = sanitizeDownloadFileNamePart(groupName) || 'group';

    return `${safeGroupName}_${month}${fileExt}`;
}

function getPreferredLogExtensions() {
    const { LOG_FORMAT: logFormat } = getConfig();
    const preferredExt = (logFormat || 'csv').toLowerCase() === 'csv' ? 'csv' : 'txt';
    const fallbackExt = preferredExt === 'csv' ? 'txt' : 'csv';
    return [preferredExt, fallbackExt];
}

function getLogFilePath(groupName, month) {
    const safeGroupName = sanitizeFolderName(groupName);
    const groupDir = path.join(LOGS_PATH, safeGroupName);

    for (const fileExt of getPreferredLogExtensions()) {
        const logPath = path.join(groupDir, `${month}.${fileExt}`);
        if (fs.existsSync(logPath)) {
            return logPath;
        }
    }

    return path.join(groupDir, `${month}.${getPreferredLogExtensions()[0]}`);
}

function sanitizeRoutePathPart(value) {
    return String(value || '').replace(/\.\./g, "").replace(/\//g, "").replace(/\\/g, "");
}

function getRequestedLogFilePath(groupName, fileName) {
    const safeGroupName = sanitizeRoutePathPart(groupName);
    const safeFileName = sanitizeRoutePathPart(fileName);

    if (!safeFileName.endsWith('.txt') && !safeFileName.endsWith('.csv')) {
        return path.join(LOGS_PATH, safeGroupName, '__invalid_log_file__');
    }

    return path.join(LOGS_PATH, safeGroupName, safeFileName);
}

function summaryLogExists(groupName, month) {
    return fs.existsSync(getLogFilePath(groupName, month));
}

async function summarizeLog(groupName, month, ollamaUrl) {
    const { OLLAMA_URL: defaultOllamaUrl } = getConfig();
    const chatText = fs.readFileSync(getLogFilePath(groupName, month), 'utf8');
    const prompt = buildSummaryPrompt(groupName, chatText);
    return askOllama("", prompt, false, ollamaUrl || defaultOllamaUrl);
}

async function summarizeIssues(groupName, month) {
    const chatText = fs.readFileSync(getLogFilePath(groupName, month), 'utf8');
    const prompt = buildIssueSummaryPrompt(groupName, month, chatText);
    const { ASK_AI: askAi, OLLAMA_URL: ollamaUrl, OLLAMA_MODEL: ollamaModel } = getConfig();

    if (askAi === 'gemini') {
        return askGemini(prompt);
    }

    if (!ollamaUrl) {
        throwConfigError('กรุณาตั้งค่า OLLAMA_URL ในหน้า Config ก่อนใช้งาน');
    }

    if (!ollamaModel) {
        throwConfigError('กรุณาตั้งค่า OLLAMA_MODEL ในหน้า Config ก่อนใช้งาน');
    }

    return askOllama("", prompt, false);
}

function throwConfigError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
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

function buildIssueSummaryPrompt(groupName, month, chatText) {
    return `
คุณคือผู้ช่วยวิเคราะห์ log แชท LINE group ชื่อ "${groupName}" เดือน "${month}"

งานของคุณ:
- คัดเฉพาะข้อความที่เป็นการแจ้งปัญหา แจ้งเคส บอกอาการผิดปกติ ใช้งานไม่ได้ error timeout ข้อมูลผิด หรือขอให้ตรวจสอบปัญหา
- ไม่ต้องรวมข้อความทั่วไป การตอบรับ การพูดคุยเล่น หรือข้อความที่ไม่ใช่การแจ้งปัญหา
- ถ้าหลายบรรทัดเป็นปัญหาเดียวกันหรือพูดต่อเนื่องเรื่องเดียวกัน ให้รวมเป็นรายการเดียว
- ใช้วันที่จาก log ในรูปแบบ YYYY-MM-DD HH:mm:ss ถ้ามีเวลาใน log
- ผู้แจ้งคือ Name จากบรรทัดที่แจ้งปัญหา
- หัวข้อการแจ้งปัญหาให้สรุปสั้น กระชับ สุภาพ เป็นภาษาไทย

รูปแบบคำตอบ:
สรุปบทสนทนา:
- [Time] [Name] : ใจความสรุป

Log:
${chatText}
`;
}

function getSummaryOptions() {
    const logPath = LOGS_PATH;
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
    const logPath = LOGS_PATH;
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
    const { CHANNEL_ACCESS_TOKEN: channelAccessToken } = getConfig();
    try {
        await axios.post('https://api.line.me/v2/bot/message/reply', {
            replyToken: replyToken,
            messages: [{ type: 'text', text: text }]
        }, {
            headers: {
                Authorization: `Bearer ${channelAccessToken}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (ex) {
        console.log('REPLY ERROR: ', ex.message);
    }
}

async function askOllama(userText, systemPrompt, isJSONResponse, ollamaUrl) {
    const { OLLAMA_URL: defaultOllamaUrl, OLLAMA_MODEL: ollamaModel } = getConfig();
    const targetOllamaUrl = ollamaUrl || defaultOllamaUrl;
    console.log(`userText: ${userText}`);
    console.log(`systemPrompt: ${systemPrompt}`);

    try {
        const payload = {
            model: ollamaModel,
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

        const res = await axios.post(targetOllamaUrl, payload);
        console.log(`Ollama raw response received`);

        return res.data?.message?.content || "ขออภัยค่ะ ระบบไม่สามารถตอบได้ในขณะนี้";
    } catch (ex) {
        console.log('OLLAMA ERROR: ', ex.message);
        return "ขออภัยค่ะ ระบบไม่สามารถตอบได้ในขณะนี้";
    }
}

async function askGemini(prompt) {
    const { GEMINI_API_KEY: geminiApiKey, GEMINI_MODEL: geminiModel } = getConfig();

    if (!geminiApiKey) {
        throwConfigError('กรุณาตั้งค่า GEMINI_API_KEY ในหน้า Config ก่อนใช้งาน');
    }

    const model = geminiModel || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt }]
            }
        ],
        generationConfig: {}
    };

    const res = await axios.post(url, payload, {
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': geminiApiKey
        },
        timeout: 90000
    });

    const text = res.data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim();

    if (!text) {
        throw new Error('Gemini ไม่ได้ส่งผลลัพธ์กลับมา');
    }

    return text;
}

async function parseCommand(text) {
    const logPath = LOGS_PATH;
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

function loadConfigFromFile() {
    const defaults = getDefaultConfig();
    if (!fs.existsSync(CONFIG_PATH)) {
        return defaults;
    }

    try {
        const savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const config = { ...defaults };
        for (const field of CONFIG_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(savedConfig, field)) continue;
            config[field] = String(savedConfig[field] ?? '');
        }
        config.LOG_FORMAT = normalizeLogFormat(config.LOG_FORMAT);
        config.ASK_AI = normalizeAskAi(config.ASK_AI);
        return config;
    } catch (ex) {
        console.log('CONFIG READ ERROR: ' + ex.message);
        return defaults;
    }
}

function getDefaultConfig() {
    return {
        CHANNEL_SECRET: '',
        CHANNEL_ACCESS_TOKEN: '',
        ADMIN_USER_ID: '',
        OLLAMA_URL: 'http://localhost:11434/api/chat',
        OLLAMA_MODEL: 'gemma3:27b',
        GEMINI_API_KEY: '',
        GEMINI_MODEL: 'gemini-2.5-flash',
        ASK_AI: 'ollama',
        LOG_FORMAT: 'csv'
    };
}

function getConfig() {
    return configStore;
}

function getPortFromArgs(argv) {
    const defaultPort = 5000;

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--port') {
            return parsePort(argv[i + 1], defaultPort);
        }
        if (arg.startsWith('--port=')) {
            return parsePort(arg.slice('--port='.length), defaultPort);
        }
    }

    return defaultPort;
}

function parsePort(value, fallback) {
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return fallback;
    }
    return port;
}

function normalizeLogFormat(value) {
    return String(value || '').toLowerCase() === 'txt' ? 'txt' : 'csv';
}

function normalizeAskAi(value) {
    return String(value || '').toLowerCase() === 'gemini' ? 'gemini' : 'ollama';
}

function maskSecret(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    if (text.length <= 8) {
        return '********';
    }
    return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function validateConfigUpdates(updates) {
    for (const field of SECRET_CONFIG_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(updates, field) && isMaskedSecret(updates[field])) {
            delete updates[field];
        }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'LOG_FORMAT')) {
        const format = String(updates.LOG_FORMAT || '').toLowerCase();
        if (format !== 'txt' && format !== 'csv') {
            throw new Error('LOG_FORMAT must be "txt" or "csv"');
        }
        updates.LOG_FORMAT = format;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'ASK_AI')) {
        const askAi = String(updates.ASK_AI || '').toLowerCase();
        if (askAi !== 'ollama' && askAi !== 'gemini') {
            throw new Error('ASK_AI must be "ollama" or "gemini"');
        }
        updates.ASK_AI = askAi;
    }
}

function isMaskedSecret(value) {
    const text = String(value || '').trim();
    return text !== '' && (/^\*+$/.test(text) || text.includes('****'));
}

function updateConfig(updates) {
    const nextConfig = { ...configStore, ...updates };
    nextConfig.LOG_FORMAT = normalizeLogFormat(nextConfig.LOG_FORMAT);
    nextConfig.ASK_AI = normalizeAskAi(nextConfig.ASK_AI);
    writeConfigFile(nextConfig);
    configStore = nextConfig;
}

function writeConfigFile(config) {
    const serializableConfig = {};
    for (const field of CONFIG_FIELDS) {
        serializableConfig[field] = config[field] || '';
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(serializableConfig, null, 2) + '\n', 'utf8');
}

