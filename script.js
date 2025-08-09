// Year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// ===== TOOL CURSOR AND TOOLTIP UX =====
function setCanvasCursor(tool) {
  const page = document.querySelector('#pdf-pages .page-container[style*="block"]');
  if (!page) return;
  const pdfCanvas = page.querySelector('.pdf-canvas');
  const fabricCanvas = page.querySelector('.fabric-canvas');
  [pdfCanvas, fabricCanvas].forEach(el => {
    if (!el) return;
    el.className = el.className.replace(/\btool-[^\s]+\b/g, '');
    if (tool === 'text') el.classList.add('tool-add-text');
    else if (tool === 'draw') el.classList.add('tool-draw');
    else if (tool === 'highlight' || tool === 'erase' || tool === 'shape') el.classList.add('tool-highlight');
  });
  if (tool === 'text') showToolHint('Tap/click to place text.');
  else if (tool === 'draw') showToolHint('Draw freehand on the page.');
  else if (tool === 'highlight') showToolHint('Drag to highlight.');
  else if (tool === 'erase') showToolHint('Drag to erase.');
  else if (tool === 'shape') showToolHint('Drag to add rectangle.');
  else hideToolHint();
}
function showToolHint(text) {
  let hint = document.getElementById('tool-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'tool-hint';
    hint.style.position = 'fixed';
    hint.style.bottom = '16px';
    hint.style.left = '50%';
    hint.style.transform = 'translateX(-50%)';
    hint.style.background = 'rgba(20,30,60,0.95)';
    hint.style.color = '#fff';
    hint.style.padding = '6px 18px';
    hint.style.borderRadius = '20px';
    hint.style.fontSize = '16px';
    hint.style.zIndex = 9999;
    hint.style.boxShadow = '0 2px 16px rgba(0,0,0,0.15)';
    document.body.appendChild(hint);
  }
  hint.textContent = text;
}
function hideToolHint() {
  const hint = document.getElementById('tool-hint');
  if (hint) hint.remove();
}

// ======= PDF EDITOR =======
const uploadInput = document.getElementById('pdf-upload');
const fileStatus = document.getElementById('file-status');
const pdfPages = document.getElementById('pdf-pages');
const toolSelect = document.getElementById('tool-select');
const fontFamily = document.getElementById('font-family');
const fontSize = document.getElementById('font-size');
const colorPicker = document.getElementById('color-picker');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const prevPage = document.getElementById('prev-page');
const nextPage = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const resetBtn = document.getElementById('reset-btn');
const downloadBtn = document.getElementById('download-btn');
const addImageBtn = document.getElementById('add-image-btn');
const addImageInput = document.getElementById('add-image-input');
const maskOldText = document.getElementById('mask-old-text');

let pdfDoc = null;
let originalPDFBytes = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let canvases = [];
let history = [];
let redoHistory = [];
let textLayers = [];

function enableToolbar(enabled) {
  [toolSelect, fontFamily, fontSize, colorPicker, zoomSlider, prevPage, nextPage, undoBtn, redoBtn, downloadBtn, resetBtn, addImageBtn].forEach(el => el.disabled = !enabled);
}

function resetEditor() {
  pdfDoc = null;
  originalPDFBytes = null;
  currentPage = 1;
  totalPages = 0;
  scale = 1.0;
  canvases = [];
  history = [];
  redoHistory = [];
  textLayers = [];
  pdfPages.innerHTML = '<div class="empty-message text-center text-gray-500 py-8">Upload a PDF to start editing. Pages will appear nested below with professional overlays for comfortable editing.</div>';
  fileStatus.textContent = 'No PDF uploaded yet.';
  pageInfo.textContent = `Page 1 / 1`;
  zoomValue.textContent = `100%`;
  enableToolbar(false);
  hideToolHint();
}
resetEditor();

async function extractTextLayer(page, viewport) {
  const textContent = await page.getTextContent();
  return textContent.items.map(item => ({
    str: item.str,
    left: item.transform[4] * scale,
    top: (viewport.height - item.transform[5] - item.height) * scale,
    fontSize: item.height * scale,
    width: item.width * scale,
    height: item.height * scale
  }));
}

