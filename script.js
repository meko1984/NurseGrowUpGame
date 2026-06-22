const DATA_FILES = {
  patientMaster: "./data/patient_master.json",
  activeBeds: "./data/active_beds.json",
  medicationMaster: "./data/medication_master.json",
  oralPrescriptions: "./data/oral_prescriptions.json",
  injectionOrders: "./data/injection_orders.json",
  quests: "./data/quests.json",
  player: "./data/player.json",
  events: "./data/events.json",
  careMaster: "./data/care_master.json",
  patientCarePlans: "./data/patient_care_plans.json"
};

const monitorLabels = { HR: "HR", NIBP: "NIBP", SpO2: "SpO₂", RR: "RR", ABP: "ABP", CVP: "CVP" };
const coreMonitorFields = ["HR", "NIBP", "SpO2", "RR"];
const expansionMonitorFields = ["ABP", "CVP"];
const labReferences = {
  TP: { min: 6.6, max: 8.1, unit: "g/dL" }, Alb: { min: 4.1, max: 5.1, unit: "g/dL" },
  Na: { min: 138, max: 145, unit: "mEq/L" }, K: { min: 3.6, max: 4.8, unit: "mEq/L" },
  Ca: { min: 8.8, max: 10.1, unit: "mg/dL" }
};

const QUEST_TYPES = ["昇段試験", "看護クエスト", "特別クエスト", "プチクエスト"];
const QUEST_STORAGE_KEY = "nurseDojoQuestProgressV1";

// All planned actionIds live in one registry. Adding a working action later
// only requires an implementation here and a button/entry point in the UI.
const questActions = {
  check_rr: { label: "RRを確認する", implemented: true, result: patient => `RRは${patient.monitor.RR.display}回/分。やや多い。` },
  check_spo2: { label: "SpO₂を確認する", implemented: true, result: patient => `SpO₂は${patient.monitor.SpO2.display}。酸素${patient.oxygenTherapy?.flowLpm || 2}L投与中。` },
  check_hr: { label: "HRを確認する", implemented: false },
  check_bp: { label: "NIBPを確認する", implemented: false },
  check_bodytemperature: { label: "体温を確認する", implemented: false },
  check_o2_route: { label: "酸素ルートを確認する", implemented: false },
  check_work_of_breathing: { label: "努力呼吸を見る", implemented: false },
  check_speaking: { label: "会話可能か確認する", implemented: false },
  check_lung_sound: { label: "肺音を確認する", implemented: false },
  check_sputum: { label: "痰の性状を確認する", implemented: false },
  check_consciousness: { label: "意識レベルを確認する", implemented: false },
  check_skin: { label: "顔色・冷汗を見る", implemented: false },
  open_chart: { label: "カルテを開く", implemented: false },
  check_labo_data: { label: "検査値を見る", implemented: false },
  check_orders: { label: "指示を確認する", implemented: false },
  consult_senior: { label: "先輩へ相談する", implemented: false },
  report_sbar: { label: "SBARで報告する", implemented: false },
  prioritize_bed1: { label: "Bed1を優先する", implemented: false }
};

// Equipment-specific content stays data-like so a real mini-game can replace
// each placeholder without changing the map interaction flow.
const miniGameDefinitions = {
  sink: {
    kicker: "HAND HYGIENE MINI GAME", title: "手指衛生チェック",
    purpose: "正しい手指衛生のタイミングを選ぶ",
    planned: "今後、手指衛生の5つのタイミングや流水／アルコールの使い分けをゲーム化します。"
  },
  shelf: {
    kicker: "SUPPLY MINI GAME", title: "物品準備",
    purpose: "ケアに必要な物品を選ぶ",
    planned: "オムツ、着替え、歯ブラシ、コップ、ティッシュなどから必要物品を選択できるようにします。"
  },
  trash: {
    kicker: "WASTE MINI GAME", title: "廃棄物分別",
    purpose: "一般ゴミ、感染性廃棄物、鋭利物などを正しく分別する",
    planned: "物品カードを正しい廃棄先へ振り分けるゲームを実装予定です。"
  },
  cart: {
    kicker: "EMERGENCY CART MINI GAME", title: "救急カート点検",
    purpose: "不足物品や期限切れ物品を確認する",
    planned: "中身整理、点検、不足分チェックをゲーム化する予定です。"
  }
};

