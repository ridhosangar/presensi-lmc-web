/* Presensi LMC — web iPhone: face-api descriptor (bukan MobileFaceNet TFLite) */
(function () {
  const cfg = window.APP_CONFIG;
  const STORAGE_TOKEN = 'lmc_token';
  const STORAGE_USER = 'lmc_user';
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';

  let token = localStorage.getItem(STORAGE_TOKEN);
  let user = null;
  try { user = JSON.parse(localStorage.getItem(STORAGE_USER) || 'null'); } catch (_) {}
  let tipeAktif = 'masuk';
  let stream = null;
  let modelsReady = false;
  let hasWebFace = false;

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
    // X-Client hanya untuk checkin (fungsi login/web-face belum allow header ini)
    if (path === 'checkin' || (typeof path === 'string' && path.startsWith('checkin'))) {
      headers['X-Client'] = 'web';
    }
    if (options.body && !(options.body instanceof FormData) && typeof options.body === 'string') {
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
    if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
    return data;
  }

  async function loadModels() {
    if (modelsReady) return;
    if (typeof faceapi === 'undefined') throw new Error('face-api tidak termuat');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
  }

  async function cekStatusWajahWeb() {
    try {
      const r = await api('web-face', { method: 'GET' });
      hasWebFace = !!r.has_web_face;
    } catch (_) {
      hasWebFace = false;
    }
    updateHomeFaceBtn();
  }

  function updateHomeFaceBtn() {
    const btn = $('btn-daftar-wajah');
    const info = $('info-wajah-web');
    if (!btn) return;
    if (hasWebFace) {
      btn.textContent = 'Daftar ulang wajah web';
      if (info) info.textContent = 'Wajah web sudah terdaftar. Siap presensi.';
    } else {
      btn.textContent = 'Daftarkan wajah web (wajib sekali)';
      if (info) info.textContent = 'Sebelum presensi, daftar wajah web dulu (beda sistem dengan Android).';
    }
  }

  // ── Login ──
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
      await bukaHome();
    } catch (e) {
      setError('login-error', e.message || 'Login gagal');
    } finally {
      $('btn-login').disabled = false;
    }
  };

  async function bukaHome() {
    $('nama-user').textContent = user.nama || user.username;
    $('jabatan-user').textContent = user.jabatan || '';
    show('screen-home');
    loadModels().catch(() => {});
    await cekStatusWajahWeb();
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

  async function descriptorDariVideo(videoEl) {
    await loadModels();
    const det = await faceapi
      .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!det) throw new Error('Wajah tidak terdeteksi. Hadap kamera, cahaya cukup, wajah di tengah.');
    return Array.from(det.descriptor);
  }

  function ambilBlobDariVideo(videoEl) {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      c.width = videoEl.videoWidth;
      c.height = videoEl.videoHeight;
      c.getContext('2d').drawImage(videoEl, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal foto'))), 'image/jpeg', 0.9);
    });
  }

  async function ambilLokasi() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('GPS tidak tersedia'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(new Error('Gagal GPS: ' + err.message)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  // ── Daftar wajah web ──
  $('btn-daftar-wajah').onclick = async () => {
    setError('daftar-error', '');
    show('screen-daftar-wajah');
    try {
      await startCamera('video-daftar');
      await loadModels();
    } catch (e) {
      setError('daftar-error', e.message || 'Kamera gagal');
    }
  };

  $('btn-cancel-daftar').onclick = () => {
    stopCamera();
    show('screen-home');
  };

  $('btn-simpan-wajah').onclick = async () => {
    setError('daftar-error', '');
    $('btn-simpan-wajah').disabled = true;
    try {
      const desc = await descriptorDariVideo($('video-daftar'));
      await api('web-face', {
        method: 'POST',
        body: JSON.stringify({ descriptor: desc }),
      });
      hasWebFace = true;
      stopCamera();
      updateHomeFaceBtn();
      show('screen-home');
      alert('Wajah web berhasil disimpan. Silakan presensi.');
    } catch (e) {
      setError('daftar-error', e.message || 'Gagal simpan wajah');
    } finally {
      $('btn-simpan-wajah').disabled = false;
    }
  };

  // ── Presensi ──
  $('btn-masuk').onclick = () => mulaiPresensi('masuk');
  $('btn-pulang').onclick = () => mulaiPresensi('pulang');

  async function mulaiPresensi(tipe) {
    // Web: wajah tidak wajib terdaftar (server paksa skor 100%)
    tipeAktif = tipe;
    $('camera-title').textContent = tipe === 'masuk' ? 'Presensi Masuk' : 'Presensi Pulang';
    setError('cam-error', '');
    $('btn-capture').classList.remove('hidden');
    $('proses').classList.add('hidden');
    show('screen-camera');
    try {
      await startCamera('video');
      await loadModels();
    } catch (e) {
      setError('cam-error', e.message || 'Kamera gagal');
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
      const [descriptor, fotoBlob, loc] = await Promise.all([
        descriptorDariVideo(video),
        ambilBlobDariVideo(video),
        ambilLokasi(),
      ]);

      const fd = new FormData();
      fd.append('tipe', tipeAktif);
      fd.append('lat', String(loc.lat));
      fd.append('lng', String(loc.lng));
      fd.append('embedding', JSON.stringify(descriptor));
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
    // Web iPhone: selalu tampilkan 100%
    if (d.face_score != null) {
      const skorTampil = (d.client_mode === 'web_force_100' || d.face_score >= 0.99)
        ? 100
        : Math.round(d.face_score * 100);
      lines.push(['Kecocokan wajah', skorTampil + '%']);
    }
    if (d.wajah_cocok !== undefined) lines.push(['Wajah cocok', d.wajah_cocok ? 'Ya' : 'Tidak']);
    if (d.client_mode) lines.push(['Mode', d.client_mode === 'web_force_100' ? 'Web 100%' : d.client_mode]);
    $('hasil-detail').innerHTML = lines
      .map(([k, v]) => '<div><span>' + k + '</span><strong>' + v + '</strong></div>')
      .join('');
    show('screen-hasil');
  }

  $('btn-selesai').onclick = () => show('screen-home');

  // init
  if (token && user && user.role === 'employee') {
    bukaHome();
  } else {
    if (token) localStorage.clear();
    show('screen-login');
  }
})();
