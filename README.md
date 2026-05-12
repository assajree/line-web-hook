# LineWebhook - บอทเก็บ Log กลุ่มและสรุปแชทด้วย AI

โปรเจกต์นี้เป็นแอปพลิเคชัน **ASP.NET Core (Minimal API)** ที่ทำหน้าที่เป็น **LINE Bot** เพื่อบันทึกประวัติการแชทในกลุ่ม (Group Chat Logger) และสามารถใช้ AI ช่วยสรุปเนื้อหาบทสนทนากลับมาเป็นข้อๆ ได้

## ฟีเจอร์หลัก
1. **เก็บ Log แชทจาก LINE Group:** เมื่อเชิญบอทเข้ากลุ่ม บอทจะบันทึกข้อความทั้งหมดลงไฟล์ Text อัตโนมัติ (แยกโฟลเดอร์ตามชื่อกลุ่ม และแยกไฟล์ตามเดือน)
2. **สรุปแชทด้วย AI (Ollama):** แอดมินสามารถทักแชทส่วนตัวหาบอท เพื่อสั่งให้ AI สรุปแชทของกลุ่มต่างๆ ได้ โดยระบบจะใช้ Local AI Model ในการอ่านไฟล์ Log และสรุปใจความสำคัญ

---

## ขั้นตอนการติดตั้งและตั้งค่า

### 1. ตั้งค่าฝั่ง LINE Official Account
1. ไปที่ [LINE Developers Console](https://developers.line.biz/) สร้าง Provider -> Channel แบบ **Messaging API**
2. คัดลอก **Channel secret** จากแท็บ *Basic settings*
3. คัดลอก **Channel access token (long-lived)** จากแท็บ *Messaging API* (ถ้ายังไม่มีให้กด Issue)
4. เปิดใช้งานฟีเจอร์ **Allow bot to join group chats** ในการตั้งค่าบัญชี

### 2. ตั้งค่าโค้ด (ไฟล์ `Program.cs`)
คุณสามารถตั้งค่าทั้งหมดได้ที่ส่วนหัวของไฟล์ `Program.cs` (ส่วน `CONFIG` บรรทัดที่ 11-17):

```csharp
// ================= CONFIG =================
string ChannelSecret = "ใส่_Channel_Secret_ของคุณที่นี่";
string ChannelAccessToken = "ใส่_Channel_Access_Token_ของคุณที่นี่";
string AdminUserID = "ใส่_UserId_ของคุณที่นี่";
string OllamaUrl = "http://192.168.11.87:11434/api/chat";
string OllamaModel = "gemma3:27b";
// =========================================
```

* **ChannelSecret / ChannelAccessToken:** นำค่าที่ได้จากข้อ 1 มาใส่
* **AdminUserID:** ใส่ User ID ของคุณเพื่อให้คุณเป็นคนเดียวที่สั่งบอทให้สรุปแชทได้ (หา User ID ได้จากเมนู *Basic settings* ในหน้า LINE Developers)
* **OllamaUrl:** แก้ที่อยู่ IP ให้ตรงกับเครื่องที่รัน Ollama อยู่ (ถ้ารันในเครื่องเดียวกันใช้ `http://localhost:11434/api/chat`)
* **OllamaModel:** ระบุชื่อโมเดลที่ต้องการใช้ (ค่าเริ่มต้นคือ `gemma3:27b`)

### 3. ติดตั้งโมเดล Ollama
ระบบต้องการ [Ollama](https://ollama.com/) ในการประมวลผล AI:
1. ติดตั้ง Ollama ลงในเครื่องเซิร์ฟเวอร์
2. รันคำสั่งนี้ใน Terminal เพื่อโหลดโมเดล:
   ```bash
   ollama run gemma3:27b
   ```
   *(หมายเหตุ: หากต้องการใช้โมเดลอื่น ให้แก้ค่า `OllamaModel` ในส่วน CONFIG ใน `Program.cs`)*

### 4. รันโปรเจกต์และเชื่อม Webhook
1. เปิด Terminal ในโฟลเดอร์โปรเจกต์และรันเซิร์ฟเวอร์:
   ```bash
   dotnet run
   ```
2. **ตั้งค่า Webhook (Public URL):** เนื่องจาก LINE ไม่สามารถส่งข้อมูลมาที่ `localhost` ได้ คุณต้องใช้ [ngrok](https://ngrok.com/) เพื่อทำ Public HTTPS URL สำหรับทดสอบ
   ```bash
   ngrok http 5000
   ```
   *(เปลี่ยน 5000 เป็น Port ที่แอปพลิเคชันของคุณรันอยู่)*
3. **เชื่อมต่อ Webhook ใน LINE Developers:**
   * ไปที่ [LINE Developers Console](https://developers.line.biz/) -> เลือก Channel ของคุณ -> แถบ **Messaging API**
   * เลื่อนหา **Webhook settings** -> ช่อง **Webhook URL** ให้กด Edit
   * นำ URL จาก ngrok มาวางตามด้วย Path ของ Webhook (เช่น `https://1a2b-3c4d.ngrok-free.app/webhook`) แล้วกด Update
   * กดปุ่ม **Verify** เพื่อทดสอบการเชื่อมต่อ (ถ้าเชื่อมต่อกับโค้ดได้จะขึ้น Success)
   * เปิดสวิตช์ **Use webhook** ให้เป็น Enabled

---

## วิธีการใช้งานจริง

1. **ดึง Log แบบเงียบๆ:** 
   เชิญบอทเข้ากลุ่ม LINE ที่ต้องการ เมื่อมีการพิมพ์ข้อความ บอทจะสร้างไฟล์บันทึกที่ `Logs/{ชื่อกลุ่ม}/{ปี-เดือน}.txt` โดยอัตโนมัติ
2. **สั่งสรุปแชท:** 
   แอดมินสามารถทักแชทส่วนตัว (1-on-1) หาบอท และพิมพ์สั่งงานได้เลย เช่น:
   * *"ช่วยสรุปแชทของกลุ่ม MyGroup เดือน 2026-05 ให้หน่อย"*
   * *"สรุปประชุมกลุ่มฝ่ายการตลาด เดือน 2026-05"*
   
   บอทจะส่งไฟล์ Log ไปให้ AI ประมวลผลและตอบกลับสรุปสาระสำคัญเป็นข้อๆ
