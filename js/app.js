/* ============================================================
   app.js — маршрутизация, состояние и интерфейс.
   Пользовательские данные выводятся только через textContent
   (сборка узлов через createElement), поэтому ввод в полях
   пациентов не может стать вектором XSS.
   ============================================================ */

'use strict';

/* ---------- Состояние приложения ---------- */

const AppState = {
  session: null,
  route: { name: 'home', param: null },
  patients: [],
  settings: null,
  filters: { query: '', sort: 'name', skin: 'all', scheduledOnly: false, visible: 10 },
  pendingLoginRedirect: null,
  loginNotice: false,
  lastDeleted: null,
  undoTimer: null
};

const PAGE_SIZE = 10;

const HERO_IMAGE = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Woman_applying_serum_on_her_face_closeup.jpg/960px-Woman_applying_serum_on_her_face_closeup.jpg';
const ABOUT_IMAGE = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/11/Woman_applies_skincare_product_in_bathroom.jpg/960px-Woman_applies_skincare_product_in_bathroom.jpg';
const LAB_IMAGE = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Laboratorium_kosmetologii.jpg/960px-Laboratorium_kosmetologii.jpg';

/* ---------- Небольшие помощники ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('width', String(size || 24));
  svg.setAttribute('height', String(size || 24));
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-' + name);
  svg.appendChild(use);
  return svg;
}

function debounce(fn, ms) {
  let timer = null;
  return function () {
    const args = arguments;
    const self = this;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(self, args); }, ms);
  };
}

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDateRu(iso) {
  if (!iso) return '—';
  const parts = String(iso).split('-');
  if (parts.length < 3) return iso;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return iso;
  return day + ' ' + (MONTHS_RU[month - 1] || '') + ' ' + year;
}

function formatDateShort(iso) {
  if (!iso) return '—';
  const parts = String(iso).split('-');
  if (parts.length < 3) return iso;
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function todayIso() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + m + '-' + d;
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  const born = new Date(birthDate + 'T00:00:00');
  if (isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday = now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age--;
  return age >= 0 ? age : null;
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* Подсветка совпадений поискового запроса внутри ячейки. */
function highlightText(container, text, query) {
  container.textContent = '';
  const safeText = String(text || '');
  const q = String(query || '').trim();
  if (!q) {
    container.textContent = safeText;
    return;
  }
  const re = new RegExp('(' + escapeRegExp(q) + ')', 'gi');
  const parts = safeText.split(re);
  parts.forEach(function (part) {
    if (part.toLowerCase() === q.toLowerCase() && part !== '') {
      container.appendChild(el('mark', null, part));
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

/* Маска телефона: +7 (999) 999-99-99 */
function applyPhoneMask(input) {
  input.addEventListener('input', function () {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) {
      input.value = '';
      return;
    }
    let d = digits;
    if (d.charAt(0) === '8') d = '7' + d.slice(1);
    if (d.charAt(0) !== '7') d = '7' + d;
    d = d.slice(0, 11);
    const p1 = d.slice(1, 4);
    const p2 = d.slice(4, 7);
    const p3 = d.slice(7, 9);
    const p4 = d.slice(9, 11);
    let out = '+7';
    if (p1) out += ' (' + p1 + (p1.length === 3 ? ')' : '');
    if (p2) out += ' ' + p2;
    if (p3) out += '-' + p3;
    if (p4) out += '-' + p4;
    input.value = out;
  });
}

const PHONE_RE = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;

/* ---------- Тосты ---------- */

function showToast(text, options) {
  options = options || {};
  const box = document.getElementById('toasts');
  const toast = el('div', 'toast' + (options.type === 'success' ? ' toast--success' : ''));
  toast.appendChild(el('span', null, text));
  let timer = null;
  function dismiss() {
    clearTimeout(timer);
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }
  if (options.actionLabel) {
    const btn = el('button', 'toast__action', options.actionLabel);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      if (options.onAction) options.onAction();
      dismiss();
    });
    toast.appendChild(btn);
    timer = setTimeout(dismiss, options.duration || 10000);
  } else {
    timer = setTimeout(dismiss, options.duration || 4000);
  }
  box.appendChild(toast);
}

/* ---------- Модальные окна ---------- */

let lastFocusedElement = null;

function openModal(options) {
  lastFocusedElement = document.activeElement;
  const root = document.getElementById('modal-root');
  clearNode(root);

  const overlay = el('div', 'modal-overlay');
  const dialog = el('div', 'modal' + (options.wide ? ' modal--wide' : ''));
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', options.title || 'Диалог');

  const head = el('div', 'modal__head');
  head.appendChild(el('h2', null, options.title || ''));
  const closeBtn = el('button', 'modal__close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Закрыть окно');
  closeBtn.appendChild(icon('close', 20));
  head.appendChild(closeBtn);
  dialog.appendChild(head);

  const body = el('div', 'modal__body');
  options.buildBody(body);
  dialog.appendChild(body);

  if (options.actions && options.actions.length) {
    const actions = el('div', 'modal__actions');
    options.actions.forEach(function (action) {
      const btn = el('button', 'btn btn--' + (action.kind || 'ghost'), action.label);
      btn.type = 'button';
      btn.addEventListener('click', action.onClick);
      actions.appendChild(btn);
    });
    dialog.appendChild(actions);
  }

  function close() {
    clearNode(root);
    document.removeEventListener('keydown', overlayKeyHandler, true);
    if (lastFocusedElement && lastFocusedElement.focus) {
      lastFocusedElement.focus();
    }
  }

  function overlayKeyHandler(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', overlayKeyHandler, true);

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', function (event) {
    if (event.target === overlay) close();
  });

  overlay.appendChild(dialog);
  root.appendChild(overlay);

  const target = dialog.querySelector('[data-autofocus]') || closeBtn;
  target.focus();

  return { close: close, dialog: dialog };
}

/* ---------- Работа с данными в состоянии ---------- */

function loadPatients() {
  AppState.patients = Store.getPatients();
}

function loadSettings() {
  AppState.settings = Store.getSettings();
}

/* ---------- Маршрутизация ---------- */

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'about') return { name: 'home', scroll: 'about' };
  if (parts[0] === 'services') return { name: 'home', scroll: 'services' };
  if (parts[0] === 'contacts') return { name: 'home', scroll: 'contacts' };
  if (parts[0] === 'login') return { name: 'login' };
  if (parts[0] === 'patients' && parts[1]) return { name: 'patient', param: parts[1] };
  if (parts[0] === 'patients') return { name: 'patients' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'products-db') return { name: 'products-db' };
  return { name: 'home' };
}

function requireAuth(intendedHash) {
  if (AppState.session) return true;
  AppState.pendingLoginRedirect = intendedHash;
  AppState.loginNotice = true;
  window.location.hash = '#/login';
  return false;
}

function router() {
  const route = parseHash();
  AppState.route = route;

  if ((route.name === 'patients' || route.name === 'patient' || route.name === 'settings' || route.name === 'products-db') && !requireAuth('#/' + (route.param ? 'patients/' + route.param : route.name === 'settings' ? 'settings' : route.name === 'products-db' ? 'products-db' : 'patients'))) {
    return;
  }
  if (route.name === 'settings' && !Auth.isAdmin(AppState.session)) {
    showToast('Недостаточно прав для раздела настроек');
    window.location.hash = '#/patients';
    return;
  }
  if (route.name === 'products-db' && !Auth.isAdmin(AppState.session)) {
    showToast('Доступ запрещён: только администраторы');
    window.location.hash = '#/patients';
    return;
  }
  if (route.name === 'login' && AppState.session) {
    window.location.hash = '#/patients';
    return;
  }
  render();
}

/* ---------- Обновление шапки и подвала ---------- */

function renderChrome() {
  const settings = AppState.settings;
  const headerPhone = document.getElementById('header-phone');
  headerPhone.href = 'tel:' + settings.phoneHref;
  document.getElementById('header-phone-text').textContent = settings.phoneDisplay;
  const footerPhone = document.getElementById('footer-phone');
  footerPhone.href = 'tel:' + settings.phoneHref;
  footerPhone.textContent = settings.phoneDisplay;

  const actions = document.getElementById('header-actions');
  const old = document.getElementById('header-auth-area');
  if (old) old.remove();
  const authArea = el('div', 'header__actions');
  authArea.id = 'header-auth-area';
  authArea.style.display = 'contents';
  if (AppState.session) {
    const patientsLink = el('a', 'btn btn--outline btn--sm', 'Пациенты');
    patientsLink.href = '#/patients';
    const logoutBtn = el('button', 'btn btn--ghost btn--sm', 'Выйти');
    logoutBtn.type = 'button';
    logoutBtn.addEventListener('click', function () {
      Auth.logout();
      AppState.session = null;
      showToast('Вы вышли из учётной записи');
      window.location.hash = '#/';
      render();
    });
    authArea.appendChild(patientsLink);
    authArea.appendChild(logoutBtn);
  } else {
    const loginBtn = el('a', 'btn btn--primary btn--sm', 'Войти');
    loginBtn.href = '#/login';
    authArea.appendChild(loginBtn);
  }
  actions.appendChild(authArea);

  /* Мобильное меню: нижний блок */
  const mobileFooter = document.getElementById('mobile-menu-footer');
  clearNode(mobileFooter);
  const mobilePhone = el('a', 'header__phone', settings.phoneDisplay);
  mobilePhone.href = 'tel:' + settings.phoneHref;
  mobileFooter.appendChild(mobilePhone);
  if (AppState.session) {
    const patientsLink = el('a', 'btn btn--outline', 'Пациенты');
    patientsLink.href = '#/patients';
    const logoutBtn = el('button', 'btn btn--ghost', 'Выйти');
    logoutBtn.type = 'button';
    logoutBtn.addEventListener('click', function () {
      Auth.logout();
      AppState.session = null;
      closeMobileMenu();
      showToast('Вы вышли из учётной записи');
      window.location.hash = '#/';
      render();
    });
    mobileFooter.appendChild(patientsLink);
    mobileFooter.appendChild(logoutBtn);
  } else {
    const loginBtn = el('a', 'btn btn--primary', 'Войти');
    loginBtn.href = '#/login';
    mobileFooter.appendChild(loginBtn);
  }

  /* Активный пункт меню */
  const map = { about: 'about', services: 'services', contacts: 'contacts' };
  document.querySelectorAll('.nav__link').forEach(function (link) {
    const key = link.getAttribute('data-nav');
    if (AppState.route.scroll && map[key] === AppState.route.scroll) {
      link.classList.add('is-active');
    } else {
      link.classList.remove('is-active');
    }
  });
}

/* ---------- Бургер-меню ---------- */

function closeMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const burger = document.getElementById('burger');
  menu.hidden = true;
  burger.setAttribute('aria-expanded', 'false');
  burger.setAttribute('aria-label', 'Открыть меню');
  clearNode(burger);
  burger.appendChild(icon('menu', 24));
}

function bindBurger() {
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobile-menu');
  burger.addEventListener('click', function () {
    const willOpen = menu.hidden;
    if (willOpen) {
      menu.hidden = false;
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', 'Закрыть меню');
      clearNode(burger);
      burger.appendChild(icon('close', 24));
    } else {
      closeMobileMenu();
    }
  });
  menu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () { closeMobileMenu(); });
  });
}

/* ---------- Экран: главная ---------- */

function renderHome(app) {
  const s = AppState.settings;

  /* --- Герой --- */
  const hero = el('section', 'hero');
  const heroGrid = el('div', 'container hero__grid');

  const heroContent = el('div', 'hero__content');
  heroContent.appendChild(el('span', 'eyebrow', 'Частный косметолог · самозанятая'));
  const heroTitle = el('h1', 'hero__title');
  heroTitle.appendChild(document.createTextNode('Здоровая кожа —'));
  heroTitle.appendChild(document.createElement('br'));
  heroTitle.appendChild(el('em', null, 'это система ухода'));
  heroContent.appendChild(heroTitle);
  heroContent.appendChild(el('p', 'hero__lead',
    'Меня зовут Ольга Титова. Я частный косметолог: принимаю в арендованном кабинете, работаю официально как самозанятая и выдаю чек через «Мой налог». Подбираю процедуры по типу кожи, веду электронную карту каждого пациента и контролирую сроки между визитами. Спокойно, последовательно и без лишних обещаний.'));
  const heroActions = el('div', 'hero__actions');
  const callBtn = el('a', 'btn btn--primary', 'Записаться по телефону');
  callBtn.href = 'tel:' + s.phoneHref;
  const servicesBtn = el('a', 'btn btn--outline', 'Посмотреть услуги');
  servicesBtn.href = '#/services';
  heroActions.appendChild(callBtn);
  heroActions.appendChild(servicesBtn);
  heroContent.appendChild(heroActions);

  const heroMedia = el('div', 'hero__media');
  const heroImg = document.createElement('img');
  heroImg.src = HERO_IMAGE;
  heroImg.width = 900;
  heroImg.height = 1350;
  heroImg.alt = 'Женщина наносит сыворотку на лицо в светлом минималистичном интерьере';
  heroImg.setAttribute('onerror', '__imgFallback(this)');
  heroMedia.appendChild(heroImg);
  const badge = el('div', 'hero__badge');
  badge.appendChild(el('strong', null, 'Самозанятая'));
  badge.appendChild(document.createTextNode('официальный статус и чек через «Мой налог» на каждый приём'));
  heroMedia.appendChild(badge);

  heroGrid.appendChild(heroContent);
  heroGrid.appendChild(heroMedia);
  hero.appendChild(heroGrid);
  app.appendChild(hero);

  /* --- О специалисте --- */
  const about = el('section', 'section');
  about.id = 'about';
  const aboutContainer = el('div', 'container');
  const aboutGrid = el('div', 'about__grid');

  const aboutMedia = el('div', 'about__media');
  const aboutImg = document.createElement('img');
  aboutImg.src = ABOUT_IMAGE;
  aboutImg.width = 900;
  aboutImg.height = 600;
  aboutImg.alt = 'Женщина с ухоженной кожей наносит крем в светлой ванной комнате';
  aboutImg.setAttribute('loading', 'lazy');
  aboutImg.setAttribute('decoding', 'async');
  aboutImg.setAttribute('onerror', '__imgFallback(this)');
  aboutMedia.appendChild(aboutImg);

  const aboutContent = el('div', 'about__content');
  aboutContent.appendChild(el('span', 'eyebrow', 'О специалисте'));
  aboutContent.appendChild(el('h2', 'section__title', 'Ольга Титова'));
  aboutContent.appendChild(el('p', null, s.aboutText));
  const facts = el('ul', 'about__facts');
  facts.appendChild(el('li', null, 'Частная практика: самозанятая, приём в арендованном кабинете'));
  s.aboutDirections.split(';').forEach(function (item) {
    const trimmed = item.trim();
    if (trimmed) facts.appendChild(el('li', null, trimmed));
  });
  aboutContent.appendChild(facts);

  aboutGrid.appendChild(aboutMedia);
  aboutGrid.appendChild(aboutContent);
  aboutContainer.appendChild(aboutGrid);
  about.appendChild(aboutContainer);
  app.appendChild(about);

  /* --- Услуги и цены --- */
  const services = el('section', 'section section--tinted');
  services.id = 'services';
  const svcContainer = el('div', 'container');
  svcContainer.appendChild(el('span', 'eyebrow', 'Прайс'));
  svcContainer.appendChild(el('h2', 'section__title', 'Услуги и цены'));
  svcContainer.appendChild(el('p', 'section__lead',
    'Стоимость фиксируется после консультации и не меняется в ходе курса. Точные позиции и цены обновляет администратор.'));

  const tableWrap = el('div', 'price-table-wrap');
  const table = el('table', 'price-table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  [['Услуга', null], ['Цена', null], ['Длительность', null]].forEach(function (h) {
    headRow.appendChild(el('th', null, h[0]));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  s.services.forEach(function (svc) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, svc.name));
    tr.appendChild(el('td', 'price', Number(svc.price).toLocaleString('ru-RU') + ' ₽'));
    tr.appendChild(el('td', 'duration', svc.duration));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  svcContainer.appendChild(tableWrap);
  svcContainer.appendChild(el('p', 'price-note',
    'Имеются противопоказания. Необходима консультация специалиста.'));
  services.appendChild(svcContainer);
  app.appendChild(services);

  /* --- Контакты --- */
  const contacts = el('section', 'section');
  contacts.id = 'contacts';
  const contactsContainer = el('div', 'container');
  contactsContainer.appendChild(el('span', 'eyebrow', 'Контакты'));
  contactsContainer.appendChild(el('h2', 'section__title', 'Запись и консультация'));
  const contactsGrid = el('div', 'contacts__grid');

  const contactsMain = el('div', 'contacts__main');
  const bigPhone = el('a', 'contacts__phone', s.phoneDisplay);
  bigPhone.href = 'tel:' + s.phoneHref;
  contactsMain.appendChild(bigPhone);
  const list = el('dl', 'contacts__list');
  [
    ['Часы приёма', 'Ежедневно с 10:00 до 20:00'],
    ['Адрес', 'г. Москва, ул. Примерная, д. 12, кабинет 4 (адрес демонстрационный)'],
    ['Запись', 'По телефону, звонок или сообщение']
  ].forEach(function (row) {
    const li = el('li');
    li.appendChild(el('strong', null, row[0]));
    li.appendChild(el('span', null, row[1]));
    list.appendChild(li);
  });
  contactsMain.appendChild(list);
  const callBtn2 = el('a', 'btn btn--primary', 'Позвонить');
  callBtn2.href = 'tel:' + s.phoneHref;
  contactsMain.appendChild(callBtn2);

  const aside = el('div', 'contacts__aside');
  aside.appendChild(el('h3', null, 'Перед первым визитом'));
  aside.appendChild(el('p', null,
    'На консультации мы собираем анамнез: аллергии, перенесённые процедуры, домашний уход. Это занимает 10–15 минут и позволяет составить план без риска для кожи. Приходите без макияжа, если планируется процедура в день визита.'));
  aside.appendChild(el('p', null,
    'Если номер занят — оставьте заявку в сообщении, перезвоним в течение рабочего дня.'));

  contactsGrid.appendChild(contactsMain);
  contactsGrid.appendChild(aside);
  contactsContainer.appendChild(contactsGrid);
  contacts.appendChild(contactsContainer);
  app.appendChild(contacts);

  /* --- Сайт сделан на заказ --- */
  const order = el('section', 'section section--tinted');
  order.id = 'order-site';
  const orderContainer = el('div', 'container');
  orderContainer.appendChild(el('span', 'eyebrow', 'Для специалистов'));
  orderContainer.appendChild(el('h2', 'section__title', 'Такой сайт можно заказать'));
  orderContainer.appendChild(el('p', 'section__lead',
    'Эта страница — не шаблон из конструктора, а рабочий инструмент: публичная визитка специалиста плюс учёт пациентов, история визитов и база препаратов в одном месте. Делаю такие сайты на заказ для косметологов, мастеров и частных специалистов: аккуратно, под ключ и без ежемесячных платежей конструктору.'));

  const orderActions = el('div', 'hero__actions');
  const tgName = (s.telegramUser || '').trim().replace(/^@/, '');
  const vkUrl = (s.vkLink || '').trim();
  if (tgName) {
    const tgBtn = el('a', 'btn btn--primary', 'Написать в Telegram');
    tgBtn.href = 'https://t.me/' + tgName;
    tgBtn.target = '_blank';
    tgBtn.rel = 'noopener';
    orderActions.appendChild(tgBtn);
  }
  if (vkUrl) {
    const vkBtn = el('a', 'btn btn--outline', 'Мы ВКонтакте');
    vkBtn.href = vkUrl;
    vkBtn.target = '_blank';
    vkBtn.rel = 'noopener';
    orderActions.appendChild(vkBtn);
  }
  if (!tgName && !vkUrl) {
    orderActions.appendChild(el('p', 'muted-text',
      'Контакты для заказа скоро появятся здесь — следите за обновлениями.'));
  }
  orderContainer.appendChild(orderActions);
  order.appendChild(orderContainer);
  app.appendChild(order);
}

/* ---------- Экран: вход ---------- */

