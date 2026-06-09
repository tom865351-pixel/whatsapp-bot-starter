const http = require("http");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

loadEnv();

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = env("WHATSAPP_VERIFY_TOKEN", env("VERIFY_TOKEN", "my_verify_token_123"));
const WHATSAPP_TOKEN = env("WHATSAPP_ACCESS_TOKEN", env("WHATSAPP_TOKEN", ""));
const PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID", env("PHONE_NUMBER_ID", ""));
const GRAPH_API_VERSION = env("GRAPH_API_VERSION", "v25.0");
const CURRENCY = env("CURRENCY_SYMBOL", "TK");
const SUPPORT_NUMBER = env("SUPPORT_WHATSAPP_NUMBER", "");
const ADMIN_IDS = parseList(env("ADMIN_IDS", ""));
const LOW_STOCK_ALERT_THRESHOLD = Number(env("LOW_STOCK_ALERT_THRESHOLD", "5"));
const AI_ENABLED = env("AI_ENABLED", "false").toLowerCase() === "true";
const GEMINI_API_KEY = env("GEMINI_API_KEY", "");
const GEMINI_MODEL = env("GEMINI_MODEL", "gemini-2.0-flash");

const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const LOG_PATH = path.join(__dirname, "webhook.log");

const stats = {
  startedAt: new Date().toISOString(),
  webhookCount: 0,
  messageCount: 0,
  lastWebhookAt: null,
  lastMessageAt: null,
  lastReplyAt: null,
  lastError: null
};

const state = loadStore();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    return sendText(res, 200, "Premium WhatsApp Mail Shop Bot is running.");
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
      graphApiVersion: GRAPH_API_VERSION,
      users: Object.keys(state.users).length,
      products: Object.keys(state.products).length,
      orders: Object.keys(state.orders).length,
      deposits: Object.keys(state.deposits).length,
      stats
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
      stats.webhookCount += 1;
      stats.lastWebhookAt = new Date().toISOString();
      log("Webhook received", JSON.stringify(body));

      const message = getIncomingMessage(body);
      if (!message) {
        log("No incoming message found in webhook payload");
        return;
      }

      stats.messageCount += 1;
      stats.lastMessageAt = new Date().toISOString();

      const from = message.from;
      const text = getMessageText(message);
      const user = registerUser(from, message);
      const replies = await handleMessage(user, text, message);

      for (const reply of replies) {
        await sendWhatsAppMessage(from, reply);
      }

      stats.lastReplyAt = new Date().toISOString();
      stats.lastError = null;
      log(`Reply sent to ${from}`, JSON.stringify(replies));
    } catch (error) {
      stats.lastError = error.message.slice(0, 500);
      log(`Webhook error: ${error.message}`);
      console.error("Webhook error:", error.message);
    }

    return;
  }

  return sendText(res, 404, "Not found");
});

async function handleMessage(user, text, message) {
  const clean = (text || "").trim();
  const lower = clean.toLowerCase();

  if (user.banned) {
    return [textMessage("Your account is banned. Contact support.")];
  }

  if (isAdmin(user.waId) && lower.startsWith("/")) {
    return [await handleAdminCommand(user, clean)];
  }

  if (lower.startsWith("buy ") || lower.startsWith("bulk ")) {
    return [buyProduct(user, clean)];
  }

  if (lower.startsWith("deposit ")) {
    return [createDeposit(user, clean)];
  }

  if (lower.startsWith("coupon ")) {
    return [redeemCoupon(user, clean)];
  }

  if (lower.startsWith("sell ")) {
    return [createSellRequest(user, clean)];
  }

  if (!clean || hasAny(lower, ["hi", "hello", "hey", "assalamualaikum", "salam", "start", "menu", "btn_menu"])) {
    return [mainMenuList(user)];
  }

  if (hasAny(lower, ["shop", "catalog", "product", "btn_shop", "menu_shop"])) {
    return [catalogMessage()];
  }

  if (hasAny(lower, ["profile", "dashboard", "balance", "btn_profile", "menu_profile"])) {
    return [profileMessage(user)];
  }

  if (hasAny(lower, ["order", "history", "purchase", "btn_orders", "menu_orders"])) {
    return [ordersMessage(user)];
  }

  if (hasAny(lower, ["topup", "top up", "deposit", "recharge", "add balance", "btn_topup", "menu_topup"])) {
    return [depositInstructions()];
  }

  if (hasAny(lower, ["coupon", "promo", "discount", "menu_coupon"])) {
    return [textMessage("Coupon redeem korte likhun:\n\ncoupon YOURCODE")];
  }

  if (hasAny(lower, ["refer", "referral", "menu_refer"])) {
    return [referralMessage(user)];
  }

  if (hasAny(lower, ["status", "deposit status", "menu_status"])) {
    return [depositStatusMessage(user)];
  }

  if (hasAny(lower, ["sell", "submit", "menu_sell"])) {
    return [sellInstructions()];
  }

  if (hasAny(lower, ["support", "help", "admin", "problem", "issue", "menu_support"])) {
    return [supportMessage()];
  }

  if (hasAny(lower, ["ai", "ask", "question", "menu_ai"])) {
    return [await aiHelp(clean, user)];
  }

  return [await aiHelp(clean, user)];
}

