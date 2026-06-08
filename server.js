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
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v25.0";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    return sendText(res, 200, "WhatsApp bot is running.");
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendText(res, 200, "ok");
  }

  if (req.method === "GET" && url.pathname === "/debug/status") {
    return sendJson(res, 200, {
      ok: true,
      verifyTokenSet: Boolean(VERIFY_TOKEN),
      whatsappTokenSet: Boolean(WHATSAPP_TOKEN),
      phoneNumberIdSet: Boolean(PHONE_NUMBER_ID),
      phoneNumberIdLast4: PHONE_NUMBER_ID ? PHONE_NUMBER_ID.slice(-4) : null,
      graphApiVersion: GRAPH_API_VERSION
    });
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
      const text = getMessageText(message);

      const reply = buildReply(text);
      await sendWhatsAppMessage(from, reply);
      log(`Reply sent to ${from}: ${JSON.stringify(reply)}`);
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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
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

function getMessageText(message) {
  if (message.text?.body) return message.text.body.trim();

  const buttonReply = message.interactive?.button_reply;
  if (buttonReply) return (buttonReply.id || buttonReply.title || "").trim();

  const listReply = message.interactive?.list_reply;
  if (listReply) return (listReply.id || listReply.title || "").trim();

  if (message.button?.text) return message.button.text.trim();

  return "";
}

function buildReply(text) {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  if (!clean) {
    return mainMenuButtons();
  }

  if (hasAny(lower, ["hi", "hello", "hey", "assalamualaikum", "salam", "start", "menu"])) {
    return mainMenuButtons();
  }

  if (hasAny(lower, ["price", "dam", "rate", "tk", "taka", "list", "btn_price"])) {
    return priceReply();
  }

  if (hasAny(lower, ["basic"])) {
    return "Basic package details pete apnar requirement/product name pathan. Admin confirm kore price bolbe.";
  }

  if (hasAny(lower, ["standard"])) {
    return "Standard package e extra support thakbe. Apnar kajer details pathan, amra quote dibo.";
  }

  if (hasAny(lower, ["premium"])) {
    return "Premium package urgent/priority kajer jonno. Details pathan, admin fast reply korbe.";
  }

  if (hasAny(lower, ["order", "buy", "kinbo", "nibo", "need", "lagbe", "btn_order"])) {
    return [
      "Order korte ei info pathan:",
      "1. Product/service name",
      "2. Quantity",
      "3. Delivery/contact info",
      "",
      "Admin shortly confirm korbe."
    ].join("\n");
  }

  if (hasAny(lower, ["support", "help", "problem", "issue", "admin", "btn_support"])) {
    return [
      "Support er jonno apnar problem details pathan.",
      "Urgent hole likhun: urgent",
      "Admin dekhe reply korbe."
    ].join("\n");
  }

  if (hasAny(lower, ["urgent", "fast", "quick"])) {
    return "Urgent request received. Apnar kaj/problem details ek message-e pathan.";
  }

  if (hasAny(lower, ["thanks", "thank", "dhonnobad", "ok", "okay"])) {
    return "Welcome. Aro help lagle menu likhun.";
  }

  return [
    `Apni bolechen: ${clean}`,
    "",
    "Options dekhte menu likhun, price janar jonno price likhun, order korte order likhun."
  ].join("\n");
}

function mainMenu() {
  return [
    "Assalamualaikum! Ki help lagbe?",
    "",
    "1. Price janar jonno: price",
    "2. Order korte: order",
    "3. Support pete: support",
    "4. Admin help: admin"
  ].join("\n");
}

function mainMenuButtons() {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Assalamualaikum! Ki help lagbe?"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "btn_price", title: "Price" }
          },
          {
            type: "reply",
            reply: { id: "btn_order", title: "Order" }
          },
          {
            type: "reply",
            reply: { id: "btn_support", title: "Support" }
          }
        ]
      }
    }
  };
}

function priceReply() {
  return [
    "Price list:",
    "1. Basic package - message korun: basic",
    "2. Standard package - message korun: standard",
    "3. Premium package - message korun: premium",
    "",
    "Exact price/product er jonno product name pathan."
  ].join("\n");
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

async function sendWhatsAppMessage(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_TOKEN or PHONE_NUMBER_ID missing in .env");
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildWhatsAppPayload(to, body))
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp API failed: ${response.status} ${errorBody}`);
  }
}

function buildWhatsAppPayload(to, message) {
  if (typeof message === "object" && message !== null) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      ...message
    };
  }

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: String(message)
    }
  };
}

server.listen(PORT, () => {
  console.log(`WhatsApp bot listening on port ${PORT}`);
});
