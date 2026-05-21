const DB_NAME = "nonsal_inventory_db";
const DB_VERSION = 1;
const STORE_ENTRIES = "entries";
const LEGACY_STORAGE_KEY = "nonsal_inventory_entries_v1";
const ACTIVE_ROOM_KEY = "nonsal_inventory_active_room_v1";
const POLICY_HOLDER_KEY = "nonsal_inventory_policy_holder_v1";

const captureScreen = document.getElementById("captureScreen");
const listScreen = document.getElementById("listScreen");
const navCaptureBtn = document.getElementById("navCaptureBtn");
const navListBtn = document.getElementById("navListBtn");

const activeRoomText = document.getElementById("activeRoomText");
const changeRoomBtn = document.getElementById("changeRoomBtn");
const roomPanel = document.getElementById("roomPanel");
const roomPresetSelect = document.getElementById("roomPresetSelect");
const customRoomInput = document.getElementById("customRoomInput");
const applyRoomBtn = document.getElementById("applyRoomBtn");
const policyHolderInput = document.getElementById("policyHolderInput");
const policyHolderEditInput = document.getElementById("policyHolderEditInput");

const photoInput = document.getElementById("photoInput");
const takePhotoBtn = document.getElementById("takePhotoBtn");
const cameraWrap = document.getElementById("cameraWrap");
const cameraVideo = document.getElementById("cameraVideo");
const capturePhotoBtn = document.getElementById("capturePhotoBtn");
const cancelCameraBtn = document.getElementById("cancelCameraBtn");
const photoPreviewWrap = document.getElementById("photoPreviewWrap");
const photoPreview = document.getElementById("photoPreview");
const descriptionInput = document.getElementById("descriptionInput");
const focusDescriptionBtn = document.getElementById("focusDescriptionBtn");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

const entriesList = document.getElementById("entriesList");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const downloadPhotosBtn = document.getElementById("downloadPhotosBtn");
const clearInventoryBtn = document.getElementById("clearInventoryBtn");

let dbPromise;
let entries = [];
let activeRoom = localStorage.getItem(ACTIVE_ROOM_KEY) || "Living Room";
let policyHolderName = localStorage.getItem(POLICY_HOLDER_KEY) || "";
let currentPhotoBlob = null;
let currentPhotoPreviewUrl = "";
let cameraStream = null;
const listPreviewUrls = new Set();

init().catch(() => {
  setStatus("Failed to initialize storage.");
});

