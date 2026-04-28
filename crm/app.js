// =========================
// CONFIGURACIÓN
// =========================
const CLIENT_ID = "476093194527-1konl7vg3vemg90ssde1aj2b002jc78e.apps.googleusercontent.com";
const API_KEY = "";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const CRM_FILENAME = "networking_crm.json";

// Backup cifrado
const BACKUP_KEY = "crm_backup_encrypted_v1";
let backupPassword = null;

// Encapsular token
const tokenStore = (() => {
  let token = null;
  return {
    set: (t) => { token = t; },
    get: () => token,
    clear: () => { token = null; }
  };
})();

let userEmail = null;
let crmFileId = null;
let data = { contacts: [] };
let currentContactId = null;
let isDirty = false;

// DOM refs
const statusEl = document.getElementById("status");
const userEmailEl = document.getElementById("user-email");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const contactsListEl = document.getElementById("contacts-list");
const searchEl = document.getElementById("search");
const urgencyFilterEl = document.getElementById("urgency-filter");
const summaryEl = document.getElementById("summary");
const newContactBtn = document.getElementById("new-contact-btn");
const saveBtn = document.getElementById("save-btn");
const detailEmptyEl = document.getElementById("detail-empty");
const detailFormEl = document.getElementById("detail-form");
const deleteBtn = document.getElementById("delete-btn");
const wipeDeviceBtn = document.getElementById("wipe-device-btn"); // botón nuevo opcional

const fName = document.getElementById("f-name");
const fCompany = document.getElementById("f-company");
const fRole = document.getElementById("f-role");
const fEmail = document.getElementById("f-email");
const fPhone = document.getElementById("f-phone");
const fTags = document.getElementById("f-tags");
const fNotes = document.getElementById("f-notes");
const fLast = document.getElementById("f-last");
const fNext = document.getElementById("f-next");
const fHistory = document.getElementById("f-history");
const addHistoryBtn = document.getElementById("add-history-btn");
const historyListEl = document.getElementById("history-list");
const fIgnore = document.getElementById("f-ignore");

// =========================
// UTILIDADES DE SEGURIDAD
// =========================

function sanitize(str) {
  if (typeof str !== "string") return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.textContent;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  if (window.crypto && crypto.getRandomValues) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  return "xxxxxx".replace(/x/g, () =>
    ((Math.random() * 36) | 0).toString(36)
  );
}

// =========================
// CRYPTO HELPERS (AES-GCM + PBKDF2)
// =========================

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(password, dataObj) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const plaintext = enc.encode(JSON.stringify(dataObj));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    )
  );

  const full = new Uint8Array(salt.length + iv.length + ciphertext.length);
  full.set(salt, 0);
  full.set(iv, salt.length);
  full.set(ciphertext, salt.length + iv.length);

  return btoa(String.fromCharCode(...full));
}

async function decryptData(password, base64Str) {
  const bin = Uint8Array.from(atob(base64Str), c => c.charCodeAt(0));
  const salt = bin.slice(0, 16);
  const iv = bin.slice(16, 28);
  const ciphertext = bin.slice(28);

  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decrypted));
}

async function ensureBackupPassword() {
  if (backupPassword) return true;

  const useBackup = confirm(
    "¿Quieres activar un backup cifrado en este dispositivo?\n" +
    "Úsalo solo si confías mínimamente en este navegador."
  );
  if (!useBackup) return false;

  const pwd = prompt(
    "Introduce una contraseña para cifrar tu backup.\n" +
    "No la olvides: sin ella no podrás recuperar los datos."
  );
  if (!pwd || pwd.length < 6) {
    alert("Contraseña demasiado corta. No se activará el backup cifrado.");
    return false;
  }
  backupPassword = pwd;
  return true;
}

async function saveEncryptedBackup() {
  try {
    const ok = await ensureBackupPassword();
    if (!ok) return;
    const encrypted = await encryptData(backupPassword, data);
    localStorage.setItem(BACKUP_KEY, encrypted);
  } catch (e) {
    console.error("No se pudo guardar backup cifrado:", e);
  }
}

function clearEncryptedBackup() {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch (e) {
    console.error("No se pudo borrar backup cifrado:", e);
  }
}

