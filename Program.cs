using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddMemoryCache();
var app = builder.Build();

// ================= CONFIG =================
string ChannelSecret = "89bc3558ed5592fd68004f8708b053a5";
string ChannelAccessToken = "Nsoac7fNQ4TXLdWW7FzZbpGsPx+qnYsoOvkw6vHwAd0sPxRq9Tmi8YK8vQzUyhStgqu7mOFjbuaF7JTqCiDWN1uiYMgSfzE3qthhFw0/umtfg3EygRD/cURjF62fWgci0G+cTddx5zSh0rYBHWt+7gdB04t89/1O/w1cDnyilFU=";
// =========================================

app.MapPost("/webhook", async (HttpRequest req, IMemoryCache cache) =>
{
    using var reader = new StreamReader(req.Body);
    var body = await reader.ReadToEndAsync();

    var signature = req.Headers["X-Line-Signature"].ToString();
    if (!VerifySignature(body, ChannelSecret, signature))
        return Results.Unauthorized();

    var json = JsonDocument.Parse(body);
    if (!json.RootElement.TryGetProperty("events", out var events))
        return Results.Ok();

    foreach (var ev in events.EnumerateArray())
    {
        if (ev.GetProperty("type").GetString() != "message")
            continue;

        var message = ev.GetProperty("message");
        if (message.GetProperty("type").GetString() != "text")
            continue;

        var replyToken = ev.GetProperty("replyToken").GetString();
        var userText = message.GetProperty("text").GetString();
        var timestamp = ev.GetProperty("timestamp").GetInt64();

        var dateTime = DateTimeOffset
            .FromUnixTimeMilliseconds(timestamp)
            .ToLocalTime()
            .DateTime;

        var timeText = dateTime.ToString("yyyy-MM-dd HH:mm:ss");

        Console.WriteLine($"userText: {userText}");

        var source = ev.GetProperty("source");
        var sourceType = source.GetProperty("type").GetString();

        if (sourceType == "group")
        {
            string? groupId = source.GetProperty("groupId").GetString();
            string? userId = source.GetProperty("userId").GetString();

            var groupCacheKey = $"group:{groupId}";
            var userCacheKey = $"user:{groupId}:{userId}";

            // ===== GROUP NAME =====
            if (!cache.TryGetValue(groupCacheKey, out string groupName))
            {
                groupName = await GetGroupName(groupId) ?? groupId;
                cache.Set(groupCacheKey, groupName, TimeSpan.FromHours(24));
            }

            // ===== USER NAME =====
            if (!cache.TryGetValue(userCacheKey, out string displayName))
            {
                displayName = await GetGroupMemberName(groupId, userId) ?? userId;
                cache.Set(userCacheKey, displayName, TimeSpan.FromHours(24));
            }

            // ===== LOG =====
            // 1) เตรียม path
            var safeGroupName = SanitizeFolderName(groupName);
            var logDir = Path.Combine(AppContext.BaseDirectory, "Logs", safeGroupName);
            Directory.CreateDirectory(logDir);

            // 2) ไฟล์รายเดือน
            var logFile = Path.Combine(logDir, $"{DateTime.Now:yyyy-MM}.txt");

            // 3) ข้อความ
            var logLine = $"[Time : {timeText}] [Group : {groupName}] [Name : {displayName}] : {userText}";
            Console.WriteLine(logLine);

            // 4) เขียน
            try
            {
                await File.AppendAllTextAsync(logFile, logLine + Environment.NewLine, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                Console.WriteLine("LOG WRITE ERROR: " + ex.Message);
            }
        }
        else if (sourceType == "user")
        {
            string? userId = source.GetProperty("userId").GetString();
            if (userId == "Ub5c70cb401a81925c731e923600b8fc6")
            {
                var (action, groupName, month) = await ParseCommand(userText!);

                if (action == "summarize" &&
                    !string.IsNullOrEmpty(groupName) &&
                    !string.IsNullOrEmpty(month))
                {
                    var safeGroupName = SanitizeFolderName(groupName);
                    var logPath = Path.Combine(
                        AppContext.BaseDirectory,
                        "Logs",
                        safeGroupName,
                        $"{month}.txt"
                    );

                    if (!File.Exists(logPath))
                    {
                        await ReplyText(replyToken!, $"ไม่พบข้อมูลของกลุ่ม {groupName} เดือน {month}");
                        return Results.Ok();
                    }

                    var chatText = await File.ReadAllTextAsync(logPath, Encoding.UTF8);

                    string prompt = $@"
                        คุณคือผู้ช่วยสรุปบทสนทนา LINE group สำหรับงานบริษัท ชื่อ ""{groupName}""

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
                        {chatText}
                        ";

                    var summary = await AskOllama("", prompt, false);
                    await ReplyText(replyToken!, summary);
                }
                else
                {
                    await ReplyText(replyToken!, $"ไม่พบข้อมูล");
                }
            }
        }
    }

    return Results.Ok();
});

app.Run("http://localhost:5000");

// ================= FUNCTIONS =================

bool VerifySignature(string body, string secret, string signature)
{
    using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(body));
    var hashBase64 = Convert.ToBase64String(hash);
    return hashBase64 == signature;
}

