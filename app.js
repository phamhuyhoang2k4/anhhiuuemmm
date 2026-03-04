/* global supabase */

const PASSCODE = "03022026";
const DELETE_PASSCODE = "9999";

// 1) Điền Supabase của bạn vào đây
// Lưu ý: anon key là public key (được phép nằm ở frontend). Đừng dùng service_role key.
const SUPABASE_URL = "https://qnuupxetqvmjqjshyoau.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MqiMwWhN7DOnn-gFQAbWcg_sVKh9liw";

const PHOTOS_BUCKET = "photos";
const VOICES_BUCKET = "voices";

const els = {
  lock: document.getElementById("lock"),
  app: document.getElementById("app"),
  lockForm: document.getElementById("lockForm"),
  passcode: document.getElementById("passcode"),
  lockError: document.getElementById("lockError"),
  btnLock: document.getElementById("btnLock"),
  btnSettings: document.getElementById("btnSettings"),
  settingsDialog: document.getElementById("settingsDialog"),
  btnCloseSettings: document.getElementById("btnCloseSettings"),

  tabs: Array.from(document.querySelectorAll(".tab")),
  panels: Array.from(document.querySelectorAll("[data-panel]")),

  daysCount: document.getElementById("daysCount"),
  ymdCount: document.getElementById("ymdCount"),
  startDateForm: document.getElementById("startDateForm"),
  loveStart: document.getElementById("loveStart"),
  counterStatus: document.getElementById("counterStatus"),

  diaryForm: document.getElementById("diaryForm"),
  diaryDate: document.getElementById("diaryDate"),
  diaryTitle: document.getElementById("diaryTitle"),
  diaryContent: document.getElementById("diaryContent"),
  diaryList: document.getElementById("diaryList"),
  diaryStatus: document.getElementById("diaryStatus"),

  photoForm: document.getElementById("photoForm"),
  photoFile: document.getElementById("photoFile"),
  photoCaption: document.getElementById("photoCaption"),
  photoGrid: document.getElementById("photoGrid"),
  photoStatus: document.getElementById("photoStatus"),

  msgTextForm: document.getElementById("msgTextForm"),
  msgText: document.getElementById("msgText"),
  msgImageFile: document.getElementById("msgImageFile"),
  btnPickImage: document.getElementById("btnPickImage"),
  btnRecord: document.getElementById("btnRecord"),
  btnStop: document.getElementById("btnStop"),
  btnSendVoice: document.getElementById("btnSendVoice"),
  previewAudio: document.getElementById("previewAudio"),
  msgList: document.getElementById("msgList"),
  msgStatus: document.getElementById("msgStatus"),

  pointsValue: document.getElementById("pointsValue"),
  checkinDay: document.getElementById("checkinDay"),
  btnCheckin: document.getElementById("btnCheckin"),
  checkinStatus: document.getElementById("checkinStatus"),
  shopList: document.getElementById("shopList"),
  btnRedeemSelected: document.getElementById("btnRedeemSelected"),
  redeemStatus: document.getElementById("redeemStatus"),
  redemptionList: document.getElementById("redemptionList"),

  addProductForm: document.getElementById("addProductForm"),
  prodName: document.getElementById("prodName"),
  prodCost: document.getElementById("prodCost"),
  prodIcon: document.getElementById("prodIcon"),
  prodImage: document.getElementById("prodImage"),
  addProductStatus: document.getElementById("addProductStatus"),

  confirmDialog: document.getElementById("confirmDialog"),
  confirmTitle: document.getElementById("confirmTitle"),
  confirmDesc: document.getElementById("confirmDesc"),
  confirmForm: document.getElementById("confirmForm"),
  confirmPass: document.getElementById("confirmPass"),
  confirmError: document.getElementById("confirmError"),
  btnCloseConfirm: document.getElementById("btnCloseConfirm"),
  btnConfirmCancel: document.getElementById("btnConfirmCancel"),
};

let sb = null;
let recorder = null;
let recordedChunks = [];
let recordedBlob = null;

let pointsDbSynced = false;
let pointsDbSaveTimer = null;
let suppressPointsDbSave = false;

const LS_POINTS = "love_points";
const LS_CHECKIN = "love_checkin";
const LS_REDEMPTIONS = "love_redemptions";

const SHOP_ITEMS = [
  { id: "candy", icon: "🍬", name: "1 bịch kẹo dẻo", cost: 5000 },
  { id: "teddy", icon: "🧸", name: "1 con gấu bông", cost: 20000 },
  { id: "song", icon: "🎵", name: "1 bài hát", cost: 1000 },
  { id: "kiss", icon: "💋", name: "1 nụ hun", cost: 2000 },
];

let shopItemsCache = null;

function ymdLocal(d = new Date()) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getPoints() {
  const n = Number(localStorage.getItem(LS_POINTS) || 0);
  return Number.isFinite(n) ? n : 0;
}