function renderLogin(app) {
  const wrap = el('div', 'container auth');
  const card = el('div', 'auth__card');

  card.appendChild(el('h1', null, 'Вход для сотрудника'));
  card.appendChild(el('p', 'auth__subtitle', 'Рабочая область для косметолога и администратора.'));

  const plaque = el('div', 'warning-plaque');
  plaque.appendChild(el('strong', null, 'Это демонстрационный прототип'));
  plaque.appendChild(el('p', null,
    'Данные хранятся только в браузере на этом устройстве. Клиентская проверка пароля не обеспечивает защиту персональных данных; перед реальным использованием требуется серверная авторизация и соблюдение требований по защите персональных данных.'));
  card.appendChild(plaque);

  const errorBox = el('div', 'auth__error');
  errorBox.hidden = true;
  errorBox.setAttribute('role', 'alert');
  card.appendChild(errorBox);

  if (AppState.loginNotice) {
    AppState.loginNotice = false;
    errorBox.hidden = false;
    errorBox.textContent = 'Доступ только для сотрудника. Войдите, чтобы продолжить.';
  }

  const form = el('form');
  form.noValidate = true;

  const loginField = el('div', 'field');
  loginField.appendChild(el('label', null, 'Логин'));
  const loginInput = el('input');
  loginInput.type = 'text';
  loginInput.name = 'login';
  loginInput.autocomplete = 'username';
  loginInput.setAttribute('aria-label', 'Логин');
  loginField.appendChild(loginInput);
  form.appendChild(loginField);

  const passField = el('div', 'field');
  const passLabel = el('label', null, 'Пароль');
  passField.appendChild(passLabel);
  const passInput = el('input');
  passInput.type = 'password';
  passInput.name = 'password';
  passInput.autocomplete = 'current-password';
  passInput.setAttribute('aria-label', 'Пароль');
  passField.appendChild(passInput);
  form.appendChild(passField);

  const rememberLabel = el('label', 'checkbox');
  const rememberInput = el('input');
  rememberInput.type = 'checkbox';
  rememberInput.checked = true;
  rememberLabel.appendChild(rememberInput);
  rememberLabel.appendChild(document.createTextNode('Запомнить меня на 7 дней'));
  form.appendChild(rememberLabel);

  const submitBtn = el('button', 'btn btn--primary', 'Войти');
  submitBtn.type = 'submit';
  form.appendChild(submitBtn);
  card.appendChild(form);

  const back = el('a', 'auth__back', 'Вернуться на главную');
  back.href = '#/';
  card.appendChild(back);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.hidden = true;
    const loginValue = loginInput.value.trim();
    const password = passInput.value;
    if (!loginValue || !password) {
      errorBox.hidden = false;
      errorBox.textContent = 'Введите логин и пароль';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Проверка…';
    Auth.login(loginValue, password, rememberInput.checked).then(function (result) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Войти';
      if (!result.ok) {
        errorBox.hidden = false;
        errorBox.textContent = result.error;
        return;
      }
      AppState.session = result.session;
      const target = AppState.pendingLoginRedirect || '#/patients';
      AppState.pendingLoginRedirect = null;
      showToast('Вы вошли в рабочую область', { type: 'success' });
      window.location.hash = target;
      render();
    });
  });

  wrap.appendChild(card);
  app.appendChild(wrap);
  loginInput.focus();
}

/* ---------- Экран: список пациентов ---------- */

function getFilteredPatients() {
  const f = AppState.filters;
  const query = f.query.trim().toLowerCase();
  const queryDigits = query.replace(/\D/g, '');
  let list = AppState.patients.slice();

  if (f.skin !== 'all') {
    list = list.filter(function (p) { return p.skinType === f.skin; });
  }
  if (query) {
    list = list.filter(function (p) {
      const nameHit = p.fullName.toLowerCase().indexOf(query) >= 0;
      const phoneHit = queryDigits
        ? p.phone.replace(/\D/g, '').indexOf(queryDigits) >= 0
        : p.phone.toLowerCase().indexOf(query) >= 0;
      return nameHit || phoneHit;
    });
  }

  function lastVisit(p) {
    if (!p.visits.length) return '';
    return p.visits.map(function (v) { return v.date; }).sort().pop();
  }

  if (f.sort === 'name') {
    list.sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'ru'); });
  } else if (f.sort === 'visit') {
    list.sort(function (a, b) { return lastVisit(b).localeCompare(lastVisit(a)); });
  } else if (f.sort === 'added') {
    list.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  }
  return list;
}

function computeCounters() {
  const now = new Date();
  const monthPrefix = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const today = todayIso();
  let visitsThisMonth = 0;
  let upcoming = 0;
  AppState.patients.forEach(function (p) {
    p.visits.forEach(function (v) {
      if (v.isScheduled === true && v.date && v.date.indexOf(monthPrefix) === 0) visitsThisMonth++;
      if (v.isScheduled === true && v.date && v.date >= today) upcoming++;
    });
  });
  return {
    total: AppState.patients.length,
    visitsThisMonth: visitsThisMonth,
    upcoming: upcoming,
    monthName: MONTHS_RU[now.getMonth()]
  };
}

function openPatientModal(patient) {
  const isEdit = !!patient;
  const data = patient || {
    fullName: '', phone: '', birthDate: '', skinType: 'нормальная',
    allergies: '', notes: '', photoUrl: ''
  };

  const fields = {};

  function buildForm(body) {
    const form = el('form');
    form.noValidate = true;

    function addField(key, labelText, inputNode, errorText) {
      const wrap = el('div', 'field');
      const label = el('label', null, labelText);
      if (key === 'fullName' || key === 'phone') {
        const req = el('span', 'req', ' *');
        label.appendChild(req);
      }
      wrap.appendChild(label);
      wrap.appendChild(inputNode);
      const err = el('div', 'field-error', errorText || 'Проверьте поле');
      err.setAttribute('role', 'alert');
      wrap.appendChild(err);
      fields[key] = { wrap: wrap, input: inputNode, error: err };
      form.appendChild(wrap);
    }

    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = data.fullName;
    nameInput.setAttribute('aria-label', 'ФИО');
    addField('fullName', 'ФИО', nameInput, 'Введите имя не короче 2 символов');

    const phoneInput = el('input');
    phoneInput.type = 'tel';
    phoneInput.value = data.phone;
    phoneInput.placeholder = '+7 (999) 999-99-99';
    phoneInput.setAttribute('aria-label', 'Телефон');
    applyPhoneMask(phoneInput);
    addField('phone', 'Телефон', phoneInput, 'Введите номер полностью: +7 (999) 999-99-99');

    const birthInput = el('input');
    birthInput.type = 'date';
    birthInput.value = data.birthDate;
    birthInput.max = todayIso();
    birthInput.setAttribute('aria-label', 'Дата рождения');
    addField('birthDate', 'Дата рождения', birthInput, 'Дата рождения не может быть в будущем');

    const skinSelect = el('select');
    skinSelect.setAttribute('aria-label', 'Тип кожи');
    Store.SKIN_TYPES.forEach(function (type) {
      const opt = el('option', null, type);
      opt.value = type;
      if (type === data.skinType) opt.selected = true;
      skinSelect.appendChild(opt);
    });
    addField('skinType', 'Тип кожи', skinSelect);

    const allergyInput = el('textarea');
    allergyInput.value = data.allergies;
    allergyInput.setAttribute('aria-label', 'Аллергии и противопоказания');
    addField('allergies', 'Аллергии и противопоказания', allergyInput);

    const notesInput = el('textarea');
    notesInput.value = data.notes;
    notesInput.setAttribute('aria-label', 'Заметки');
    addField('notes', 'Заметки', notesInput);

    const photoInput = el('input');
    photoInput.type = 'url';
    photoInput.value = data.photoUrl;
    photoInput.placeholder = 'https://…';
    photoInput.setAttribute('aria-label', 'Ссылка на фото до и после');
    addField('photoUrl', 'Фото «до/после» (ссылка, необязательно)', photoInput, 'Укажите ссылку, начинающуюся с http:// или https://');

    body.appendChild(form);
  }

  function setError(key, message) {
    const f = fields[key];
    if (!f) return;
    f.wrap.classList.add('has-error');
    if (message) f.error.textContent = message;
  }

  function clearErrors() {
    Object.keys(fields).forEach(function (key) {
      fields[key].wrap.classList.remove('has-error');
    });
  }

  let modal = null;

  function submit() {
    clearErrors();
    let valid = true;

    const fullName = fields.fullName.input.value.trim();
    if (fullName.length < 2) {
      setError('fullName');
      valid = false;
    }

    const phone = fields.phone.input.value.trim();
    if (!PHONE_RE.test(phone)) {
      setError('phone');
      valid = false;
    } else {
      const digits = phone.replace(/\D/g, '');
      const duplicate = AppState.patients.some(function (p) {
        return p.id !== (patient && patient.id) && p.phone.replace(/\D/g, '') === digits;
      });
      if (duplicate) {
        setError('phone', 'Пациент с таким номером телефона уже добавлен');
        valid = false;
      }
    }

    const birthDate = fields.birthDate.input.value;
    if (birthDate && birthDate > todayIso()) {
      setError('birthDate');
      valid = false;
    }

    const photoUrl = fields.photoUrl.input.value.trim();
    if (photoUrl && !/^https?:\/\/.+/.test(photoUrl)) {
      setError('photoUrl');
      valid = false;
    }

    if (!valid) return;

    const record = {
      id: patient ? patient.id : Store.generateId('pat'),
      fullName: fullName,
      phone: phone,
      birthDate: birthDate,
      skinType: fields.skinType.input.value,
      allergies: fields.allergies.input.value.trim(),
      notes: fields.notes.input.value.trim(),
      photoUrl: photoUrl,
      createdAt: patient ? patient.createdAt : new Date().toISOString(),
      visits: patient ? patient.visits : []
    };
    Store.savePatient(record);
    loadPatients();
    modal.close();
    showToast(isEdit ? 'Карточка пациента обновлена' : 'Пациент добавлен', { type: 'success' });
    render();
    if (AppState.route.name === 'patient') {
      window.location.hash = '#/patients/' + record.id;
    }
  }

  modal = openModal({
    title: isEdit ? 'Редактировать пациента' : 'Добавить пациента',
    wide: true,
    buildBody: buildForm,
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
      { label: isEdit ? 'Сохранить' : 'Добавить', kind: 'primary', onClick: submit }
    ]
  });

  const form = modal.dialog.querySelector('form');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submit();
  });
  fields.fullName.input.setAttribute('data-autofocus', '');
  fields.fullName.input.focus();
}

function confirmDeletePatient(patient, onDeleted) {
  let modal = null;
  modal = openModal({
    title: 'Удалить пациента',
    buildBody: function (body) {
      const text = el('p', 'modal__text');
      text.appendChild(document.createTextNode('Вы собираетесь удалить карточку '));
      text.appendChild(el('strong', null, patient.fullName));
      text.appendChild(document.createTextNode('. История визитов будет удалена вместе с карточкой. Действие можно отменить сразу после удаления.'));
      body.appendChild(text);
    },
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
      {
        label: 'Удалить',
        kind: 'danger',
        onClick: function () {
          modal.close();
          onDeleted();
        }
      }
    ]
  });
}

function deletePatientFlow(patient) {
  confirmDeletePatient(patient, function () {
    AppState.lastDeleted = Store.deletePatient(patient.id);
    loadPatients();
    if (AppState.route.name === 'patient') {
      window.location.hash = '#/patients';
    } else {
      render();
    }
    clearTimeout(AppState.undoTimer);
    showToast('Пациент удалён', {
      actionLabel: 'Отменить',
      onAction: function () {
        if (AppState.lastDeleted) {
          Store.savePatient(AppState.lastDeleted);
          AppState.lastDeleted = null;
          loadPatients();
          render();
          showToast('Карточка восстановлена', { type: 'success' });
        }
      }
    });
    AppState.undoTimer = setTimeout(function () { AppState.lastDeleted = null; }, 10000);
  });
}