// =========================
// MARCAR CAMBIOS
// =========================

async function markDirty() {
  if (!isDirty) {
    isDirty = true;
    saveBtn.disabled = false;
    setStatus("Cambios sin guardar.");
  }
  // Backup cifrado en segundo plano
  saveEncryptedBackup();
}

// =========================
// AUTENTICACIÓN
// =========================

function initGoogle() {
  if (!window.google || !google.accounts || !google.accounts.oauth2) return;
  google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        setStatus("Error al obtener token.");
        return;
      }
      tokenStore.set(resp.access_token);
      setStatus("Autenticado. Cargando datos...");
      fetchUserInfo().then(() => {
        loadOrCreateCrmFile();
      });
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
    },
  });
}

function login() {
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    setStatus("Google Identity no está disponible. Revisa bloqueadores o conexión.");
    return;
  }
  google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        setStatus("Error al iniciar sesión.");
        return;
      }
      tokenStore.set(resp.access_token);
      setStatus("Autenticado. Cargando datos...");
      fetchUserInfo().then(() => {
        loadOrCreateCrmFile();
      });
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
      wipeDeviceBtn.style.display = "none";
    },
  }).requestAccessToken();
}

function logout() {
  tokenStore.clear();
  userEmail = null;
  crmFileId = null;
  data = { contacts: [] };
  currentContactId = null;
  isDirty = false;
  backupPassword = null;

  clearEncryptedBackup();

  renderContacts();
  renderDetail(null);
  userEmailEl.textContent = "";
  setStatus("Sesión cerrada.");
  loginBtn.style.display = "inline-block";
  logoutBtn.style.display = "none";
  saveBtn.disabled = true;
  wipeDeviceBtn.style.display = "none";
}

async function fetchUserInfo() {
  try {
    const token = tokenStore.get();
    if (!token) return;
    const res = await driveFetch("https://www.googleapis.com/oauth2/v3/userinfo");
    if (!res || !res.ok) return;
    const info = await res.json();
    userEmail = info.email;
    userEmailEl.textContent = userEmail || "";
  } catch (e) {
    console.error(e);
  }
}

// =========================
// TOKEN REFRESH + DRIVE FETCH
// =========================

async function refreshToken() {
  return new Promise((resolve, reject) => {
    try {
      google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) {
            reject(resp.error);
          } else {
            tokenStore.set(resp.access_token);
            setStatus("Reconectado.");
            resolve(resp.access_token);
          }
        }
      }).requestAccessToken({ prompt: "" });
    } catch (e) {
      reject(e);
    }
  });
}

async function driveFetch(url, options = {}, retry = true) {
  const token = tokenStore.get();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const res = await fetch(url, { ...options, headers });

  if (res && (res.status === 401 || res.status === 403) && retry) {
    setStatus("Sesión expirada. Intentando renovar credenciales…");
    try {
      await refreshToken();
      return driveFetch(url, options, false);
    } catch (e) {
      console.error("No se pudo renovar token:", e);
      setStatus("La sesión expiró. Pulsa 'Iniciar sesión' para continuar.");
      return null;
    }
  }

  return res;
}

// =========================
// DRIVE: CARGA / GUARDADO
// =========================

async function loadOrCreateCrmFile() {
  try {
    const token = tokenStore.get();
    if (!token) {
      setStatus("No hay token de sesión.");
      return;
    }
    const searchUrl =
      "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent("name='" + CRM_FILENAME + "' and trashed=false") +
      "&fields=files(id,name)";
    const res = await driveFetch(searchUrl);
    if (!res || !res.ok) {
      throw new Error("Error HTTP " + (res && res.status));
    }
    const json = await res.json();
    if (json.files && json.files.length > 0) {
      crmFileId = json.files[0].id;
      await loadCrmData();
    } else {
      await createCrmFile();
    }
  } catch (e) {
    console.error(e);
    setStatus("Error al acceder a Google Drive.");
  }
}