async function handleAdminCommand(admin, input) {
  const [cmd, ...parts] = input.split(/\s+/);
  const command = cmd.toLowerCase();

  if (command === "/admin") {
    return textMessage([
      "Admin Dashboard",
      "",
      "/stats",
      "/products",
      "/addproduct name|price|description",
      "/stock product_id email|pass",
      "/deposits",
      "/approve deposit_id",
      "/reject deposit_id reason",
      "/addbal wa_id amount reason",
      "/ban wa_id reason",
      "/unban wa_id",
      "/broadcast message"
    ].join("\n"));
  }

  if (command === "/stats") {
    const totalSales = Object.values(state.orders).reduce((sum, order) => sum + order.total, 0);
    return textMessage([
      "Sales Statistics",
      `Users: ${Object.keys(state.users).length}`,
      `Products: ${Object.keys(state.products).length}`,
      `Orders: ${Object.keys(state.orders).length}`,
      `Deposits: ${Object.keys(state.deposits).length}`,
      `Sales: ${CURRENCY} ${totalSales}`
    ].join("\n"));
  }

  if (command === "/products") {
    return catalogText(true);
  }

  if (command === "/addproduct") {
    const raw = input.slice("/addproduct".length).trim();
    const [name, priceRaw, description = ""] = raw.split("|").map((v) => v.trim());
    const price = Number(priceRaw);
    if (!name || !price) return textMessage("Format:\n/addproduct name|price|description");

    const product = createProduct(name, price, description);
    audit(admin.waId, "add_product", product.id);
    return textMessage(`Product added:\n${product.id} - ${product.name} - ${CURRENCY} ${product.price}`);
  }

  if (command === "/stock") {
    const productId = parts.shift();
    const stockText = input.split(/\s+/).slice(2).join(" ").trim();
    if (!state.products[productId] || !stockText) return textMessage("Format:\n/stock product_id email@example.com|password");

    const item = addStock(productId, stockText);
    audit(admin.waId, "add_stock", `${productId}:${item.id}`);
    return textMessage(`Stock added for ${productId}. Unsold stock: ${stockCount(productId)}`);
  }

  if (command === "/deposits") {
    const pending = Object.values(state.deposits).filter((d) => d.status === "pending").slice(0, 10);
    if (!pending.length) return textMessage("No pending deposits.");
    return textMessage(pending.map((d) => `${d.id}: ${d.waId} - ${CURRENCY} ${d.amount} - TXID ${d.txid}`).join("\n"));
  }

  if (command === "/approve") {
    const deposit = state.deposits[parts[0]];
    if (!deposit || deposit.status !== "pending") return textMessage("Pending deposit not found.");

    deposit.status = "approved";
    deposit.reviewedBy = admin.waId;
    deposit.reviewedAt = now();
    state.users[deposit.waId].balance += deposit.amount;
    audit(admin.waId, "approve_deposit", deposit.id);
    saveStore();
    await sendWhatsAppMessage(deposit.waId, textMessage(`Deposit approved.\nAmount: ${CURRENCY} ${deposit.amount}\nBalance: ${CURRENCY} ${state.users[deposit.waId].balance}`));
    return textMessage(`Approved ${deposit.id}.`);
  }

  if (command === "/reject") {
    const depositId = parts[0];
    const reason = input.split(/\s+/).slice(2).join(" ").trim();
    const deposit = state.deposits[depositId];
    if (!deposit || deposit.status !== "pending") return textMessage("Pending deposit not found.");
    if (!reason) return textMessage("Reject reason required:\n/reject deposit_id reason");

    deposit.status = "rejected";
    deposit.reason = reason;
    deposit.reviewedBy = admin.waId;
    deposit.reviewedAt = now();
    audit(admin.waId, "reject_deposit", `${deposit.id}: ${reason}`);
    saveStore();
    await sendWhatsAppMessage(deposit.waId, textMessage(`Deposit rejected.\nReason: ${reason}`));
    return textMessage(`Rejected ${deposit.id}.`);
  }

  if (command === "/addbal") {
    const waId = parts[0];
    const amount = Number(parts[1]);
    const reason = input.split(/\s+/).slice(3).join(" ").trim();
    if (!state.users[waId] || !amount || !reason) return textMessage("Format:\n/addbal wa_id amount reason");

    state.users[waId].balance += amount;
    audit(admin.waId, "add_balance", `${waId}:${amount}:${reason}`);
    saveStore();
    return textMessage(`Balance added. ${waId}: ${CURRENCY} ${state.users[waId].balance}`);
  }

  if (command === "/ban") {
    const waId = parts[0];
    const reason = input.split(/\s+/).slice(2).join(" ").trim() || "No reason";
    if (!state.users[waId]) return textMessage("User not found.");
    state.users[waId].banned = true;
    state.users[waId].banReason = reason;
    audit(admin.waId, "ban_user", `${waId}:${reason}`);
    saveStore();
    return textMessage(`Banned ${waId}.`);
  }

  if (command === "/unban") {
    const waId = parts[0];
    if (!state.users[waId]) return textMessage("User not found.");
    state.users[waId].banned = false;
    audit(admin.waId, "unban_user", waId);
    saveStore();
    return textMessage(`Unbanned ${waId}.`);
  }

  if (command === "/broadcast") {
    const message = input.slice("/broadcast".length).trim();
    if (!message) return textMessage("Format:\n/broadcast message");
    audit(admin.waId, "broadcast", message.slice(0, 80));
    let sent = 0;
    for (const waId of Object.keys(state.users)) {
      if (waId === admin.waId || state.users[waId].banned) continue;
      await sendWhatsAppMessage(waId, textMessage(message));
      sent += 1;
    }
    return textMessage(`Broadcast sent to ${sent} users.`);
  }

  return textMessage("Unknown admin command. Send /admin");
}