async function init() {
  registerServiceWorker();
  dbPromise = openDb();

  updateActiveRoomUI();
  syncPolicyHolderInputs();
  resetCaptureState();
  showScreen("capture");

  await migrateFromLegacyIfNeeded();
  await refreshEntries();

  navCaptureBtn.addEventListener("click", () => showScreen("capture"));
  navListBtn.addEventListener("click", () => showScreen("list"));

  changeRoomBtn.addEventListener("click", () => {
    roomPanel.hidden = !roomPanel.hidden;
  });

  applyRoomBtn.addEventListener("click", applyRoomChoice);
  policyHolderInput.addEventListener("input", onPolicyHolderChange);
  policyHolderEditInput.addEventListener("input", onPolicyHolderChange);

  takePhotoBtn.addEventListener("click", openCameraCapture);
  photoInput.addEventListener("change", onPhotoSelected);
  capturePhotoBtn.addEventListener("click", captureFromLiveCamera);
  cancelCameraBtn.addEventListener("click", closeCameraCapture);

  focusDescriptionBtn.addEventListener("click", focusDescriptionField);
  saveBtn.addEventListener("click", saveEntry);

  entriesList.addEventListener("click", onEntriesListClick);

  exportCsvBtn.addEventListener("click", exportXlsx);
  downloadPhotosBtn.addEventListener("click", downloadAllPhotos);
  clearInventoryBtn.addEventListener("click", clearInventoryWithConfirm);
  window.addEventListener("pagehide", stopActiveCamera);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;

  navigator.serviceWorker.register("./sw.js").catch(() => {
    setStatus("Offline install setup failed.");
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = db.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function migrateFromLegacyIfNeeded() {
  const existing = await getAllEntries();
  if (existing.length > 0) return;

  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;

  let legacyEntries;
  try {
    legacyEntries = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Array.isArray(legacyEntries) || legacyEntries.length === 0) return;

  for (const legacy of legacyEntries) {
    const blob = dataUrlToBlob(legacy.photoDataUrl);
    if (!blob) continue;

    const migrated = {
      id: legacy.id || crypto.randomUUID(),
      room: legacy.room || "Room",
      description: legacy.description || "",
      timestamp: legacy.timestamp || new Date().toISOString(),
      photoBlob: blob,
      photoMimeType: blob.type || "image/jpeg",
    };

    // eslint-disable-next-line no-await-in-loop
    await putEntry(migrated);
  }

  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

async function refreshEntries() {
  entries = await getAllEntries();
  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  renderEntries();
}

async function getAllEntries() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, "readonly");
    const store = tx.objectStore(STORE_ENTRIES);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function putEntry(entry) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, "readwrite");
    const store = tx.objectStore(STORE_ENTRIES);
    const request = store.put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteEntryById(entryId) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, "readwrite");
    const store = tx.objectStore(STORE_ENTRIES);
    const request = store.delete(entryId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function showScreen(screen) {
  const isCapture = screen === "capture";
  captureScreen.hidden = !isCapture;
  listScreen.hidden = isCapture;
  navCaptureBtn.classList.toggle("btn--active", isCapture);
  navListBtn.classList.toggle("btn--active", !isCapture);
  if (!isCapture) {
    stopActiveCamera();
  }
}

function applyRoomChoice() {
  const custom = customRoomInput.value.trim();
  const chosen = custom || roomPresetSelect.value;
  activeRoom = chosen;
  localStorage.setItem(ACTIVE_ROOM_KEY, activeRoom);
  updateActiveRoomUI();
  customRoomInput.value = "";
  roomPanel.hidden = true;
  setStatus("Room updated.");
}

function onPolicyHolderChange(event) {
  policyHolderName = event.target.value;
  localStorage.setItem(POLICY_HOLDER_KEY, policyHolderName);
  syncPolicyHolderInputs();
}

function syncPolicyHolderInputs() {
  policyHolderInput.value = policyHolderName;
  policyHolderEditInput.value = policyHolderName;
}

function updateActiveRoomUI() {
  activeRoomText.textContent = activeRoom;
  if (Array.from(roomPresetSelect.options).some((opt) => opt.value === activeRoom)) {
    roomPresetSelect.value = activeRoom;
  }
}

async function openCameraCapture() {
  resetCaptureState();

  if (!navigator.mediaDevices?.getUserMedia) {
    photoInput.click();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    cameraStream = stream;
    cameraVideo.srcObject = stream;
    cameraWrap.hidden = false;
    setStatus("Camera ready.");
  } catch {
    // Fallback keeps capture working where stream APIs are blocked.
    photoInput.click();
  }
}

function closeCameraCapture() {
  stopActiveCamera();
  setStatus("Camera closed.");
}

function stopActiveCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraWrap.hidden = true;
}

async function captureFromLiveCamera() {
  if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    setStatus("Camera not ready yet.");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = cameraVideo.videoWidth;
  canvas.height = cameraVideo.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    setStatus("Camera capture failed.");
    return;
  }

  ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9)
  );

  if (!blob) {
    setStatus("Camera capture failed.");
    return;
  }

  setCapturedPhoto(blob);
  stopActiveCamera();
  setStatus("Photo captured. Tap 2. Describe.");
}

function onPhotoSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setCapturedPhoto(file);
  setStatus("Photo captured. Tap 2. Describe.");
}

function setCapturedPhoto(blob) {
  currentPhotoBlob = blob;

  if (currentPhotoPreviewUrl) {
    URL.revokeObjectURL(currentPhotoPreviewUrl);
  }
  currentPhotoPreviewUrl = URL.createObjectURL(blob);

  photoPreview.src = currentPhotoPreviewUrl;
  photoPreviewWrap.hidden = false;
}

function focusDescriptionField() {
  descriptionInput.focus();
  setStatus("Use keyboard microphone or type description.");
}

async function saveEntry() {
  if (!currentPhotoBlob) {
    setStatus("Take photo first.");
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    policyHolder: policyHolderName.trim(),
    room: activeRoom,
    description: descriptionInput.value.trim(),
    photoBlob: currentPhotoBlob,
    photoMimeType: currentPhotoBlob.type || "image/jpeg",
    timestamp: new Date().toISOString(),
  };

  await putEntry(entry);
  await refreshEntries();

  resetCaptureState();
  setStatus("Saved. Ready for next photo.");
}

function resetCaptureState() {
  stopActiveCamera();
  currentPhotoBlob = null;
  photoInput.value = "";

  if (currentPhotoPreviewUrl) {
    URL.revokeObjectURL(currentPhotoPreviewUrl);
    currentPhotoPreviewUrl = "";
  }

  photoPreview.src = "";
  photoPreviewWrap.hidden = true;
  descriptionInput.value = "";
}

function clearListPreviewUrls() {
  listPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  listPreviewUrls.clear();
}