function renderPatients(app) {
  const counters = computeCounters();

  const head = el('div', 'workspace__head container');
  const headText = el('div');
  headText.appendChild(el('h1', null, 'Пациенты'));
  const roleName = Auth.isAdmin(AppState.session) ? 'Администратор' : 'Косметолог';
  headText.appendChild(el('p', 'workspace__sub',
    'Учёт пациентов и история визитов. Вошли как ' + AppState.session.login + ' (' + roleName + ').'));
  head.appendChild(headText);

  const headActions = el('div', 'workspace__actions');
  const exportBtn = el('button', 'btn btn--ghost btn--sm', 'Экспорт данных');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', exportData);
  const importBtn = el('button', 'btn btn--ghost btn--sm', 'Импорт');
  importBtn.type = 'button';
  importBtn.addEventListener('click', importData);
  const addBtn = el('button', 'btn btn--primary btn--sm', 'Добавить пациента');
  addBtn.type = 'button';
  addBtn.appendChild(icon('plus', 18));
  addBtn.addEventListener('click', function () { openPatientModal(null); });
  headActions.appendChild(exportBtn);
  headActions.appendChild(importBtn);
  if (Auth.isAdmin(AppState.session)) {
    const settingsBtn = el('a', 'btn btn--outline btn--sm', 'Настройки сайта');
    settingsBtn.href = '#/settings';
    headActions.appendChild(settingsBtn);
    const dbBtn = el('a', 'btn btn--outline btn--sm', 'База препаратов');
    dbBtn.href = '#/products-db';
    headActions.appendChild(dbBtn);
  }
  headActions.appendChild(addBtn);
  head.appendChild(headActions);
  app.appendChild(head);

  /* Окно «Запланированные визиты» — все предстоящие записи по пациентам */
  const today = todayIso();
  const upcomingVisits = [];
  AppState.patients.forEach(function (p) {
    (p.visits || []).forEach(function (v) {
      if (v.isScheduled === true && v.date >= today) {
        upcomingVisits.push({ patient: p, visit: v });
      }
    });
  });
  upcomingVisits.sort(function (a, b) { return a.visit.date.localeCompare(b.visit.date); });

  const upcomingBlock = el('section', 'card-block container');
  upcomingBlock.appendChild(el('h2', null,
    'Запланированные визиты (' + upcomingVisits.length + ')'));
  if (!upcomingVisits.length) {
    upcomingBlock.appendChild(el('p', 'muted-text', 'Предстоящих записей нет.'));
  } else {
    const upTable = el('table', 'patients-table');
    upTable.setAttribute('aria-label', 'Запланированные визиты');
    const upThead = document.createElement('thead');
    const upHeadRow = document.createElement('tr');
    ['Дата', 'Пациент', 'Процедура', 'Действия'].forEach(function (h) {
      upHeadRow.appendChild(el('th', null, h));
    });
    upThead.appendChild(upHeadRow);
    upTable.appendChild(upThead);
    const upTbody = document.createElement('tbody');
    upcomingVisits.forEach(function (item) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', null, formatDateRu(item.visit.date)));
      const nameTd = el('td', 'cell-name');
      const nameLink = el('a', null, item.patient.fullName);
      nameLink.href = '#/patients/' + item.patient.id;
      nameTd.appendChild(nameLink);
      tr.appendChild(nameTd);
      tr.appendChild(el('td', null, item.visit.procedure || '—'));
      const actTd = el('td', 'cell-actions');
      const cancelLink = el('button', 'btn btn--danger btn--sm', 'Отменить');
      cancelLink.type = 'button';
      cancelLink.addEventListener('click', function () {
        Store.updateVisitStatus(item.visit.id, false);
        loadPatients();
        render();
        showToast('Запись отменена', { type: 'warning' });
      });
      actTd.appendChild(cancelLink);
      tr.appendChild(actTd);
      upTbody.appendChild(tr);
    });
    upTable.appendChild(upTbody);
    const upScroll = el('div', 'table-scroll');
    upScroll.appendChild(upTable);
    upcomingBlock.appendChild(upScroll);
  }
  app.appendChild(upcomingBlock);

  const countersGrid = el('div', 'container counters');
  [
    [counters.total, pluralRu(counters.total, 'пациент', 'пациента', 'пациентов') + ' в базе'],
    [counters.visitsThisMonth, pluralRu(counters.visitsThisMonth, 'визит', 'визита', 'визитов') + ' за ' + counters.monthName],
    [counters.upcoming, pluralRu(counters.upcoming, 'запись впереди', 'записи впереди', 'записей впереди')]
  ].forEach(function (item) {
    const counter = el('div', 'counter');
    counter.appendChild(el('span', 'counter__value', item[0]));
    counter.appendChild(el('span', 'counter__label', item[1]));
    countersGrid.appendChild(counter);
  });
  app.appendChild(countersGrid);

  const toolbar = el('div', 'container toolbar');
  const searchWrap = el('div', 'toolbar__search');
  searchWrap.appendChild(icon('search', 18));
  const searchInput = el('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Поиск по имени или телефону';
  searchInput.setAttribute('aria-label', 'Поиск по имени или телефону');
  searchInput.value = AppState.filters.query;
  searchWrap.appendChild(searchInput);
  toolbar.appendChild(searchWrap);

  const sortSelect = el('select');
  sortSelect.setAttribute('aria-label', 'Сортировка списка');
  [
    ['name', 'По имени'],
    ['visit', 'По дате последнего визита'],
    ['added', 'По дате добавления']
  ].forEach(function (opt) {
    const o = el('option', null, opt[1]);
    o.value = opt[0];
    if (AppState.filters.sort === opt[0]) o.selected = true;
    sortSelect.appendChild(o);
  });
  toolbar.appendChild(sortSelect);

  const skinSelect = el('select');
  skinSelect.setAttribute('aria-label', 'Фильтр по типу кожи');
  const allOpt = el('option', null, 'Все типы кожи');
  allOpt.value = 'all';
  if (AppState.filters.skin === 'all') allOpt.selected = true;
  skinSelect.appendChild(allOpt);
  Store.SKIN_TYPES.forEach(function (type) {
    const o = el('option', null, type);
    o.value = type;
    if (AppState.filters.skin === type) o.selected = true;
    skinSelect.appendChild(o);
  });
  toolbar.appendChild(skinSelect);
  app.appendChild(toolbar);

  const results = el('div', 'container');
  app.appendChild(results);

  function renderResults() {
    clearNode(results);
    const list = getFilteredPatients();
    const visible = list.slice(0, AppState.filters.visible);
    const query = AppState.filters.query.trim();

    if (!AppState.patients.length) {
      const empty = el('div', 'panel empty');
      const iconWrap = el('span', 'empty__icon');
      iconWrap.appendChild(icon('plus', 28));
      empty.appendChild(iconWrap);
      empty.appendChild(el('h2', null, 'Пока нет ни одного пациента'));
      empty.appendChild(el('p', null, 'Добавьте первого пациента — карточка появится в этом списке.'));
      const btn = el('button', 'btn btn--primary', 'Добавить пациента');
      btn.type = 'button';
      btn.appendChild(icon('plus', 18));
      btn.addEventListener('click', function () { openPatientModal(null); });
      empty.appendChild(btn);
      results.appendChild(empty);
      return;
    }

    if (!list.length) {
      const empty = el('div', 'panel empty');
      empty.appendChild(el('h2', null, 'Ничего не найдено'));
      empty.appendChild(el('p', null, 'Попробуйте изменить запрос, сортировку или фильтр по типу кожи.'));
      const resetBtn = el('button', 'btn btn--outline', 'Сбросить фильтры');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', function () {
        AppState.filters.query = '';
        AppState.filters.skin = 'all';
        AppState.filters.sort = 'name';
        AppState.filters.visible = PAGE_SIZE;
        render();
      });
      empty.appendChild(resetBtn);
      results.appendChild(empty);
      return;
    }

    /* Таблица для десктопа */
    const panel = el('div', 'panel');
    const scroll = el('div', 'table-scroll');
    const table = el('table', 'patients-table');
    table.setAttribute('aria-label', 'Список пациентов');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['ФИО', 'Телефон', 'Возраст', 'Тип кожи', 'Последний визит', 'Действия'].forEach(function (h) {
      headRow.appendChild(el('th', null, h));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    visible.forEach(function (p) {
      const tr = document.createElement('tr');
      const nameTd = el('td', 'cell-name');
      highlightText(nameTd, p.fullName, query);
      tr.appendChild(nameTd);
      const phoneTd = el('td');
      highlightText(phoneTd, p.phone, query);
      tr.appendChild(phoneTd);
      const age = calcAge(p.birthDate);
      tr.appendChild(el('td', null, age === null ? '—' : age + ' ' + pluralRu(age, 'год', 'года', 'лет')));
      tr.appendChild(el('td', null, p.skinType));
      const visits = p.visits.map(function (v) { return v.date; }).sort();
      tr.appendChild(el('td', null, visits.length ? formatDateShort(visits[visits.length - 1]) : '—'));
      const actionsTd = el('td', 'cell-actions');
      const rowActions = el('span', 'row-actions');
      const openBtn = el('button', 'btn btn--outline btn--sm', 'Открыть');
      openBtn.type = 'button';
      openBtn.appendChild(icon('arrow-right', 16));
      openBtn.addEventListener('click', function () {
        window.location.hash = '#/patients/' + p.id;
      });
      const delBtn = el('button', 'btn btn--danger btn--sm', 'Удалить');
      delBtn.type = 'button';
      delBtn.appendChild(icon('trash', 16));
      delBtn.addEventListener('click', function () { deletePatientFlow(p); });
      rowActions.appendChild(openBtn);
      rowActions.appendChild(delBtn);
      actionsTd.appendChild(rowActions);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);

    /* Карточки для мобильных */
    const cardsWrap = el('div', 'patient-cards');
    visible.forEach(function (p) {
      const card = el('article', 'patient-card');
      const name = el('div', 'patient-card__name');
      highlightText(name, p.fullName, query);
      card.appendChild(name);
      const rows = el('dl', 'patient-card__rows');
      const age = calcAge(p.birthDate);
      [
        ['Телефон', p.phone],
        ['Возраст', age === null ? '—' : age + ' ' + pluralRu(age, 'год', 'года', 'лет')],
        ['Тип кожи', p.skinType],
        ['Последний визит', p.visits.length ? formatDateShort(p.visits.map(function (v) { return v.date; }).sort().pop()) : '—']
      ].forEach(function (row) {
        const div = el('div');
        div.appendChild(el('dt', null, row[0]));
        div.appendChild(el('dd', null, row[1]));
        rows.appendChild(div);
      });
      card.appendChild(rows);
      const actions = el('div', 'patient-card__actions');
      const openBtn = el('button', 'btn btn--outline btn--sm', 'Открыть');
      openBtn.type = 'button';
      openBtn.appendChild(icon('arrow-right', 16));
      openBtn.addEventListener('click', function () {
        window.location.hash = '#/patients/' + p.id;
      });
      const delBtn = el('button', 'btn btn--danger btn--sm', 'Удалить');
      delBtn.type = 'button';
      delBtn.appendChild(icon('trash', 16));
      delBtn.addEventListener('click', function () { deletePatientFlow(p); });
      actions.appendChild(openBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);
      cardsWrap.appendChild(card);
    });
    panel.appendChild(cardsWrap);
    results.appendChild(panel);

    if (list.length > AppState.filters.visible) {
      const loadMore = el('div', 'load-more');
      const btn = el('button', 'btn btn--ghost', 'Показать ещё (' + (list.length - AppState.filters.visible) + ')');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        AppState.filters.visible += PAGE_SIZE;
        renderResults();
      });
      loadMore.appendChild(btn);
      results.appendChild(loadMore);
    }
  }

  renderResults();

  searchInput.addEventListener('input', debounce(function () {
    AppState.filters.query = searchInput.value;
    AppState.filters.visible = PAGE_SIZE;
    renderResults();
  }, 150));

  sortSelect.addEventListener('change', function () {
    AppState.filters.sort = sortSelect.value;
    AppState.filters.visible = PAGE_SIZE;
    renderResults();
  });

  skinSelect.addEventListener('change', function () {
    AppState.filters.skin = skinSelect.value;
    AppState.filters.visible = PAGE_SIZE;
    renderResults();
  });
}