function mainMenuList(user) {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Premium Mail Shop" },
      body: { text: `Welcome!\nBalance: ${CURRENCY} ${user.balance}\nChoose an option below.` },
      footer: { text: "Fast delivery • Secure shop" },
      action: {
        button: "Open Menu",
        sections: [
          {
            title: "Main",
            rows: [
              { id: "menu_shop", title: "Shop", description: "Browse products" },
              { id: "menu_topup", title: "Top Up", description: "Deposit balance" },
              { id: "menu_profile", title: "Profile", description: "Balance and account" },
              { id: "menu_orders", title: "Orders", description: "Purchase history" },
              { id: "menu_status", title: "Status", description: "Deposit status" },
              { id: "menu_coupon", title: "Coupon", description: "Redeem promo code" },
              { id: "menu_refer", title: "Refer", description: "Referral commission" },
              { id: "menu_sell", title: "Sell", description: "Submit product to sell" },
              { id: "menu_ai", title: "AI Help", description: "Ask support agent" },
              { id: "menu_support", title: "Support", description: "Contact admin" }
            ]
          }
        ]
      }
    }
  };
}

function catalogMessage() {
  const products = activeProducts();
  if (!products.length) {
    return textMessage("No active products right now. Please check later.");
  }

  return {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Product Catalog" },
      body: { text: "Select a product or type: buy PRODUCT_ID" },
      action: {
        button: "View Products",
        sections: [
          {
            title: "Available",
            rows: products.slice(0, 10).map((product) => ({
              id: `buy ${product.id}`,
              title: product.name.slice(0, 24),
              description: `${CURRENCY} ${product.price} • Stock ${stockCount(product.id)}`
            }))
          }
        ]
      }
    }
  };
}

function catalogText(includeDisabled = false) {
  const products = Object.values(state.products)
    .filter((product) => includeDisabled || product.active)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (!products.length) return textMessage("No products found.");

  return textMessage(products.map((p) => [
    `${p.id}. ${p.name}`,
    `Price: ${CURRENCY} ${p.price}`,
    `Stock: ${stockCount(p.id)}`,
    `Status: ${p.active ? "active" : "disabled"}`,
    `Buy: buy ${p.id}`
  ].join("\n")).join("\n\n"));
}

