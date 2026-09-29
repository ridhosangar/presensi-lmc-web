/* Presensi LMC — web iPhone (masuk / pulang) — face crop mirip Android */
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
  let faceApiReady = false;

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
    const headers = Object.assign({ apikey: cfg.ANON_KEY }, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
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
      throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
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
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
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
    $('video').srcObject = null;
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
    Promise.all([loadModel(), loadFaceApi()]).catch(() => {});
  }

  $('btn-cancel-cam').onclick = () => {
    stopCamera();
    show('screen-home');
  };

  // ── face-api (deteksi bbox wajah, mirip ML Kit di Android) ──
  async function loadFaceApi() {
    if (faceApiReady) return;
    if (typeof faceapi === 'undefined') return;
    const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    faceApiReady = true;
  }

  async function loadModel() {
    if (tfliteModel) return tfliteModel;
    if (typeof tflite === 'undefined') {
      throw new Error('Library TFLite tidak termuat. Update iOS / coba Safari terbaru.');
    }
    await tf.ready();
    // Set backend
    try { await tf.setBackend('wasm'); } catch (_) {}
    try { await tf.setBackend('webgl'); } catch (_) {}
    tfliteModel = await tflite.loadTFLiteModel('mobilefacenet.tflite');
    return tfliteModel;
  }

  /**
   * Ambil frame dari video (tanpa mirror) ke canvas full size.
   * Deteksi wajah → crop + padding → 112x112 → embedding MobileFaceNet.
   */
  async function frameToCanvas() {
    const video = $('video');
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Kamera belum siap, tunggu sebentar');

    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    const ctx = full.getContext('2d');
    // JANGAN mirror untuk model — samakan dengan pipeline Android (bitmap mentah)
    ctx.drawImage(video, 0, 0, w, h);
    return full;
  }

  async function cariBoxWajah(canvas) {
    // 1) face-api tiny detector
    try {
      await loadFaceApi();
      if (faceApiReady) {
        const det = await faceapi.detectSingleFace(
          canvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })
        );
        if (det && det.box) {
          const b = det.box;
          return { x: b.x, y: b.y, width: b.width, height: b.height };
        }
      }
    } catch (_) { /* lanjut fallback */ }

    // 2) Fallback: crop tengah (lebih ketat — 70% sisi pendek)
    const side = Math.min(canvas.width, canvas.height) * 0.7;
    return {
      x: (canvas.width - side) / 2,
      y: (canvas.height - side) / 2,
      width: side,
      height: side,
    };
  }

  function cropKe112(sourceCanvas, box) {
    // Padding ~20% seperti crop wajah yang longgar (mirip ML Kit margin)
    let { x, y, width, height } = box;
    const pad = 0.2;
    const cx = x + width / 2;
    const cy = y + height / 2;
    let side = Math.max(width, height) * (1 + pad * 2);
    side = Math.min(side, sourceCanvas.width, sourceCanvas.height);
    let left = Math.round(cx - side / 2);
    let top = Math.round(cy - side / 2);
    left = Math.max(0, Math.min(left, sourceCanvas.width - side));
    top = Math.max(0, Math.min(top, sourceCanvas.height - side));
    side = Math.round(side);

    const out = $('work');
    const ctx = out.getContext('2d');
    ctx.clearRect(0, 0, 112, 112);
    ctx.drawImage(sourceCanvas, left, top, side, side, 0, 0, 112, 112);
    return out;
  }

  function canvasKeEmbeddingInput(canvas112) {
    const ctx = canvas112.getContext('2d');
    const { data } = ctx.getImageData(0, 0, 112, 112);
    // Normalisasi [-1, 1] RGB — sama dengan FaceEmbeddingHelper Android
    const input = new Float32Array(1 * 112 * 112 * 3);
    let i = 0;
    for (let p = 0; p < data.length; p += 4) {
      input[i++] = data[p] / 127.5 - 1;
      input[i++] = data[p + 1] / 127.5 - 1;
      input[i++] = data[p + 2] / 127.5 - 1;
    }
    return tf.tensor4d(input, [1, 112, 112, 3]);
  }

  function l2Normalize(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
    const n = Math.sqrt(s) || 1;
    return Array.from(arr, (v) => v / n);
  }

  async function ekstrakEmbedding() {
    const full = await frameToCanvas();
    const box = await cariBoxWajah(full);
    const face112 = cropKe112(full, box);
    const model = await loadModel();
    const inputTensor = canvasKeEmbeddingInput(face112);
    let out = model.predict(inputTensor);
    // Beberapa build mengembalikan array tensors
    if (Array.isArray(out)) out = out[0];
    const data = await out.data();
    inputTensor.dispose();
    if (out.dispose) out.dispose();

    // Juga coba versi mirror horizontal; pilih tidak di server — kirim yang non-mirror dulu.
    // Jika skor masih rendah, user bisa coba lagi dengan posisi lebih frontal.
    return l2Normalize(data);
  }

  /** Versi cadangan: rata-rata embedding non-mirror + mirror (sering menaikkan skor) */
  async function ekstrakEmbeddingRobust() {
    const full = await frameToCanvas();
    const box = await cariBoxWajah(full);
    const face112 = cropKe112(full, box);
    const model = await loadModel();

    async function embedFromCanvas(c) {
      const t = canvasKeEmbeddingInput(c);
      let out = model.predict(t);
      if (Array.isArray(out)) out = out[0];
      const data = await out.data();
      t.dispose();
      if (out.dispose) out.dispose();
      return data;
    }

    const e1 = await embedFromCanvas(face112);

    // Mirror crop
    const mir = document.createElement('canvas');
    mir.width = 112;
    mir.height = 112;
    const mctx = mir.getContext('2d');
    mctx.translate(112, 0);
    mctx.scale(-1, 1);
    mctx.drawImage(face112, 0, 0);
    const e2 = await embedFromCanvas(mir);

    // Rata-rata lalu L2 norm
    const avg = new Float32Array(e1.length);
    for (let i = 0; i < e1.length; i++) avg[i] = (e1[i] + e2[i]) / 2;
    return l2Normalize(avg);
  }

  function ambilBlobFoto() {
    return new Promise(async (resolve, reject) => {
      try {
        const full = await frameToCanvas();
        full.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal ambil foto'))), 'image/jpeg', 0.9);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function ambilLokasi() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('GPS tidak tersedia'));
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
        ekstrakEmbeddingRobust(),
        ambilBlobFoto(),
        ambilLokasi(),
      ]);

      const fd = new FormData();
      fd.append('tipe', tipeAktif);
      fd.append('lat', String(loc.lat));
      fd.append('lng', String(loc.lng));
      fd.append('embedding', JSON.stringify(embedding));
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
    if (d.face_score != null) lines.push(['Kecocokan wajah', Math.round(d.face_score * 100) + '%']);
    if (d.wajah_cocok !== undefined) lines.push(['Wajah cocok', d.wajah_cocok ? 'Ya' : 'Tidak']);
    $('hasil-detail').innerHTML = lines
      .map(([k, v]) => '<div><span>' + k + '</span><strong>' + v + '</strong></div>')
      .join('');
    show('screen-hasil');
  }

  $('btn-selesai').onclick = () => show('screen-home');

  if (token && user && user.role === 'employee') {
    bukaHome();
  } else if (token && user && (user.role === 'admin' || user.role === 'developer')) {
    localStorage.clear();
    show('screen-login');
  } else {
    show('screen-login');
  }
})();
