const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

loadEnv();

const LOG_PATH = path.join(__dirname, "webhook.log");
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    return sendText(res, 200, "WhatsApp bot is running.");
  }

  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return sendText(res, 200, challenge || "");
    }

    return sendText(res, 403, "Forbidden");
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    sendText(res, 200, "OK");

    try {
      const body = await readJson(req);
      log("Webhook received", JSON.stringify(body));
      const message = getIncomingMessage(body);
      if (!message) {
        log("No incoming message found in webhook payload");
        return;
      }

      const from = message.from;
      const text = message.text?.body?.trim() || "";

      const reply = buildReply(text);
      await sendWhatsAppMessage(from, reply);
      log(`Reply sent to ${from}: ${reply}`);
    } catch (error) {
      log(`Webhook error: ${error.message}`);
      console.error("Webhook error:", error.message);
    }

    return;
  }

  return sendText(res, 404, "Not found");
});

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    process.env[key] = value;
  }
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain" });
  res.end(text);
}

function log(message, details = "") {
  const line = `[${new Date().toISOString()}] ${message}${details ? `\n${details}` : ""}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
    });

    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function getIncomingMessage(body) {
  return body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
}

function buildReply(text) {
  const lower = text.toLowerCase();

  if (lower === "hi" || lower === "hello" || lower === "assalamualaikum") {
    return "Hello! Apnar message peyechi. Ki help lagbe?";
  }

  if (lower.includes("price") || lower.includes("dam")) {
    return "Price details janar jonno product name/pathan.";
  }

  return `Apni bolechen: ${text || "empty message"}`;
}

async function sendWhatsAppMessage(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_TOKEN or PHONE_NUMBER_ID missing in .env");
  }

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp API failed: ${response.status} ${errorBody}`);
  }
}

server.listen(PORT, () => {
  console.log(`WhatsApp bot listening on port ${PORT}`);
});