function renderEntries() {
  clearListPreviewUrls();
  entriesList.innerHTML = "";

  if (!entries.length) {
    entriesList.innerHTML = '<li class="entry-item"><div>No entries yet.</div></li>';
    return;
  }

  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "entry-item";
    li.dataset.id = entry.id;

    const previewUrl = URL.createObjectURL(entry.photoBlob);
    listPreviewUrls.add(previewUrl);

    const thumb = document.createElement("img");
    thumb.className = "entry-thumb";
    thumb.src = previewUrl;
    thumb.alt = "Entry thumbnail";

    const body = document.createElement("div");

    const roomEl = document.createElement("div");
    roomEl.className = "entry-room";
    roomEl.textContent = entry.room;

    const policyHolderEl = document.createElement("div");
    policyHolderEl.className = "entry-policy";
    policyHolderEl.textContent = `Policy Holder: ${entry.policyHolder || policyHolderName || "(Not set)"}`;

    const descInput = document.createElement("textarea");
    descInput.className = "input entry-desc";
    descInput.rows = 2;
    descInput.value = entry.description || "";

    const actions = document.createElement("div");
    actions.className = "entry-actions";

    const saveEditBtn = document.createElement("button");
    saveEditBtn.type = "button";
    saveEditBtn.className = "btn save-edit-btn";
    saveEditBtn.textContent = "Save Edit";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn delete-btn";
    deleteBtn.textContent = "Delete";

    actions.append(saveEditBtn, deleteBtn);
    body.append(roomEl, policyHolderEl, descInput, actions);
    li.append(thumb, body);
    entriesList.appendChild(li);
  });
}

async function onEntriesListClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const item = target.closest(".entry-item");
  if (!item) return;

  const entryId = item.dataset.id;
  if (!entryId) return;

  if (target.classList.contains("delete-btn")) {
    await deleteEntryById(entryId);
    await refreshEntries();
    setStatus("Entry deleted.");
    return;
  }

  if (target.classList.contains("save-edit-btn")) {
    const textarea = item.querySelector(".entry-desc");
    if (!(textarea instanceof HTMLTextAreaElement)) return;

    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    entry.description = textarea.value.trim();
    await putEntry(entry);
    await refreshEntries();
    setStatus("Entry updated.");
  }
}