let dataStore;
let patients = {};
let playerState;
let questState = [];
let eventState = [];
let lastCompletedQuestId = null;
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

function validateQuestData(quests) {
  const questIds = new Set(quests.map(quest => quest.questId));
  if (questIds.size !== quests.length) throw new Error("Duplicate questId found");
  quests.forEach(quest => {
    if (!QUEST_TYPES.includes(quest.questType)) throw new Error(`Unknown questType: ${quest.questType}`);
    quest.requiredActions.forEach(actionId => {
      if (!questActions[actionId]) throw new Error(`Unknown actionId: ${actionId}`);
    });
    quest.coversQuestIds.forEach(questId => {
      if (!questIds.has(questId)) throw new Error(`Unknown coversQuestId: ${questId}`);
    });
  });
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
  validateQuestData(dataStore.quests);
  dataStore.careById = new Map(dataStore.careMaster.map(row => [row.careId, row]));
  dataStore.carePlanByPatientId = new Map(dataStore.patientCarePlans.map(row => [row.patientId, row]));
  playerState = {
    ...dataStore.player,
    completedQuestIds: [...dataStore.player.completedQuestIds],
    activeQuestIds: [...dataStore.player.activeQuestIds]
  };
  questState = dataStore.quests.map(quest => ({
    ...quest,
    requiredActions: [...quest.requiredActions],
    coversQuestIds: [...quest.coversQuestIds],
    completedActions: []
  }));
  eventState = dataStore.events.map(event => ({ ...event }));
  restoreQuestProgress();
  synchronizeQuestStatuses();
  activateFirstAvailableQuest();
  buildActivePatients();
}

function restoreQuestProgress() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(QUEST_STORAGE_KEY));
    if (!saved?.player) return;
    playerState = {
      ...playerState,
      ...saved.player,
      completedQuestIds: Array.isArray(saved.player.completedQuestIds) ? saved.player.completedQuestIds : [],
      activeQuestIds: Array.isArray(saved.player.activeQuestIds) ? saved.player.activeQuestIds : []
    };
    const progressByQuestId = new Map((saved.questProgress || []).map(item => [item.questId, item]));
    questState.forEach(quest => {
      const progress = progressByQuestId.get(quest.questId);
      quest.completedActions = progress?.completedActions?.filter(actionId => quest.requiredActions.includes(actionId)) || [];
    });
  } catch (error) {
    console.warn("Saved quest progress could not be restored", error);
  }
}

function saveQuestProgress() {
  try {
    window.localStorage.setItem(QUEST_STORAGE_KEY, JSON.stringify({
      player: playerState,
      questProgress: questState.map(quest => ({ questId: quest.questId, completedActions: quest.completedActions }))
    }));
  } catch (error) {
    console.warn("Quest progress could not be saved", error);
  }
}

function synchronizeQuestStatuses() {
  const knownIds = new Set(questState.map(quest => quest.questId));
  playerState.completedQuestIds = [...new Set(playerState.completedQuestIds)].filter(id => knownIds.has(id));
  playerState.activeQuestIds = [...new Set(playerState.activeQuestIds)]
    .filter(id => {
      const quest = questState.find(item => item.questId === id);
      return quest && playerState.level >= quest.requiredPlayerLevel && !playerState.completedQuestIds.includes(id);
    });
  questState.forEach(quest => {
    if (playerState.completedQuestIds.includes(quest.questId)) quest.status = "completed";
    else if (playerState.activeQuestIds.includes(quest.questId)) quest.status = "active";
    else quest.status = playerState.level >= quest.requiredPlayerLevel ? "available" : "locked";
  });
}

function activateQuest(questId, announce = true) {
  synchronizeQuestStatuses();
  const quest = questState.find(item => item.questId === questId);
  if (!quest || quest.status !== "available") return false;
  if (!playerState.activeQuestIds.includes(questId)) playerState.activeQuestIds.push(questId);
  synchronizeQuestStatuses();
  saveQuestProgress();
  renderActiveQuest();
  if (announce) showToast(`クエスト受注：${quest.title}`);
  return true;
}

