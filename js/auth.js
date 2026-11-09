/* ============================================================
   auth.js — вход, сессия, роли.
   Пароли не хранятся в открытом виде: сохраняются и сравниваются
   только SHA-256-хеши. Демонстрационные учётные записи задаются
   константой USERS_SEED ниже: чтобы сменить пароль, вычислите
   SHA-256 нового пароля и подставьте вместо значения hash
   (подробности — в README.md).
   ============================================================ */

'use strict';

const Auth = (function () {

  const USERS_KEY = 'kosmetolog_users_v1';
  const SESSION_KEY = 'kosmetolog_session';
  const REMEMBER_DAYS = 7;

  /* SHA-256 от строки «Krasota2026» и «Admin2026» (UTF-8). */
  const USERS_SEED = [
    {
      login: 'kosmetolog',
      hash: '377de057c346eda1bdfbc7a562675843886e83e17b3cc5a51dd627ef651559f2',
      role: 'cosmetolog'
    },
    {
      login: 'admin',
      hash: '059a50ce956b7ec61527c7ecc0c55b5a009dc54ab4acddce8852b46baa2aba30',
      role: 'admin'
    }
  ];

  /* ---------- Хеширование ---------- */

  /* Компактная реализация SHA-256 на чистом JavaScript.
     Используется как запасной вариант, если Web Crypto API
     недоступен (например, при открытии файла напрямую). */
  function sha256Js(input) {
    let ascii = unescape(encodeURIComponent(input));
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const maxWord = Math.pow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    const hash = [];
    const k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while ((ascii.length % 64) - 56) {
      ascii += '\x00';
    }
    for (let j = 0; j < ascii.length; j++) {
      const code = ascii.charCodeAt(j);
      words[j >> 2] |= code << (((3 - j) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (let block = 0; block < words.length;) {
      let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
      let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      for (let i = 0; i < 64; i++) {
        const w15 = words[block + i - 15] || 0;
        const w2 = words[block + i - 2] || 0;
        const t1 = h +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & f) ^ (~e & g)) +
          k[i] +
          (words[block + i] = i < 16 ? words[block + i] : (
            words[block + i - 16] +
            (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
            words[block + i - 7] +
            (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        const t2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c));
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }
    for (let i = 0; i < 8; i++) {
      const value = hash[i];
      for (let j = 3; j + 1; j--) {
        result += '0123456789abcdef'.charAt((value >> (j * 4)) & 15);
      }
    }
    return result;
  }

  async function hashPassword(password) {
    const text = String(password);
    if (window.crypto && window.crypto.subtle && window.isSecureContext !== false) {
      try {
        const data = new TextEncoder().encode(text);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest))
          .map(function (b) { return b.toString(16).padStart(2, '0'); })
          .join('');
      } catch (e) {
        /* переходим на запасной вариант ниже */
      }
    }
    return sha256Js(text);
  }

  /* ---------- Учётные записи ---------- */

  function getUsers() {
    try {
      const raw = window.localStorage.getItem(USERS_KEY);
      if (raw !== null) {
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) { /* ignore */ }
    window.localStorage.setItem(USERS_KEY, JSON.stringify(USERS_SEED));
    return USERS_SEED.slice();
  }

  /* ---------- Сессия ---------- */

  function saveSession(session, remember) {
    const payload = JSON.stringify(session);
    window.sessionStorage.setItem(SESSION_KEY, payload);
    if (remember) {
      const expires = Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000;
      window.localStorage.setItem(SESSION_KEY, JSON.stringify({ expires: expires, session: session }));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }

  function getSession() {
    try {
      const rawRemembered = window.localStorage.getItem(SESSION_KEY);
      if (rawRemembered) {
        const box = JSON.parse(rawRemembered);
        if (box && box.session && typeof box.expires === 'number' && box.expires > Date.now()) {
          return box.session;
        }
        window.localStorage.removeItem(SESSION_KEY);
      }
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        if (session && session.login && session.role) return session;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function logout() {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(SESSION_KEY);
  }

  /* ---------- Вход ---------- */

  async function login(loginValue, password, remember) {
    const loginNorm = String(loginValue || '').trim().toLowerCase();
    const user = getUsers().find(function (u) { return u.login === loginNorm; });
    const hash = await hashPassword(String(password || ''));
    if (!user || user.hash !== hash) {
      return { ok: false, error: 'Неверный логин или пароль' };
    }
    const session = { login: user.login, role: user.role, startedAt: new Date().toISOString() };
    saveSession(session, !!remember);
    return { ok: true, session: session };
  }

  function isAdmin(session) {
    return !!session && session.role === 'admin';
  }

  return {
    login: login,
    logout: logout,
    getSession: getSession,
    hashPassword: hashPassword,
    isAdmin: isAdmin
  };
})();