function getEntriesSortedForExport() {
  return [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function buildExportRows() {
  return getEntriesSortedForExport().map((entry, index) => {
    const itemNumber = String(index + 1).padStart(3, "0");
    const photoFilename = `${itemNumber}_${sanitizeForFilename(entry.room)}.jpg`;

    return {
      itemNumber,
      policyHolder: entry.policyHolder || policyHolderName || "",
      room: entry.room,
      description: entry.description || "",
      timestamp: entry.timestamp,
      photoFilename,
      photoBlob: entry.photoBlob,
    };
  });
}

async function clearInventoryWithConfirm() {
  const confirmation = window.prompt("Type CLEAR to remove all inventory entries.");
  if (confirmation !== "CLEAR") {
    setStatus("Clear inventory canceled.");
    return;
  }

  await clearAllEntries();
  policyHolderName = "";
  localStorage.removeItem(POLICY_HOLDER_KEY);
  syncPolicyHolderInputs();
  await refreshEntries();
  setStatus("Inventory cleared. Set a new policy holder.");
}

async function clearAllEntries() {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ENTRIES, "readwrite");
    const store = tx.objectStore(STORE_ENTRIES);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function exportXlsx() {
  if (!entries.length) {
    setStatus("No entries to export.");
    return;
  }

  setStatus("Building XLSX...");
  const rows = buildExportRows();
  const blob = await buildXlsxBlob(rows);
  triggerDownload(blob, `nonsal-inventory-${dateStamp()}.xlsx`);
  setStatus("XLSX exported.");
}

function downloadAllPhotos() {
  if (!entries.length) {
    setStatus("No photos to download.");
    return;
  }

  const rows = buildExportRows();
  rows.forEach((row, index) => {
    setTimeout(() => {
      triggerDownload(row.photoBlob, row.photoFilename);
    }, index * 180);
  });

  setStatus("Photo downloads started.");
}

function sanitizeForFilename(value) {
  const cleaned = String(value || "Room")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned || "Room";
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  const parts = dataUrl.split(",");
  if (parts.length !== 2) return null;

  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const byteString = atob(parts[1]);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const intArray = new Uint8Array(arrayBuffer);

  for (let i = 0; i < byteString.length; i += 1) {
    intArray[i] = byteString.charCodeAt(i);
  }

  return new Blob([arrayBuffer], { type: mime });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function buildXlsxBlob(rows) {
  const files = [];

  const sheetRows = [
    [
      "Item Number",
      "Policy Holder",
      "Thumbnail",
      "Room",
      "Description",
      "Timestamp",
      "Photo Filename",
    ],
    ...rows.map((row) => [
      row.itemNumber,
      row.policyHolder,
      "",
      row.room,
      row.description,
      row.timestamp,
      row.photoFilename,
    ]),
  ];

  files.push({ path: "[Content_Types].xml", data: textEncoder.encode(contentTypesXml(rows.length)) });
  files.push({ path: "_rels/.rels", data: textEncoder.encode(rootRelsXml()) });
  files.push({ path: "xl/workbook.xml", data: textEncoder.encode(workbookXml()) });
  files.push({ path: "xl/_rels/workbook.xml.rels", data: textEncoder.encode(workbookRelsXml()) });
  files.push({ path: "xl/styles.xml", data: textEncoder.encode(stylesXml()) });
  files.push({ path: "xl/worksheets/sheet1.xml", data: textEncoder.encode(sheetXml(sheetRows, rows.length)) });
  files.push({ path: "xl/worksheets/_rels/sheet1.xml.rels", data: textEncoder.encode(sheetRelsXml()) });
  files.push({ path: "xl/drawings/drawing1.xml", data: textEncoder.encode(drawingXml(rows.length)) });
  files.push({ path: "xl/drawings/_rels/drawing1.xml.rels", data: textEncoder.encode(drawingRelsXml(rows.length)) });

  for (let i = 0; i < rows.length; i += 1) {
    const imageBytes = new Uint8Array(await rows[i].photoBlob.arrayBuffer());
    files.push({ path: `xl/media/image${i + 1}.jpg`, data: imageBytes });
  }

  return createZipBlob(files);
}

function contentTypesXml(imageCount) {
  const overrides = [];
  for (let i = 1; i <= imageCount; i += 1) {
    overrides.push(
      `<Override PartName="/xl/media/image${i}.jpg" ContentType="image/jpeg"/>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  ${overrides.join("\n  ")}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Inventory" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="1">
    <fill><patternFill patternType="none"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
</styleSheet>`;
}

function sheetXml(rows, imageCount) {
  const colWidths = [
    '<col min="1" max="1" width="12" customWidth="1"/>',
    '<col min="2" max="2" width="28" customWidth="1"/>',
    '<col min="3" max="3" width="14" customWidth="1"/>',
    '<col min="4" max="4" width="18" customWidth="1"/>',
    '<col min="5" max="5" width="42" customWidth="1"/>',
    '<col min="6" max="6" width="24" customWidth="1"/>',
    '<col min="7" max="7" width="20" customWidth="1"/>',
  ].join("");

  const rowXml = rows
    .map((cells, rowIndex) => {
      const rowNum = rowIndex + 1;
      const rowHeight = rowNum === 1 ? "" : ' ht="64" customHeight="1"';
      const cellXml = cells
        .map((value, colIndex) => {
          const cellRef = `${columnName(colIndex)}${rowNum}`;
          const safeText = escapeXml(String(value ?? ""));
          return `<c r="${cellRef}" t="inlineStr"><is><t>${safeText}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNum}"${rowHeight}>${cellXml}</row>`;
    })
    .join("");

  const drawingTag = imageCount > 0 ? '<drawing r:id="rId1"/>' : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colWidths}</cols>
  <sheetData>${rowXml}</sheetData>
  ${drawingTag}
</worksheet>`;
}

function sheetRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
}

function drawingXml(imageCount) {
  const anchors = [];
  for (let i = 0; i < imageCount; i += 1) {
    const row = i + 1;
    anchors.push(`
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="${i + 1}" name="Picture ${i + 1}"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId${i + 1}"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors.join("")}
</xdr:wsDr>`;
}

function drawingRelsXml(imageCount) {
  const rels = [];
  for (let i = 0; i < imageCount; i += 1) {
    rels.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.jpg"/>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join("\n  ")}
</Relationships>`;
}

function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createZipBlob(files) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.path);
    const dataBytes = file.data;
    const crc = crc32(dataBytes);
    const fileHeader = new Uint8Array(30 + nameBytes.length);
    const fh = new DataView(fileHeader.buffer);

    fh.setUint32(0, 0x04034b50, true);
    fh.setUint16(4, 20, true);
    fh.setUint16(6, 0, true);
    fh.setUint16(8, 0, true);
    fh.setUint16(10, 0, true);
    fh.setUint16(12, 0, true);
    fh.setUint32(14, crc, true);
    fh.setUint32(18, dataBytes.length, true);
    fh.setUint32(22, dataBytes.length, true);
    fh.setUint16(26, nameBytes.length, true);
    fh.setUint16(28, 0, true);
    fileHeader.set(nameBytes, 30);

    chunks.push(fileHeader, dataBytes);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    centralDirectory.push(cd);

    offset += fileHeader.length + dataBytes.length;
  }

  const centralSize = centralDirectory.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...chunks, ...centralDirectory, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const textEncoder = new TextEncoder();
let crcTableCache = null;

function crc32(bytes) {
  if (!crcTableCache) {
    crcTableCache = makeCrcTable();
  }

  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ crcTableCache[(crc ^ bytes[i]) & 0xff];
  }

  return (crc ^ -1) >>> 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

function dateStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}
