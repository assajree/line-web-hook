# LineWebhook - บอทเก็บ Log กลุ่มและสรุปแชทด้วย AI

## Summary AI selection
หน้า **Summary** ใช้สำหรับสรุปรายการแจ้งปัญหาเท่านั้น และจะใช้ AI ตามค่า **ASK_AI** ในหน้า Config:
* `ollama` ใช้ **OLLAMA_URL** และ **OLLAMA_MODEL** จากหน้า Config
* `gemini` ใช้ **GEMINI_API_KEY** และ **GEMINI_MODEL** จากหน้า Config
* หน้า Summary ไม่มีช่องให้กรอก **OLLAMA_URL** เพิ่มแล้ว

โปรเจกต์นี้เป็น Node JS แอปพลิเคชันที่ทำหน้าที่เก็บ Chat log จาก **LINE Bot** และสามารถใช้ AI ช่วยสรุปเนื้อหาบทสนทนากลับมาเป็นข้อๆ ได้

## ฟีเจอร์หลัก
1. **เก็บ Log แชทจาก LINE Group:** เมื่อเชิญบอทเข้ากลุ่ม บอทจะบันทึกข้อความทั้งหมดลงไฟล์ Text อัตโนมัติ (แยกโฟลเดอร์ตามชื่อกลุ่ม และแยกไฟล์ตามเดือน)
2. **สรุปแชทผ่าน Line Chat:** แอดมินสามารถทักแชทส่วนตัวหาบอท เพื่อสั่งให้ AI สรุปแชทของกลุ่มต่างๆ ได้ โดยระบบจะใช้ Local AI Model ในการอ่านไฟล์ Log และสรุปใจความสำคัญ
3. **สรุปแชทด้วยผ่านหน้าเว็บ:** สามารถใช้หน้า Summary เพื่อเลือก group และเดือนที่อยากให้ AI สรุปหัวข้อให้ได้ โดยต้องใส่ Public URL ของ AI API
4. **Dowload Chat Log:** สามารถดาวน์โหลดประวัติการแชทเพื่อเอาไปใช้กับ AI ภายนอกได้

## วิธีการใช้งานจริง

1. **การเก็บ Log :** 
   เชิญบอทเข้ากลุ่ม LINE ที่ต้องการ เมื่อมีการพิมพ์ข้อความ บอทจะสร้างไฟล์บันทึกที่ `Logs/{ชื่อกลุ่ม}/{ปี-เดือน}.csv` โดยอัตโนมัติ
2. **สั่งสรุปแชท:** 
   แอดมินสามารถทักแชทส่วนตัว (1-on-1) หาบอท และพิมพ์สั่งงานได้เลย เช่น:
   * *"ช่วยสรุปแชทของกลุ่ม MyGroup เดือน 2026-05 ให้หน่อย"*
   * *"สรุปประชุมกลุ่มฝ่ายการตลาด เดือน 2026-05"*
   
   บอทจะส่งไฟล์ Log ไปให้ AI ประมวลผลและตอบกลับสรุปสาระสำคัญเป็นข้อๆ


## ขั้นตอนการติดตั้งและตั้งค่า