function profileMessage(user) {
  return textMessage([
    "Profile",
    `ID: ${user.id}`,
    `WhatsApp: ${user.waId}`,
    `Balance: ${CURRENCY} ${user.balance}`,
    `Orders: ${user.orders.length}`,
    `Referral code: ${user.referralCode}`,
    "",
    "Menu dekhte: menu"
  ].join("\n"));
}

function ordersMessage(user) {
  const orders = user.orders.map((id) => state.orders[id]).filter(Boolean).slice(-10).reverse();
  if (!orders.length) return textMessage("No orders yet. Shop dekhte likhun: shop");

  return textMessage(orders.map((order) => [
    `${order.id} - ${order.status}`,
    `Product: ${order.productName}`,
    `Qty: ${order.quantity}`,
    `Total: ${CURRENCY} ${order.total}`,
    `Date: ${formatDate(order.createdAt)}`
  ].join("\n")).join("\n\n"));
}

function depositInstructions() {
  return textMessage([
    "Top Up / Deposit",
    "",
    `Minimum: ${CURRENCY} ${env("MIN_DEPOSIT", "100")}`,
    "",
    paymentLine("bKash", "BKASH_NUMBER"),
    paymentLine("Nagad", "NAGAD_NUMBER"),
    paymentLine("Rocket", "ROCKET_NUMBER"),
    paymentLine("Binance", "BINANCE_PAY_ID"),
    paymentLine("USDT TRC20", "USDT_TRC20_ADDRESS"),
    paymentLine("USDT BEP20", "USDT_BEP20_ADDRESS"),
    "",
    "Payment kore likhun:",
    "deposit amount txid method",
    "",
    "Example:",
    "deposit 500 TX12345 bkash"
  ].filter(Boolean).join("\n"));
}

function depositStatusMessage(user) {
  const deposits = user.deposits.map((id) => state.deposits[id]).filter(Boolean).slice(-5).reverse();
  if (!deposits.length) return textMessage("No deposit request found.");

  return textMessage(deposits.map((deposit) => [
    `${deposit.id} - ${deposit.status}`,
    `Amount: ${CURRENCY} ${deposit.amount}`,
    `Method: ${deposit.method}`,
    `TXID: ${deposit.txid}`,
    deposit.reason ? `Reason: ${deposit.reason}` : ""
  ].filter(Boolean).join("\n")).join("\n\n"));
}

function referralMessage(user) {
  return textMessage([
    "Referral",
    `Your code: ${user.referralCode}`,
    `Commission: ${env("REFERRAL_COMMISSION_PERCENT", "10")}%`,
    `Earned: ${CURRENCY} ${user.referralEarned || 0}`,
    "",
    "New user ke apnar code dite bolun."
  ].join("\n"));
}

function sellInstructions() {
  return textMessage([
    "Sell Request",
    "Apni product/account/service sell korte chaile likhun:",
    "",
    "sell product details | expected price | contact",
    "",
    "Example:",
    "sell 10 gmail account | 500 | my contact"
  ].join("\n"));
}

function supportMessage() {
  return textMessage([
    "Support",
    "Apnar problem ek message-e details pathan.",
    SUPPORT_NUMBER ? `Admin WhatsApp: ${SUPPORT_NUMBER}` : "",
    "Urgent hole likhun: urgent"
  ].filter(Boolean).join("\n"));
}

function buyProduct(user, input) {
  const parts = input.split(/\s+/);
  const bulk = parts[0].toLowerCase() === "bulk";
  const productId = parts[1];
  const quantity = Math.max(1, Number(parts[2] || "1"));
  const product = state.products[productId];

  if (!product || !product.active) return textMessage("Product not found. Catalog dekhte likhun: shop");
  if (bulk && quantity < 2) return textMessage("Bulk buy format:\nbulk PRODUCT_ID quantity");
  if (stockCount(productId) < quantity) return textMessage(`Insufficient stock. Available: ${stockCount(productId)}`);

  const total = product.price * quantity;
  if (user.balance < total) {
    return textMessage([
      "Insufficient balance.",
      `Need: ${CURRENCY} ${total}`,
      `Your balance: ${CURRENCY} ${user.balance}`,
      "Top up korte likhun: topup"
    ].join("\n"));
  }

  const items = reserveStock(productId, quantity);
  user.balance -= total;

  const order = {
    id: nextId("ORD"),
    waId: user.waId,
    productId,
    productName: product.name,
    quantity,
    total,
    stockItemIds: items.map((item) => item.id),
    delivery: items.map((item) => item.value),
    status: "delivered",
    createdAt: now()
  };

  state.orders[order.id] = order;
  user.orders.push(order.id);
  saveStore();

  maybeLowStockAlert(productId);

  return textMessage([
    "Order delivered",
    `Order ID: ${order.id}`,
    `Product: ${product.name}`,
    `Qty: ${quantity}`,
    `Total: ${CURRENCY} ${total}`,
    `Balance: ${CURRENCY} ${user.balance}`,
    "",
    "Delivery:",
    order.delivery.join("\n")
  ].join("\n"));
}

