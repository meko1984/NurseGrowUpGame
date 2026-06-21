const DATA_FILES = {
  patientMaster: "./data/patient_master.json",
  activeBeds: "./data/active_beds.json",
  medicationMaster: "./data/medication_master.json",
  oralPrescriptions: "./data/oral_prescriptions.json",
  injectionOrders: "./data/injection_orders.json"
};

const monitorLabels = { HR: "HR", NIBP: "NIBP", SpO2: "SpO₂", RR: "RR", ABP: "ABP", CVP: "CVP" };
const coreMonitorFields = ["HR", "NIBP", "SpO2", "RR"];
const expansionMonitorFields = ["ABP", "CVP"];
const labReferences = {
  TP: { min: 6.6, max: 8.1, unit: "g/dL" }, Alb: { min: 4.1, max: 5.1, unit: "g/dL" },
  Na: { min: 138, max: 145, unit: "mEq/L" }, K: { min: 3.6, max: 4.8, unit: "mEq/L" },
  Ca: { min: 8.8, max: 10.1, unit: "mg/dL" }
};

let dataStore;
let patients = {};
const questState = new Set();
let minutes = 9 * 60;
let toastTimer;
const nurse = document.querySelector("#nurse");
const gameTime = document.querySelector("#game-time");
const sheet = document.querySelector("#bottom-sheet");
const backdrop = document.querySelector("#sheet-backdrop");
const sheetContent = document.querySelector("#sheet-content");
const toast = document.querySelector("#toast");

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function calculateBmi(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  return Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10;
}

function createMonitor(patient) {
  const vs = patient.admissionVitals;
  const systolic = Number(String(vs.BP).split("/")[0]);
  return {
    HR: { value: vs.HR, display: String(vs.HR), lower: 50, upper: 100 },
    NIBP: { value: systolic, display: vs.BP, lower: patient.admissionDiagnosis === "消化管出血" ? 100 : 90, upper: 160 },
    SpO2: { value: vs.SpO2, display: `${vs.SpO2}%`, lower: 95, upper: 100 },
    RR: { value: vs.RR, display: String(vs.RR), lower: 10, upper: 22 },
    ABP: null, CVP: null
  };
}

function createEmptyBed(bedId) {
  return {
    bedId, bed: `Bed${bedId.slice(-1)}`, patientId: null, name: "なし", age: "なし",
    diagnosis: "空床", hospitalDay: "なし", status: "ベッド準備中。", monitor: null,
    labs: null, order: "指示なし", handover: "空床", care: ["ベッド準備", "物品確認"]
  };
}

function buildActivePatients() {
  const masterById = new Map(dataStore.patientMaster.map(row => [row.patientId, { ...row, bmi: calculateBmi(row.heightCm, row.weightKg) }]));
  dataStore.patientById = masterById;
  dataStore.medicationById = new Map(dataStore.medicationMaster.map(row => [row.medicationId, row]));
  patients = Object.fromEntries(dataStore.activeBeds.map(assignment => {
    if (!assignment.patientId) return [assignment.bedId, createEmptyBed(assignment.bedId)];
    const master = masterById.get(assignment.patientId);
    const active = {
      ...master,
      bedId: assignment.bedId,
      bed: `Bed${assignment.bedId.slice(-1)}`,
      ageLabel: `${master.age}歳`,
      diagnosis: master.admissionDiagnosis,
      hospitalDay: `${assignment.hospitalDay}日目`,
      monitor: createMonitor(master),
      labs: master.labResults,
      order: master.medicalOrder,
      handover: master.handover
    };
    return [assignment.bedId, active];
  }));
}

async function loadDataStore() {
  const keys = Object.keys(DATA_FILES);
  const values = await Promise.all(keys.map(key => loadJson(DATA_FILES[key])));
  dataStore = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  buildActivePatients();
}