async function renderPDFPages() {
  pdfPages.innerHTML = '';
  canvases = [];
  textLayers = [];
  history = [];
  redoHistory = [];
  for (let i = 1; i <= totalPages; i++) {
    const pageContainer = document.createElement('div');
    pageContainer.className = 'page-container';
    pageContainer.style.display = (i === currentPage) ? 'block' : 'none';

    const pdfCanvas = document.createElement('canvas');
    pdfCanvas.className = 'pdf-canvas';
    const fabricCanvas = document.createElement('canvas');
    fabricCanvas.className = 'fabric-canvas';

    pageContainer.appendChild(pdfCanvas);
    pageContainer.appendChild(fabricCanvas);
    pdfPages.appendChild(pageContainer);

    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });
    pdfCanvas.height = viewport.height;
    pdfCanvas.width = viewport.width;
    fabricCanvas.height = viewport.height;
    fabricCanvas.width = viewport.width;

    await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport }).promise;

    const fabricInstance = new fabric.Canvas(fabricCanvas, {
      width: viewport.width,
      height: viewport.height,
      backgroundColor: 'transparent',
      selection: true
    });
    canvases.push(fabricInstance);

    const textLayer = await extractTextLayer(page, viewport);
    textLayers.push(textLayer);

    history.push([JSON.stringify(fabricInstance.toJSON())]);
    redoHistory.push([]);

    fabricInstance.on('object:added', () => saveState(i - 1, fabricInstance));
    fabricInstance.on('object:modified', () => saveState(i - 1, fabricInstance));
    fabricInstance.on('object:removed', () => saveState(i - 1, fabricInstance));
  }
}

function saveState(pageIdx, fabricInstance) {
  const state = JSON.stringify(fabricInstance.toJSON());
  if (history[pageIdx][history[pageIdx].length - 1] !== state) {
    history[pageIdx].push(state);
    redoHistory[pageIdx] = [];
  }
}