function createDeposit(user, input) {
  const parts = input.split(/\s+/);
  const amount = Number(parts[1]);
  const txid = parts[2];
  const method = parts.slice(3).join(" ") || "unknown";
  const minDeposit = Number(env("MIN_DEPOSIT", "100"));

  if (!amount || !txid) return textMessage("Format:\ndeposit amount txid method\nExample: deposit 500 TX123 bkash");
  if (amount < minDeposit) return textMessage(`Minimum deposit: ${CURRENCY} ${minDeposit}`);

  const duplicate = Object.values(state.deposits).find((deposit) => deposit.txid.toLowerCase() === txid.toLowerCase());
  if (duplicate) return textMessage("This TXID already submitted. Duplicate TXID not allowed.");

  const deposit = {
    id: nextId("DEP"),
    waId: user.waId,
    amount,
    txid,
    method,
    status: "pending",
    createdAt: now()
  };

  state.deposits[deposit.id] = deposit;
  user.deposits.push(deposit.id);
  saveStore();

  notifyAdmins(`New pending deposit\n${deposit.id}\nUser: ${user.waId}\nAmount: ${CURRENCY} ${amount}\nTXID: ${txid}\nApprove: /approve ${deposit.id}`);

  return textMessage([
    "Deposit request submitted.",
    `ID: ${deposit.id}`,
    `Amount: ${CURRENCY} ${amount}`,
    `Status: pending`,
    "",
    "Admin verify kore approve korbe."
  ].join("\n"));
}

function redeemCoupon(user, input) {
  const code = input.split(/\s+/)[1]?.toUpperCase();
  const coupon = state.coupons[code];
  if (!code) return textMessage("Format:\ncoupon YOURCODE");
  if (!coupon || !coupon.active) return textMessage("Invalid coupon.");
  if (coupon.usedBy.includes(user.waId)) return textMessage("You already used this coupon.");
  if (coupon.maxUses && coupon.usedBy.length >= coupon.maxUses) return textMessage("Coupon usage limit reached.");

  user.balance += coupon.amount;
  coupon.usedBy.push(user.waId);
  saveStore();
  return textMessage(`Coupon redeemed.\nAdded: ${CURRENCY} ${coupon.amount}\nBalance: ${CURRENCY} ${user.balance}`);
}

function createSellRequest(user, input) {
  const details = input.slice("sell".length).trim();
  if (!details) return sellInstructions();

  const request = {
    id: nextId("SELL"),
    waId: user.waId,
    details,
    status: "pending",
    createdAt: now()
  };
  state.sellRequests[request.id] = request;
  saveStore();
  notifyAdmins(`New sell request\n${request.id}\nUser: ${user.waId}\n${details}`);
  return textMessage(`Sell request submitted.\nID: ${request.id}\nAdmin review korbe.`);
}

async function aiHelp(text, user) {
  const local = localIntentReply(text, user);
  if (!AI_ENABLED || !GEMINI_API_KEY) return textMessage(local);

  try {
    const prompt = [
      "You are a polite Bangla/Banglish WhatsApp shop support agent.",
      "Guide users to shop, deposit, balance, orders, coupon, referral, support, sell request.",
      "Never approve deposits, refunds, balance changes, or admin actions.",
      `User balance: ${CURRENCY} ${user.balance}.`,
      `User message: ${text}`
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    if (!response.ok) return textMessage(local);
    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return textMessage(answer || local);
  } catch {
    return textMessage(local);
  }
}

function localIntentReply(text, user) {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["price", "shop", "kinbo", "buy"])) return "Shop dekhte likhun: shop\nKinte: buy PRODUCT_ID";
  if (hasAny(lower, ["deposit", "topup", "balance"])) return `Apnar balance ${CURRENCY} ${user.balance}.\nTop up korte likhun: topup`;
  if (hasAny(lower, ["order", "history"])) return "Order history dekhte likhun: orders";
  if (hasAny(lower, ["coupon"])) return "Coupon redeem korte likhun: coupon YOURCODE";
  if (hasAny(lower, ["refer"])) return `Referral code: ${user.referralCode}`;
  if (hasAny(lower, ["sell"])) return "Sell request korte likhun: sell details | price | contact";
  return "Bujhte parlam. Menu dekhte likhun: menu\nSupport pete likhun: support";
}