/* ---------- Экран: карточка пациента ---------- */

function renderPatientCard(app, id) {
  const patient = Store.getPatient(id);
  if (!patient) {
    const wrap = el('div', 'container section');
    wrap.appendChild(el('h1', null, 'Пациент не найден'));
    wrap.appendChild(el('p', 'section__lead', 'Возможно, карточка была удалена. Вернитесь к списку.'));
    const back = el('a', 'btn btn--outline', 'Назад к списку');
    back.href = '#/patients';
    wrap.appendChild(back);
    app.appendChild(wrap);
    return;
  }

  const wrap = el('div', 'container');

  const back = el('a', 'link-back', 'Назад к списку');
  back.href = '#/patients';
  wrap.appendChild(back);

  const head = el('div', 'patient-head');
  const headText = el('div');
  headText.appendChild(el('h1', null, patient.fullName));
  const badges = el('div', 'badges');
  badges.appendChild(el('span', 'badge', patient.skinType));
  const age = calcAge(patient.birthDate);
  if (age !== null) badges.appendChild(el('span', 'badge badge--muted', age + ' ' + pluralRu(age, 'год', 'года', 'лет')));
  const visits = patient.visits.map(function (v) { return v.date; }).sort();
  if (visits.length) {
    badges.appendChild(el('span', 'badge badge--gold', 'визитов: ' + patient.visits.length));
  }
  headText.appendChild(badges);
  head.appendChild(headText);

  const headActions = el('div', 'patient-head__actions');
  const editBtn = el('button', 'btn btn--outline btn--sm', 'Редактировать');
  editBtn.type = 'button';
  editBtn.appendChild(icon('pencil', 16));
  editBtn.addEventListener('click', function () { openPatientModal(patient); });
  const delBtn = el('button', 'btn btn--danger btn--sm', 'Удалить');
  delBtn.type = 'button';
  delBtn.appendChild(icon('trash', 16));
  delBtn.addEventListener('click', function () { deletePatientFlow(patient); });
  headActions.appendChild(editBtn);
  headActions.appendChild(delBtn);
  head.appendChild(headActions);
  wrap.appendChild(head);

  const grid = el('div', 'detail-grid');

  /* Левая колонка */
  const leftCol = el('div', 'detail-col');

  const contactsBlock = el('section', 'card-block');
  contactsBlock.appendChild(el('h2', null, 'Контакты'));
  const contactsDl = el('dl');
  const phoneRow = el('div');
  phoneRow.appendChild(el('dt', null, 'Телефон'));
  const phoneDd = el('dd');
  const phoneLink = el('a', null, patient.phone);
  phoneLink.href = 'tel:' + patient.phone.replace(/[\s()]/g, '');
  phoneDd.appendChild(phoneLink);
  phoneRow.appendChild(phoneDd);
  contactsDl.appendChild(phoneRow);
  const birthRow = el('div');
  birthRow.appendChild(el('dt', null, 'Дата рождения'));
  birthRow.appendChild(el('dd', null, patient.birthDate ? formatDateRu(patient.birthDate) : '—'));
  contactsDl.appendChild(birthRow);
  const createdRow = el('div');
  createdRow.appendChild(el('dt', null, 'В базе с'));
  createdRow.appendChild(el('dd', null, formatDateRu(patient.createdAt.slice(0, 10))));
  contactsDl.appendChild(createdRow);
  contactsBlock.appendChild(contactsDl);
  leftCol.appendChild(contactsBlock);

  const allergyBlock = el('section', 'card-block' + (patient.allergies ? ' card-block--alert' : ''));
  allergyBlock.appendChild(el('h2', null, 'Аллергии и противопоказания'));
  allergyBlock.appendChild(el('p', 'muted-text', patient.allergies || 'Не указаны. Уточните при следующем визите.'));
  leftCol.appendChild(allergyBlock);

  const notesBlock = el('section', 'card-block');
  notesBlock.appendChild(el('h2', null, 'Заметки'));
  notesBlock.appendChild(el('p', 'muted-text', patient.notes || 'Заметок пока нет.'));
  leftCol.appendChild(notesBlock);

  if (patient.photoUrl) {
    const photoBlock = el('section', 'card-block');
    photoBlock.appendChild(el('h2', null, 'Фото «до/после»'));
    const img = document.createElement('img');
    img.src = patient.photoUrl;
    img.alt = 'Фотография по ссылке из карточки пациента';
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.setAttribute('onerror', '__imgFallback(this)');
    img.style.borderRadius = '10px';
    img.style.border = '1px solid var(--line)';
    photoBlock.appendChild(img);
    leftCol.appendChild(photoBlock);
  }

  /* Правая колонка: запланированные визиты, форма добавления, история */
  const rightCol = el('div', 'detail-col');
  const today = todayIso();

  /* --- Запланированные визиты пациента --- */
  const scheduledBlock = el('section', 'card-block');
  scheduledBlock.appendChild(el('h2', null, 'Запланированные визиты'));

  function renderScheduled() {
    const old = scheduledBlock.querySelector('.table-scroll');
    if (old) old.remove();
    const oldEmpty = scheduledBlock.querySelector('.visits-empty');
    if (oldEmpty) oldEmpty.remove();

    const upcoming = patient.visits
      .filter(function (v) { return v.isScheduled === true && v.date >= today; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });

    if (!upcoming.length) {
      const p = el('p', 'Нет предстоящих записей. Добавьте запланированный визит формой ниже — отметьте «Запланировать визит».');
      p.className = 'muted-text visits-empty';
      scheduledBlock.appendChild(p);
      return;
    }

    const scroll = el('div', 'table-scroll');
    const table = el('table', 'visits-table');
    table.setAttribute('aria-label', 'Запланированные визиты');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Дата', 'Процедура', 'Комментарий', 'Действия'].forEach(function (h) {
      trh.appendChild(el('th', null, h));
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    upcoming.forEach(function (v) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', null, formatDateRu(v.date)));
      tr.appendChild(el('td', null, v.procedure || '—'));
      tr.appendChild(el('td', null, v.comment || '—'));
      const actTd = el('td');
      const actWrap = el('div', 'visit-actions');
      const cancelBtn = el('button', 'btn btn--danger btn--sm icon-btn', 'Отменить');
      cancelBtn.type = 'button';
      cancelBtn.setAttribute('aria-label', 'Отменить запись');
      cancelBtn.addEventListener('click', function () {
        Store.updateVisitStatus(v.id, false);
        loadPatients();
        render();
        showToast('Запись отменена', { type: 'warning' });
      });
      const editBtn = el('button', 'btn btn--primary btn--sm icon-btn', 'Редактировать');
      editBtn.type = 'button';
      editBtn.setAttribute('aria-label', 'Редактировать запись');
      editBtn.addEventListener('click', function () {
        openEditVisitModal(v, patient.id);
      });
      actWrap.appendChild(editBtn);
      actWrap.appendChild(cancelBtn);
      actTd.appendChild(actWrap);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    scheduledBlock.appendChild(scroll);
  }
  renderScheduled();
  rightCol.appendChild(scheduledBlock);

  /* --- Форма добавления записи --- */
  const visitFormWrap = el('section', 'card-block');
  visitFormWrap.appendChild(el('h2', null, 'Добавить запись о визите'));
  const vForm = el('form');
  vForm.noValidate = true;
  const vRow = el('div', 'visit-form__row');

  function visitField(cls, labelText, inputNode, errorText) {
    const wrap = el('div', 'field ' + cls);
    wrap.appendChild(el('label', null, labelText));
    wrap.appendChild(inputNode);
    const err = el('div', 'field-error', errorText);
    err.setAttribute('role', 'alert');
    wrap.appendChild(err);
    vRow.appendChild(wrap);
    return wrap;
  }

  const vDate = el('input');
  vDate.type = 'date';
  vDate.setAttribute('aria-label', 'Дата визита');
  const dateWrap = visitField('visit-form__date', 'Дата *', vDate, 'Укажите дату визита');

  const vProc = el('input');
  vProc.type = 'text';
  vProc.placeholder = 'Например: чистка лица';
  vProc.setAttribute('aria-label', 'Процедура');
  const procWrap = visitField('visit-form__procedure', 'Процедура *', vProc, 'Укажите название процедуры');

  const vProd = el('input');
  vProd.type = 'text';
  vProd.placeholder = 'Препарат, состав';
  vProd.setAttribute('aria-label', 'Препарат');
  visitField('visit-form__product', 'Препарат', vProd, '');

  const vComment = el('textarea');
  vComment.placeholder = 'Реакция кожи, рекомендации';
  vComment.setAttribute('aria-label', 'Комментарий');
  visitField('visit-form__comment', 'Комментарий', vComment, '');

  const vSteps = el('textarea');
  vSteps.placeholder = '1. Очищение кожи… 2. Пилинг… 3. Маска…';
  vSteps.setAttribute('aria-label', 'Последовательность действий');
  visitField('visit-form__steps', 'Последовательность действий', vSteps, '');

  const vScheduled = el('input');
  vScheduled.type = 'checkbox';
  const scheduledWrap = el('div', 'field visit-form__scheduled');
  const scheduledLabel = el('label', 'checkbox');
  scheduledLabel.appendChild(vScheduled);
  scheduledLabel.appendChild(document.createTextNode(' Запланировать визит (будущая дата)'));
  scheduledWrap.appendChild(scheduledLabel);
  vRow.appendChild(scheduledWrap);

  vForm.appendChild(vRow);
  const vSubmit = el('button', 'btn btn--primary btn--sm', 'Добавить запись');
  vSubmit.type = 'submit';
  vSubmit.appendChild(icon('plus', 16));
  vForm.appendChild(vSubmit);
  visitFormWrap.appendChild(vForm);
  rightCol.appendChild(visitFormWrap);

  vForm.addEventListener('submit', function (event) {
    event.preventDefault();
    dateWrap.classList.remove('has-error');
    procWrap.classList.remove('has-error');
    let valid = true;
    if (!vDate.value) {
      dateWrap.classList.add('has-error');
      valid = false;
    }
    if (!vProc.value.trim()) {
      procWrap.classList.add('has-error');
      valid = false;
    }
    if (!valid) return;
    patient.visits.push({
      id: Store.generateId('vis'),
      date: vDate.value,
      procedure: vProc.value.trim(),
      product: vProd.value.trim(),
      comment: vComment.value.trim(),
      steps: vSteps.value.trim(),
      isScheduled: vScheduled.checked
    });
    Store.savePatient(patient);
    loadPatients();
    vForm.reset();
    render();
    showToast('Запись о визите добавлена', { type: 'success' });
  });

  /* --- История визитов (внизу): фильтры неделя/месяц/год --- */
  const visitsBlock = el('section', 'card-block');
  visitsBlock.appendChild(el('h2', null, 'История визитов'));

  /* Фильтр периода: all | week | month | year */
  if (typeof AppState.filters.historyPeriod === 'undefined') {
    AppState.filters.historyPeriod = 'all';
  }

  function periodStart(period) {
    const d = new Date();
    if (period === 'week') {
      d.setDate(d.getDate() - 7);
    } else if (period === 'month') {
      d.setMonth(d.getMonth() - 1);
    } else if (period === 'year') {
      d.setFullYear(d.getFullYear() - 1);
    } else {
      return null;
    }
    return d.toISOString().split('T')[0];
  }

  function visitStatus(v) {
    if (v.isScheduled === true && v.date >= today) return 'Запланирован';
    if (v.isScheduled === false && v.date >= today) return 'Отменён';
    return 'Прошёл';
  }

  function renderVisits() {
    const oldScroll = visitsBlock.querySelector('.table-scroll');
    if (oldScroll) oldScroll.remove();
    const oldEmpty = visitsBlock.querySelector('.visits-empty');
    if (oldEmpty) oldEmpty.remove();
    const oldFilters = visitsBlock.querySelector('.visits-filters');
    if (oldFilters) oldFilters.remove();

    /* История: прошедшие и отменённые визиты (запланированные будущие не дублируем) */
    let list = patient.visits.filter(function (v) {
      return !(v.isScheduled === true && v.date >= today);
    });
    const period = AppState.filters.historyPeriod;
    const from = periodStart(period);
    if (from) {
      list = list.filter(function (v) { return v.date >= from; });
    }
    list = list.sort(function (a, b) { return b.date.localeCompare(a.date); });

    /* Кнопки фильтров периода */
    const filtersWrap = el('div', 'visits-filters');
    [['all', 'Все'], ['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год']].forEach(function (item) {
      const b = el('button', 'btn btn--sm visits-filters__btn' + (period === item[0] ? ' btn--primary' : ' btn--outline'), item[1]);
      b.type = 'button';
      b.setAttribute('aria-label', 'Показать визиты за ' + item[1].toLowerCase());
      b.addEventListener('click', function () {
        AppState.filters.historyPeriod = item[0];
        renderVisits();
      });
      filtersWrap.appendChild(b);
    });
    visitsBlock.appendChild(filtersWrap);

    if (!list.length) {
      const p = el('p', 'За выбранный период записей нет.');
      p.className = 'muted-text visits-empty';
      visitsBlock.appendChild(p);
      return;
    }

    const scroll = el('div', 'table-scroll');
    const table = el('table', 'visits-table');
    table.setAttribute('aria-label', 'История визитов');
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    ['Дата', 'Процедура', 'Статус', 'Действия'].forEach(function (h) {
      trh.appendChild(el('th', null, h));
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    list.forEach(function (v) {
      const tr = document.createElement('tr');
      tr.appendChild(el('td', null, formatDateRu(v.date)));
      tr.appendChild(el('td', null, v.procedure || '—'));
      tr.appendChild(el('td', null, visitStatus(v)));

      const actTd = el('td');
      const actWrap = el('div', 'visit-actions');
      const openBtn = el('button', 'btn btn--outline btn--sm icon-btn', 'Открыть');
      openBtn.type = 'button';
      openBtn.setAttribute('aria-label', 'Открыть визит');
      openBtn.addEventListener('click', function () {
        openVisitDetailModal(v, patient.id);
      });
      const delBtn = el('button', 'btn btn--danger btn--sm icon-btn', 'Удалить');
      delBtn.type = 'button';
      delBtn.setAttribute('aria-label', 'Удалить визит из истории');
      delBtn.addEventListener('click', function () {
        let modal = null;
        modal = openModal({
          title: 'Точно удалить визит?',
          buildBody: function (body) {
            const text = el('p', 'modal__text');
            text.appendChild(document.createTextNode('Визит «'));
            text.appendChild(el('strong', null, v.procedure || '—'));
            text.appendChild(document.createTextNode('» от ' + formatDateRu(v.date) +
              ' будет удалён из истории без возможности восстановления. Вы уверены?'));
            body.appendChild(text);
          },
          actions: [
            { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
            {
              label: 'Да, удалить',
              kind: 'danger',
              onClick: function () {
                Store.deleteVisit(patient.id, v.id);
                modal.close();
                loadPatients();
                render();
                showToast('Визит удалён из истории', { type: 'warning' });
              }
            }
          ]
        });
      });
      actWrap.appendChild(openBtn);
      actWrap.appendChild(delBtn);
      actTd.appendChild(actWrap);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    visitsBlock.appendChild(scroll);
  }
  renderVisits();
  rightCol.appendChild(visitsBlock);

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  wrap.appendChild(grid);
  wrap.style.paddingBottom = '3rem';
  app.appendChild(wrap);
}

/* ---------- Модальное окно редактирования визита ---------- */

function openEditVisitModal(visit, patientId) {
  let modal = null;

  const dateInput = el('input');
  dateInput.type = 'date';
  dateInput.value = visit.date || '';
  dateInput.setAttribute('aria-label', 'Дата визита');

  const procInput = el('input');
  procInput.type = 'text';
  procInput.value = visit.procedure || '';
  procInput.placeholder = 'Например: чистка лица';
  procInput.setAttribute('aria-label', 'Процедура');

  const prodInput = el('input');
  prodInput.type = 'text';
  prodInput.value = visit.product || '';
  prodInput.setAttribute('aria-label', 'Препарат');

  const commentInput = el('textarea');
  commentInput.rows = 3;
  commentInput.value = visit.comment || '';
  commentInput.setAttribute('aria-label', 'Комментарий');

  const stepsInput = el('textarea');
  stepsInput.rows = 5;
  stepsInput.value = visit.steps || '';
  stepsInput.placeholder = '1. Очищение кожи…\n2. Пилинг…\n3. Маска…';
  stepsInput.setAttribute('aria-label', 'Последовательность действий');

  const scheduledCheck = el('input');
  scheduledCheck.type = 'checkbox';
  scheduledCheck.checked = visit.isScheduled === true;
  const scheduledLabel = el('label', 'checkbox');
  scheduledLabel.appendChild(scheduledCheck);
  scheduledLabel.appendChild(document.createTextNode(' Запланированный визит'));

  function buildBody(body) {
    function addField(labelText, node) {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', null, labelText));
      wrap.appendChild(node);
      body.appendChild(wrap);
    }
    addField('Дата *', dateInput);
    addField('Процедура *', procInput);
    addField('Препарат/продукт', prodInput);
    addField('Комментарий', commentInput);
    addField('Последовательность действий', stepsInput);
    body.appendChild(scheduledLabel);
    body.appendChild(el('p', 'muted-text',
      'Отметка «Запланированный визит» переносит запись в список предстоящих. Снимите отметку, если визит отменён или уже прошёл.'));
  }

  function submit() {
    const date = dateInput.value;
    const procedure = procInput.value.trim();
    if (!date) {
      showToast('Укажите дату визита');
      dateInput.focus();
      return;
    }
    if (!procedure) {
      showToast('Укажите название процедуры');
      procInput.focus();
      return;
    }
    const patient = Store.getPatient(patientId);
    if (!patient) {
      modal.close();
      return;
    }
    const target = (patient.visits || []).find(function (v) { return v.id === visit.id; });
    if (!target) {
      modal.close();
      return;
    }
    target.date = date;
    target.procedure = procedure;
    target.product = prodInput.value.trim();
    target.comment = commentInput.value.trim();
    target.steps = stepsInput.value.trim();
    target.isScheduled = scheduledCheck.checked;
    Store.savePatient(patient);
    loadPatients();
    modal.close();
    render();
    showToast('Запись о визите обновлена', { type: 'success' });
  }

  modal = openModal({
    title: 'Редактировать визит',
    buildBody: buildBody,
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
      { label: 'Сохранить', kind: 'primary', onClick: submit }
    ]
  });
  procInput.setAttribute('data-autofocus', '');
  procInput.focus();
}

/* ---------- Детальный просмотр визита ---------- */

function openVisitDetailModal(visit, patientId) {
  let modal = null;

  const patient = Store.getPatient(patientId);
  const patientName = patient ? patient.fullName : '—';

  function infoRow(label, value) {
    const row = el('div', 'detail-info__row');
    row.appendChild(el('dt', null, label));
    row.appendChild(el('dd', null, value || '—'));
    return row;
  }

  function buildBody(body) {
    const today = todayIso();
    let status = 'Прошёл';
    if (visit.isScheduled === true && visit.date >= today) status = 'Запланирован';
    else if (visit.isScheduled === false && visit.date >= today) status = 'Отменён';

    const dl = el('dl', 'detail-info');
    dl.appendChild(infoRow('Пациент', patientName));
    dl.appendChild(infoRow('Дата', formatDateRu(visit.date)));
    dl.appendChild(infoRow('Процедура', visit.procedure));
    dl.appendChild(infoRow('Препарат/продукт', visit.product));
    dl.appendChild(infoRow('Комментарий', visit.comment));
    dl.appendChild(infoRow('Статус', status));
    body.appendChild(dl);

    body.appendChild(el('h3', 'detail-info__heading', 'Последовательность действий косметолога'));
    if (visit.steps) {
      const stepsList = el('ol', 'visit-steps');
      visit.steps.split('\n').forEach(function (line) {
        const trimmed = line.trim();
        if (trimmed) stepsList.appendChild(el('li', null, trimmed));
      });
      body.appendChild(stepsList);
    } else {
      body.appendChild(el('p', 'muted-text',
        'Последовательность действий не записана. Нажмите «Редактировать», чтобы добавить протокол процедуры.'));
    }
  }

  modal = openModal({
    title: 'Визит · подробно',
    buildBody: buildBody,
    actions: [
      { label: 'Закрыть', kind: 'ghost', onClick: function () { modal.close(); } },
      {
        label: 'Редактировать',
        kind: 'primary',
        onClick: function () {
          modal.close();
          openEditVisitModal(visit, patientId);
        }
      }
    ]
  });
}


/* ---------- База препаратов ---------- */

function renderProductsDatabase(app) {
  const products = StoreProducts.loadProducts();

  /* Заголовок */
  const headWrap = el('div', 'workspace__head container');
  const hText = el('div');
  hText.appendChild(el('h1', null, 'База препаратов и продуктов'));
  hText.appendChild(el('p', 'workspace__sub', 'Управление препаратами, кремами, сыворотками и методиками.'));
  headWrap.appendChild(hText);

  const hActions = el('div', 'workspace__actions');
  const addBtn = el('button', 'btn btn--primary btn--sm', 'Добавить препарат');
  addBtn.type = 'button';
  addBtn.appendChild(icon('plus', 16));
  addBtn.addEventListener('click', function () {
    openAddProductModal();
  });
  hActions.appendChild(addBtn);

  const exportBtn = el('button', 'btn btn--outline btn--sm', 'Экспорт JSON');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', function () {
    const blob = new Blob([StoreProducts.exportProducts()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'products-db.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  });
  hActions.appendChild(exportBtn);

  const resetBtn = el('button', 'btn btn--danger btn--sm', 'Сбросить к демо');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', function () {
    let modal = null;
    modal = openModal({
      title: 'Сбросить базу препаратов?',
      buildBody: function (body) {
        body.appendChild(el('p', 'modal__text',
          'Текущие данные будут заменены демонстрационным списком препаратов. Продолжить?'));
      },
      actions: [
        { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
        {
          label: 'Заменить',
          kind: 'danger',
          onClick: function () {
            StoreProducts.setProductsToStorage(JSON.parse(JSON.stringify(StoreProducts.DEFAULT_PRODUCTS)));
            modal.close();
            render();
            showToast('База перезапущена с демо-данными', { type: 'warning' });
          }
        }
      ]
    });
  });
  hActions.appendChild(resetBtn);

  const backBtn = el('a', 'btn btn--ghost btn--sm', 'К списку пациентов');
  backBtn.href = '#/patients';
  hActions.appendChild(backBtn);
  headWrap.appendChild(hActions);
  app.appendChild(headWrap);

  /* Статистика */
  const byCategory = {};
  products.forEach(function (p) {
    const cat = p.category || '—';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });

  const statsWrap = el('div', 'container counters');
  const statTotal = el('div', 'counter');
  statTotal.appendChild(el('span', 'counter__value', products.length));
  statTotal.appendChild(el('span', 'counter__label', pluralRu(products.length, 'препарат', 'препарата', 'препаратов') + ' в базе'));
  statsWrap.appendChild(statTotal);
  Object.keys(byCategory).forEach(function (cat) {
    const c = el('div', 'counter');
    c.appendChild(el('span', 'counter__value', byCategory[cat]));
    c.appendChild(el('span', 'counter__label', cat));
    statsWrap.appendChild(c);
  });
  app.appendChild(statsWrap);

  /* Таблица */
  const content = el('div', 'container');
  const tableBlock = el('section', 'card-block');
  tableBlock.appendChild(el('h2', null, 'Список препаратов и продуктов'));

  const scroll = el('div', 'table-scroll');
  const table = el('table', 'patients-table');
  table.setAttribute('aria-label', 'Список препаратов');
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  ['Название', 'Категория', 'Описание', 'Цена, ₽', 'Действия'].forEach(function (h) {
    trHead.appendChild(el('th', null, h));
  });
  thead.appendChild(trHead);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  products.forEach(function (product) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', 'cell-name', product.name || '—'));
    tr.appendChild(el('td', null, product.category || '—'));
    const descTd = el('td', null, product.description || '—');
    descTd.title = product.description || '';
    tr.appendChild(descTd);
    tr.appendChild(el('td', null, (product.price || 0).toLocaleString('ru-RU')));

    const actionsTd = el('td', 'cell-actions');
    const rowActions = el('span', 'row-actions');

    const editBtn = el('button', 'btn btn--outline btn--sm', 'Изменить');
    editBtn.type = 'button';
    editBtn.appendChild(icon('pencil', 16));
    editBtn.addEventListener('click', function () {
      openEditProductModal(product);
    });
    rowActions.appendChild(editBtn);

    const delBtn = el('button', 'btn btn--danger btn--sm', 'Удалить');
    delBtn.type = 'button';
    delBtn.appendChild(icon('trash', 16));
    delBtn.addEventListener('click', function () {
      let modal = null;
      modal = openModal({
        title: 'Удалить препарат',
        buildBody: function (body) {
          const text = el('p', 'modal__text');
          text.appendChild(document.createTextNode('Удалить «'));
          text.appendChild(el('strong', null, product.name || '—'));
          text.appendChild(document.createTextNode('» из базы? Действие нельзя отменить.'));
          body.appendChild(text);
        },
        actions: [
          { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
          {
            label: 'Удалить',
            kind: 'danger',
            onClick: function () {
              StoreProducts.deleteProduct(product.id);
              modal.close();
              render();
              showToast('Препарат удалён', { type: 'warning' });
            }
          }
        ]
      });
    });
    rowActions.appendChild(delBtn);

    actionsTd.appendChild(rowActions);
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  tableBlock.appendChild(scroll);
  content.appendChild(tableBlock);
  app.appendChild(content);
}

/* ---------- Модальное окно: добавить препарат ---------- */

function openAddProductModal() {
  let modal = null;

  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.setAttribute('aria-label', 'Название препарата');

  const catSelect = el('select');
  catSelect.setAttribute('aria-label', 'Категория');
  ['Кремы и лосьоны', 'Сыворотки и концентраты', 'Инъекционные препараты', 'Аппаратные методики'].forEach(function (cat) {
    const opt = el('option', null, cat);
    opt.value = cat;
    catSelect.appendChild(opt);
  });

  const descInput = el('textarea');
  descInput.rows = 3;
  descInput.setAttribute('aria-label', 'Описание');

  const priceInput = el('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '100';
  priceInput.setAttribute('aria-label', 'Цена');

  function buildBody(body) {
    function addField(labelText, node) {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', null, labelText));
      wrap.appendChild(node);
      body.appendChild(wrap);
    }
    addField('Название *', nameInput);
    addField('Категория', catSelect);
    addField('Описание', descInput);
    addField('Цена, ₽', priceInput);
  }

  function submit() {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Укажите название препарата');
      nameInput.focus();
      return;
    }
    StoreProducts.saveProduct({
      name: name,
      category: catSelect.value,
      description: descInput.value.trim(),
      price: parseInt(priceInput.value, 10) || 0
    });
    modal.close();
    render();
    showToast('Препарат добавлен', { type: 'success' });
  }

  modal = openModal({
    title: 'Добавить препарат',
    buildBody: buildBody,
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
      { label: 'Сохранить', kind: 'primary', onClick: submit }
    ]
  });
  nameInput.setAttribute('data-autofocus', '');
  nameInput.focus();
}

/* ---------- Модальное окно: редактировать препарат ---------- */

function openEditProductModal(product) {
  let modal = null;

  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.value = product.name || '';
  nameInput.setAttribute('aria-label', 'Название препарата');

  const catSelect = el('select');
  catSelect.setAttribute('aria-label', 'Категория');
  ['Кремы и лосьоны', 'Сыворотки и концентраты', 'Инъекционные препараты', 'Аппаратные методики'].forEach(function (cat) {
    const opt = el('option', null, cat);
    opt.value = cat;
    if (cat === product.category) opt.selected = true;
    catSelect.appendChild(opt);
  });

  const descInput = el('textarea');
  descInput.rows = 3;
  descInput.value = product.description || '';
  descInput.setAttribute('aria-label', 'Описание');

  const priceInput = el('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '100';
  priceInput.value = String(product.price || 0);
  priceInput.setAttribute('aria-label', 'Цена');

  function buildBody(body) {
    function addField(labelText, node) {
      const wrap = el('div', 'field');
      wrap.appendChild(el('label', null, labelText));
      wrap.appendChild(node);
      body.appendChild(wrap);
    }
    addField('Название *', nameInput);
    addField('Категория', catSelect);
    addField('Описание', descInput);
    addField('Цена, ₽', priceInput);
  }

  function submit() {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Укажите название препарата');
      nameInput.focus();
      return;
    }
    StoreProducts.saveProduct({
      id: product.id,
      name: name,
      category: catSelect.value,
      description: descInput.value.trim(),
      price: parseInt(priceInput.value, 10) || 0
    });
    modal.close();
    render();
    showToast('Препарат обновлён', { type: 'success' });
  }

  modal = openModal({
    title: 'Редактировать препарат',
    buildBody: buildBody,
    actions: [
      { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
      { label: 'Сохранить', kind: 'primary', onClick: submit }
    ]
  });
  nameInput.setAttribute('data-autofocus', '');
  nameInput.focus();
}


/* ---------- Экран: настройки сайта (администратор) ---------- */

function renderSettings(app) {
  const s = AppState.settings;

  const head = el('div', 'workspace__head container');
  const headText = el('div');
  headText.appendChild(el('h1', null, 'Настройки сайта'));
  headText.appendChild(el('p', 'workspace__sub',
    'Публичные тексты, телефон и прайс. Изменения сразу появляются на главной странице.'));
  head.appendChild(headText);
  const headActions = el('div', 'workspace__actions');
  const backBtn = el('a', 'btn btn--ghost btn--sm', 'К списку пациентов');
  backBtn.href = '#/patients';
  headActions.appendChild(backBtn);
  head.appendChild(headActions);
  app.appendChild(head);

  const grid = el('div', 'container settings-grid');

  /* Тексты и контакты */
  const colLeft = el('div', 'settings-col');
  const textCard = el('section', 'card-block');
  textCard.appendChild(el('h2', null, 'Тексты и контакты'));

  const fields = {};

  function addSettingField(key, labelText, inputNode) {
    const wrap = el('div', 'field');
    wrap.appendChild(el('label', null, labelText));
    wrap.appendChild(inputNode);
    const err = el('div', 'field-error', 'Проверьте поле');
    err.setAttribute('role', 'alert');
    wrap.appendChild(err);
    textCard.appendChild(wrap);
    fields[key] = { wrap: wrap, input: inputNode, error: err };
  }

  const phoneDisplayInput = el('input');
  phoneDisplayInput.type = 'text';
  phoneDisplayInput.value = s.phoneDisplay;
  phoneDisplayInput.setAttribute('aria-label', 'Телефон для отображения');
  addSettingField('phoneDisplay', 'Телефон (как показывать на сайте)', phoneDisplayInput);

  const phoneHrefInput = el('input');
  phoneHrefInput.type = 'tel';
  phoneHrefInput.value = s.phoneHref;
  phoneHrefInput.setAttribute('aria-label', 'Телефон для набора');
  addSettingField('phoneHref', 'Телефон для набора (только цифры и +)', phoneHrefInput);

  const dirInput = el('input');
  dirInput.type = 'text';
  dirInput.value = s.aboutDirections;
  dirInput.setAttribute('aria-label', 'Направления работы');
  addSettingField('aboutDirections', 'Направления работы (через точку с запятой)', dirInput);

  const aboutInput = el('textarea');
  aboutInput.value = s.aboutText;
  aboutInput.setAttribute('aria-label', 'Текст о специалисте');
  addSettingField('aboutText', 'Текст «О специалисте»', aboutInput);

  colLeft.appendChild(textCard);

  /* Контакты для блока «заказать сайт» */
  const orderCard = el('section', 'card-block');
  orderCard.appendChild(el('h2', null, 'Контакты для заказа сайта'));
  orderCard.appendChild(el('p', 'muted-text',
    'Показываются в блоке «Такой сайт можно заказать» внизу главной страницы. Оставьте пустым, чтобы скрыть кнопку.'));

  const tgInput = el('input');
  tgInput.type = 'text';
  tgInput.value = s.telegramUser;
  tgInput.placeholder = 'username (без @)';
  tgInput.setAttribute('aria-label', 'Telegram');
  addSettingField('telegramUser', 'Telegram (username)', tgInput);
  orderCard.appendChild(fields.telegramUser.wrap);

  const vkInput = el('input');
  vkInput.type = 'url';
  vkInput.value = s.vkLink;
  vkInput.placeholder = 'https://vk.com/…';
  vkInput.setAttribute('aria-label', 'Ссылка ВКонтакте');
  addSettingField('vkLink', 'Ссылка ВКонтакте', vkInput);
  orderCard.appendChild(fields.vkLink.wrap);

  colLeft.appendChild(orderCard);

  /* Услуги и цены */
  const colRight = el('div', 'settings-col');
  const servicesCard = el('section', 'card-block');
  servicesCard.appendChild(el('h2', null, 'Услуги и цены'));

  const servicesList = el('div');
  servicesCard.appendChild(servicesList);

  const serviceRows = [];

  function addServiceRow(service) {
    const row = el('div', 'service-row');
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = service.name;
    nameInput.placeholder = 'Название услуги';
    nameInput.className = 'service-row__name';
    nameInput.setAttribute('aria-label', 'Название услуги');
    const priceInput = el('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.step = '100';
    priceInput.value = String(service.price);
    priceInput.placeholder = 'Цена';
    priceInput.setAttribute('aria-label', 'Цена услуги');
    const durInput = el('input');
    durInput.type = 'text';
    durInput.value = service.duration;
    durInput.placeholder = 'Длительность';
    durInput.setAttribute('aria-label', 'Длительность услуги');
    const removeBtn = el('button', 'btn btn--danger btn--sm');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', 'Удалить услугу «' + service.name + '»');
    removeBtn.appendChild(icon('trash', 16));
    const rowState = { id: service.id, nameInput: nameInput, priceInput: priceInput, durInput: durInput, removed: false };
    removeBtn.addEventListener('click', function () {
      rowState.removed = true;
      row.remove();
    });
    row.appendChild(nameInput);
    row.appendChild(priceInput);
    row.appendChild(durInput);
    row.appendChild(removeBtn);
    servicesList.appendChild(row);
    serviceRows.push(rowState);
  }

  s.services.forEach(addServiceRow);

  const addServiceBtn = el('button', 'btn btn--outline btn--sm', 'Добавить услугу');
  addServiceBtn.type = 'button';
  addServiceBtn.appendChild(icon('plus', 16));
  addServiceBtn.addEventListener('click', function () {
    addServiceRow({ id: Store.generateId('svc'), name: '', price: 0, duration: '' });
    servicesCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  servicesCard.appendChild(addServiceBtn);
  colRight.appendChild(servicesCard);

  /* Кнопка сохранения */
  const saveCard = el('section', 'card-block');
  const saveBtn = el('button', 'btn btn--primary', 'Сохранить изменения');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', function () {
    let valid = true;
    Object.keys(fields).forEach(function (key) {
      fields[key].wrap.classList.remove('has-error');
    });
    const phoneDisplay = fields.phoneDisplay.input.value.trim();
    const phoneHref = fields.phoneHref.input.value.trim();
    if (phoneDisplay.length < 6) {
      fields.phoneDisplay.wrap.classList.add('has-error');
      valid = false;
    }
    if (!/^\+?\d{10,15}$/.test(phoneHref)) {
      fields.phoneHref.wrap.classList.add('has-error');
      valid = false;
    }
    if (!fields.aboutText.input.value.trim()) {
      fields.aboutText.wrap.classList.add('has-error');
      valid = false;
    }
    const services = [];
    serviceRows.forEach(function (row) {
      if (row.removed) return;
      const name = row.nameInput.value.trim();
      const price = Number(row.priceInput.value);
      const duration = row.durInput.value.trim();
      if (!name) {
        row.nameInput.style.borderColor = 'var(--danger)';
        valid = false;
        return;
      }
      row.nameInput.style.borderColor = '';
      services.push({ id: row.id, name: name, price: isNaN(price) ? 0 : price, duration: duration });
    });
    if (!services.length) {
      showToast('Должна остаться хотя бы одна услуга');
      return;
    }
    if (!valid) {
      showToast('Проверьте выделенные поля');
      return;
    }
    Store.saveSettings({
      phoneDisplay: phoneDisplay,
      phoneHref: phoneHref,
      aboutDirections: fields.aboutDirections.input.value.trim(),
      telegramUser: fields.telegramUser.input.value.trim(),
      vkLink: fields.vkLink.input.value.trim(),
      aboutText: fields.aboutText.input.value.trim(),
      services: services
    });
    loadSettings();
    showToast('Настройки сайта сохранены', { type: 'success' });
    render();
  });
  saveCard.appendChild(saveBtn);
  colRight.appendChild(saveCard);

  grid.appendChild(colLeft);
  grid.appendChild(colRight);
  app.appendChild(grid);
}

/* ---------- Экспорт и импорт ---------- */

function exportData() {
  const data = Store.exportAll();
  const now = new Date();
  const stamp = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = 'kosmetolog-export-' + stamp + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  showToast('Файл выгрузки сохранён', { type: 'success' });
}

function importData() {
  const input = el('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.setAttribute('aria-label', 'Выбор файла выгрузки');
  input.addEventListener('change', function () {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let data = null;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        showToast('Не удалось прочитать файл: это не корректный файл выгрузки');
        return;
      }
      const check = Store.validateImport(data);
      if (!check.ok) {
        let modal = null;
        modal = openModal({
          title: 'Файл не подходит',
          buildBody: function (body) {
            body.appendChild(el('p', 'modal__text', 'При проверке файла обнаружены ошибки:'));
            const ul = el('ul');
            ul.style.margin = '0.75rem 0 0';
            ul.style.paddingLeft = '1.25rem';
            check.errors.slice(0, 6).forEach(function (err) {
              ul.appendChild(el('li', null, err));
            });
            body.appendChild(ul);
          },
          actions: [
            { label: 'Закрыть', kind: 'primary', onClick: function () { modal.close(); } }
          ]
        });
        return;
      }
      let modal = null;
      modal = openModal({
        title: 'Импорт данных',
        buildBody: function (body) {
          body.appendChild(el('p', 'modal__text',
            'В файле найдено пациентов: ' + check.counts.patients + '. Текущий список пациентов и настройки сайта будут полностью заменены данными из файла. Продолжить?'));
        },
        actions: [
          { label: 'Отмена', kind: 'ghost', onClick: function () { modal.close(); } },
          {
            label: 'Заменить данные',
            kind: 'primary',
            onClick: function () {
              const result = Store.importAll(data);
              modal.close();
              if (result.ok) {
                loadPatients();
                loadSettings();
                showToast('Импортировано пациентов: ' + result.counts.patients, { type: 'success' });
                render();
              } else {
                showToast('Импорт не выполнен: проверьте файл');
              }
            }
          }
        ]
      });
    };
    reader.onerror = function () {
      showToast('Не удалось прочитать файл с этого устройства');
    };
    reader.readAsText(file);
  });
  input.click();
}

/* ---------- Общий рендер ---------- */

function scrollTopInstant() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  setTimeout(function () {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, 60);
}

const TITLES = {
  home: 'Косметология Ольги Титовой — частная практика',
  login: 'Вход для сотрудника — Косметология',
  patients: 'Пациенты — Косметология',
  patient: 'Карточка пациента — Косметология',
  settings: 'Настройки сайта — Косметология',
  'products-db': 'База препаратов — Косметология'
};

function render() {
  loadSettings();
  const app = document.getElementById('app');
  clearNode(app);
  renderChrome();

  const name = AppState.route.name;
  document.title = TITLES[name] || TITLES.home;

  if (name === 'login') {
    renderLogin(app);
    scrollTopInstant();
  } else if (name === 'patients') {
    renderPatients(app);
    scrollTopInstant();
  } else if (name === 'patient') {
    renderPatientCard(app, AppState.route.param);
    scrollTopInstant();
  } else if (name === 'settings') {
    renderSettings(app);
    scrollTopInstant();
  } else if (name === 'products-db') {
    renderProductsDatabase(app);
    scrollTopInstant();
  } else {
    renderHome(app);
    if (AppState.route.scroll) {
      const target = document.getElementById(AppState.route.scroll);
      if (target) {
        setTimeout(function () {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
        return;
      }
    }
    scrollTopInstant();
  }
}

/* ---------- Запуск ---------- */

function init() {
  Store.ensureSeeded();
  loadPatients();
  loadSettings();
  AppState.session = Auth.getSession();
  bindBurger();
  window.addEventListener('hashchange', router);
  router();
}

document.addEventListener('DOMContentLoaded', init);
