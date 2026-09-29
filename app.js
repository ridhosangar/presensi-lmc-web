/* Presensi LMC — web iPhone (masuk / pulang saja) */
(function () {
  const cfg = window.APP_CONFIG;
  const STORAGE_TOKEN = 'lmc_token';
  const STORAGE_USER = 'lmc_user';

  let token = localStorage.getItem(STORAGE_TOKEN);
  let user = null;
  try { user = JSON.parse(localStorage.getItem(STORAGE_USER) || 'null'); } catch (_) {}
  let tipeAktif = 'masuk';
  let stream = null;
  let tfliteModel = null;

  const $ = (id) => document.getElementById(id);

  function show(id) {
    ['screen-login', 'screen-home', 'screen-camera', 'screen-hasil'].forEach((s) => {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  function setError(elId, msg) {
    const el = $(elId);
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function api(path, options = {}) {
    const headers = Object.assign({
      apikey: cfg.ANON_KEY,
    }, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    // Jangan set Content-Type jika body FormData
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(cfg.BASE_URL + path, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { error: text }; }
    if (!res.ok) {
      const err = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      throw new Error(err);
    }
    return data;
  }

  // ── Login ──
  $('btn-login').onclick = async () => {
    setError('login-error', '');
    const username = $('username').value.trim();
    const password = $('password').value;
    if (!username || !password) {
      setError('login-error', 'Username dan password wajib diisi');
      return;
    }
    $('btn-login').disabled = true;
    try {
      const data = await api('login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      if (data.user && (data.user.role === 'admin' || data.user.role === 'developer')) {
        throw new Error('Akun admin/developer silakan pakai aplikasi Android.');
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

  // ── Kamera ──
  async function startCamera() {
    stopCamera();
    setError('cam-error', '');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      const v = $('video');
      v.srcObject = stream;
      v.classList.remove('hidden');
      $('preview').classList.add('hidden');
      await v.play();
    } catch (e) {
      setError('cam-error', 'Kamera tidak bisa dibuka: ' + (e.message || e));
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const v = $('video');
    v.srcObject = null;
  }

  $('btn-masuk').onclick = () => bukaKamera('masuk');
  $('btn-pulang').onclick = () => bukaKamera('pulang');

  async function bukaKamera(tipe) {
    tipeAktif = tipe;
    $('camera-title').textContent = tipe === 'masuk' ? 'Presensi Masuk' : 'Presensi Pulang';
    $('btn-capture').classList.remove('hidden');
    $('proses').classList.add('hidden');
    show('screen-camera');
    await startCamera();
    // Preload model di background
    loadModel().catch(() => {});
  }

  $('btn-cancel-cam').onclick = () => {
    stopCamera();
    show('screen-home');
  };

  // ── Model wajah (MobileFaceNet TFLite) ──
  async function loadModel() {
    if (tfliteModel) return tfliteModel;
    if (typeof tflite === 'undefined') {
      throw new Error('Library TFLite tidak termuat. Coba browser lain / update iOS.');
    }
    await tf.ready();
    tfliteModel = await tflite.loadTFLiteModel('mobilefacenet.tflite');
    return tfliteModel;
  }

  /** Ambil frame video → crop tengah persegi → 112x112 → embedding 192 */
  async function ekstrakEmbeddingDariVideo() {
    const video = $('video');
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Kamera belum siap');

    const side = Math.min(w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);

    const work = $('work');
    const ctx = work.getContext('2d');
    // mirror selfie → gambar terbalik horizontal biar natural; model tidak wajib mirror
    ctx.save();
    ctx.translate(112, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, 112, 112);
    ctx.restore();

    const model = await loadModel();
    const imageData = ctx.getImageData(0, 0, 112, 112);
    const { data } = imageData;
    // Float32 [-1, 1] NHWC
    const input = new Float32Array(1 * 112 * 112 * 3);
    let i = 0;
    for (let p = 0; p < data.length; p += 4) {
      input[i++] = data[p] / 127.5 - 1;
      input[i++] = data[p + 1] / 127.5 - 1;
      input[i++] = data[p + 2] / 127.5 - 1;
    }
    const inputTensor = tf.tensor4d(input, [1, 112, 112, 3]);
    const out = model.predict(inputTensor);
    const arr = await out.data();
    inputTensor.dispose();
    if (out.dispose) out.dispose();
    return Array.from(arr);
  }

  function ambilBlobFoto() {
    return new Promise((resolve, reject) => {
      const video = $('video');
      const w = video.videoWidth;
      const h = video.videoHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal ambil foto'))), 'image/jpeg', 0.85);
    });
  }

  async function ambilLokasi() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('GPS tidak tersedia di perangkat ini'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          mock: false,
        }),
        (err) => reject(new Error('Gagal GPS: ' + err.message)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  $('btn-capture').onclick = async () => {
    setError('cam-error', '');
    $('btn-capture').classList.add('hidden');
    $('proses').classList.remove('hidden');
    try {
      const [embedding, fotoBlob, loc] = await Promise.all([
        ekstrakEmbeddingDariVideo(),
        ambilBlobFoto(),
        ambilLokasi(),
      ]);

      const fd = new FormData();
      fd.append('tipe', tipeAktif);
      fd.append('lat', String(loc.lat));
      fd.append('lng', String(loc.lng));
      fd.append('embedding', JSON.stringify(embedding));
      fd.append('mock_location', loc.mock ? '1' : '0');
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
    if (d.dalam_radius !== undefined) {
      lines.push(['Dalam radius', d.dalam_radius ? 'Ya' : 'Tidak']);
    }
    if (d.dalam_jam_kerja !== undefined) {
      lines.push(['Dalam jam kerja', d.dalam_jam_kerja ? 'Ya' : 'Tidak']);
    }
    if (d.face_score !== undefined && d.face_score !== null) {
      lines.push(['Kecocokan wajah', Math.round(d.face_score * 100) + '%']);
    }
    if (d.wajah_cocok !== undefined) {
      lines.push(['Wajah cocok', d.wajah_cocok ? 'Ya' : 'Tidak']);
    }
    $('hasil-detail').innerHTML = lines
      .map(([k, v]) => '<div><span>' + k + '</span><strong>' + v + '</strong></div>')
      .join('');

    show('screen-hasil');
  }

  $('btn-selesai').onclick = () => show('screen-home');

  // ── Start ──
  if (token && user && user.role === 'employee') {
    bukaHome();
  } else if (token && user && (user.role === 'admin' || user.role === 'developer')) {
    localStorage.clear();
    show('screen-login');
  } else {
    show('screen-login');
  }
})();