function advanceTime() {
  minutes += 5;
  const hours = Math.floor(minutes / 60) % 24;
  gameTime.textContent = `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function moveNurse(target) {
  const targetElement = document.querySelector(`[data-target="${target}"]`);
  const map = document.querySelector("#room-map");
  if (!targetElement || !map) return;
  const targetRect = targetElement.getBoundingClientRect();
  const mapRect = map.getBoundingClientRect();
  const centerX = targetRect.left + targetRect.width / 2 - mapRect.left;
  const isFacility = targetElement.classList.contains("facility-button");
  const desiredY = targetRect.bottom - mapRect.top + (isFacility ? -10 : 12);
  const maxY = isFacility ? mapRect.height - 20 : mapRect.height * .65 - 24;
  nurse.style.setProperty("--nurse-x", `${(centerX / mapRect.width) * 100}%`);
  nurse.style.setProperty("--nurse-y", `${(Math.min(desiredY, maxY) / mapRect.height) * 100}%`);
}

function showToast(message, success = false) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show${success ? " success" : ""}`;
  toastTimer = window.setTimeout(() => { toast.className = "toast"; }, 3200);
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

function sheetHeader(kicker, title) {
  return `<p class="sheet-kicker">${kicker}</p><h2 class="sheet-title">${title}</h2>`;
}

function alarmDirection(measurement) {
  if (!measurement) return null;
  if (measurement.value < measurement.lower) return "low";
  if (measurement.value > measurement.upper) return "high";
  return null;
}

function monitorAlarms(patientId) {
  const monitor = patients[patientId].monitor;
  if (!monitor) return [];
  return [...coreMonitorFields, ...expansionMonitorFields].flatMap(field => {
    const direction = alarmDirection(monitor[field]);
    return direction ? [{ patientId, field, direction }] : [];
  });
}

function waveformMarkup(className = "central-wave") {
  return `<span class="${className}" aria-label="心電図波形">─╱╲──╱│╲────╱╲─</span>`;
}

function bedsideMonitorMarkup(patientId) {
  const patient = patients[patientId];
  if (!patient.monitor) return `<span>STANDBY</span>`;
  const values = coreMonitorFields.map(field => {
    const measurement = patient.monitor[field];
    return `<i class="${alarmDirection(measurement) ? "is-alarm" : ""}">${monitorLabels[field]} <b>${measurement.display}</b></i>`;
  }).join("");
  const expansion = expansionMonitorFields.map(field => patient.monitor[field] ? `${field} ${patient.monitor[field].display}` : `${field} --`).join(" ｜ ");
  return `${waveformMarkup("bedside-wave")}<span class="bedside-values">${values}</span><span class="monitor-expansion">${expansion}</span>`;
}

function renderRoomFromData() {
  Object.entries(patients).forEach(([bedId, patient]) => {
    const card = document.querySelector(`[data-target="${bedId}"]`);
    const patientLabel = card.querySelector(".bed-patient");
    const visual = card.querySelector(".bed-visual");
    const avatar = visual.querySelector(".patient-avatar");
    card.setAttribute("aria-label", patient.patientId ? `${patient.bed} ${patient.name} ${patient.ageLabel}` : `${patient.bed} 空床`);
    patientLabel.innerHTML = patient.patientId ? `<strong>${patient.name}</strong><small>${patient.ageLabel}</small>` : `<strong>空床</strong>`;
    if (patient.patientId && !avatar) visual.insertAdjacentHTML("afterbegin", `<i class="patient-avatar">●</i>`);
    if (!patient.patientId && avatar) avatar.remove();
    card.querySelector(".bedside-monitor").innerHTML = bedsideMonitorMarkup(bedId);
  });
}

function careMarkup(patient) {
  return `<div class="detail-list">${patient.care.map(item => `<div class="detail-item"><b>CARE</b>${item}</div>`).join("")}</div>`;
}

function patientView(patientId) {
  const patient = patients[patientId];
  const vitals = patient.monitor ? `<div class="vitals-grid">${coreMonitorFields.map(field => `<div class="vital-card"><span>${monitorLabels[field]}</span><b>${patient.monitor[field].display}</b></div>`).join("")}</div>` : "";
  return `${sheetHeader("PATIENT INFORMATION", `${patient.bed} <small>｜${patient.diagnosis}</small>`)}<p class="info-status">${patient.status}</p>${vitals}<div class="action-list"><button class="action-button" data-message="状態観察機能は今後実装予定です">状態を観察</button><button class="action-button" data-bed-care="${patientId}">ケアを確認</button></div>`;
}

function bedCareView(patientId) {
  const patient = patients[patientId];
  return `${sheetHeader("BEDSIDE CARE", `${patient.bed}｜ケア`)}<button class="back-button" data-bed-back="${patientId}">← 患者情報へ</button><div class="patient-summary"><div><strong>${patient.name}</strong><span>${patient.diagnosis}</span></div></div>${careMarkup(patient)}`;
}

function pcPatientListView() {
  const rows = Object.entries(patients).map(([id, patient]) => `<button class="pc-patient-row" data-pc-patient="${id}" aria-label="${patient.bed} ${patient.name}を選択"><span class="row-bed">${patient.bed}</span><span>${patient.name}</span><span>${patient.ageLabel || patient.age}</span><span>${patient.diagnosis}</span><span>${patient.hospitalDay}</span></button>`).join("");
  return `${sheetHeader("STAFF TERMINAL", "スタッフ用PC")}<div class="pc-frame"><div class="pc-topbar"><b>患者一覧</b><span>${gameTime.textContent}｜日勤</span></div><div class="pc-list-header"><span>Bed</span><span>氏名</span><span>年齢</span><span>診断名</span><span>入院</span></div><div class="pc-patient-list">${rows}</div></div>`;
}

function pcPatientMenuView(patientId) {
  const patient = patients[patientId];
  const items = [["profile","患者概要"],["orders","指示確認"],["labs","検査値"],["records","記録"],["handover","申し送り"],["care","ケア"],["injections","注射指示書"],["medications","内服処方"]];
  return `${sheetHeader("ELECTRONIC CHART", `${patient.bed} 患者メニュー`)}<button class="back-button" data-pc-back="list">← 患者一覧へ</button><div class="pc-frame"><div class="pc-breadcrumb"><span>患者一覧</span><span>›</span><b>${patient.bed}</b></div><div class="patient-summary"><div><strong>${patient.name}</strong><span>${patient.ageLabel || patient.age} ｜ ${patient.diagnosis} ｜ 入院${patient.hospitalDay}</span></div></div></div><div class="pc-menu">${items.map(([view,label]) => `<button data-pc-view="${view}" data-patient="${patientId}">${label}</button>`).join("")}</div>`;
}

function labStatus(value, reference) {
  if (value < reference.min) return "is-low";
  if (value > reference.max) return "is-high";
  return "is-normal";
}

function listMarkup(title, items, emptyText) {
  return items.length ? `<div class="detail-list">${items.map(item => `<div class="detail-item"><b>${title}</b>${item}</div>`).join("")}</div>` : `<p class="info-status">${emptyText}</p>`;
}

function profileMarkup(patient) {
  if (!patient.patientId) return `<p class="info-status">空床です。</p>`;
  const vs = patient.admissionVitals;
  const rows = [
    ["基本情報", `${patient.sex} / ${patient.heightCm}cm / ${patient.weightKg}kg / BMI ${patient.bmi}`],
    ["ADL・KP", `${patient.adl} / KP：${patient.keyPerson}`],
    ["既往歴", patient.medicalHistory.join("、") || "なし"],
    ["入院時VS", `BT ${vs.BT} / HR ${vs.HR} / BP ${vs.BP} / RR ${vs.RR} / SpO₂ ${vs.SpO2}%`],
    ["入院計画", `予定${patient.plannedStayDays}日 / せん妄歴：${patient.deliriumHistory ? "あり" : "なし"}`]
  ];
  return `<div class="detail-list">${rows.map(([label, value]) => `<div class="detail-item"><b>${label}</b>${value}</div>`).join("")}</div>`;
}

function oralPrescriptionMarkup(patient) {
  const prescriptions = dataStore.oralPrescriptions.filter(row => row.patientId === patient.patientId);
  if (!prescriptions.length) return `<p class="info-status">内服処方はありません。</p>`;
  return `<div class="medication-list">${prescriptions.map(prescription => {
    const drug = dataStore.medicationById.get(prescription.medicationId);
    const detail = `${drug.name}：${drug.effect}。主な副作用：${drug.sideEffects.join("、")}`;
    return `<button class="medication-card" data-medication-id="${drug.medicationId}" data-message="${detail}"><span><b>${drug.name}</b><small>${drug.type}｜${drug.effect}</small></span><strong>${prescription.dose}｜${prescription.administration}</strong><i>${prescription.startDate}｜詳細 ›</i></button>`;
  }).join("")}</div>`;
}

function injectionOrderMarkup(patient) {
  const orders = dataStore.injectionOrders.filter(row => row.patientId === patient.patientId);
  if (!orders.length) return `<p class="info-status">注射指示はありません。</p>`;
  return `<div class="medication-list">${orders.map(order => {
    const drug = dataStore.medicationById.get(order.medicationId);
    const detail = `${drug.name}：${drug.effect}。主な副作用：${drug.sideEffects.join("、")}`;
    return `<button class="medication-card" data-medication-id="${drug.medicationId}" data-message="${detail}"><span><b>${drug.name}</b><small>${order.route}｜${order.rate}</small></span><strong>${order.dose}｜${order.timing}</strong><i>${order.comment}｜詳細 ›</i></button>`;
  }).join("")}</div>`;
}

function pcDetailView(patientId, view) {
  const patient = patients[patientId];
  const labels = { profile:"患者概要", orders:"指示確認", labs:"検査値", records:"記録", handover:"申し送り", care:"ケア", injections:"注射指示書", medications:"内服処方" };
  let content;
  if (view === "profile") content = profileMarkup(patient);
  else if (view === "labs") content = patient.labs ? `<div class="lab-list">${Object.entries(labReferences).map(([name, reference]) => `<div class="lab-row ${labStatus(patient.labs[name], reference)}"><strong>${name}</strong><span>${patient.labs[name]} ${reference.unit}</span><small>基準 ${reference.min}〜${reference.max}</small></div>`).join("")}</div>` : `<p class="info-status">検査値はありません。</p>`;
  else if (view === "orders") content = listMarkup("指示", [patient.order], "指示はありません。");
  else if (view === "records") content = `<p class="info-status">記録機能は今後実装予定です</p>`;
  else if (view === "handover") content = listMarkup("申し送り", [patient.handover], "申し送りはありません。");
  else if (view === "care") content = careMarkup(patient);
  else if (view === "injections") content = injectionOrderMarkup(patient);
  else content = oralPrescriptionMarkup(patient);
  return `${sheetHeader("ELECTRONIC CHART", `${patient.bed}｜${labels[view]}`)}<button class="back-button" data-pc-back="menu" data-patient="${patientId}">← ${patient.bed}メニューへ</button><div class="patient-summary"><div><strong>${patient.name}</strong><span>${patient.ageLabel || patient.age} ｜ ${patient.diagnosis}</span></div></div>${content}`;
}

function centralMonitorBedMarkup(patientId) {
  const patient = patients[patientId];
  if (!patient.monitor) return `<div class="monitor-bed"><span class="monitor-alarm-strip is-clear">NO ALARM</span><strong>${patient.bed}<small>空床</small></strong><span class="empty-monitor">STANDBY</span></div>`;
  const alarms = monitorAlarms(patientId);
  const values = coreMonitorFields.map(field => `<i class="${alarmDirection(patient.monitor[field]) ? "is-alarm" : ""}"><small>${monitorLabels[field]}</small>${patient.monitor[field].display}</i>`).join("");
  const alarmStrip = alarms.length ? alarms.map(alarm => `<button data-alarm-patient="${patientId}" data-alarm-field="${alarm.field}">${monitorLabels[alarm.field]} ${alarm.direction}</button>`).join("") : `<span class="is-clear">NO ALARM</span>`;
  return `<div class="monitor-bed ${alarms.length ? "alarm" : ""}"><span class="monitor-alarm-strip">${alarmStrip}</span><strong>${patient.bed}<small>${patient.name}</small></strong>${waveformMarkup()}<span class="central-values">${values}</span></div>`;
}

function monitorView() {
  return `${sheetHeader("CENTRAL MONITOR", "セントラルモニター")}<div class="monitor-frame"><div class="pc-topbar"><b>4 BED VIEW</b><span>● LIVE</span></div><div class="monitor-grid">${Object.keys(patients).map(centralMonitorBedMarkup).join("")}</div></div><div id="alarm-detail"></div>`;
}

function showAlarmDetail(patientId, field) {
  const patient = patients[patientId];
  const measurement = patient.monitor[field];
  const direction = alarmDirection(measurement);
  document.querySelector("#alarm-detail").innerHTML = `<div class="alarm-detail"><b>${patient.bed} ${monitorLabels[field]} ${direction}</b><br>現在値 ${measurement.display} / 設定範囲 ${measurement.lower}〜${measurement.upper}<button class="move-only-button" data-move-only="${patientId}">${patient.bed}へ移動する</button></div>`;
}

function equipmentView(target) {
  if (target === "infusion") {
    const orders = dataStore.injectionOrders.map(order => {
      const patient = dataStore.patientById.get(order.patientId);
      const drug = dataStore.medicationById.get(order.medicationId);
      return `${patient.name}｜${drug.name} ${order.dose} ${order.timing}`;
    });
    return `${sheetHeader("INFUSION STATION", "点滴台")}<p class="info-status">分離管理された注射指示書データと連動しています。</p><div class="supply-shelves"><div><b>上段</b>シリンジ</div><div><b>中段</b>点滴ルート</div><div><b>本日分の点滴薬</b>${orders.join(" / ")}</div></div>`;
  }
  if (target === "shelf") return `${sheetHeader("SUPPLY STORAGE", "物品棚")}<p class="info-status">物品補充ミニゲームは今後実装予定です。</p>${listMarkup("物品", ["オムツ","着替え","歯ブラシ","コップ","ティッシュ","その他日用品"], "物品なし")}`;
  if (target === "cart") return `${sheetHeader("EMERGENCY CART", "救急カート")}<p class="info-status">救急カート点検機能は今後実装予定です。</p>${listMarkup("点検項目", ["中身整理","点検","不足分チェック"], "")}`;
  if (target === "sink") return `${sheetHeader("HAND HYGIENE", "手洗い")}<p class="info-status">正しい手順やタイミングを確認する手洗い機能は今後実装予定です。</p>`;
  return `${sheetHeader("WASTE STATION", "ゴミ箱")}<p class="info-status">感染性廃棄物と一般廃棄物を扱う廃棄物分別機能は今後実装予定です。</p>`;
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
    if (patients[target]) openSheet(patientView(target));
    else if (target === "pc") openSheet(pcPatientListView());
    else if (target === "monitor") openSheet(monitorView());
    else openSheet(equipmentView(target));
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380);
}

