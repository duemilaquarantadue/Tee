document.addEventListener('DOMContentLoaded', function() {
  const actionButton = document.getElementById('action-button');
  const notification = document.getElementById('notification');
  const aScene = document.querySelector('a-scene');

  let pressTimer, mediaRecorder, recordedChunks = [], isRecording = false, videoElement;

  // Canvas finale per foto/video
  const finalCanvas = document.createElement('canvas');
  const ctx = finalCanvas.getContext('2d');

  // Migliora nitidezza 3D su schermi HiDPI quando il renderer è pronto
  const onSceneLoaded = () => {
    try {
      if (AFRAME.scenes[0] && AFRAME.scenes[0].renderer) {
        AFRAME.scenes[0].renderer.setPixelRatio(window.devicePixelRatio || 1);
      }
    } catch (e) {}
  };
  if (aScene.hasLoaded) onSceneLoaded();
  else aScene.addEventListener('loaded', onSceneLoaded);

  window.onerror = function(message, source, lineno, colno) {
    notification.style.display = 'block';
    notification.textContent = `Error: ${message} (${lineno}:${colno})`;
  };

  const findVideoEl = () => document.querySelector('video');

  const createCanvasWithScreenshot = async (aframeCanvas) => {
    let screenshotCanvas = document.querySelector('#screenshotCanvas');
    if (!screenshotCanvas) {
      screenshotCanvas = document.createElement('canvas');
      screenshotCanvas.id = 'screenshotCanvas';
      screenshotCanvas.hidden = true;
      document.body.appendChild(screenshotCanvas);
    }
    screenshotCanvas.width = aframeCanvas.width;
    screenshotCanvas.height = aframeCanvas.height;
    const ctxScreenshot = screenshotCanvas.getContext('2d');
    ctxScreenshot.drawImage(aframeCanvas, 0, 0);
    return screenshotCanvas;
  };

  // ====== Salvataggio universale (foto/video) ======
  async function saveFile(blob, filename, kind = 'image') {
    // 1) Web Share API con file
    try {
      const file = new File(
        [blob],
        filename,
        { type: blob.type || (kind === 'video' ? 'video/mp4' : 'image/png') }
      );
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'AR capture' });
        return;
      }
    } catch (_) {}

    const url = URL.createObjectURL(blob);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // 2) iOS: per i VIDEO crea una viewer-page come Blob HTML
    if (kind === 'video' && isIOS) {
      const safeFileName = filename.replace(/"/g, '');
      const viewerHtml = `
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeFileName}</title>
  <style>
    body {
      font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif;
      margin: 0; padding: 16px;
    }
    video {
      width: 100%; height: auto; display: block;
      background: #000; border-radius: 12px;
    }
    .actions {
      margin-top: 12px; display: grid; gap: 8px;
    }
    button {
      font-size: 16px;
      padding: 12px;
      border-radius: 10px;
      border: 0;
      background: #09172f;
      color: #fff;
    }
    button:active {
      background: #13294b;
    }
    .hint {
      color: #666; font-size: 14px; margin-top: 8px;
    }
  </style>
</head>
<body>
  <video id="v" controls playsinline src="${url}"></video>
  <div class="actions">
    <button id="shareBtn">Condividi/Salva Video</button>
    <div class="hint">
      iPhone: se il tasto non apre direttamente il foglio di condivisione,
      tocca il player e usa Condividi → Salva video per metterlo in Galleria.
    </div>
  </div>
  <script>
    const blobUrl = "${url}";
    const filename = "${safeFileName}";
    document.getElementById('shareBtn').addEventListener('click', async () => {
      try {
        if (navigator.canShare) {
          const resp = await fetch(blobUrl);
          const b = await resp.blob();
          const mime = b.type || 'video/mp4';
          const file = new File([b], filename, { type: mime });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'AR capture' });
            return;
          }
        }
      } catch (e) { /* fallback */ }
      const w = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!w) window.location.href = blobUrl;
    });
  </script>
</body>
</html>`;
      const htmlBlob = new Blob([viewerHtml], { type: 'text/html' });
      const viewerUrl = URL.createObjectURL(htmlBlob);
      window.open(viewerUrl, '_blank');
      return;
    }

    // 3) Fallback universale: download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  // ====================================

  // Press breve = foto, lunga = video
  const pressDelay = 500;

  actionButton.addEventListener('touchstart', () => {
    pressTimer = setTimeout(startRecording, pressDelay);
  });
  actionButton.addEventListener('touchend', () => {
    clearTimeout(pressTimer);
    isRecording ? stopRecording() : screenshot();
  });

  actionButton.addEventListener('mousedown', () => {
    pressTimer = setTimeout(startRecording, pressDelay);
  });
  actionButton.addEventListener('mouseup', () => {
    clearTimeout(pressTimer);
    isRecording ? stopRecording() : screenshot();
  });

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      actionButton.classList.remove('recording');
    }
  }

  function drawFrame() {
    const baseW = finalCanvas.width;
    const baseH = finalCanvas.height;

    // sfondo: video adattato "cover"
    const vw = videoElement.videoWidth || baseW;
    const vh = videoElement.videoHeight || baseH;
    const scale = Math.max(baseW / vw, baseH / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (baseW - dw) / 2;
    const dy = (baseH - dh) / 2;
    ctx.drawImage(videoElement, dx, dy, dw, dh);

    // overlay AR usando il canvas della scena
    const sceneCanvas = aScene.canvas;
    if (sceneCanvas && sceneCanvas.width && sceneCanvas.height) {
      ctx.drawImage(
        sceneCanvas,
        0, 0, sceneCanvas.width, sceneCanvas.height,
        0, 0, baseW, baseH
      );
    }

    if (isRecording) requestAnimationFrame(drawFrame);
  }

  async function startRecording() {
    try {
      videoElement = findVideoEl();
      if (!videoElement) throw new Error('AR video stream not found.');

      const sceneCanvas = aScene.canvas;
      const baseW = (sceneCanvas && sceneCanvas.width)  || videoElement.videoWidth  || 1280;
      const baseH = (sceneCanvas && sceneCanvas.height) || videoElement.videoHeight || 720;

      finalCanvas.width  = baseW;
      finalCanvas.height = baseH;

      const stream = finalCanvas.captureStream(30);
      mediaRecorder = new MediaRecorder(stream);
      recordedChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const type = mediaRecorder.mimeType || 'video/mp4';
        const ext = type.includes('webm') ? 'webm' : 'mp4';
        const blob = new Blob(recordedChunks, { type });
        const filename = `ar-video-${Date.now()}.${ext}`;

        await saveFile(blob, filename, 'video');
        actionButton.classList.remove('recording');
      };

      isRecording = true;
      actionButton.classList.add('recording');
      drawFrame();
      mediaRecorder.start();
    } catch (error) {
      showNotification(`Error: ${error.message}`);
    }
  }

  function showNotification(message) {
    notification.textContent = message;
    notification.style.display = 'block';
    setTimeout(() => {
      notification.style.display = 'none';
    }, 3000);
  }

  async function screenshot() {
    stopRecording();
    try {
      videoElement = findVideoEl();
      if (!videoElement || !videoElement.srcObject)
        throw new Error('Camera stream not found');

      const track = videoElement.srcObject.getVideoTracks()[0];

      // forza un render dell’overlay AR
      aScene.render(AFRAME.scenes[0].object3D, AFRAME.scenes[0].camera);
      const overlayCanvas = await createCanvasWithScreenshot(aScene.canvas);

      let bgBitmap = null;
      if ('ImageCapture' in window) {
        try {
          const ic = new ImageCapture(track);
          const photoBlob = await ic.takePhoto();
          bgBitmap = await createImageBitmap(photoBlob);
        } catch (e) {}
      }

      // Scegliamo una risoluzione unica "alta"
      const baseW =
        overlayCanvas.width ||
        (bgBitmap && bgBitmap.width) ||
        videoElement.videoWidth ||
        1280;
      const baseH =
        overlayCanvas.height ||
        (bgBitmap && bgBitmap.height) ||
        videoElement.videoHeight ||
        720;

      finalCanvas.width  = baseW;
      finalCanvas.height = baseH;

      // 1) sfondo: foto della camera o video, adattato "cover"
      if (bgBitmap) {
        const scale = Math.max(baseW / bgBitmap.width, baseH / bgBitmap.height);
        const dw = bgBitmap.width * scale;
        const dh = bgBitmap.height * scale;
        const dx = (baseW - dw) / 2;
        const dy = (baseH - dh) / 2;
        ctx.drawImage(bgBitmap, dx, dy, dw, dh);
      } else {
        const vw = videoElement.videoWidth || 1280;
        const vh = videoElement.videoHeight || 720;
        const scale = Math.max(baseW / vw, baseH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (baseW - dw) / 2;
        const dy = (baseH - dh) / 2;
        ctx.drawImage(videoElement, dx, dy, dw, dh);
      }

      // 2) overlay AR alla stessa risoluzione
      ctx.drawImage(
        overlayCanvas,
        0, 0, overlayCanvas.width, overlayCanvas.height,
        0, 0, baseW, baseH
      );

      const d = new Date();
      const name = `ar-screenshot-${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}_${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.png`;

      finalCanvas.toBlob(async (blob) => {
        await saveFile(blob, name, 'image');
      }, 'image/png');

    } catch (e) {
      console.error('Screenshot creation error:', e);
      showNotification('Error creating screenshot: ' + e.message);
    }
  }
});