async function createCrmFile() {
  setStatus("Creando archivo de CRM en Drive...");
  const metadata = {
    name: CRM_FILENAME,
    mimeType: "application/json",
  };

  const boundary = "-------314159265358979323846";
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const body =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json\r\n\r\n" +
    JSON.stringify({ contacts: [] }) +
    closeDelim;

  const token = tokenStore.get();
  if (!token) {
    setStatus("No hay token de sesión.");
    return;
  }

  const res = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        "Content-Type": "multipart/related; boundary=" + boundary,
      },
      body,
    }
  );
  if (!res || !res.ok) {
    console.error("Error al crear archivo:", res && res.status);
    setStatus("No se pudo crear el archivo de CRM.");
    return;
  }
  const json = await res.json();
  crmFileId = json.id;
  data = { contacts: [] };
  isDirty = false;
  setStatus("Archivo de CRM creado.");
  renderContacts();
  renderSummary();
}

async function loadCrmData() {
  setStatus("Cargando datos del CRM...");
  const token = tokenStore.get();
  if (!token) {
    setStatus("No hay token de sesión.");
    return;
  }
  const res = await driveFetch(
    "https://www.googleapis.com/drive/v3/files/" + crmFileId + "?alt=media"
  );
  if (!res) {
    setStatus("Error al cargar datos del CRM.");
    return;
  }
  if (!res.ok) {
    console.error("Error al cargar CRM:", res.status);
    setStatus("Error al cargar datos del CRM.");
    return;
  }
  const json = await res.json();
  data = json && Array.isArray(json.contacts) ? json : { contacts: [] };
  if (!data.contacts) data.contacts = [];
  data.contacts.forEach(c => {
    if (!c.history || !Array.isArray(c.history)) c.history = [];
  });
  if (data.contacts.length > 5000) {
    data.contacts = data.contacts.slice(0, 5000);
  }
  isDirty = false;
  setStatus("Datos cargados.");
  renderContacts();
  renderSummary();
}

async function saveCrmData() {
  try {
    const token = tokenStore.get();
    if (!token) {
      alert("Sesión no válida. Vuelve a iniciar sesión.");
      return;
    }
    const json = JSON.stringify(data, null, 2);

    const res = await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files/" +
        crmFileId +
        "?uploadType=media",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: json,
      }
    );

    if (!res || !res.ok) {
      throw new Error("Error HTTP " + (res && res.status));
    }

    isDirty = false;
    saveBtn.disabled = true;

    clearEncryptedBackup();

    alert("✔ Cambios guardados correctamente.");
  } catch (err) {
    console.error("Error al guardar:", err);
    alert("❌ No se pudo guardar. Revisa tu conexión a Google.");
  }
}

// =========================
// LÓGICA DE CONTACTOS
// =========================

function computeUrgency(contact) {
  if (contact.ignore) return "";

  if (!contact.next_followup) return "green";

  const today = new Date();
  const next = new Date(contact.next_followup);
  if (isNaN(next.getTime())) return "green";

  const todayDate = new Date(today.toISOString().slice(0, 10));
  if (next < todayDate) return "red";

  const diffDays = (next - todayDate) / 86400000;
  if (diffDays <= 7) return "yellow";

  return "green";
}

function getFilteredContacts() {
  const q = (searchEl.value || "").toLowerCase().trim();
  const uf = urgencyFilterEl.value;
  return data.contacts.filter((c) => {
    const tags = (c.tags || []).join(" ");
    const matchesText =
      !q ||
      (c.name || "").toLowerCase().includes(q) ||
      (c.company || "").toLowerCase().includes(q) ||
      tags.toLowerCase().includes(q);

    if (!matchesText) return false;
    if (!uf) return true;

    const urgency = computeUrgency(c);
    return urgency === uf;
  });
}