function activateFirstAvailableQuest() {
  synchronizeQuestStatuses();
  if (playerState.activeQuestIds.length) return;
  const nextQuest = questState.find(quest => quest.status === "available");
  if (nextQuest) activateQuest(nextQuest.questId, false);
}

function advanceTime() {
  minutes += 5;
  const hours = Math.floor(minutes / 60) % 24;
  gameTime.textContent = `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  checkScheduledEvents();
}

function renderPlayerStatus() {
  document.querySelector("#player-level").textContent = `Lv.${playerState.level}`;
  document.querySelector("#player-role").textContent = playerState.role;
  document.querySelector("#player-stamina").textContent = `${playerState.stamina}/100`;
  document.querySelector("#player-motivation").textContent = `${playerState.motivation}/100`;
  document.querySelector("#player-exp").textContent = `${playerState.exp}/${playerState.nextLevelExp}`;
  document.querySelector("#stamina-meter").style.width = `${Math.min(playerState.stamina, 100)}%`;
  document.querySelector("#motivation-meter").style.width = `${Math.min(playerState.motivation, 100)}%`;
  document.querySelector("#experience-meter").style.width = `${Math.min((playerState.exp / playerState.nextLevelExp) * 100, 100)}%`;
}

function nextLevelRequirement(level) {
  if (level === 1) return 30;
  if (level === 2) return 60;
  if (level === 3) return 100;
  if (level === 4) return 150;
  return level * 40;
}

function grantExperience(amount) {
  playerState.exp += amount;
  const levelUpMessages = [];
  while (playerState.exp >= playerState.nextLevelExp) {
    playerState.exp -= playerState.nextLevelExp;
    playerState.level += 1;
    playerState.nextLevelExp = nextLevelRequirement(playerState.level);
    levelUpMessages.push(`レベルアップ！ Lv.${playerState.level}になりました`);
  }
  renderPlayerStatus();
  return levelUpMessages;
}

function timeToMinutes(time) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

// Event records are runtime copies. A future save layer can persist triggered
// state without changing scheduling or event handlers.
function checkScheduledEvents() {
  eventState.filter(event => !event.triggered && timeToMinutes(event.time) <= minutes).forEach(event => {
    event.triggered = true;
    if (event.type === "monitor_alarm") {
      const patient = Object.values(patients).find(item => item.patientId === event.targetPatientId);
      const measurement = patient?.monitor?.[event.parameter];
      if (measurement) {
        measurement.value = event.newValue;
        measurement.display = event.parameter === "SpO2" ? `${event.newValue}%` : String(event.newValue);
        renderRoomFromData();
      }
    }
    showToast(event.message);
  });
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

function carePlanFor(patient) {
  if (!patient.patientId) return null;
  return dataStore.carePlanByPatientId.get(patient.patientId) || null;
}

function careMarkup(patient) {
  const plan = carePlanFor(patient);
  if (!plan) return `<p class="info-status">${patient.patientId ? "ケア計画は未設定です。" : "空床です。ベッド準備と物品確認を行います。"}</p>`;
  const cards = plan.selectedCareIds.map(careId => dataStore.careById.get(careId)).filter(Boolean).map(care => `
    <button class="care-card" data-message="${care.name}の実施機能は今後実装予定です">
      <span><b>${care.name}</b><small>${care.category}｜重要度 ${care.weight}</small></span>
      <p>${care.description}</p>
      <i>必要物品：${care.requiredItems.join("、") || "なし"}</i>
      <em>MINI GAME：${care.miniGameType}</em>
    </button>`).join("");
  return `<p class="care-plan-note">入院時に設定したケア計画（試作）</p><div class="care-list">${cards}</div><button class="future-button" data-message="ケア計画の編集・採点機能は今後実装予定です">ケア計画を確認・編集</button>`;
}

function patientView(patientId) {
  const patient = patients[patientId];
  const vitals = patient.monitor ? `<div class="vitals-grid">${coreMonitorFields.map(field => `<div class="vital-card"><span>${monitorLabels[field]}</span><b>${patient.monitor[field].display}</b></div>`).join("")}</div>` : "";
  const observationButton = patient.patientId === "p001"
    ? `<button class="action-button is-primary" data-observation-menu="${patientId}">観察</button>`
    : `<button class="action-button" data-message="この患者の観察アクションは今後実装予定です">観察</button>`;
  return `${sheetHeader("PATIENT INFORMATION", `${patient.bed} <small>｜${patient.diagnosis}</small>`)}<p class="info-status">${patient.status}</p>${vitals}<div class="action-list">${observationButton}<button class="action-button" data-bed-care="${patientId}">ケアを確認</button></div>`;
}

function observationView(patientId, lastResult = "") {
  const patient = patients[patientId];
  const quest = questState.find(item => item.status === "active" && item.targetPatientId === patient.patientId);
  const actions = ["check_rr", "check_spo2"];
  const buttons = actions.map(actionId => {
    const action = questActions[actionId];
    const completed = quest?.completedActions.includes(actionId);
    const required = quest?.requiredActions.includes(actionId);
    return `<button class="observation-button ${completed ? "is-complete" : ""}" data-observation-action="${actionId}" data-patient-bed="${patientId}"><span>${completed ? "✓" : "○"} ${action.label}</span><small>${required ? "進行中クエストの対象" : "観察可能"}</small></button>`;
  }).join("");
  const progress = quest ? `<div class="observation-quest"><b>進行中：${quest.title}</b><span>${quest.completedActions.length}/${quest.requiredActions.length}</span></div>` : `<p class="info-status">この患者で進行中のクエストはありません。</p>`;
  const result = lastResult ? `<p class="observation-result">${lastResult}</p>` : "";
  return `${sheetHeader("BEDSIDE OBSERVATION", `${patient.bed}｜観察`)}<button class="back-button" data-bed-back="${patientId}">← 患者情報へ</button><div class="patient-summary"><div><strong>${patient.name}</strong><span>${patient.diagnosis}｜酸素${patient.oxygenTherapy?.flowLpm || 2}L投与中</span></div></div>${progress}${result}<div class="observation-list">${buttons}</div>`;
}

function bedCareView(patientId) {
  const patient = patients[patientId];
  return `${sheetHeader("BEDSIDE CARE", `${patient.bed}｜ケア`)}<button class="back-button" data-bed-back="${patientId}">← 患者情報へ</button><div class="patient-summary"><div><strong>${patient.name}</strong><span>${patient.diagnosis}</span></div></div>${careMarkup(patient)}`;
}

function pcPatientListView() {
  const rows = Object.entries(patients).map(([id, patient]) => `<button class="pc-patient-row" data-pc-patient="${id}" aria-label="${patient.bed} ${patient.name}を選択"><span class="row-bed">${patient.bed}</span><span>${patient.name}</span><span>${patient.ageLabel || patient.age}</span><span>${patient.diagnosis}</span><span>${patient.hospitalDay}</span></button>`).join("");
  return `${sheetHeader("ELECTRONIC CHART", "カルテ")}<div class="pc-frame"><div class="pc-topbar"><b>患者一覧</b><span>${gameTime.textContent}｜日勤</span></div><div class="pc-list-header"><span>Bed</span><span>氏名</span><span>年齢</span><span>診断名</span><span>入院</span></div><div class="pc-patient-list">${rows}</div></div>`;
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
  return miniGamePlaceholderView(target);
}

function miniGamePlaceholderView(target) {
  const game = miniGameDefinitions[target];
  if (!game) return `${sheetHeader("FACILITY", "設備")}<p class="info-status">この設備の機能は今後実装予定です。</p>`;
  return `${sheetHeader(game.kicker, game.title)}<div class="mini-game-card"><span class="mini-game-badge">プチクエスト / PROTOTYPE</span><h3>${game.purpose}</h3><p>${game.planned}</p><button class="future-button" data-message="${game.title}は現在設計中です">ミニゲームを確認</button></div>`;
}

function activeQuest() {
  return questState.find(quest => quest.status === "active") || null;
}

function renderActiveQuest() {
  const quest = activeQuest();
  const title = document.querySelector("#quest-title");
  const count = document.querySelector("#quest-count");
  const tasks = document.querySelector(".quest-tasks");
  const kicker = document.querySelector(".quest-heading p");
  if (quest) {
    title.textContent = quest.title;
    count.textContent = `${quest.completedActions.length}/${quest.requiredActions.length}`;
    kicker.textContent = `${quest.questType}｜Lv.${quest.questLevel}`;
    tasks.innerHTML = quest.requiredActions.map(actionId => {
      const done = quest.completedActions.includes(actionId);
      return `<span class="${done ? "done" : ""}">${done ? "✓" : "○"} ${questActions[actionId]?.label || actionId}</span>`;
    }).join("");
    return;
  }
  const nextLocked = questState.find(item => item.status === "locked");
  const completed = questState.find(item => item.questId === lastCompletedQuestId) || questState.filter(item => item.status === "completed").slice(-1)[0];
  kicker.textContent = "QUEST STATUS";
  title.textContent = nextLocked ? `次はLv.${nextLocked.requiredPlayerLevel}で解放` : "進行中のクエストはありません";
  count.textContent = "--";
  tasks.innerHTML = `<span class="${completed ? "done" : ""}">${completed ? `✓ ${completed.title}` : "クエスト一覧を確認しよう"}</span>`;
}

function questListView() {
  synchronizeQuestStatuses();
  const statusMeta = {
    available: ["受注可能", "AVAILABLE"], active: ["進行中", "ACTIVE"],
    completed: ["達成済み", "COMPLETED"], locked: ["未解放", "LOCKED"]
  };
  const sections = ["active", "available", "completed", "locked"].map(status => {
    const quests = questState.filter(quest => quest.status === status);
    const cards = quests.length ? quests.map(quest => {
      const progress = quest.completedActions.length;
      const actionTotal = quest.requiredActions.length;
      const action = status === "available" ? `<button data-accept-quest="${quest.questId}">受注する</button>` : "";
      return `<article class="quest-list-card is-${status}"><div><span>${quest.questType}｜QUEST Lv.${quest.questLevel}</span><b>${quest.title}</b></div><p>${quest.description}</p><small>${status === "locked" ? `プレイヤーLv.${quest.requiredPlayerLevel}で解放` : `進捗 ${progress}/${actionTotal}｜EXP +${quest.rewardExp}`}</small>${action}</article>`;
    }).join("") : `<p class="quest-empty">該当するクエストはありません</p>`;
    return `<section class="quest-status-section"><h3>${statusMeta[status][0]} <small>${statusMeta[status][1]}</small><b>${quests.length}</b></h3>${cards}</section>`;
  }).join("");
  return `${sheetHeader("QUEST BOARD", "肺炎患者クエストツリー")}<div class="quest-player-summary"><b>Lv.${playerState.level} ${playerState.name}</b><span>EXP ${playerState.exp}/${playerState.nextLevelExp}</span><small>次のレベルまで ${Math.max(playerState.nextLevelExp - playerState.exp, 0)} EXP</small></div>${sections}`;
}

function completeQuest(quest) {
  quest.status = "completed";
  lastCompletedQuestId = quest.questId;
  if (!playerState.completedQuestIds.includes(quest.questId)) playerState.completedQuestIds.push(quest.questId);
  playerState.activeQuestIds = playerState.activeQuestIds.filter(id => id !== quest.questId);
  const levelUps = grantExperience(quest.rewardExp);
  synchronizeQuestStatuses();
  activateFirstAvailableQuest();
  saveQuestProgress();
  renderActiveQuest();
  return `クエスト達成：${quest.title}\n経験値 +${quest.rewardExp}${levelUps.length ? `\n${levelUps.join("\n")}` : ""}`;
}

function recordQuestAction(actionId, patientId) {
  let completionMessage = "";
  questState.filter(quest => quest.status === "active" && quest.targetPatientId === patientId && quest.requiredActions.includes(actionId)).forEach(quest => {
    if (!quest.completedActions.includes(actionId)) quest.completedActions.push(actionId);
    if (quest.requiredActions.every(requiredAction => quest.completedActions.includes(requiredAction))) completionMessage = completeQuest(quest);
  });
  saveQuestProgress();
  renderActiveQuest();
  return completionMessage;
}

function performObservation(patientId, actionId) {
  const patient = patients[patientId];
  const action = questActions[actionId];
  if (!patient || !action?.implemented) return { result: "この観察は今後実装予定です。", completionMessage: "" };
  advanceTime();
  const result = action.result(patient);
  const completionMessage = recordQuestAction(actionId, patient.patientId);
  return { result, completionMessage };
}

function interact(target) {
  moveNurse(target);
  advanceTime();
  window.setTimeout(() => {
    if (patients[target]) openSheet(patientView(target));
    else if (target === "pc") openSheet(pcPatientListView());
    else if (target === "monitor") openSheet(monitorView());
    else openSheet(equipmentView(target));
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380);
}

function bindInteractions() {
  document.querySelectorAll(".map-target").forEach(target => target.addEventListener("click", () => interact(target.dataset.target)));
  document.querySelector("#open-quest-list").addEventListener("click", () => openSheet(questListView()));
  document.querySelector("#close-sheet").addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !sheet.hidden) closeSheet(); });
  sheetContent.addEventListener("click", event => {
    const patientRow = event.target.closest("[data-pc-patient]");
    const pcViewButton = event.target.closest("[data-pc-view]");
    const pcBackButton = event.target.closest("[data-pc-back]");
    const bedCareButton = event.target.closest("[data-bed-care]");
    const bedBackButton = event.target.closest("[data-bed-back]");
    const observationMenu = event.target.closest("[data-observation-menu]");
    const observationAction = event.target.closest("[data-observation-action]");
    const acceptQuestButton = event.target.closest("[data-accept-quest]");
    const alarm = event.target.closest("[data-alarm-patient]");
    const moveOnly = event.target.closest("[data-move-only]");
    const messageButton = event.target.closest("[data-message]");
    if (patientRow) { advanceTime(); sheetContent.innerHTML = pcPatientMenuView(patientRow.dataset.pcPatient); }
    else if (pcViewButton) { advanceTime(); sheetContent.innerHTML = pcDetailView(pcViewButton.dataset.patient, pcViewButton.dataset.pcView); }
    else if (pcBackButton) sheetContent.innerHTML = pcBackButton.dataset.pcBack === "list" ? pcPatientListView() : pcPatientMenuView(pcBackButton.dataset.patient);
    else if (bedCareButton) sheetContent.innerHTML = bedCareView(bedCareButton.dataset.bedCare);
    else if (bedBackButton) sheetContent.innerHTML = patientView(bedBackButton.dataset.bedBack);
    else if (observationMenu) sheetContent.innerHTML = observationView(observationMenu.dataset.observationMenu);
    else if (observationAction) {
      const outcome = performObservation(observationAction.dataset.patientBed, observationAction.dataset.observationAction);
      sheetContent.innerHTML = observationView(observationAction.dataset.patientBed, outcome.result);
      showToast(outcome.completionMessage || outcome.result, Boolean(outcome.completionMessage));
    }
    else if (acceptQuestButton) {
      const accepted = activateQuest(acceptQuestButton.dataset.acceptQuest);
      sheetContent.innerHTML = questListView();
      if (!accepted) showToast("このクエストは現在受注できません。");
    }
    else if (alarm) showAlarmDetail(alarm.dataset.alarmPatient, alarm.dataset.alarmField);
    else if (moveOnly) { moveNurse(moveOnly.dataset.moveOnly); closeSheet(); showToast(`${patients[moveOnly.dataset.moveOnly].bed}付近へ移動しました`); }
    else if (messageButton) showToast(messageButton.dataset.message);
  });
}

async function init() {
  try {
    await loadDataStore();
    renderRoomFromData();
    renderPlayerStatus();
    renderActiveQuest();
    bindInteractions();
  } catch (error) {
    console.error("Game data could not be loaded", error);
    showToast("データを読み込めませんでした。ローカルサーバーから起動してください。");
  }
}

init();