### 1. ตั้งค่าฝั่ง LINE Official Account
1. ไปที่ [LINE Developers Console](https://developers.line.biz/) สร้าง Provider -> Channel แบบ **Messaging API**
2. คัดลอก **Channel secret** จากแท็บ *Basic settings*
3. คัดลอก **Channel access token (long-lived)** จากแท็บ *Messaging API* (ถ้ายังไม่มีให้กด Issue)
4. เปิดใช้งานฟีเจอร์ **Allow bot to join group chats** ในการตั้งค่าบัญชี

### 2. Deploy WebHook ที่ Public Web (Render.com)
1. Push code ขึ้น github
2. Deploy ใน render.com จากโค้ดใน github
4. ถ้าใช้แบบ free plan ต้องใช้ [Uptime Robot Site](https://stats.uptimerobot.com/XGx9qZnSsZ) เพื่อป้องกันไม่ให้เกิดการ spin down (ข้อมูลทั้งหมดจะถูกรีเซ็ต) เมื่อ server ไม่ถูกใช้งานเกิน 15 นาที 

** ทุกครั้งที่ push code ใหม่ขึ้น branch master ใน github เว็บไซต์จะถูก reset ใหม่ ทำให้ข้อมูลทั้งหมดถูกลบและต้อง config ใหม่ด้วย!!

** ก่อน push code แนะนำให้ download ไฟล์ log ที่สำคัญออกมาก่อน

###  3. ตั้งค่า Webhook
เปิดหน้า [Webhook Config](https://line-web-hook-9h5l.onrender.com/config) ใน public site ที่ deploy ไว้

* **CHANNEL_SECRET:** ได้จากแท็บ *Basic settings* ของ LINE Developers Console
* **CHANNEL_ACCESS_TOKEN:** ได้จาก แท็บ *Messaging API* ของ LINE Developers Console
* **ADMIN_USER_ID:** ใส่ User ID ของ Line ที่จะสามรถสั่งบอทให้สรุปแชทได้ (User ID ของเจ้าของ Line Bot หาได้จาก *Your user ID* ในเท็บ *Basic settings* ของ LINE Developers)
* **OllamaUrl:** แก้ที่อยู่ url ให้ตรงกับ Ollama API เช่น `http://localhost:11434/api/chat`)
* **OllamaModel:** ระบุชื่อโมเดลที่ต้องการใช้ (ค่าเริ่มต้นคือ `gemma3:27b`)
* **GeminiApiKey:** ใส่ API key จาก Google AI Studio เพื่อใช้หน้า Summary เมื่อเลือก ASK_AI เป็น `gemini`
* **GeminiModel:** ระบุชื่อโมเดล Gemini ที่ต้องการใช้ (ค่าเริ่มต้นคือ `gemini-2.5-flash`)

### การตั้งค่า Gemini สำหรับ Summary
1. ไปที่ [Google AI Studio](https://aistudio.google.com/app/apikey) แล้วสร้าง API key สำหรับ Gemini
2. เปิดหน้า [Webhook Config](https://line-web-hook-9h5l.onrender.com/config) ใน public site ที่ deploy ไว้
3. ใส่ค่า **GEMINI_API_KEY** และตรวจสอบค่า **GEMINI_MODEL** เช่น `gemini-2.5-flash`
4. กด **Save Config**
5. ตั้งค่า **ASK_AI** เป็น `gemini` แล้วเปิดหน้า **Summary** เพื่อเลือก group และเดือน ระบบจะใช้ Gemini สรุปรายการแจ้งปัญหา

###  4. เชื่อมต่อ Webhook ใน LINE Developers
* ไปที่ [LINE Developers Console](https://developers.line.biz/) -> เลือก Channel ของคุณ -> แถบ **Messaging API**
* เลื่อนหา **Webhook settings** -> ช่อง **Webhook URL** ให้กด Edit
* ใส่ Public URL ของ Webhook (เช่น `https://line-web-hook-9h5l.onrender.com/webhook`) แล้วกด Update
* กดปุ่ม **Verify** เพื่อทดสอบการเชื่อมต่อ (ถ้าเชื่อมต่อกับโค้ดได้จะขึ้น Success)
* เปิดสวิตช์ **Use webhook** ให้เป็น Enabled

## การสรุปแชทจาก Public Webhook
1. ใช้ [ngrok](https://ngrok.com/) เพื่อทำ Public HTTPS URL ของ Ollama API

   ```bash
   ngrok http http://192.168.11.87:11434
   ```

2. เปิดหน้า [Webhook Config](https://line-web-hook-9h5l.onrender.com/config) ใน public site ที่ deploy ไว้

3. ใส่ค่า OLLAMA_URL ที่ได้จาก ngrok เช่น *https://pummel-compacter-blemish.ngrok-free.dev/api/chat*

4. แอดมินสามารถทักแชทส่วนตัว (1-on-1) หาบอท และพิมพ์สั่งงานได้เลย เช่น:
   * *"ช่วยสรุปแชทของกลุ่ม MyGroup เดือน 2026-05 ให้หน่อย"*
   * *"สรุปประชุมกลุ่มฝ่ายการตลาด เดือน 2026-05"*



## การทดสอบ Webhook บน localhost
1. เปิด Terminal ในโฟลเดอร์โปรเจกต์และรันเซิร์ฟเวอร์:
   ```bash
   npm start
   ```

2. **รับ Webhook Public URL** เนื่องจาก LINE ไม่สามารถส่งข้อมูลมาที่ `localhost` ได้ คุณต้องใช้ [ngrok](https://ngrok.com/) เพื่อทำ Public HTTPS URL สำหรับทดสอบ
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