function renderContacts() {
  contactsListEl.innerHTML = "";
  const contacts = getFilteredContacts().sort((a, b) =>
    (a.name || "").localeCompare(b.name || "")
  );
  if (contacts.length === 0) {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "Sin contactos. Crea el primero.";
    contactsListEl.appendChild(div);
    return;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  contacts.forEach((c) => {
    const div = document.createElement("div");
    const urgency = computeUrgency(c);
    div.className =
      "contact-item " +
      urgency +
      (c.ignore ? " ignored" : "") +
      (c.id === currentContactId ? " active" : "");
    div.onclick = () => {
      currentContactId = c.id;
      renderContacts();
      renderDetail(c);
    };

    const safeName = sanitize(c.name || "(Sin nombre)");
    const safeCompany = sanitize(c.company || "");

    const titleEl = document.createElement("div");
    titleEl.className = "contact-title";
    titleEl.textContent = safeName;

    if (c.next_followup && c.next_followup < todayStr) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "seguimiento vencido";
      titleEl.appendChild(document.createTextNode(" "));
      titleEl.appendChild(badge);
    }

    const subEl = document.createElement("div");
    subEl.className = "contact-sub";
    subEl.textContent = safeCompany;

    const tagsEl = document.createElement("div");
    tagsEl.className = "tags";
    (c.tags || []).forEach((t) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = sanitize(t);
      tagsEl.appendChild(pill);
    });

    div.appendChild(titleEl);
    div.appendChild(subEl);
    div.appendChild(tagsEl);

    contactsListEl.appendChild(div);
  });
}

function renderHistory(contact) {
  historyListEl.innerHTML = "";

  if (!contact.history || contact.history.length === 0) {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "Sin historial.";
    historyListEl.appendChild(div);
    return;
  }

  contact.history.forEach((entry, index) => {
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";
    div.style.marginBottom = "4px";

    const span = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = entry.date;
    span.appendChild(strong);
    span.appendChild(document.createTextNode(": " + sanitize(entry.note || "")));

    const btnContainer = document.createElement("div");

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-secondary btn-sm";
    editBtn.textContent = "✏️";

    const deleteBtnHistory = document.createElement("button");
    deleteBtnHistory.className = "btn btn-danger btn-sm";
    deleteBtnHistory.textContent = "❌";

    editBtn.addEventListener("click", () => {
      const newText = prompt("Editar entrada:", entry.note);
      if (newText !== null && newText.trim() !== "") {
        entry.note = newText.trim();
        markDirty();
        renderHistory(contact);
      }
    });

    deleteBtnHistory.addEventListener("click", () => {
      if (!confirm("¿Seguro que quieres eliminar esta entrada del historial?")) {
        return;
      }
      contact.history.splice(index, 1);
      markDirty();
      renderHistory(contact);
    });

    btnContainer.appendChild(editBtn);
    btnContainer.appendChild(deleteBtnHistory);

    div.appendChild(span);
    div.appendChild(btnContainer);

    historyListEl.appendChild(div);
  });
}

function renderDetail(contact) {
  if (!contact) {
    detailEmptyEl.style.display = "block";
    detailFormEl.style.display = "none";
    return;
  }
  detailEmptyEl.style.display = "none";
  detailFormEl.style.display = "block";

  fName.value = contact.name || "";
  fCompany.value = contact.company || "";
  fRole.value = contact.role || "";
  fEmail.value = contact.email || "";
  fPhone.value = contact.phone || "";
  fTags.value = (contact.tags || []).join(", ");
  fNotes.value = contact.notes || "";
  fLast.value = contact.last_contact || "";
  fNext.value = contact.next_followup || "";
  fIgnore.checked = !!contact.ignore;
  fHistory.value = "";
  renderHistory(contact);
}

function renderSummary() {
  const total = data.contacts.length;
  const today = new Date().toISOString().slice(0, 10);
  const pending = data.contacts.filter(
    (c) => c.next_followup && c.next_followup <= today
  ).length;
  summaryEl.textContent =
    "Contactos: " +
    total +
    " · Seguimientos pendientes (hoy o antes): " +
    pending;
}

function getCurrentContact() {
  return data.contacts.find((c) => c.id === currentContactId) || null;
}

function createNewContact() {
  const c = {
    id: uuid(),
    name: "",
    company: "",
    role: "",
    email: "",
    phone: "",
    tags: [],
    notes: "",
    last_contact: "",
    next_followup: "",
    history: [],
    ignore: false,
  };
  data.contacts.push(c);
  currentContactId = c.id;
  markDirty();
  renderContacts();
  renderDetail(c);
  renderSummary();
}

function deleteCurrentContact() {
  if (!currentContactId) return;
  if (!confirm("¿Eliminar este contacto?")) return;
  data.contacts = data.contacts.filter((c) => c.id !== currentContactId);
  currentContactId = null;
  markDirty();
  renderContacts();
  renderDetail(null);
  renderSummary();
}