function showCurrentPage() {
  const children = Array.from(pdfPages.children);
  for (let i = 0; i < children.length; i++) {
    children[i].style.display = (i === currentPage - 1) ? 'block' : 'none';
  }
  pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
  zoomValue.textContent = `${Math.round(scale * 100)}%`;
}
function updateNavButtons() {
  prevPage.disabled = currentPage <= 1;
  nextPage.disabled = currentPage >= totalPages;
}
uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileStatus.textContent = `Loaded: ${file.name} (${Math.round(file.size / 1024)} KB)`;
  originalPDFBytes = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: originalPDFBytes }).promise;
  totalPages = pdfDoc.numPages;
  currentPage = 1;
  scale = 1.0;
  await renderPDFPages();
  showCurrentPage();
  updateNavButtons();
  enableToolbar(true);
  resetBtn.disabled = false;
  downloadBtn.disabled = false;
});
undoBtn.addEventListener('click', () => {
  const idx = currentPage - 1;
  if (history[idx].length > 1) {
    redoHistory[idx].push(history[idx].pop());
    canvases[idx].loadFromJSON(history[idx][history[idx].length - 1], canvases[idx].renderAll.bind(canvases[idx]));
  }
});
redoBtn.addEventListener('click', () => {
  const idx = currentPage - 1;
  if (redoHistory[idx].length > 0) {
    const redoState = redoHistory[idx].pop();
    history[idx].push(redoState);
    canvases[idx].loadFromJSON(redoState, canvases[idx].renderAll.bind(canvases[idx]));
  }
});
prevPage.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    showCurrentPage();
    updateNavButtons();
    toolSelect.value = 'select';
    clearAllFabricEvents(canvases[currentPage - 1]);
    setCanvasCursor('select');
  }
});
nextPage.addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage++;
    showCurrentPage();
    updateNavButtons();
    toolSelect.value = 'select';
    clearAllFabricEvents(canvases[currentPage - 1]);
    setCanvasCursor('select');
  }
});
zoomSlider.addEventListener('input', async (e) => {
  scale = parseInt(e.target.value) / 100;
  await renderPDFPages();
  showCurrentPage();
  updateNavButtons();
});
resetBtn.addEventListener('click', () => {
  if (confirm('Reset all?')) resetEditor();
});
downloadBtn.addEventListener('click', async () => {
  if (!pdfDoc || !originalPDFBytes) return;
  const pdfLibDoc = await PDFLib.PDFDocument.load(originalPDFBytes);
  for (let i = 0; i < totalPages; i++) {
    const fabricCanvas = canvases[i];
    if (!fabricCanvas || fabricCanvas.getObjects().length === 0) continue;
    const pngData = fabricCanvas.toDataURL({ format: 'png', multiplier: 1 });
    const page = pdfLibDoc.getPages()[i];
    const { width, height } = page.getSize();
    const pngImg = await pdfLibDoc.embedPng(pngData);
    page.drawImage(pngImg, {
      x: 0, y: 0, width, height
    });
  }
  const pdfBytes = await pdfLibDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'PDFEasyEdit-edited.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});
function clearAllFabricEvents(canvas) {
  canvas.off('mouse:down');
  canvas.off('mouse:move');
  canvas.off('mouse:up');
  canvas.isDrawingMode = false;
  canvas.selection = toolSelect.value === 'select';
}
toolSelect.addEventListener('change', () => {
  const idx = currentPage - 1;
  const canvas = canvases[idx];
  clearAllFabricEvents(canvas);
  const tool = toolSelect.value;
  setCanvasCursor(tool);

  // --- ADD TEXT ---
  if (tool === 'text') {
    let ghost = null;
    function moveGhost(opt) {
      const pointer = canvas.getPointer(opt.e);
      if (!ghost) {
        ghost = new fabric.Textbox('New text', {
          left: pointer.x,
          top: pointer.y,
          fontFamily: fontFamily.value,
          fontSize: parseInt(fontSize.value),
          fill: colorPicker.value + '99',
          selectable: false,
          evented: false,
          opacity: 0.5
        });
        canvas.add(ghost);
        canvas.renderAll();
      } else {
        ghost.set({ left: pointer.x, top: pointer.y });
        canvas.renderAll();
      }
    }
    function placeText(opt) {
      const pointer = canvas.getPointer(opt.e);
      if (ghost) { canvas.remove(ghost); ghost = null; }
      const text = new fabric.IText('New text', {
        left: pointer.x,
        top: pointer.y,
        fontFamily: fontFamily.value,
        fontSize: parseInt(fontSize.value),
        fill: colorPicker.value
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.renderAll();
      canvas.off('mouse:move', moveGhost);
      canvas.off('mouse:down', placeText);
      setTimeout(() => { text.enterEditing && text.enterEditing(); }, 50);
    }
    canvas.on('mouse:move', moveGhost);
    canvas.on('mouse:down', placeText);
    return;
  }

  // --- DRAW ---
  if (tool === 'draw') {
    canvas.isDrawingMode = true;
    canvas.freeDrawingBrush.color = colorPicker.value;
    canvas.freeDrawingBrush.width = 2;
    return;
  }

  // --- RECTANGLE SHAPE ---
  if (tool === 'shape') {
    let rect = null, isDown = false, origX = 0, origY = 0;
    function onDown(opt) {
      isDown = true;
      const pointer = canvas.getPointer(opt.e);
      origX = pointer.x;
      origY = pointer.y;
      rect = new fabric.Rect({
        left: origX,
        top: origY,
        width: 0,
        height: 0,
        fill: colorPicker.value + '33',
        stroke: colorPicker.value,
        strokeWidth: 2,
        rx: 4,
        ry: 4,
        selectable: false,
        evented: false,
        opacity: 0.6
      });
      canvas.add(rect);
    }
    function onMove(opt) {
      if (!isDown || !rect) return;
      const pointer = canvas.getPointer(opt.e);
      rect.set({
        width: Math.abs(pointer.x - origX),
        height: Math.abs(pointer.y - origY),
        left: Math.min(origX, pointer.x),
        top: Math.min(origY, pointer.y)
      });
      canvas.renderAll();
    }
    function onUp() {
      if (rect) {
        rect.set({ selectable: true, evented: true, opacity: 1.0 });
        canvas.setActiveObject(rect);
        canvas.renderAll();
        rect = null;
      }
      isDown = false;
      canvas.off('mouse:down', onDown);
      canvas.off('mouse:move', onMove);
      canvas.off('mouse:up', onUp);
    }
    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);
    return;
  }

  // --- HIGHLIGHT ---
  if (tool === 'highlight') {
    let rect = null, isDown = false, origX = 0, origY = 0;
    function onDown(opt) {
      isDown = true;
      const pointer = canvas.getPointer(opt.e);
      origX = pointer.x;
      origY = pointer.y;
      rect = new fabric.Rect({
        left: origX,
        top: origY,
        width: 0,
        height: 0,
        fill: '#ffff0044',
        stroke: '#ffd700aa',
        strokeWidth: 1,
        selectable: false,
        evented: false,
        opacity: 0.9
      });
      canvas.add(rect);
    }
    function onMove(opt) {
      if (!isDown || !rect) return;
      const pointer = canvas.getPointer(opt.e);
      rect.set({
        width: Math.abs(pointer.x - origX),
        height: Math.abs(pointer.y - origY),
        left: Math.min(origX, pointer.x),
        top: Math.min(origY, pointer.y)
      });
      canvas.renderAll();
    }
    function onUp() {
      if (rect) {
        rect.set({ selectable: true, evented: true, opacity: 1.0 });
        canvas.setActiveObject(rect);
        canvas.renderAll();
        rect = null;
      }
      isDown = false;
      canvas.off('mouse:down', onDown);
      canvas.off('mouse:move', onMove);
      canvas.off('mouse:up', onUp);
    }
    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);
    return;
  }

  // --- ERASE (Rectangle & Spray) ---
  if (tool === 'erase') {
    let sprayMode = false;
    // Add spray/paint toggle button if not present
    let sprayBtn = document.getElementById('erase-spray-btn');
    if (!sprayBtn) {
      sprayBtn = document.createElement('button');
      sprayBtn.id = 'erase-spray-btn';
      sprayBtn.className = 'btn btn-secondary';
      sprayBtn.textContent = 'Spray Paint Erase';
      sprayBtn.style.marginLeft = '8px';
      sprayBtn.onclick = function() {
        sprayMode = !sprayMode;
        sprayBtn.textContent = sprayMode ? 'Rectangle Erase' : 'Spray Paint Erase';
        showToolHint(sprayMode ? 'Spray paint to erase/hide text.' : 'Drag to erase area.');
      };
      toolSelect.parentNode.appendChild(sprayBtn);
    }
    sprayBtn.style.display = '';
    showToolHint('Drag to erase area or click "Spray Paint Erase" for spray mode.');

    let rect = null, isDown = false, origX = 0, origY = 0;
    function sprayDraw(opt) {
      if (!isDown) return;
      const pointer = canvas.getPointer(opt.e);
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * 2 * Math.PI;
        const radius = Math.random() * 16;
        const x = pointer.x + Math.cos(angle) * radius;
        const y = pointer.y + Math.sin(angle) * radius;
        const spot = new fabric.Circle({
          left: x,
          top: y,
          radius: 4 + Math.random() * 6,
          fill: colorPicker.value,
          selectable: false,
          evented: false,
          opacity: 0.4 + Math.random() * 0.5
        });
        canvas.add(spot);
        setTimeout(() => spot.set({ selectable: true, evented: true, opacity: 1.0 }), 100);
      }
    }
    function onDown(opt) {
      isDown = true;
      const pointer = canvas.getPointer(opt.e);
      origX = pointer.x;
      origY = pointer.y;
      if (!sprayMode) {
        rect = new fabric.Rect({
          left: origX,
          top: origY,
          width: 0,
          height: 0,
          fill: colorPicker.value,
          selectable: false,
          evented: false,
          opacity: 0.7
        });
        canvas.add(rect);
      }
    }
    function onMove(opt) {
      if (!isDown) return;
      if (sprayMode) {
        sprayDraw(opt);
      } else if (rect) {
        const pointer = canvas.getPointer(opt.e);
        rect.set({
          width: Math.abs(pointer.x - origX),
          height: Math.abs(pointer.y - origY),
          left: Math.min(origX, pointer.x),
          top: Math.min(origY, pointer.y)
        });
        canvas.renderAll();
      }
    }
    function onUp() {
      if (!sprayMode && rect) {
        rect.set({ selectable: true, evented: true, opacity: 1.0 });
        canvas.setActiveObject(rect);
        canvas.renderAll();
        rect = null;
      }
      isDown = false;
    }
    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);

    toolSelect.addEventListener('change', function cleanupEraseBtn() {
      if (sprayBtn) sprayBtn.style.display = 'none';
      hideToolHint();
      canvas.off('mouse:down', onDown);
      canvas.off('mouse:move', onMove);
      canvas.off('mouse:up', onUp);
      toolSelect.removeEventListener('change', cleanupEraseBtn);
    });
    return;
  }

  // --- EDIT TEXT (unchanged) ---
  if (tool === 'edit-text') {
    canvas.on('mouse:down', async function handler(opt) {
      const pointer = canvas.getPointer(opt.e);
      const pageText = textLayers[idx];
      let closest = null, minDist = Infinity;
      pageText.forEach(item => {
        const dist = Math.hypot(item.left - pointer.x, item.top - pointer.y);
        if (dist < minDist) { minDist = dist; closest = item; }
      });
      if (closest && minDist < 50) {
        if (maskOldText.checked) {
          const mask = new fabric.Rect({
            left: closest.left,
            top: closest.top,
            width: closest.width,
            height: closest.height,
            fill: 'white',
            selectable: false,
            evented: false
          });
          canvas.add(mask);
        }
        const newText = new fabric.IText(closest.str, {
          left: closest.left,
          top: closest.top,
          fontFamily: fontFamily.value,
          fontSize: parseInt(fontSize.value) || closest.fontSize,
          fill: colorPicker.value,
          editable: true
        });
        canvas.add(newText);
        canvas.setActiveObject(newText);
        canvas.renderAll();
        setTimeout(() => { newText.enterEditing && newText.enterEditing(); }, 50);
      }
    });
    return;
  }
});
fontFamily.addEventListener('change', () => {
  const obj = canvases[currentPage - 1].getActiveObject();
  if (obj && obj.type === 'i-text') {
    obj.set('fontFamily', fontFamily.value);
    canvases[currentPage - 1].renderAll();
  }
});
fontSize.addEventListener('change', () => {
  const obj = canvases[currentPage - 1].getActiveObject();
  if (obj && obj.type === 'i-text') {
    obj.set('fontSize', parseInt(fontSize.value));
    canvases[currentPage - 1].renderAll();
  }
});
colorPicker.addEventListener('input', () => {
  const obj = canvases[currentPage - 1].getActiveObject();
  if (obj && (obj.type === 'i-text' || obj.type === 'rect')) {
    obj.set('fill', colorPicker.value);
    canvases[currentPage - 1].renderAll();
  }
});
addImageBtn.addEventListener('click', () => addImageInput.click());
addImageInput.addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    fabric.Image.fromURL(e.target.result, function (img) {
      const canvas = canvases[currentPage - 1];
      img.set({ left: 60, top: 60, scaleX: 0.5, scaleY: 0.5 });
      canvas.add(img);
      canvas.setActiveObject(img);
    });
  };
  reader.readAsDataURL(file);
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { undoBtn.click(); e.preventDefault(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { redoBtn.click(); e.preventDefault(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const canvas = canvases[currentPage - 1];
    if (canvas) {
      const obj = canvas.getActiveObject();
      if (obj) {
        canvas.remove(obj);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    }
  }
});

// ======= IMAGE COMPRESSOR =======
const imgUpload = document.getElementById('img-upload');
const imgQuality = document.getElementById('img-quality');
const imgQualityVal = document.getElementById('img-quality-val');
const imgPreview = document.getElementById('img-preview');
const imgDownloadBtn = document.getElementById('img-download-btn');
const imgStatus = document.getElementById('img-status');
let compressedBlob = null, origImg = new Image();
imgQuality.addEventListener('input', () => {
  imgQualityVal.textContent = imgQuality.value + '%';
  if (origImg.src) compressAndPreview();
});
imgUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (evt) {
    origImg = new Image();
    origImg.onload = () => compressAndPreview();
    origImg.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});
function compressAndPreview() {
  const canvas = document.createElement('canvas');
  canvas.width = origImg.width;
  canvas.height = origImg.height;
  canvas.getContext('2d').drawImage(origImg, 0, 0);
  canvas.toBlob(blob => {
    compressedBlob = blob;
    imgPreview.innerHTML = `<img src="${URL.createObjectURL(blob)}" style="max-width:300px;border:1px solid #eee;border-radius:4px;margin-bottom:8px;"><br>`;
    imgStatus.textContent = `Original: ${(origImg.src.length / 1024).toFixed(1)} KB — Compressed: ${(blob.size / 1024).toFixed(1)} KB`;
    imgDownloadBtn.style.display = '';
  }, 'image/jpeg', imgQuality.value / 100);
}
imgDownloadBtn.addEventListener('click', () => {
  if (!compressedBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(compressedBlob);
  a.download = 'compressed.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ======= PDF TO IMAGE =======
const pdf2imgUpload = document.getElementById('pdf2img-upload');
const pdf2imgPreview = document.getElementById('pdf2img-preview');
const pdf2imgStatus = document.getElementById('pdf2img-status');
const pdf2imgDownloadAll = document.getElementById('pdf2img-download-all');
let pdf2imgImages = [];
pdf2imgUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pdf2imgPreview.innerHTML = '';
  pdf2imgStatus.textContent = 'Processing...';
  pdf2imgDownloadAll.style.display = 'none';
  pdf2imgImages = [];
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdfjsDoc.numPages;
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfjsDoc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const imgUrl = canvas.toDataURL('image/png');
    pdf2imgImages.push(imgUrl);
    pdf2imgPreview.innerHTML += `<img src="${imgUrl}" alt="Page ${i}">`;
  }
  pdf2imgStatus.textContent = `Converted ${numPages} pages to images.`;
  pdf2imgDownloadAll.style.display = pdf2imgImages.length ? '' : 'none';
});
pdf2imgDownloadAll.addEventListener('click', async () => {
  if (!pdf2imgImages.length) return;
  pdf2imgStatus.textContent = 'Zipping...';
  const zip = new JSZip();
  pdf2imgImages.forEach((img, idx) => {
    zip.file(`page-${idx + 1}.png`, img.split(',')[1], { base64: true });
  });
  const blob = await zip.generateAsync({ type: "blob" });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'pdf-pages.zip';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  pdf2imgStatus.textContent = 'ZIP ready for download.';
});
(function() {
  if (!window.JSZip) {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    document.head.appendChild(script);
  }
})();

// ======= IMAGE TO PDF =======
const img2pdfUpload = document.getElementById('img2pdf-upload');
const img2pdfPreview = document.getElementById('img2pdf-preview');
const img2pdfStatus = document.getElementById('img2pdf-status');
const img2pdfDownloadBtn = document.getElementById('img2pdf-download-btn');
let img2pdfFiles = [];
img2pdfUpload.addEventListener('change', (e) => {
  img2pdfFiles = Array.from(e.target.files);
  img2pdfPreview.innerHTML = '';
  img2pdfFiles.forEach((file, i) => {
    const img = document.createElement('img');
    img.style.cursor = 'move';
    img.draggable = true;
    img.src = URL.createObjectURL(file);
    img.title = file.name;
    img.dataset.idx = i;
    img2pdfPreview.appendChild(img);
  });
  img2pdfStatus.textContent = `Ready: ${img2pdfFiles.length} images. Drag to reorder.`;
  img2pdfDownloadBtn.style.display = img2pdfFiles.length ? '' : 'none';
});
img2pdfPreview.addEventListener('dragstart', function(e) {
  e.dataTransfer.setData('idx', e.target.dataset.idx);
});
img2pdfPreview.addEventListener('dragover', function(e) {
  e.preventDefault();
});
img2pdfPreview.addEventListener('drop', function(e) {
  e.preventDefault();
  const fromIdx = parseInt(e.dataTransfer.getData('idx'));
  const toIdx = Array.from(img2pdfPreview.children).indexOf(e.target);
  if (fromIdx !== toIdx && toIdx >= 0) {
    const file = img2pdfFiles.splice(fromIdx, 1)[0];
    img2pdfFiles.splice(toIdx, 0, file);
    img2pdfPreview.innerHTML = '';
    img2pdfFiles.forEach((file, i) => {
      const img = document.createElement('img');
      img.style.cursor = 'move';
      img.draggable = true;
      img.src = URL.createObjectURL(file);
      img.title = file.name;
      img.dataset.idx = i;
      img2pdfPreview.appendChild(img);
    });
  }
});
img2pdfDownloadBtn.addEventListener('click', async () => {
  if (!img2pdfFiles.length) return;
  img2pdfStatus.textContent = 'Building PDF...';
  const pdfDoc = await PDFLib.PDFDocument.create();
  for (let file of img2pdfFiles) {
    const imgArrayBuffer = await file.arrayBuffer();
    let image, dims;
    if (file.type === 'image/png') {
      image = await pdfDoc.embedPng(imgArrayBuffer);
      dims = image.scale(1);
    } else {
      image = await pdfDoc.embedJpg(imgArrayBuffer);
      dims = image.scale(1);
    }
    const page = pdfDoc.addPage([dims.width, dims.height]);
    page.drawImage(image, { x: 0, y: 0, width: dims.width, height: dims.height });
  }
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'images.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  img2pdfStatus.textContent = 'PDF ready for download.';
});