function registerUser(waId, message) {
  if (!state.users[waId]) {
    const refCode = `REF${waId.slice(-6)}`;
    state.users[waId] = {
      id: nextId("USR"),
      waId,
      name: message.contacts?.[0]?.profile?.name || "",
      balance: 0,
      referralCode: refCode,
      referralEarned: 0,
      banned: false,
      restricted: false,
      orders: [],
      deposits: [],
      createdAt: now()
    };
    saveStore();
  }
  return state.users[waId];
}

function createProduct(name, price, description) {
  const product = {
    id: nextId("P"),
    name,
    price,
    description,
    active: true,
    archived: false,
    createdAt: now()
  };
  state.products[product.id] = product;
  saveStore();
  return product;
}

function addStock(productId, value) {
  const item = {
    id: nextId("STK"),
    productId,
    value,
    status: "unsold",
    createdAt: now()
  };
  state.stockItems[item.id] = item;
  saveStore();
  return item;
}

function reserveStock(productId, quantity) {
  const items = Object.values(state.stockItems)
    .filter((item) => item.productId === productId && item.status === "unsold")
    .slice(0, quantity);

  for (const item of items) {
    item.status = "sold";
    item.soldAt = now();
  }

  return items;
}

function activeProducts() {
  return Object.values(state.products).filter((product) => product.active && !product.archived);
}

function stockCount(productId) {
  return Object.values(state.stockItems).filter((item) => item.productId === productId && item.status === "unsold").length;
}

async function maybeLowStockAlert(productId) {
  const product = state.products[productId];
  const remaining = stockCount(productId);
  if (product && remaining <= LOW_STOCK_ALERT_THRESHOLD) {
    await notifyAdmins(`Low stock alert\n${product.name}\nRemaining: ${remaining}`);
  }
}

async function notifyAdmins(message) {
  for (const adminId of ADMIN_IDS) {
    if (!adminId) continue;
    try {
      await sendWhatsAppMessage(adminId, textMessage(message));
    } catch (error) {
      log(`Admin notify failed: ${error.message}`);
    }
  }
}

function audit(actor, action, details) {
  state.adminAuditLogs[nextId("AUD")] = { actor, action, details, createdAt: now() };
  saveStore();
}

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

function loadStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_PATH)) {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  }

  const initial = {
    counters: {},
    users: {},
    products: {},
    stockItems: {},
    orders: {},
    deposits: {},
    coupons: {
      WELCOME10: {
        code: "WELCOME10",
        amount: 10,
        active: true,
        maxUses: 100,
        usedBy: []
      }
    },
    sellRequests: {},
    adminAuditLogs: {}
  };

  fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2));
  return initial;
}

function saveStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
}

function nextId(prefix) {
  state.counters[prefix] = (state.counters[prefix] || 0) + 1;
  return `${prefix}${String(state.counters[prefix]).padStart(5, "0")}`;
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

async function sendWhatsAppMessage(to, message) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_TOKEN or PHONE_NUMBER_ID missing");
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildWhatsAppPayload(to, message))
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp API failed: ${response.status} ${errorBody}`);
  }
}

function buildWhatsAppPayload(to, message) {
  if (typeof message === "object" && message !== null && message.type) {
    return { messaging_product: "whatsapp", recipient_type: "individual", to, ...message };
  }
  return textPayload(to, String(message));
}

function textMessage(body) {
  return { type: "text", text: { preview_url: false, body: String(body) } };
}

function textPayload(to, body) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to, ...textMessage(body) };
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

function isAdmin(waId) {
  return ADMIN_IDS.includes(waId);
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function parseList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function now() {
  return new Date().toISOString();
}

function formatDate(value) {
  return new Date(value).toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
}

function paymentLine(label, key) {
  const value = env(key, "");
  return value ? `${label}: ${value}` : "";
}

server.listen(PORT, () => {
  console.log(`Premium WhatsApp Mail Shop Bot listening on port ${PORT}`);
});
