/* Presensi LMC — web iPhone
 * Tanpa daftar wajah web, tanpa face-api.
 * Wajah selalu diloloskan 100% di server (client=web).
 * Validasi tetap: GPS radius + jam kerja.
 */
(function () {
  const cfg = window.APP_CONFIG;
  const STORAGE_TOKEN = 'lmc_token';
  const STORAGE_USER = 'lmc_user';

  let token = localStorage.getItem(STORAGE_TOKEN);
  let user = null;
  try { user = JSON.parse(localStorage.getItem(STORAGE_USER) || 'null'); } catch (_) {}
  let tipeAktif = 'masuk';
  let stream = null;

  const $ = (id) => document.getElementById(id);

  function show(id) {
    ['screen-login', 'screen-home', 'screen-camera', 'screen-hasil', 'screen-daftar-wajah'].forEach((s) => {
      const el = $(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }

  function setError(elId, msg) {
    const el = $(elId);
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function api(path, options = {}) {
    const headers = Object.assign({ apikey: cfg.ANON_KEY }, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (options.body && !(options.body instanceof FormData) && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(cfg.BASE_URL + path, {
        method: options.method || 'GET',
        headers,
        body: options.body,
      });
    } catch (netErr) {
      throw new Error(
        'Tidak bisa terhubung ke server (' + ((netErr && netErr.message) || 'Failed to fetch') + '). ' +
        'Buka di Safari (bukan browser WhatsApp). Periksa internet, matikan VPN.'
      );
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { error: text }; }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
    return data;
  }

  $('btn-login').onclick = async () => {
    setError('login-error', '');
    const username = $('username').value.trim();
    const password = $('password').value;
    if (!username || !password) {
      setError('login-error', 'Username dan password wajib');
      return;
    }
    $('btn-login').disabled = true;
    try {
      const data = await api('login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (data.user && (data.user.role === 'admin' || data.user.role === 'developer')) {
        throw new Error('Admin/developer pakai app Android.');
      }
      token = data.token;
      user = data.user;
      localStorage.setItem(STORAGE_TOKEN, token);
      localStorage.setItem(STORAGE_USER, JSON.stringify(user));
      bukaHome();
    } catch (e) {
      setError('login-error', e.message || 'Login gagal');
    } finally {
      $('btn-login').disabled = false;
    }
  };

  function bukaHome() {
    $('nama-user').textContent = user.nama || user.username;
    $('jabatan-user').textContent = user.jabatan || '';
    const info = $('info-wajah-web');
    if (info) info.textContent = 'Mode iPhone: wajah otomatis lolos 100%. Pastikan GPS & dalam radius klinik.';
    const btnDaftar = $('btn-daftar-wajah');
    if (btnDaftar) btnDaftar.classList.add('hidden');
    show('screen-home');
  }

  $('btn-logout').onclick = () => {
    token = null;
    user = null;
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    stopCamera();
    show('screen-login');
  };

  async function startCamera(videoId) {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const v = $(videoId);
    v.srcObject = stream;
    await v.play();
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    ['video', 'video-daftar'].forEach((id) => {
      const v = $(id);
      if (v) v.srcObject = null;
    });
  }

  function ambilBlobDariVideo(videoEl) {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      c.width = videoEl.videoWidth || 640;
      c.height = videoEl.videoHeight || 480;
      c.getContext('2d').drawImage(videoEl, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal foto'))), 'image/jpeg', 0.85);
    });
  }

  async function ambilLokasi() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('GPS tidak tersedia'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(new Error('Gagal GPS: ' + err.message + '. Izinkan lokasi di Settings → Safari.')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
  }

  function bindTap(id, fn) {
    const el = $(id);
    if (!el) return;
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.disabled = false;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    el.onclick = handler;
    el.ontouchend = handler;
  }

  bindTap('btn-masuk', () => mulaiPresensi('masuk'));
  bindTap('btn-pulang', () => mulaiPresensi('pulang'));

  async function mulaiPresensi(tipe) {
    try {
      tipeAktif = tipe;
      const title = $('camera-title');
      if (title) title.textContent = tipe === 'masuk' ? 'Presensi Masuk' : 'Presensi Pulang';
      setError('cam-error', '');
      const btnCap = $('btn-capture');
      const proses = $('proses');
      if (btnCap) btnCap.classList.remove('hidden');
      if (proses) proses.classList.add('hidden');
      show('screen-camera');
      try {
        await startCamera('video');
      } catch (e) {
        setError('cam-error', (e && e.message) || 'Kamera gagal. Izinkan kamera di Settings → Safari.');
      }
    } catch (e) {
      alert('Gagal buka presensi: ' + ((e && e.message) || e));
    }
  }

  $('btn-cancel-cam').onclick = () => {
    stopCamera();
    show('screen-home');
  };

  $('btn-capture').onclick = async () => {
    setError('cam-error', '');
    $('btn-capture').classList.add('hidden');
    $('proses').classList.remove('hidden');
    try {
      const video = $('video');
      const [fotoBlob, loc] = await Promise.all([
        ambilBlobDariVideo(video),
        ambilLokasi(),
      ]);

      const embedding = new Array(128).fill(0);

      const fd = new FormData();
      fd.append('tipe', tipeAktif);
      fd.append('lat', String(loc.lat));
      fd.append('lng', String(loc.lng));
      fd.append('embedding', JSON.stringify(embedding));
      fd.append('client', 'web');
      fd.append('mock_location', '0');
      fd.append('foto', fotoBlob, 'presensi.jpg');

      const hasil = await api('checkin', { method: 'POST', body: fd });
      stopCamera();
      tampilHasil(hasil);
    } catch (e) {
      setError('cam-error', e.message || 'Presensi gagal');
      $('btn-capture').classList.remove('hidden');
      $('proses').classList.add('hidden');
    }
  };

  function tampilHasil(hasil) {
    const ok = !!(hasil && (hasil.berhasil === true || hasil.status === 'berhasil'));
    $('hasil-judul').textContent = ok ? '✅ Presensi Berhasil' : '❌ Presensi Gagal';
    $('hasil-judul').style.color = ok ? '#2e7d32' : '#c62828';
    $('hasil-pesan').textContent = hasil.pesan || hasil.message || hasil.keterangan || '';
    const d = hasil.detail || hasil;
    const lines = [];
    if (d.dalam_radius !== undefined) lines.push(['Dalam radius', d.dalam_radius ? 'Ya' : 'Tidak']);
    if (d.dalam_jam_kerja !== undefined) lines.push(['Dalam jam kerja', d.dalam_jam_kerja ? 'Ya' : 'Tidak']);
    lines.push(['Kecocokan wajah', '100% (mode web)']);
    if (d.wajah_cocok !== undefined) lines.push(['Wajah cocok', d.wajah_cocok ? 'Ya' : 'Tidak']);
    $('hasil-detail').innerHTML = lines
      .map(([k, v]) => '<div><span>' + k + '</span><strong>' + v + '</strong></div>')
      .join('');
    show('screen-hasil');
  }

  $('btn-selesai').onclick = () => show('screen-home');

  if (token && user && user.role === 'employee') {
    bukaHome();
  } else {
    if (token) localStorage.clear();
    show('screen-login');
  }
})();
