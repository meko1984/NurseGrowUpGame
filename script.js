const patients = {
  bed1: { bed: "Bed1", diagnosis: "肺炎", status: "酸素投与中。呼吸状態に注意。", vitals: { "SpO₂": "94%", RR: "24", HR: "104", BP: "132/74" } },
  bed2: { bed: "Bed2", diagnosis: "心不全", status: "尿量低下傾向。呼吸苦、浮腫、尿量に注意。", vitals: { "SpO₂": "95%", RR: "22", HR: "110", BP: "148/86" } },
  bed3: { bed: "Bed3", diagnosis: "消化管出血", status: "出血リスクあり。血圧低下、冷汗、黒色便、意識変化に注意。", vitals: { "SpO₂": "97%", RR: "20", HR: "116", BP: "96/58" } },
  bed4: { bed: "Bed4", diagnosis: "空床", status: "ベッド準備中。", actions: ["ベッド準備", "物品確認"] }
};

const positions = {
  bed1: [31, 31], bed2: [57, 31], bed3: [31, 61], bed4: [57, 61],
  pc: [18, 74], monitor: [43, 74], mixing: [69, 74], sink: [78, 16], shelf: [78, 43], trash: [78, 68]
};
const labels = { pc: "スタッフ用PC", monitor: "セントラルモニター", mixing: "点滴ミキシング台", sink: "手洗い場", shelf: "オムツ／日用品棚", trash: "ゴミ箱" };
const questState = new Set();
let minutes = 9 * 60;
let toastTimer;

const nurse = document.querySelector("#nurse");
const gameTime = document.querySelector("#game-time");
const sheet = document.querySelector("#bottom-sheet");
const backdrop = document.querySelector("#sheet-backdrop");
const sheetContent = document.querySelector("#sheet-content");
const toast = document.querySelector("#toast");

function advanceTime() {
  minutes += 5;
  const hours = Math.floor(minutes / 60) % 24;
  gameTime.textContent = `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function moveNurse(target) {
  const [x, y] = positions[target];
  nurse.style.setProperty("--nurse-x", `${x}%`);
  nurse.style.setProperty("--nurse-y", `${y}%`);
}

function showToast(message, success = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${success ? " success" : ""}`;
  toastTimer = window.setTimeout(() => { toast.className = "toast"; }, 2800);
}

function openSheet(html) {
  sheetContent.innerHTML = html;
  sheet.hidden = false;
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  document.querySelector("#close-sheet").focus({ preventScroll: true });
}

function closeSheet() {
  sheet.hidden = true;
  backdrop.hidden = true;
  document.body.style.overflow = "";
}

function patientView(patient) {
  const vitals = patient.vitals ? `<div class="vitals-grid">${Object.entries(patient.vitals).map(([name, value]) => `<div class="vital-card"><span>${name}</span><b>${value}</b></div>`).join("")}</div>` : "";
  const actions = patient.actions || ["状態を観察", "ケアを確認"];
  return `<p class="sheet-kicker">PATIENT INFORMATION</p><h2 class="sheet-title">${patient.bed} <small>｜${patient.diagnosis}</small></h2><p class="info-status">${patient.status}</p>${vitals}<div class="action-list">${actions.map(action => `<button class="action-button" data-message="${action}は今後のアップデートで実装予定です">${action}</button>`).join("")}</div>`;
}

function pcView() {
  return `<p class="sheet-kicker">STAFF TERMINAL</p><h2 class="sheet-title">スタッフ用PC</h2><div class="pc-frame"><div class="pc-topbar"><b>患者一覧</b><span>${gameTime.textContent}｜日勤</span></div>${Object.values(patients).map(p => `<div class="patient-row"><b>${p.bed}</b><span>${p.diagnosis}</span></div>`).join("")}</div><div class="pc-menu">${["患者一覧", "指示確認", "検査値", "記録", "申し送り"].map(item => `<button data-message="${item}メニューを選択しました">${item}</button>`).join("")}</div>`;
}

function monitorView() {
  const beds = [
    ["Bed1", "SpO₂ 94% / RR 24 / HR 104", "alarm"], ["Bed2", "SpO₂ 95% / RR 22 / HR 110", ""],
    ["Bed3", "BP 96/58 / HR 116", "alarm"], ["Bed4", "空床", ""]
  ];
  return `<p class="sheet-kicker">CENTRAL MONITOR</p><h2 class="sheet-title">セントラルモニター</h2><div class="monitor-frame"><div class="pc-topbar"><b>UNIT VITALS</b><span>● LIVE</span></div><div class="monitor-grid">${beds.map(([bed, value, alarm]) => `<div class="monitor-bed ${alarm}"><strong>${bed}</strong><span>${value}</span></div>`).join("")}</div><p class="alarm-text orange">Bed1：呼吸状態注意</p><p class="alarm-text">Bed3：血圧低下注意</p></div>`;
}

function equipmentView(target) {
  const configs = {
    mixing: ["IV PREPARATION", "点滴準備メニュー", "安全確認をして点滴を準備します。", ["指示を確認", "薬剤を準備"]],
    sink: ["HAND HYGIENE", "手指衛生", "適切なタイミングと手順を確認します。", ["手洗いを実施", "手順を確認"]],
    shelf: ["SUPPLY STORAGE", "オムツ／日用品棚", "患者ケアに必要な日用品を確認できます。", ["在庫を確認", "物品を取り出す"]],
    trash: ["WASTE STATION", "ゴミ箱", "廃棄物を正しく分別します。", ["分別を確認", "廃棄する"]]
  };
  const [kicker, title, info, actions] = configs[target];
  return `<p class="sheet-kicker">${kicker}</p><h2 class="sheet-title">${title}</h2><p class="info-status">${info}</p><div class="action-list">${actions.map(action => `<button class="action-button" data-message="${action}しました">${action}</button>`).join("")}</div>`;
}

function updateQuest(target) {
  if (!["bed1", "pc", "monitor"].includes(target) || questState.has(target)) return;
  questState.add(target);
  const task = document.querySelector(`[data-quest="${target}"]`);
  task.classList.add("done");
  task.textContent = `✓ ${target === "bed1" ? "Bed1" : target === "pc" ? "PC" : "モニター"}`;
  document.querySelector("#quest-count").textContent = `${questState.size}/3`;
  if (questState.size === 3) showToast("クエスト達成：病室の基本確認が完了しました", true);
}

function interact(target) {
  moveNurse(target);
  advanceTime();
  updateQuest(target);
  window.setTimeout(() => {
    if (patients[target]) openSheet(patientView(patients[target]));
    else if (target === "pc") openSheet(pcView());
    else if (target === "monitor") openSheet(monitorView());
    else openSheet(equipmentView(target));
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420);
}

document.querySelectorAll(".map-object").forEach(object => object.addEventListener("click", () => interact(object.dataset.target)));
document.querySelector("#close-sheet").addEventListener("click", closeSheet);
backdrop.addEventListener("click", closeSheet);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !sheet.hidden) closeSheet(); });
sheetContent.addEventListener("click", event => {
  const button = event.target.closest("[data-message]");
  if (button) showToast(button.dataset.message);
});