function bindInteractions() {
  document.querySelectorAll(".map-target").forEach(target => target.addEventListener("click", () => interact(target.dataset.target)));
  document.querySelector("#close-sheet").addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !sheet.hidden) closeSheet(); });
  sheetContent.addEventListener("click", event => {
    const patientRow = event.target.closest("[data-pc-patient]");
    const pcViewButton = event.target.closest("[data-pc-view]");
    const pcBackButton = event.target.closest("[data-pc-back]");
    const bedCareButton = event.target.closest("[data-bed-care]");
    const bedBackButton = event.target.closest("[data-bed-back]");
    const alarm = event.target.closest("[data-alarm-patient]");
    const moveOnly = event.target.closest("[data-move-only]");
    const messageButton = event.target.closest("[data-message]");
    if (patientRow) { advanceTime(); sheetContent.innerHTML = pcPatientMenuView(patientRow.dataset.pcPatient); }
    else if (pcViewButton) { advanceTime(); sheetContent.innerHTML = pcDetailView(pcViewButton.dataset.patient, pcViewButton.dataset.pcView); }
    else if (pcBackButton) sheetContent.innerHTML = pcBackButton.dataset.pcBack === "list" ? pcPatientListView() : pcPatientMenuView(pcBackButton.dataset.patient);
    else if (bedCareButton) sheetContent.innerHTML = bedCareView(bedCareButton.dataset.bedCare);
    else if (bedBackButton) sheetContent.innerHTML = patientView(bedBackButton.dataset.bedBack);
    else if (alarm) showAlarmDetail(alarm.dataset.alarmPatient, alarm.dataset.alarmField);
    else if (moveOnly) { moveNurse(moveOnly.dataset.moveOnly); closeSheet(); showToast(`${patients[moveOnly.dataset.moveOnly].bed}付近へ移動しました`); }
    else if (messageButton) showToast(messageButton.dataset.message);
  });
}

async function init() {
  try {
    await loadDataStore();
    renderRoomFromData();
    bindInteractions();
  } catch (error) {
    console.error("Game data could not be loaded", error);
    showToast("データを読み込めませんでした。ローカルサーバーから起動してください。");
  }
}

init();
