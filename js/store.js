/* ============================================================
   store.js — хранилище данных (localStorage).
   Обычный скрипт без ES-модулей: работает и с http://,
   и с file:// (открытие index.html двойным кликом), и на
   GitHub Pages. Данные — пациенты, настройки сайта, препараты.
   ============================================================ */

'use strict';

const KEYS = {
  settings: 'site-settings',
  patients: 'patients-db'
};

const SKIN_TYPES = ['нормальная', 'сухая', 'жирная', 'комбинированная', 'чувствительная'];

/* ---------- Низкоуровневое чтение/запись ---------- */

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null ? raw : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- Store ---------- */

function generateId(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function normalizeVisit(data) {
  if (!data || typeof data !== 'object') return null;
  const visit = { ...data };
  if (typeof visit.isScheduled === 'undefined') visit.isScheduled = false;
  return visit;
}

function normalizePatient(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const patient = { ...data };
  // Даты храним строками в ISO / ГГГГ-ММ-ДД — так их удобно сравнивать и резать .slice()
  const dateKeys = ['createdAt', 'updatedAt'];
  dateKeys.forEach(function (key) {
    if (patient[key] instanceof Date) {
      patient[key] = patient[key].toISOString();
    } else if (typeof patient[key] === 'undefined') {
      patient[key] = null;
    }
  });
  if (typeof patient.isScheduled === 'undefined') {
    patient.isScheduled = false;
  }
  if (!Array.isArray(patient.visits)) {
    patient.visits = [];
  }
  patient.visits = patient.visits.map(normalizeVisit).filter(Boolean);
  return patient;
}

function seedDemoPatients() {
  const now = new Date();
  const isoNow = now.toISOString();
  const isoDate = function (d) {
    return d.toISOString().split('T')[0];
  };
  return [
    {
      id: 'demo1',
      fullName: 'Анна Смирнова',
      phone: '+7 (905) 123-45-67',
      birthDate: '1991-04-12',
      skinType: 'сухая',
      allergies: '',
      notes: 'Предпочитает вечернее время визитов.',
      photoUrl: '',
      createdAt: isoNow,
      updatedAt: isoNow,
      visits: [
        { id: 'v1', date: isoDate(new Date(now.getTime() - 3000 * 60 * 60 * 24)), procedure: 'Уход за сухой кожей', product: 'Увлажняющий крем Hydraderm', comment: 'Первый визит', isScheduled: false },
        { id: 'v2', date: isoDate(new Date(now.getTime() - 1500 * 60 * 60 * 24)), procedure: 'Пилинг', product: '', comment: 'Реакция кожи в норме.', isScheduled: false }
      ]
    },
    {
      id: 'demo2',
      fullName: 'Елена Петрова',
      phone: '+7 (916) 555-44-33',
      birthDate: '1996-09-03',
      skinType: 'комбинированная',
      allergies: '',
      notes: '',
      photoUrl: '',
      createdAt: isoNow,
      updatedAt: isoNow,
      visits: [
        { id: 'v3', date: isoDate(new Date(now.getTime() + 5 * 86400000)), procedure: 'Чистка лица', product: '', comment: 'Запланирована.', isScheduled: true },
        { id: 'v4', date: isoDate(new Date(now.getTime() - 10 * 86400000)), procedure: 'Уход по типу кожи', product: '—', comment: 'Предварительная запись.', isScheduled: false }
      ]
    },
    {
      id: 'demo3',
      fullName: 'Мария Иванова',
      phone: '+7 (926) 888-77-66',
      birthDate: '1979-01-25',
      skinType: 'жирная',
      allergies: 'Аспирин.',
      notes: '',
      photoUrl: '',
      createdAt: isoNow,
      updatedAt: isoNow,
      visits: [
        { id: 'v5', date: isoDate(new Date(now.getTime() + 10 * 86400000)), procedure: 'Ботулинотерапия', product: '', comment: 'Запланирована.', isScheduled: true },
        { id: 'v6', date: isoDate(new Date(now.getTime() - 25 * 86400000)), procedure: 'Уход по типу кожи', product: '—', comment: 'Предварительная запись.', isScheduled: false }
      ]
    },
    {
      id: 'demo4',
      fullName: 'Ольга Кузнецова',
      phone: '+7 (936) 111-22-33',
      birthDate: '1972-06-30',
      skinType: 'чувствительная',
      allergies: '',
      notes: 'Тонкие сосуды, бережный массаж.',
      photoUrl: '',
      createdAt: isoNow,
      updatedAt: isoNow,
      visits: [
        { id: 'v7', date: isoDate(new Date(now.getTime() + 15 * 86400000)), procedure: 'Фотомоложение', product: '', comment: 'Запланирована.', isScheduled: true },
        { id: 'v8', date: isoDate(new Date(now.getTime() - 35 * 86400000)), procedure: 'Уход по типу кожи', product: '—', comment: 'Предварительная запись.', isScheduled: false }
      ]
    },
    {
      id: 'demo5',
      fullName: 'Дмитрий Соколов',
      phone: '+7 (909) 444-55-66',
      birthDate: '1986-12-08',
      skinType: 'нормальная',
      allergies: '',
      notes: '',
      photoUrl: '',
      createdAt: isoNow,
      updatedAt: isoNow,
      visits: [
        { id: 'v9', date: isoDate(new Date(now.getTime() + 20 * 86400000)), procedure: 'Лечение морщин', product: '', comment: 'Запланирована.', isScheduled: true },
        { id: 'v10', date: isoDate(new Date(now.getTime() - 55 * 86400000)), procedure: 'Уход по типу кожи', product: '—', comment: 'Предварительная запись.', isScheduled: false }
      ]
    },
    {
      id: 'demo6',
      fullName: 'Екатерина Васильева',
      phone: '+7 (918) 222-33-44',
      birthDate: '1995-03-17',
      skinType: 'сухая',
      allergies: '',
      notes: '',
      photoUrl: '',
      createdAt: isoNow,
      updatedAt: isoNow,
      visits: [
        { id: 'v11', date: isoDate(new Date(now.getTime() + 25 * 86400000)), procedure: 'Гидропилинг', product: '', comment: 'Запланирована.', isScheduled: true },
        { id: 'v12', date: isoDate(new Date(now.getTime() - 65 * 86400000)), procedure: 'Уход по типу кожи', product: '—', comment: 'Предварительная запись.', isScheduled: false }
      ]
    }
  ];
}

/* ---------- Настройки сайта: значения по умолчанию ---------- */

function defaultSettings() {
  return {
    siteName: 'Косметолог Ольга Титова',
    phoneDisplay: '+7 (905) 123-45-67',
    phoneHref: '+79051234567',
    aboutDirections: 'Эстетическая косметология;Уходовые программы;Инъекционные методики;Массаж лица',
    telegramUser: '',
    vkLink: '',
    aboutText: 'Меня зовут Ольга Титова, я частный косметолог. Работаю как самозанятая: официально оформляю каждый приём и выдаю чек через приложение «Мой налог». Принимаю в уютном кабинете, который снимаю в центре города. Подбираю уход под тип кожи, работаю с препаратами доказанной эффективности и веду электронную карту каждого пациента. Верю, что красивая кожа — это регулярность и честная работа без лишних обещаний.',
    services: [
      { id: 'svc1', name: 'Консультация и диагностика кожи', price: 1500, duration: '45 мин' },
      { id: 'svc2', name: 'Чистка лица (аппаратная)', price: 3500, duration: '60 мин' },
      { id: 'svc3', name: 'Пилинг поверхностный', price: 4000, duration: '40 мин' },
      { id: 'svc4', name: 'Уходовая программа по типу кожи', price: 5000, duration: '75 мин' },
      { id: 'svc5', name: 'Массаж лица', price: 2500, duration: '30 мин' }
    ]
  };
}

function ensureSeeded() {
  if (read(KEYS.patients, null) === null) {
    write(KEYS.patients, JSON.stringify(seedDemoPatients()));
  }
  if (read(KEYS.settings, null) === null) {
    write(KEYS.settings, JSON.stringify(defaultSettings()));
  }
}

/* ---------- CRUD для пациентов и настроек ---------- */

function getPatients() {
  const data = read(KEYS.patients, null);
  if (data === null) return [];
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePatient).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function getPatient(id) {
  const patients = getPatients();
  for (let i = 0; i < patients.length; i++) {
    if (patients[i].id === id) {
      return patients[i];
    }
  }
  return null;
}

function savePatient(patient) {
  const patients = getPatients();
  let found = false;
  const updated = patients.map(function (p) {
    if (p.id === patient.id) {
      found = true;
      return patient;
    }
    return p;
  });
  if (!found) {
    updated.push(patient);
  }
  write(KEYS.patients, JSON.stringify(updated));
}

function deletePatient(id) {
  const patients = getPatients();
  let removed = null;
  const filtered = patients.filter(function (p) {
    if (p.id === id) {
      removed = p;
      return false;
    }
    return true;
  });
  if (removed) {
    write(KEYS.patients, JSON.stringify(filtered));
    return removed;
  }
  return null;
}

function getSettings() {
  const defaults = defaultSettings();
  const data = read(KEYS.settings, null);
  if (data === null) return defaults;
  try {
    const stored = JSON.parse(data);
    // Подмешиваем умолчания, чтобы новые поля не были undefined
    return { ...defaults, ...stored };
  } catch (e) {
    return defaults;
  }
}

function saveSettings(settings) {
  write(KEYS.settings, JSON.stringify({ ...getSettings(), ...settings }));
}

/* ---------- Записи (визиты): статусы и подсчёт ---------- */

function updateVisitStatus(visitId, isScheduled) {
  const patients = getPatients();
  let changed = false;
  patients.forEach(function (p) {
    (p.visits || []).forEach(function (v) {
      if (v.id === visitId) {
        v.isScheduled = !!isScheduled;
        changed = true;
      }
    });
  });
  if (changed) {
    write(KEYS.patients, JSON.stringify(patients));
  }
  return changed;
}

function deleteVisit(patientId, visitId) {
  const patient = getPatient(patientId);
  if (!patient) return false;
  const before = (patient.visits || []).length;
  patient.visits = (patient.visits || []).filter(function (v) { return v.id !== visitId; });
  if (patient.visits.length === before) return false;
  savePatient(patient);
  return true;
}

function getPatientScheduledVisitsCount(patientId) {
  const patient = getPatient(patientId);
  if (!patient) return 0;
  const today = new Date().toISOString().split('T')[0];
  return (patient.visits || []).filter(function (v) {
    return v.isScheduled === true && v.date >= today;
  }).length;
}

/* ---------- Экспорт и импорт ---------- */

function exportAll() {
  return {
    app: 'kosmetolog',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    patients: getPatients()
  };
}

function validateImport(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('Файл должен содержать объект с данными');
    return { ok: false, errors: errors, counts: { patients: 0 } };
  }
  if (!Array.isArray(data.patients)) {
    errors.push('В файле нет списка пациентов (patients)');
  } else {
    data.patients.forEach(function (p, i) {
      if (!p || typeof p !== 'object' || !p.id) {
        errors.push('Пациент №' + (i + 1) + ': отсутствует идентификатор');
      }
    });
  }
  return {
    ok: errors.length === 0,
    errors: errors,
    counts: { patients: Array.isArray(data.patients) ? data.patients.length : 0 }
  };
}