async Task<string?> GetGroupMemberName(string groupId, string userId)
{
    using var client = new HttpClient();
    client.DefaultRequestHeaders.Authorization =
        new AuthenticationHeaderValue("Bearer", ChannelAccessToken);

    var url = $"https://api.line.me/v2/bot/group/{groupId}/member/{userId}";
    var res = await client.GetAsync(url);

    if (!res.IsSuccessStatusCode)
        return null;

    var json = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
    return json.RootElement.GetProperty("displayName").GetString();
}

async Task<string?> GetGroupName(string groupId)
{
    using var client = new HttpClient();
    client.DefaultRequestHeaders.Authorization =
        new AuthenticationHeaderValue("Bearer", ChannelAccessToken);

    var url = $"https://api.line.me/v2/bot/group/{groupId}/summary";
    var res = await client.GetAsync(url);

    if (!res.IsSuccessStatusCode)
        return null;

    var json = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
    return json.RootElement.GetProperty("groupName").GetString();
}

string SanitizeFolderName(string name)
{
    foreach (var c in Path.GetInvalidFileNameChars())
        name = name.Replace(c, '_');

    return name.Trim();
}

async Task ReplyText(string replyToken, string text)
{
    var http = new HttpClient();
    http.DefaultRequestHeaders.Add(
        "Authorization",
        $"Bearer {ChannelAccessToken}"
    );

    var payload = new
    {
        replyToken = replyToken,
        messages = new[]
        {
            new
            {
                type = "text",
                text = text
            }
        }
    };

    var json = JsonSerializer.Serialize(payload);
    var content = new StringContent(json, Encoding.UTF8, "application/json");

    await http.PostAsync(
        "https://api.line.me/v2/bot/message/reply",
        content
    );
}

async Task<string> AskOllama(string userText, string systemPrompt, bool isJSONResponse)
{
    Console.WriteLine($"userText: {userText}");
    Console.WriteLine($"systemPrompt: {systemPrompt}");

    var http = new HttpClient();

    //model = "qwen2.5:1.5b",
    var payload = new
    {
        model = "gemma3:27b",
        format = isJSONResponse == true ? "json" : null,
        messages = new[]
        {
            new
            {
                role = "system",
                content = systemPrompt
            },
            new
            {
                role = "user",
                //content = userText
                content = string.IsNullOrWhiteSpace(userText) ? "ทำงานตาม system prompt" : userText
            }
        },
        stream = false
    };

    var json = JsonSerializer.Serialize(payload);
    var content = new StringContent(json, Encoding.UTF8, "application/json");

    //"http://localhost:11434/api/chat",
    var response = await http.PostAsync(
        "http://192.168.11.87:11434/api/chat",
        content
    );

    var result = await response.Content.ReadAsStringAsync();
    Console.WriteLine($"Ollama raw response: {result}");

    return JsonDocument
        .Parse(result)
        .RootElement
        .GetProperty("message")
        .GetProperty("content")
        .GetString()
        ?? "ขออภัยค่ะ ระบบไม่สามารถตอบได้ในขณะนี้";
}

async Task<(string? action, string? group, string? month)> ParseCommand(string text)
{
    var logPath = Path.Combine(AppContext.BaseDirectory, "Logs");
    var groupList = Directory.Exists(logPath) ? Directory.GetDirectories(logPath).Select(Path.GetFileName).ToList() : new List<string?>();

    var prompt = $@"
        คุณคือระบบแยก intent จากข้อความผู้ใช้

        ตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอกเหนือจาก JSON โดยเด็ดขาด

        รูปแบบ JSON:
        {{
          ""action"": ""summarize"" | ""none"",
          ""groupName"": ""string"" | null,
          ""month"": ""yyyy-MM"" | null
        }}

        กติกา:
        - action:
          - ใช้ ""summarize"" เมื่อผู้ใช้ต้องการสรุปข้อมูล
          - ถ้าไม่เข้าเงื่อนไขใด ให้ใช้ ""none""
        - groupName:
          - ต้องเป็นหนึ่งในรายการนี้เท่านั้น
          - ถ้าไม่ตรง ให้ตอบ null
          รายการที่อนุญาต:
          [{groupList}]
        - month:
          - ดึงจากข้อความผู้ใช้เท่านั้น
          - ถ้าไม่พบหรือไม่ชัดเจน ให้ตอบ null

        ข้อความผู้ใช้:
        {text}
    ";

    var result = await AskOllama("", prompt, true);

    try
    {
        var json = JsonDocument.Parse(result);
        return (
            json.RootElement.GetProperty("action").GetString(),
            json.RootElement.GetProperty("groupName").GetString(),
            json.RootElement.GetProperty("month").GetString()
        );
    }
    catch
    {
        return (null, null, null);
    }
}