function setPoints(v) {
  const n = Math.max(0, Number(v) || 0);
  localStorage.setItem(LS_POINTS, String(n));
  if (!suppressPointsDbSave) scheduleSavePointsStateToDb();
}

function getCheckinState() {
  return readJson(LS_CHECKIN, { lastYmd: null, day: 0 });
}

function setCheckinState(state) {
  writeJson(LS_CHECKIN, state);
  if (!suppressPointsDbSave) scheduleSavePointsStateToDb();
}

function getRedemptions() {
  const arr = readJson(LS_REDEMPTIONS, []);
  return Array.isArray(arr) ? arr : [];
}

function setRedemptions(arr) {
  writeJson(LS_REDEMPTIONS, arr);
}

async function listShopItemsFromDb() {
  if (!sb) return null;
  const { data, error } = await sb
    .from("love_shop_items")
    .select("id, name, icon, cost, image_url, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function addShopItemToDb(payload) {
  if (!sb) throw new Error("Supabase chưa cấu hình");
  const { error } = await sb.from("love_shop_items").insert(payload);
  if (error) throw error;
}

function normalizeShopItems(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((it) => {
      const id = it?.id ?? it?.itemId ?? it?.name;
      const cost = Math.max(0, Math.floor(Number(it?.cost) || 0));
      return {
        id: String(id ?? crypto.randomUUID()),
        name: String(it?.name || "Sản phẩm"),
        icon: String(it?.icon || ""),
        cost,
        imageUrl: it?.image_url || it?.imageUrl || "",
      };
    })
    .filter((x) => x.cost >= 0);
}

async function loadShopItems() {
  if (!sb) {
    shopItemsCache = normalizeShopItems(SHOP_ITEMS);
    return shopItemsCache;
  }

  try {
    const dbItems = await listShopItemsFromDb();
    const normalized = normalizeShopItems(dbItems);
    shopItemsCache = normalized.length ? normalized : normalizeShopItems(SHOP_ITEMS);
    return shopItemsCache;
  } catch {
    shopItemsCache = normalizeShopItems(SHOP_ITEMS);
    return shopItemsCache;
  }
}

async function fetchPointsStateFromDb() {
  if (!sb) return null;
  const { data, error } = await sb.from("love_points_state").select("id, points, checkin_last_ymd, checkin_day").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function upsertPointsStateToDb() {
  if (!sb) return;
  const st = getCheckinState();
  const payload = {
    id: 1,
    points: getPoints(),
    checkin_last_ymd: st?.lastYmd ?? null,
    checkin_day: Number(st?.day || 0),
  };
  const { error } = await sb.from("love_points_state").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

function scheduleSavePointsStateToDb() {
  if (!sb) return;
  if (pointsDbSaveTimer) clearTimeout(pointsDbSaveTimer);
  pointsDbSaveTimer = setTimeout(async () => {
    try {
      await upsertPointsStateToDb();
    } catch {
      // ignore
    }
  }, 600);
}

async function syncPointsStateFromDbOnce() {
  if (!sb) return;
  if (pointsDbSynced) return;
  try {
    const remote = await fetchPointsStateFromDb();
    if (remote) {
      suppressPointsDbSave = true;
      try {
        if (typeof remote.points === "number" && Number.isFinite(remote.points)) setPoints(remote.points);
        setCheckinState({
          lastYmd: remote.checkin_last_ymd ?? null,
          day: Number(remote.checkin_day || 0),
        });
      } finally {
        suppressPointsDbSave = false;
      }
    } else {
      await upsertPointsStateToDb();
    }
    pointsDbSynced = true;
  } catch {
    pointsDbSynced = false;
  }
}

function formatPoints(n) {
  try {
    return Number(n || 0).toLocaleString("vi-VN");
  } catch {
    return String(n || 0);
  }
}

function renderPoints() {
  if (els.pointsValue) els.pointsValue.textContent = formatPoints(getPoints());
}

function renderCheckinDay() {
  const st = getCheckinState();
  if (els.checkinDay) els.checkinDay.textContent = st?.day ? String(st.day) : "0";
}

function renderShop() {
  if (!els.shopList) return;
  const items = shopItemsCache?.length ? shopItemsCache : normalizeShopItems(SHOP_ITEMS);
  els.shopList.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "shop__row";
    const img = it.imageUrl
      ? `<div class="shop__imgWrap"><img class="shop__img" src="${escapeHtml(it.imageUrl)}" alt="product" loading="lazy" /></div>`
      : "";
    row.innerHTML = `
      ${img}
      <div class="shop__meta">
        <div class="shop__title"><span class="shop__icon">${escapeHtml(it.icon || "")}</span>${escapeHtml(it.name)}</div>
        <div class="shop__price">${formatPoints(it.cost)} điểm</div>
      </div>
      <div class="shop__qty">
        <input class="input qty" type="number" min="0" step="1" value="0" inputmode="numeric" data-shop-qty="${escapeHtml(it.id)}" />
      </div>
    `;
    els.shopList.appendChild(row);
  }
}

function renderRedemptions() {
  if (!els.redemptionList) return;
  const items = getRedemptions();
  els.redemptionList.innerHTML = "";
  if (!items.length) {
    els.redemptionList.innerHTML = `<div class="item"><div class="muted">Chưa đổi quà nào.</div></div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    const when = it?.createdAt ? new Date(it.createdAt).toLocaleString("vi-VN") : "";
    const qtyTxt = it?.qty && it.qty > 1 ? ` x${it.qty}` : "";
    const spent = formatPoints(it?.spent || 0);
    div.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(it?.name || "Quà")}${escapeHtml(qtyTxt)}</div>
          <div class="item__meta">${escapeHtml(when)}</div>
        </div>
        <div class="item__meta">-${escapeHtml(spent)} điểm</div>
      </div>
    `;
    els.redemptionList.appendChild(div);
  }
}

function renderCheckinShopAll() {
  renderPoints();
  renderCheckinDay();
  renderShop();
  renderRedemptions();
}

function checkinToday() {
  const today = ymdLocal();
  const st = getCheckinState();
  const last = st?.lastYmd || null;

  if (last === today) {
    setStatus(els.checkinStatus, "Hôm nay bé đã check-in rồi nà.", "ok");
    return;
  }

  let diff = null;
  if (last) {
    try {
      diff = daysBetween(last, today);
    } catch {
      diff = null;
    }
  }

  let nextDay = 1;
  if (diff === 1) {
    if (Number(st?.day || 0) >= 7) nextDay = 1;
    else nextDay = Number(st?.day || 0) + 1;
  } else {
    nextDay = 1;
  }

  const reward = nextDay === 7 ? 1500 : 500;
  const newPoints = getPoints() + reward;
  setPoints(newPoints);
  setCheckinState({ lastYmd: today, day: nextDay });
  renderPoints();
  renderCheckinDay();
  setStatus(els.checkinStatus, `Đã check-in! +${formatPoints(reward)} điểm.`, "ok");
}

function redeemSelected() {
  if (!els.shopList) return;
  const inputs = Array.from(els.shopList.querySelectorAll("[data-shop-qty]"));
  const picks = [];

  for (const inp of inputs) {
    const id = inp.getAttribute("data-shop-qty");
    const qty = Math.max(0, Math.floor(Number(inp.value) || 0));
    if (!qty) continue;
    const source = shopItemsCache?.length ? shopItemsCache : normalizeShopItems(SHOP_ITEMS);
    const item = source.find((x) => String(x.id) === String(id));
    if (!item) continue;
    picks.push({ item, qty });
  }

  if (!picks.length) {
    setStatus(els.redeemStatus, "Chọn số lượng quà trước nha.", "danger");
    return;
  }

  const total = picks.reduce((s, p) => s + p.item.cost * p.qty, 0);
  const pts = getPoints();
  if (pts < total) {
    setStatus(els.redeemStatus, `Không đủ điểm. Cần ${formatPoints(total)} điểm.`, "danger");
    return;
  }

  const now = new Date().toISOString();
  const old = getRedemptions();
  const toAdd = [];
  for (const p of picks) {
    toAdd.push({
      id: `${String(p.item.id)}_${crypto.randomUUID()}`,
      itemId: String(p.item.id),
      name: p.item.name,
      qty: p.qty,
      spent: p.item.cost * p.qty,
      createdAt: now,
    });
  }

  setPoints(pts - total);
  setRedemptions([...toAdd, ...old]);
  renderPoints();
  renderRedemptions();
  for (const inp of inputs) inp.value = "0";
  setStatus(els.redeemStatus, `Đổi quà thành công! -${formatPoints(total)} điểm.`, "ok");
}

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

async function deleteMessage(id) {
  const { error } = await sb.from("love_messages").delete().eq("id", id);
  if (error) throw error;
}

function initSupabase() {
  if (!isConfigured()) return null;
  return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function supaErrMsg(e) {
  if (!e) return "Lỗi không xác định";
  if (typeof e === "string") return e;
  const parts = [];
  if (e.message) parts.push(e.message);
  if (e.details) parts.push(e.details);
  if (e.hint) parts.push(e.hint);
  if (e.code) parts.push(`code=${e.code}`);
  return parts.filter(Boolean).join(" | ") || "Lỗi không xác định";
}

function setStatus(el, msg, kind = "muted") {
  if (!el) return;
  el.style.color = kind === "ok" ? "var(--ok)" : kind === "danger" ? "var(--danger)" : "var(--muted)";
  el.textContent = msg || "";
}

let confirmResolver = null;
let confirmExpected = null;
let confirmWrongText = null;

function openConfirmDialog({ title, desc } = {}) {
  if (!els.confirmDialog) return;
  if (els.confirmTitle) els.confirmTitle.textContent = title || "Xác nhận";
  if (els.confirmDesc) els.confirmDesc.textContent = desc || "Nhập mật khẩu để xác nhận thao tác";
  if (els.confirmError) els.confirmError.textContent = "";
  if (els.confirmPass) {
    els.confirmPass.value = "";
    setTimeout(() => els.confirmPass?.focus?.(), 0);
  }

  if (typeof els.confirmDialog.showModal === "function") {
    els.confirmDialog.showModal();
  } else {
    els.confirmDialog.setAttribute("open", "open");
  }
}

function closeConfirmDialog() {
  if (!els.confirmDialog) return;
  if (typeof els.confirmDialog.close === "function") {
    els.confirmDialog.close();
  } else {
    els.confirmDialog.removeAttribute("open");
  }
}

function requestConfirmMatch(expected, { title, desc, wrongText } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    confirmExpected = String(expected ?? "").trim();
    confirmWrongText = wrongText || "Sai mật khẩu rồi bé ơi.";
    openConfirmDialog({ title, desc });
  });
}

function confirmDelete() {
  return requestConfirmMatch(DELETE_PASSCODE, { title: "Xác nhận xóa", desc: "Nhập mật khẩu để xóa" });
}

function fmtDate(d) {
  const x = new Date(d);
  return x.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function daysBetween(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function ymdBetween(start, end) {
  // Tính kiểu calendar: năm/tháng/ngày
  let s = new Date(start);
  let e = new Date(end);
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);

  if (e < s) return { y: 0, m: 0, d: 0 };

  let y = e.getFullYear() - s.getFullYear();
  let m = e.getMonth() - s.getMonth();
  let d = e.getDate() - s.getDate();

  if (d < 0) {
    // mượn ngày từ tháng trước
    const prevMonth = new Date(e.getFullYear(), e.getMonth(), 0);
    d += prevMonth.getDate();
    m -= 1;
  }
  if (m < 0) {
    m += 12;
    y -= 1;
  }

  return { y, m, d };
}

function lockApp() {
  localStorage.removeItem("love_unlocked");
  els.app.classList.add("hidden");
  els.lock.classList.remove("hidden");
  els.passcode.value = "";
  setStatus(els.lockError, "");
}

function unlockApp() {
  localStorage.setItem("love_unlocked", "1");
  els.lock.classList.add("hidden");
  els.app.classList.remove("hidden");
}

function ensureUnlockedUI() {
  const ok = localStorage.getItem("love_unlocked") === "1";
  if (ok) unlockApp();
  else lockApp();
}

function switchTab(name) {
  for (const t of els.tabs) t.classList.toggle("is-active", t.dataset.tab === name);
  for (const p of els.panels) p.hidden = p.dataset.panel !== name;
}

function openSettings() {
  if (!els.settingsDialog) return;
  if (typeof els.settingsDialog.showModal === "function") {
    els.settingsDialog.showModal();
  } else {
    // Fallback
    els.settingsDialog.setAttribute("open", "open");
  }
}

function closeSettings() {
  if (!els.settingsDialog) return;
  if (typeof els.settingsDialog.close === "function") {
    els.settingsDialog.close();
  } else {
    els.settingsDialog.removeAttribute("open");
  }
}

async function upsertLoveStartDate(dateStr) {
  if (!sb) throw new Error("Chưa cấu hình Supabase");
  // Singleton row: id = 1
  const { error } = await sb
    .from("settings")
    .upsert({ id: 1, love_start_date: dateStr }, { onConflict: "id" });
  if (error) throw error;
}

async function fetchLoveStartDate() {
  if (!sb) return null;
  const { data, error } = await sb.from("settings").select("love_start_date").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data?.love_start_date ?? null;
}

function renderCounter(startDateStr) {
  if (!startDateStr) {
    els.daysCount.textContent = "—";
    els.ymdCount.textContent = "Chưa đặt ngày bắt đầu yêu";
    return;
  }

  const today = new Date();
  const days = daysBetween(startDateStr, today);
  const ymd = ymdBetween(startDateStr, today);

  els.daysCount.textContent = String(Math.max(0, days));
  els.ymdCount.textContent = `${ymd.y} năm · ${ymd.m} tháng · ${ymd.d} ngày`;
}

async function addDiaryEntry(payload) {
  const { error } = await sb.from("diary_entries").insert(payload);
  if (error) throw error;
}

async function listDiaryEntries() {
  const { data, error } = await sb
    .from("diary_entries")
    .select("id, entry_date, title, content, created_at")
    .order("entry_date", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

function renderDiary(items) {
  els.diaryList.innerHTML = "";
  if (!items.length) {
    els.diaryList.innerHTML = `<div class="item"><div class="muted">Chưa có kỷ niệm nào. Thêm cái đầu tiên nha.</div></div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${escapeHtml(it.title)}</div>
          <div class="item__meta">${fmtDate(it.entry_date)}</div>
        </div>
        <button class="mini-btn mini-btn--danger" type="button" data-action="delete-diary" data-id="${it.id}">Xóa</button>
      </div>
      <div class="item__content">${escapeHtml(it.content)}</div>
    `;
    els.diaryList.appendChild(div);
  }
}

async function deleteDiaryEntry(id) {
  const { error } = await sb.from("diary_entries").delete().eq("id", id);
  if (error) throw error;
}

async function uploadToBucket(bucket, file) {
  const ext = file.name.split(".").pop() || "bin";
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}_${safeName}.${ext}`;

  const { error } = await sb.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;

  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

async function addPhotoItem({ caption, file_path, public_url }) {
  const { error } = await sb.from("media_items").insert({ caption, file_path, public_url });
  if (error) throw error;
}

async function listPhotos() {
  const { data, error } = await sb
    .from("media_items")
    .select("id, caption, public_url, file_path, created_at")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

function renderPhotos(items) {
  els.photoGrid.innerHTML = "";
  if (!items.length) {
    els.photoGrid.innerHTML = `<div class="item"><div class="muted">Chưa có ảnh nào.</div></div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "photo";
    div.innerHTML = `
      <div class="photo__top">
        <button class="mini-btn mini-btn--danger" type="button" data-action="delete-photo" data-id="${it.id}" data-path="${escapeHtml(it.file_path || "")}">Xóa</button>
      </div>
      <img src="${it.public_url}" alt="photo" loading="lazy" />
      <div class="cap">${escapeHtml(it.caption || "")}</div>
    `;
    els.photoGrid.appendChild(div);
  }
}

async function deletePhotoItem(id) {
  const { error } = await sb.from("media_items").delete().eq("id", id);
  if (error) throw error;
}

async function deleteFromBucket(bucket, path) {
  if (!path) return;
  const { error } = await sb.storage.from(bucket).remove([path]);
  if (error) throw error;
}

function tryParseStoragePathFromPublicUrl(publicUrl, bucket) {
  if (!publicUrl) return null;
  const needle = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(needle);
  if (idx === -1) return null;
  return publicUrl.slice(idx + needle.length);
}

async function addMessage(payload) {
  const { error } = await sb.from("love_messages").insert(payload);
  if (error) throw error;
}

async function listMessages() {
  const { data, error } = await sb
    .from("love_messages")
    .select("id, type, text, public_url, created_at")
    .order("created_at", { ascending: true })
    .limit(80);
  if (error) throw error;
  return data ?? [];
}

function renderMessages(items) {
  els.msgList.innerHTML = "";
  if (!items.length) {
    els.msgList.innerHTML = `<div class="chat__empty muted">Chưa có tin nhắn nào.</div>`;
    return;
  }

  for (const it of items) {
    const wrap = document.createElement("div");
    wrap.className = "chat__msg chat__msg--out";

    const bubble = document.createElement("div");
    bubble.className = "chat__bubble";

    const meta = document.createElement("div");
    meta.className = "chat__meta";
    meta.innerHTML = `
      <span>${new Date(it.created_at).toLocaleString("vi-VN")}</span>
      <button class="mini-btn mini-btn--danger" type="button" data-action="delete-message" data-id="${it.id}" data-type="${it.type}" data-url="${escapeHtml(it.public_url || "")}">Xóa</button>
    `;

    const content = document.createElement("div");
    content.className = "chat__content";

    if (it.type === "text") {
      content.textContent = it.text || "";
    } else if (it.type === "image") {
      if (it.text) {
        const p = document.createElement("div");
        p.className = "chat__text";
        p.textContent = it.text;
        content.appendChild(p);
      }
      const img = document.createElement("img");
      img.src = it.public_url;
      img.alt = "image";
      img.loading = "lazy";
      img.className = "chat__img";
      content.appendChild(img);
    } else if (it.type === "voice") {
      if (it.text) {
        const p = document.createElement("div");
        p.className = "chat__text";
        p.textContent = it.text;
        content.appendChild(p);
      }
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = it.public_url;
      audio.className = "chat__audio";
      content.appendChild(audio);
    }

    bubble.appendChild(meta);
    bubble.appendChild(content);
    wrap.appendChild(bubble);
    els.msgList.appendChild(wrap);
  }

  // auto-scroll xuống tin mới nhất
  try {
    els.msgList.scrollTop = els.msgList.scrollHeight;
  } catch {
    // ignore
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function refreshAll() {
  renderCheckinShopAll();
  if (!sb) {
    setStatus(els.counterStatus, "Bạn cần điền SUPABASE_URL và SUPABASE_ANON_KEY trong app.js", "danger");
    setStatus(els.diaryStatus, "Chưa cấu hình Supabase", "danger");
    setStatus(els.photoStatus, "Chưa cấu hình Supabase", "danger");
    setStatus(els.msgStatus, "Chưa cấu hình Supabase", "danger");
    renderCounter(null);
    return;
  }

  try {
    await loadShopItems();
    renderShop();
  } catch {
    // ignore
  }

  try {
    await syncPointsStateFromDbOnce();
    renderCheckinShopAll();
  } catch (e) {
    setStatus(els.checkinStatus, `Chưa sync được điểm lên database: ${supaErrMsg(e)}`, "danger");
  }

  // Connection/table/RLS check: nếu lỗi ở đây, 99% là chưa tạo table hoặc policy đang chặn.
  try {
    const { error } = await sb.from("settings").select("id").limit(1);
    if (error) setStatus(els.counterStatus, supaErrMsg(error), "danger");
  } catch (e) {
    setStatus(els.counterStatus, supaErrMsg(e), "danger");
  }

  try {
    setStatus(els.counterStatus, "Đang tải...", "muted");
    const startDate = await fetchLoveStartDate();
    els.loveStart.value = startDate || "";
    renderCounter(startDate);
    setStatus(els.counterStatus, "OK", "ok");
  } catch (e) {
    setStatus(els.counterStatus, supaErrMsg(e), "danger");
  }

  try {
    const diary = await listDiaryEntries();
    renderDiary(diary);
  } catch (e) {
    setStatus(els.diaryStatus, supaErrMsg(e), "danger");
  }

  try {
    const photos = await listPhotos();
    renderPhotos(photos);
  } catch (e) {
    setStatus(els.photoStatus, supaErrMsg(e), "danger");
  }

  try {
    const msgs = await listMessages();
    renderMessages(msgs);
  } catch (e) {
    setStatus(els.msgStatus, supaErrMsg(e), "danger");
  }
}

async function startRecording() {
  recordedChunks = [];
  recordedBlob = null;
  if (els.previewAudio) {
    els.previewAudio.hidden = true;
    els.previewAudio.src = "";
  }
  els.btnSendVoice.disabled = true;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorder = new MediaRecorder(stream);

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  recorder.onstop = () => {
    try {
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
      recordedBlob = blob;
      if (els.previewAudio) {
        els.previewAudio.src = URL.createObjectURL(blob);
        els.previewAudio.hidden = false;
      }
      els.btnSendVoice.disabled = false;

      // stop tracks
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
  };

  recorder.start();
  els.btnRecord.disabled = true;
  els.btnStop.disabled = false;
  setStatus(els.msgStatus, "Đang ghi âm...", "muted");
}

function stopRecording() {
  if (!recorder) return;
  recorder.stop();
  els.btnRecord.disabled = false;
  els.btnStop.disabled = true;
  setStatus(els.msgStatus, "Đã ghi xong. Bạn có thể nghe thử và bấm Gửi voice.", "ok");
}

function wireEvents() {
  els.lockForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (els.passcode.value || "").trim();
    if (v === PASSCODE) {
      setStatus(els.lockError, "");
      unlockApp();
      refreshAll();
    } else {
      setStatus(els.lockError, "Sai mật khẩu rồi bé ơi.", "danger");
    }
  });

  els.btnLock.addEventListener("click", () => lockApp());
  els.btnSettings?.addEventListener("click", () => openSettings());
  els.btnCloseSettings?.addEventListener("click", () => closeSettings());

  // Confirm dialog wiring
  els.btnCloseConfirm?.addEventListener("click", () => {
    closeConfirmDialog();
    confirmResolver?.(null);
    confirmResolver = null;
    confirmExpected = null;
    confirmWrongText = null;
  });
  els.btnConfirmCancel?.addEventListener("click", () => {
    closeConfirmDialog();
    confirmResolver?.(null);
    confirmResolver = null;
    confirmExpected = null;
    confirmWrongText = null;
  });
  els.confirmDialog?.addEventListener?.("close", () => {
    if (confirmResolver) {
      confirmResolver(null);
      confirmResolver = null;
      confirmExpected = null;
      confirmWrongText = null;
    }
  });
  els.confirmForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = (els.confirmPass?.value || "").trim();
    if (!val) {
      if (els.confirmError) els.confirmError.textContent = "Nhập mật khẩu trước nha";
      return;
    }
    if (confirmExpected && val !== confirmExpected) {
      if (els.confirmError) els.confirmError.textContent = confirmWrongText || "Sai mật khẩu";
      if (els.confirmPass) {
        els.confirmPass.value = "";
        els.confirmPass.focus();
      }
      return;
    }

    closeConfirmDialog();
    confirmResolver?.(true);
    confirmResolver = null;
    confirmExpected = null;
    confirmWrongText = null;
  });

  els.btnPickImage?.addEventListener("click", () => {
    if (!els.msgImageFile) return;
    els.msgImageFile.click();
  });

  els.msgImageFile?.addEventListener("change", async () => {
    if (!sb) return setStatus(els.msgStatus, "Chưa cấu hình Supabase", "danger");
    const file = els.msgImageFile.files?.[0];
    if (!file) return;

    try {
      setStatus(els.msgStatus, "Đang upload ảnh...", "muted");
      const up = await uploadToBucket(PHOTOS_BUCKET, file);
      await addMessage({ type: "image", public_url: up.publicUrl });
      els.msgImageFile.value = "";
      setStatus(els.msgStatus, "Đã gửi ảnh!", "ok");
      renderMessages(await listMessages());
    } catch (e) {
      setStatus(els.msgStatus, supaErrMsg(e), "danger");
    }
  });

  for (const t of els.tabs) {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  }

  els.btnCheckin?.addEventListener("click", () => {
    try {
      checkinToday();
    } catch {
      setStatus(els.checkinStatus, "Có lỗi xảy ra khi check-in.", "danger");
    }
  });

  els.btnRedeemSelected?.addEventListener("click", () => {
    try {
      redeemSelected();
    } catch {
      setStatus(els.redeemStatus, "Có lỗi xảy ra khi đổi quà.", "danger");
    }
  });

  els.addProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return setStatus(els.addProductStatus, "Chưa cấu hình Supabase", "danger");

    const name = (els.prodName?.value || "").trim();
    const icon = (els.prodIcon?.value || "").trim();
    const cost = Math.max(0, Math.floor(Number(els.prodCost?.value) || 0));
    const file = els.prodImage?.files?.[0] || null;

    if (!name) return setStatus(els.addProductStatus, "Nhập tên sản phẩm trước nha", "danger");
    if (!Number.isFinite(cost) || cost < 0) return setStatus(els.addProductStatus, "Giá điểm không hợp lệ", "danger");

    const ok = await requestConfirmMatch(DELETE_PASSCODE, { title: "Thêm sản phẩm", desc: "Nhập mật khẩu để thêm sản phẩm" });
    if (!ok) return;

    try {
      setStatus(els.addProductStatus, "Đang thêm...", "muted");
      let imageUrl = "";
      if (file) {
        const up = await uploadToBucket(PHOTOS_BUCKET, file);
        imageUrl = up.publicUrl || "";
      }

      await addShopItemToDb({ name, icon: icon || null, cost, image_url: imageUrl || null });
      await loadShopItems();
      renderShop();

      if (els.prodName) els.prodName.value = "";
      if (els.prodCost) els.prodCost.value = "";
      if (els.prodIcon) els.prodIcon.value = "";
      if (els.prodImage) els.prodImage.value = "";
      setStatus(els.addProductStatus, "Đã thêm sản phẩm!", "ok");
    } catch (err) {
      setStatus(els.addProductStatus, supaErrMsg(err), "danger");
    }
  });

  // Event delegation: delete diary/photo/message
  els.diaryList?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-action='delete-diary']");
    if (!btn) return;
    if (!(await confirmDelete())) return;
    if (!sb) return setStatus(els.diaryStatus, "Chưa cấu hình Supabase", "danger");
    try {
      await deleteDiaryEntry(btn.dataset.id);
      setStatus(els.diaryStatus, "Đã xóa nhật ký!", "ok");
      renderDiary(await listDiaryEntries());
    } catch (err) {
      setStatus(els.diaryStatus, supaErrMsg(err), "danger");
    }
  });

  els.photoGrid?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-action='delete-photo']");
    if (!btn) return;
    if (!(await confirmDelete())) return;
    if (!sb) return setStatus(els.photoStatus, "Chưa cấu hình Supabase", "danger");
    const id = btn.dataset.id;
    const path = btn.dataset.path;
    try {
      setStatus(els.photoStatus, "Đang xóa...", "muted");
      // xóa file trước rồi xóa row
      await deleteFromBucket(PHOTOS_BUCKET, path);
      await deletePhotoItem(id);
      setStatus(els.photoStatus, "Đã xóa ảnh!", "ok");
      renderPhotos(await listPhotos());
    } catch (err) {
      setStatus(els.photoStatus, supaErrMsg(err), "danger");
    }
  });

  els.msgList?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-action='delete-message']");
    if (!btn) return;
    if (!(await confirmDelete())) return;
    if (!sb) return setStatus(els.msgStatus, "Chưa cấu hình Supabase", "danger");

    const id = btn.dataset.id;
    const type = btn.dataset.type;
    const url = btn.dataset.url;

    try {
      setStatus(els.msgStatus, "Đang xóa...", "muted");
      if (type === "image") {
        const path = tryParseStoragePathFromPublicUrl(url, PHOTOS_BUCKET);
        if (path) await deleteFromBucket(PHOTOS_BUCKET, path);
      }
      if (type === "voice") {
        const path = tryParseStoragePathFromPublicUrl(url, VOICES_BUCKET);
        if (path) await deleteFromBucket(VOICES_BUCKET, path);
      }
      await deleteMessage(id);
      setStatus(els.msgStatus, "Đã xóa tin nhắn!", "ok");
      renderMessages(await listMessages());
    } catch (err) {
      setStatus(els.msgStatus, supaErrMsg(err), "danger");
    }
  });

  els.startDateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return setStatus(els.counterStatus, "Chưa cấu hình Supabase", "danger");

    const val = els.loveStart.value;
    if (!val) return setStatus(els.counterStatus, "Chọn ngày trước nha", "danger");

    try {
      setStatus(els.counterStatus, "Đang lưu...", "muted");
      await upsertLoveStartDate(val);
      renderCounter(val);
      setStatus(els.counterStatus, "Đã lưu!", "ok");
    } catch (e2) {
      setStatus(els.counterStatus, supaErrMsg(e2), "danger");
    }
  });

  els.diaryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return setStatus(els.diaryStatus, "Chưa cấu hình Supabase", "danger");

    const payload = {
      entry_date: els.diaryDate.value,
      title: els.diaryTitle.value.trim(),
      content: els.diaryContent.value.trim(),
    };

    try {
      setStatus(els.diaryStatus, "Đang thêm...", "muted");
      await addDiaryEntry(payload);
      els.diaryTitle.value = "";
      els.diaryContent.value = "";
      setStatus(els.diaryStatus, "Đã thêm kỷ niệm!", "ok");
      renderDiary(await listDiaryEntries());
    } catch (e2) {
      setStatus(els.diaryStatus, supaErrMsg(e2), "danger");
    }
  });

  els.photoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return setStatus(els.photoStatus, "Chưa cấu hình Supabase", "danger");

    const file = els.photoFile.files?.[0];
    if (!file) return setStatus(els.photoStatus, "Chọn ảnh trước nha", "danger");

    try {
      setStatus(els.photoStatus, "Đang upload...", "muted");
      const up = await uploadToBucket(PHOTOS_BUCKET, file);
      await addPhotoItem({ caption: (els.photoCaption.value || "").trim(), file_path: up.path, public_url: up.publicUrl });

      setPoints(getPoints() + 50);
      renderPoints();

      els.photoFile.value = "";
      els.photoCaption.value = "";
      setStatus(els.photoStatus, "Đã up ảnh!", "ok");
      renderPhotos(await listPhotos());
    } catch (e2) {
      setStatus(els.photoStatus, supaErrMsg(e2), "danger");
    }
  });

  els.msgTextForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return setStatus(els.msgStatus, "Chưa cấu hình Supabase", "danger");

    const txt = (els.msgText.value || "").trim();
    if (!txt) return;

    try {
      setStatus(els.msgStatus, "Đang gửi...", "muted");
      await addMessage({ type: "text", text: txt });
      els.msgText.value = "";
      setStatus(els.msgStatus, "Đã gửi!", "ok");
      renderMessages(await listMessages());
    } catch (e2) {
      setStatus(els.msgStatus, supaErrMsg(e2), "danger");
    }
  });

  els.btnRecord.addEventListener("click", async () => {
    try {
      await startRecording();
    } catch (e) {
      setStatus(els.msgStatus, "Không mở được micro. Hãy cho phép quyền micro.", "danger");
    }
  });

  els.btnStop.addEventListener("click", () => stopRecording());

  els.btnSendVoice.addEventListener("click", async () => {
    if (!sb) return setStatus(els.msgStatus, "Chưa cấu hình Supabase", "danger");
    if (!recordedBlob) return;

    try {
      setStatus(els.msgStatus, "Đang upload voice...", "muted");
      const file = new File([recordedBlob], `voice_${Date.now()}.webm`, { type: recordedBlob.type || "audio/webm" });
      const up = await uploadToBucket(VOICES_BUCKET, file);
      await addMessage({ type: "voice", public_url: up.publicUrl });
      recordedBlob = null;
      if (els.previewAudio) {
        els.previewAudio.hidden = true;
        els.previewAudio.src = "";
      }
      els.btnSendVoice.disabled = true;
      setStatus(els.msgStatus, "Đã gửi voice!", "ok");
      renderMessages(await listMessages());
    } catch (e2) {
      setStatus(els.msgStatus, supaErrMsg(e2), "danger");
    }
  });
}

function boot() {
  sb = initSupabase();
  ensureUnlockedUI();
  wireEvents();
  switchTab("diary");

  loadShopItems().finally(() => renderCheckinShopAll());

  try {
    setCustomCursorFromImage("./z7574744147805_ab6b33bf96bfb0962ffc056b20edb4a9.jpg");
  } catch {
    // ignore
  }

  if (localStorage.getItem("love_unlocked") === "1") {
    refreshAll();
  }
}

boot();

async function setCustomCursorFromImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const p = new Promise((resolve, reject) => {
    img.onload = () => resolve(true);
    img.onerror = () => reject(new Error("cursor image load failed"));
  });
  img.src = src;
  await p;

  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const sx = Math.max(0, Math.floor(((img.naturalWidth || img.width) - s) / 2));
  const sy = Math.max(0, Math.floor(((img.naturalHeight || img.height) - s) / 2));
  ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);

  ctx.restore();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
  ctx.closePath();
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const url = canvas.toDataURL("image/png");
  document.body.style.cursor = `url(${url}) 8 8, auto`;
}
