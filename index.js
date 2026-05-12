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
                        const safeGroupName = sanitizeFolderName(groupName);
                        const fileExt = LogFormat.toLowerCase() === 'csv' ? 'csv' : 'txt';
                        const logPath = path.join(__dirname, 'Logs', safeGroupName, `${month}.${fileExt}`);

                        if (!fs.existsSync(logPath)) {
                            await replyText(replyToken, `ไม่พบข้อมูลของกลุ่ม ${groupName} เดือน ${month}`);
                            return res.status(200).send('OK');
                        }

                        const chatText = fs.readFileSync(logPath, 'utf8');

                        const prompt = `
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

                        const summary = await askOllama("", prompt, false);
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

app.get('/logs', (req, res) => {
    const logPath = path.join(__dirname, 'Logs');

    if (!fs.existsSync(logPath)) {
        return res.send('<h1>No logs found.</h1>');
    }

    let htmlBuilder = `
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Log Viewer</title>
        <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; color: #333; margin: 40px; }
        h1 { color: #2c3e50; }
        .group-box { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
        h2 { color: #2980b9; margin-top: 0; }
        ul { list-style-type: none; padding: 0; }
        li { margin: 10px 0; display: flex; justify-content: space-between; align-items: center; max-width: 400px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        a { text-decoration: none; color: #fff; background-color: #3498db; padding: 8px 12px; border-radius: 4px; font-weight: bold; transition: background-color 0.3s; font-size: 14px; }
        a:hover { background-color: #2980b9; }
        </style></head><body>
        <h1>Download Logs</h1>
    `;

    const groups = fs.readdirSync(logPath, { withFileTypes: true }).filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);

    if (groups.length === 0) {
        htmlBuilder += '<p>No groups found.</p>';
    }

    for (const groupName of groups) {
        htmlBuilder += `<div class="group-box">`;
        htmlBuilder += `<h2>Group: ${groupName}</h2>`;

        const groupDir = path.join(logPath, groupName);
        const files = fs.readdirSync(groupDir).filter(f => f.endsWith('.txt') || f.endsWith('.csv'));

        if (files.length === 0) {
            htmlBuilder += `<p>No log files for this group.</p>`;
        } else {
            htmlBuilder += `<ul>`;
            for (const fileName of files) {
                const downloadUrl = `/logs/download/${encodeURIComponent(groupName)}/${encodeURIComponent(fileName)}`;
                htmlBuilder += `<li><span>${fileName}</span> <a href="${downloadUrl}" target="_blank">Download</a></li>`;
            }
            htmlBuilder += `</ul>`;
        }
        htmlBuilder += `</div>`;
    }

    htmlBuilder += `</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlBuilder);
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

async function askOllama(userText, systemPrompt, isJSONResponse) {
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

        const res = await axios.post(OllamaUrl, payload);
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
        คุณคือระบบแยก intent จากข้อความผู้ใช้

        ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON โดยเด็ดขาด

        รูปแบบ JSON:
        {
          "action": "summarize" | "none",
          "groupName": "string" | null,
          "month": "yyyy-MM" | null
        }

        กติกา:
        - action:
          - ใช้ "summarize" เมื่อผู้ใช้ต้องการสรุปข้อมูล
          - ถ้าไม่เข้าเงื่อนไขใด ให้ใช้ "none"
        - groupName:
          - ต้องเป็นหนึ่งในรายการนี้เท่านั้น
          - ถ้าไม่ตรง ให้ตอบ null
          รายการที่อนุญาต:
          [${groupList.join(', ')}]
        - month:
          - ดึงจากข้อความผู้ใช้เท่านั้น
          - ถ้าไม่พบหรือไม่ชัดเจน ให้ตอบ null

        ข้อความผู้ใช้:
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