function updateCurrentContactFromForm() {
  const c = getCurrentContact();
  if (!c) return;
  c.name = fName.value.trim();
  c.company = fCompany.value.trim();
  c.role = fRole.value.trim();
  c.email = fEmail.value.trim();
  c.phone = fPhone.value.trim();
  c.tags = fTags.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);
  c.notes = fNotes.value.trim();
  c.last_contact = fLast.value || "";
  c.next_followup = fNext.value || "";
  markDirty();
  renderContacts();
  renderSummary();
}

function addHistoryEntry() {
  const c = getCurrentContact();
  if (!c) return;
  const note = fHistory.value.trim();
  if (!note) return;
  if (!c.history) c.history = [];
  c.history.push({
    date: new Date().toISOString().slice(0, 10),
    note,
  });
  fHistory.value = "";
  markDirty();
  renderHistory(c);
}

// =========================
// EVENTOS
// =========================

loginBtn.addEventListener("click", login);
logoutBtn.addEventListener("click", logout);
newContactBtn.addEventListener("click", createNewContact);
saveBtn.addEventListener("click", saveCrmData);
deleteBtn.addEventListener("click", deleteCurrentContact);

searchEl.addEventListener("input", () => {
  renderContacts();
});

urgencyFilterEl.addEventListener("change", () => {
  renderContacts();
});

[fName, fCompany, fRole, fEmail, fPhone, fTags, fNotes, fLast, fNext].forEach(
  (el) => {
    el.addEventListener("input", () => {
      updateCurrentContactFromForm();
    });
  }
);

fIgnore.addEventListener("change", () => {
  const c = getCurrentContact();
  if (!c) return;

  c.ignore = fIgnore.checked;
  markDirty();
  renderContacts();
  renderSummary();
});

addHistoryBtn.addEventListener("click", addHistoryEntry);

if (wipeDeviceBtn) {
  wipeDeviceBtn.addEventListener("click", () => {
    const sure = confirm(
      "Esto borrará el backup cifrado de este navegador.\n" +
      "Úsalo en PCs públicos o compartidos."
    );
    if (!sure) return;

    clearEncryptedBackup();
    backupPassword = null;

    isDirty = false;
    
    alert("Datos locales borrados de este dispositivo.");
    
    wipeDeviceBtn.style.display = "none";
  });
}

window.addEventListener("beforeunload", (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});


// =========================
// INICIO
// =========================

window.addEventListener("load", () => {
  (async () => {
    try {
      const encrypted = localStorage.getItem(BACKUP_KEY);

      if (encrypted && !tokenStore.get()) {
        wipeDeviceBtn.style.display = "inline-block";
      } else {
        wipeDeviceBtn.style.display = "none";
      }

      if (encrypted) {
        const wantsRestore = confirm(
          "Hay un backup cifrado de una sesión anterior.\n" +
          "¿Quieres intentar restaurarlo en este dispositivo?"
        );
        if (wantsRestore) {
          const pwd = prompt("Introduce la contraseña del backup cifrado:");
          if (!pwd) {
            alert("No se introdujo contraseña. No se restaurará el backup.");
          } else {
            try {
              const restored = await decryptData(pwd, encrypted);
              if (restored && Array.isArray(restored.contacts)) {
                data = restored;
                isDirty = true;
                saveBtn.disabled = false;
                renderContacts();
                renderSummary();
                setStatus("Backup cifrado restaurado. No olvides guardar en Google Drive.");
                backupPassword = pwd;
              } else {
                alert("El backup no tiene un formato válido.");
              }
            } catch (e) {
              console.error(e);
              alert("No se pudo descifrar el backup. ¿Contraseña correcta?");
            }
          }
        }
      }
    } catch (e) {
      console.error("Error al manejar backup cifrado:", e);
    }

    setStatus("Listo. Inicia sesión para cargar tu CRM.");

    const tryInit = () => {
      if (window.google && google.accounts && google.accounts.oauth2) {
        initGoogle();
      } else {
        setTimeout(() => {
          if (window.google && google.accounts && google.accounts.oauth2) {
            initGoogle();
          }
        }, 1000);
      }
    };

    tryInit();
  })();
});