function importAll(data) {
  const check = validateImport(data);
  if (!check.ok) {
    return { ok: false, counts: check.counts };
  }
  write(KEYS.patients, JSON.stringify(data.patients.map(normalizePatient).filter(Boolean)));
  if (data.settings && typeof data.settings === 'object') {
    write(KEYS.settings, JSON.stringify({ ...defaultSettings(), ...data.settings }));
  }
  return { ok: true, counts: { patients: data.patients.length } };
}

/* ---------- CRUD для препаратов (Products) ---------- */

const StoreProducts = (() => {
  const PRODUCTS_KEY = 'products-db';

  const DEFAULT_PRODUCTS = [
    { id: 'prod1', name: 'Увлажняющий крем Hydraderm', category: 'Кремы и лосьоны', description: 'Для всех типов кожи', price: 2500 },
    { id: 'prod2', name: 'Сыворотка с витамином С', category: 'Сыворотки и концентраты', description: 'Отбеливание, антиоксидант', price: 3200 },
    { id: 'prod3', name: 'Ботулинотерапия (1 ед.)', category: 'Инъекционные препараты', description: 'Устранение морщин', price: 500 },
    { id: 'prod4', name: 'Филлер губы (1 мл)', category: 'Инъекционные препараты', description: 'Объемные контуры', price: 8000 },
    { id: 'prod5', name: 'Чистка лица аппаратная', category: 'Аппаратные методики', description: 'Ультразвуковая чистка', price: 2000 }
  ];

  function loadProducts() {
    const data = read(PRODUCTS_KEY, null);
    if (data !== null && typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error('Ошибка при чтении препаратов:', e);
      }
    }
    write(PRODUCTS_KEY, JSON.stringify(DEFAULT_PRODUCTS));
    return DEFAULT_PRODUCTS.slice();
  }

  function saveProduct(product) {
    const products = loadProducts();
    const existingIndex = products.findIndex(function (p) { return p.id === product.id; });

    if (existingIndex >= 0) {
      products[existingIndex] = {
        ...products[existingIndex],
        name: product.name || '—',
        category: product.category || '—',
        description: product.description || '—',
        price: product.price || 0
      };
      write(PRODUCTS_KEY, JSON.stringify(products));
      return products[existingIndex];
    }
    const newProduct = {
      id: generateId('prod'),
      name: product.name || '—',
      category: product.category || '—',
      description: product.description || '—',
      price: product.price || 0,
      createdAt: Date.now()
    };
    products.push(newProduct);
    write(PRODUCTS_KEY, JSON.stringify(products));
    return newProduct;
  }

  function deleteProduct(productId) {
    const products = loadProducts();
    const filtered = products.filter(function (p) { return p.id !== productId; });
    if (products.length !== filtered.length) {
      write(PRODUCTS_KEY, JSON.stringify(filtered));
      return true;
    }
    return false;
  }

  function exportProducts() {
    return JSON.stringify(loadProducts(), null, 2);
  }

  return {
    DEFAULT_PRODUCTS: DEFAULT_PRODUCTS,
    loadProducts: loadProducts,
    saveProduct: saveProduct,
    deleteProduct: deleteProduct,
    setProductsToStorage: function (products) { write(PRODUCTS_KEY, JSON.stringify(products)); },
    exportProducts: exportProducts
  };
})();

/* ---------- Публичный интерфейс Store ---------- */

const Store = {
  SKIN_TYPES: SKIN_TYPES,
  generateId: generateId,
  ensureSeeded: ensureSeeded,
  getPatients: getPatients,
  getPatient: getPatient,
  savePatient: savePatient,
  deletePatient: deletePatient,
  getSettings: getSettings,
  saveSettings: saveSettings,
  exportAll: exportAll,
  validateImport: validateImport,
  importAll: importAll,
  getPatientScheduledVisitsCount: getPatientScheduledVisitsCount,
  updateVisitStatus: updateVisitStatus,
  deleteVisit: deleteVisit
};
