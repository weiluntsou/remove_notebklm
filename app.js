// Global copy helper
window.copyToClipboard = function(elementId) {
    const el = document.getElementById(elementId);
    el.select();
    document.execCommand('copy');
    alert('指令已複製！');
};

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const autoRemoveCheckbox = document.getElementById('autoRemoveCheckbox');
    const removeBgCheckbox = document.getElementById('removeBgCheckbox');
    const ocrCheckbox = document.getElementById('ocrCheckbox');
    const editableTextCheckbox = document.getElementById('editableTextCheckbox');
    const apiKeyContainer = document.getElementById('apiKeyContainer');
    const googleApiKeyInput = document.getElementById('googleApiKeyInput');
    const geminiModelSelect = document.getElementById('geminiModelSelect');
    const btnRefreshModels = document.getElementById('btnRefreshModels');
    const processingOverlay = document.getElementById('processingOverlay');
    const resultsContainer = document.getElementById('resultsContainer');

    // Toggle API Key input visibility
    const toggleApiKeyVisibility = () => {
        apiKeyContainer.style.display = (ocrCheckbox.checked || editableTextCheckbox.checked) ? 'block' : 'none';
    };
    ocrCheckbox.addEventListener('change', toggleApiKeyVisibility);
    if (editableTextCheckbox) editableTextCheckbox.addEventListener('change', toggleApiKeyVisibility);

    // Load saved API Key and Model
    const savedApiKey = localStorage.getItem('googleApiKey');
    if (savedApiKey) {
        googleApiKeyInput.value = savedApiKey;
    }
    
    const savedModel = localStorage.getItem('geminiModel');
    if (savedModel) {
        geminiModelSelect.value = savedModel;
    }

    googleApiKeyInput.addEventListener('input', () => {
        localStorage.setItem('googleApiKey', googleApiKeyInput.value);
    });

    geminiModelSelect.addEventListener('change', () => {
        localStorage.setItem('geminiModel', geminiModelSelect.value);
    });

    btnRefreshModels.addEventListener('click', async () => {
        const apiKey = googleApiKeyInput.value.trim();
        if (!apiKey) {
            alert('請先輸入 Google API Key 再重新整理模型列表。');
            return;
        }

        btnRefreshModels.disabled = true;
        btnRefreshModels.textContent = '⏳';

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await response.json();
            
            if (data.error) {
                alert(`獲取模型失敗: ${data.error.message}`);
                return;
            }

            if (data.models && data.models.length > 0) {
                const currentVal = geminiModelSelect.value;
                geminiModelSelect.innerHTML = '';
                
                const geminiModels = data.models.filter(m => m.name.includes('gemini') && m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
                
                geminiModels.forEach(model => {
                    const option = document.createElement('option');
                    const modelId = model.name.replace('models/', '');
                    option.value = modelId;
                    option.textContent = `${model.displayName || modelId} (${modelId})`;
                    geminiModelSelect.appendChild(option);
                });

                if (Array.from(geminiModelSelect.options).some(opt => opt.value === currentVal)) {
                    geminiModelSelect.value = currentVal;
                } else if (savedModel && Array.from(geminiModelSelect.options).some(opt => opt.value === savedModel)) {
                    geminiModelSelect.value = savedModel;
                }
                
                alert('模型列表已更新！');
            }
        } catch (error) {
            console.error('Fetch models error:', error);
            alert('連線失敗，請檢查網路狀態或 API Key 是否正確。');
        } finally {
            btnRefreshModels.disabled = false;
            btnRefreshModels.textContent = '🔄';
        }
    });

    // Drag and Drop Events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', handleDrop, false);
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    function handleFileSelect(e) {
        const files = e.target.files;
        handleFiles(files);
        // Reset input so the same file can be selected again
        fileInput.value = '';
    }

    async function handleFiles(files) {
        if (!autoRemoveCheckbox.checked) {
            alert('請勾選「自動去除 NotebookLM 浮水印」以繼續。');
            return;
        }

        const needsApi = ocrCheckbox.checked || (editableTextCheckbox && editableTextCheckbox.checked);
        if (needsApi && !googleApiKeyInput.value.trim()) {
            alert('請輸入 Google API Key 才能啟用此功能。');
            return;
        }

        if (files.length === 0) return;

        processingOverlay.classList.add('active');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                let processedBlob = null;
                const ext = file.name.split('.').pop().toLowerCase();

                if (ext === 'pdf') {
                    processedBlob = await processPDF(file);
                } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
                    processedBlob = await processImage(file, ext);
                } else if (ext === 'pptx') {
                    processedBlob = await processPPTX(file);
                } else {
                    console.warn('Unsupported file type:', ext);
                    continue; // Skip unsupported
                }

                if (processedBlob) {
                    addResultItem(file.name, processedBlob);
                }
            } catch (err) {
                console.error(`Error processing ${file.name}:`, err);
                alert(`處理 ${file.name} 時發生錯誤。`);
            }
        }

        processingOverlay.classList.remove('active');
    }

    // --- Processing Logic ---

    // Process PDF using pdf-lib
    async function processPDF(file) {
        const arrayBuffer = await file.arrayBuffer();
        const { PDFDocument, rgb } = PDFLib;
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();

        for (const page of pages) {
            const { width, height } = page.getSize();
            // NotebookLM watermark is typically at the bottom right.
            // Scale mask to be 8% of width and 4% of height to precisely cover the logo/text
            const maskW = width * 0.08;
            const maskH = height * 0.04;
            
            // Draw a white rectangle over it. (origin 0,0 is bottom-left in PDF)
            page.drawRectangle({
                x: width - maskW,
                y: 0,
                width: maskW,
                height: maskH,
                color: rgb(1, 1, 1),
            });
        }

        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: 'application/pdf' });
    }

    // Process Images using Canvas
    async function processImage(file, ext) {
        let imgBlob = file;

        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(imgBlob);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                
                // Draw original image
                ctx.drawImage(img, 0, 0);

                removeWatermarkFromCanvas(canvas, ctx);

                if (removeBgCheckbox && removeBgCheckbox.checked) {
                    removeWhiteBackgroundCanvas(canvas, ctx);
                    ext = 'png'; // Output PNG to preserve transparency
                }

                // Export
                const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    resolve(blob);
                }, mimeType, 0.95);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };
            img.src = url;
        });
    }

    // Process PPTX using JSZip and DOMParser
    async function processPPTX(file) {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        
        // 1. Remove native text shapes if any
        const targetRegex = /^ppt\/(slides|slideLayouts|slideMasters)\/(slide|slideLayout|slideMaster)\d+\.xml$/;
        const parser = new DOMParser();
        const serializer = new XMLSerializer();

        for (const relativePath in zip.files) {
            if (targetRegex.test(relativePath)) {
                let xmlString = await zip.file(relativePath).async("string");
                const xmlDoc = parser.parseFromString(xmlString, "application/xml");
                
                const shapes = xmlDoc.getElementsByTagName("p:sp");
                let modified = false;

                for (let i = shapes.length - 1; i >= 0; i--) {
                    const textContent = shapes[i].textContent;
                    const normalizedText = textContent ? textContent.replace(/\s+/g, '').toLowerCase() : '';
                    if (normalizedText.includes("notebooklm")) {
                        shapes[i].parentNode.removeChild(shapes[i]);
                        modified = true;
                    }
                }

                if (modified) {
                    const newXmlString = serializer.serializeToString(xmlDoc);
                    zip.file(relativePath, newXmlString);
                }
            }
        }

        // 1.5 Map images to slides
        const imageToSlides = {};
        const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/;
        for (const path in zip.files) {
            const match = path.match(slideRegex);
            if (match) {
                const slideIndex = match[1];
                const relsPath = `ppt/slides/_rels/slide${slideIndex}.xml.rels`;
                if (zip.file(relsPath)) {
                    const relsXml = await zip.file(relsPath).async('string');
                    const relsDoc = parser.parseFromString(relsXml, "application/xml");
                    const rels = relsDoc.getElementsByTagName('Relationship');
                    for (let i = 0; i < rels.length; i++) {
                        const target = rels[i].getAttribute('Target');
                        if (target && target.includes('../media/image')) {
                            const imgPath = `ppt/media/${target.split('/').pop()}`.toLowerCase();
                            if (!imageToSlides[imgPath]) imageToSlides[imgPath] = [];
                            imageToSlides[imgPath].push({ path, index: slideIndex });
                        }
                    }
                }
            }
        }

        // 2. NotebookLM PPTX exports usually bake the slides and watermark into images.
        // We need to process all large images in ppt/media/ and mask the bottom right.
        const mediaRegex = /^ppt\/media\/image\d+\.(png|jpeg|jpg)$/i;
        
        const ocrCache = {}; // Cache OCR text for step 3 if already extracted
        let maxShapeId = 1000;

        for (const relativePath in zip.files) {
            if (mediaRegex.test(relativePath)) {
                let imgBlob = await zip.file(relativePath).async("blob");
                const ext = relativePath.split('.').pop().toLowerCase();
                let mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
                
                let layoutBlocks = [];
                if (editableTextCheckbox && editableTextCheckbox.checked) {
                    const apiKey = googleApiKeyInput.value.trim();
                    const selectedModel = geminiModelSelect.value || 'gemini-1.5-flash';
                    const base64 = await blobToBase64(imgBlob);
                    
                    const pText = document.querySelector('#processingOverlay p');
                    if (pText) pText.innerText = `處理中... (正在辨識圖片文字佈局)`;
                    
                    layoutBlocks = await performOCRWithLayout(base64, mimeType, apiKey, selectedModel);
                    
                    // Cache combined text for OCR notes injection
                    if (layoutBlocks.length > 0) {
                        ocrCache[relativePath] = layoutBlocks.map(b => b.text).join('\n');
                    }
                }
                
                const modifiedImgBlob = await new Promise((resolve) => {
                    const img = new Image();
                    const url = URL.createObjectURL(imgBlob);
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);

                        // Only mask if the image is large enough to be a slide background
                        if (img.width >= 800 && img.height >= 450) {
                            removeWatermarkFromCanvas(canvas, ctx);
                        }

                        // Apply white to transparent filter
                        if (removeBgCheckbox && removeBgCheckbox.checked) {
                            removeWhiteBackgroundCanvas(canvas, ctx);
                            mimeType = 'image/png';
                        }
                        
                        // Apply editable text filter (erase text blocks)
                        if (editableTextCheckbox && editableTextCheckbox.checked && layoutBlocks.length > 0) {
                            eraseTextBlocksCanvas(canvas, ctx, layoutBlocks);
                            mimeType = 'image/png';
                        }

                        canvas.toBlob((blob) => {
                            URL.revokeObjectURL(url);
                            resolve(blob);
                        }, mimeType, 0.95);
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve(imgBlob); // Fallback to original
                    };
                    img.src = url;
                });
                
                // Note: if converted to PNG from JPG, we need to rename it in the zip and update rels,
                // but PowerPoint can usually handle PNG data inside a .jpeg extension if we just replace the blob.
                // It's safer to just let JSZip write the PNG bytes to the .jpeg file path. PowerPoint handles it gracefully.
                zip.file(relativePath, modifiedImgBlob);
                
                // Inject TextBoxes to slides
                const lowerRelativePath = relativePath.toLowerCase();
                if (layoutBlocks.length > 0 && imageToSlides[lowerRelativePath]) {
                    for (const slideInfo of imageToSlides[lowerRelativePath]) {
                        const slideXmlStr = await zip.file(slideInfo.path).async("string");
                        const slideDoc = parser.parseFromString(slideXmlStr, "application/xml");
                        const spTree = slideDoc.getElementsByTagName("p:spTree")[0];
                        if (spTree) {
                            layoutBlocks.forEach(block => {
                                const W = 12192000;
                                const H = 6858000;
                                const box = block.box || block.boundingBox || block.bounding_box || block.coordinates;
                                if(box && Array.isArray(box) && box.length === 4) {
                                    const ymin = box[0], xmin = box[1], ymax = box[2], xmax = box[3];
                                    const y = (ymin / 1000) * H;
                                    const x = (xmin / 1000) * W;
                                    const cy = ((ymax - ymin) / 1000) * H;
                                    const cx = ((xmax - xmin) / 1000) * W;
                                    
                                    // 八、文字位置偏移問題 (修正位置飄移)
                                    const adjustedX = x - (cx * 0.03);
                                    const adjustedY = y - (cy * 0.08);

                                    // 七、textbox 高度太貼 (修正高度)
                                    const adjustedCy = cy * 1.15;
                                    
                                    // 四、字級估算
                                    let estimatedPt = 20;
                                    if (block.font_size_px) {
                                        estimatedPt = Math.max(10, Math.round(block.font_size_px * 0.75));
                                    } else {
                                        const canvasHeight = 720; 
                                        const boxHeightPx = ((ymax - ymin) / 1000) * canvasHeight;
                                        const lineCount = (block.text.match(/\n/g) || []).length + 1;
                                        const singleLinePx = (boxHeightPx / lineCount) * 0.65;
                                        estimatedPt = Math.max(10, Math.round(singleLinePx * 0.75));
                                    }

                                    // 將計算出的 estimatedPt 傳入 (包含 color, align)
                                    const shapeXml = createShapeXml(maxShapeId++, block.text, adjustedX, adjustedY, cx, adjustedCy, block.text_color || block.color, estimatedPt, block.text_align);
                                    const shapeDoc = parser.parseFromString(shapeXml, "application/xml");
                                    const importedNode = slideDoc.importNode(shapeDoc.documentElement, true);
                                    spTree.appendChild(importedNode);
                                }
                            });
                            zip.file(slideInfo.path, serializer.serializeToString(slideDoc));
                        }
                    }
                }
            }
        }

        // 3. OCR and Notes Injection
        if (ocrCheckbox.checked && googleApiKeyInput.value.trim()) {
            const apiKey = googleApiKeyInput.value.trim();
            const selectedModel = geminiModelSelect.value || 'gemini-1.5-flash';
            const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/;
            
            let contentTypesXml = await zip.file('[Content_Types].xml').async('string');
            let contentTypesDoc = parser.parseFromString(contentTypesXml, "application/xml");
            
            for (const relativePath in zip.files) {
                const slideMatch = relativePath.match(slideRegex);
                if (slideMatch) {
                    const slideIndex = slideMatch[1];
                    const relsPath = `ppt/slides/_rels/slide${slideIndex}.xml.rels`;
                    let imagePath = null;
                    
                    if (zip.file(relsPath)) {
                        const relsXml = await zip.file(relsPath).async('string');
                        const relsDoc = parser.parseFromString(relsXml, "application/xml");
                        const rels = relsDoc.getElementsByTagName('Relationship');
                        for (let i = 0; i < rels.length; i++) {
                            const target = rels[i].getAttribute('Target');
                            if (target && target.includes('../media/image')) {
                                imagePath = `ppt/media/${target.split('/').pop()}`;
                                break;
                            }
                        }
                    }
                    
                    if (imagePath && zip.file(imagePath)) {
                        let text = ocrCache[imagePath];
                        
                        if (!text) {
                            const imgBlob = await zip.file(imagePath).async('blob');
                            const ext = imagePath.split('.').pop().toLowerCase();
                            const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
                            const base64 = await blobToBase64(imgBlob);
                            
                            const pText = document.querySelector('#processingOverlay p');
                            if (pText) pText.innerText = `處理中... (正在辨識第 ${slideIndex} 頁文字)`;
                            
                            text = await performOCR(base64, mimeType, apiKey, selectedModel);
                        }
                        
                        if (text) {
                            const notesSlidePath = `ppt/notesSlides/notesSlide${slideIndex}.xml`;
                            const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const paragraphs = escapedText.split('\n').map(line => `
                                <a:p>
                                    <a:r>
                                        <a:t>${line}</a:t>
                                    </a:r>
                                </a:p>
                            `).join('');

                            const notesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name=""/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          ${paragraphs}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
                            zip.file(notesSlidePath, notesXml);
                            
                            if (!contentTypesXml.includes(`PartName="/${notesSlidePath}"`)) {
                                const overrideNode = contentTypesDoc.createElementNS(contentTypesDoc.documentElement.namespaceURI || "http://schemas.openxmlformats.org/package/2006/content-types", 'Override');
                                overrideNode.setAttribute('PartName', `/${notesSlidePath}`);
                                overrideNode.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
                                contentTypesDoc.documentElement.appendChild(overrideNode);
                            }
                            
                            if (zip.file(relsPath)) {
                                const relsXml = await zip.file(relsPath).async('string');
                                const relsDoc = parser.parseFromString(relsXml, "application/xml");
                                
                                let hasNotesRel = false;
                                const rels = relsDoc.getElementsByTagName('Relationship');
                                let maxId = 0;
                                for (let i = 0; i < rels.length; i++) {
                                    const type = rels[i].getAttribute('Type');
                                    const id = rels[i].getAttribute('Id');
                                    if (id && id.startsWith('rId')) {
                                        const num = parseInt(id.replace('rId', ''));
                                        if (num > maxId) maxId = num;
                                    }
                                    if (type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide') {
                                        hasNotesRel = true;
                                        break;
                                    }
                                }
                                
                                if (!hasNotesRel) {
                                    const newRel = relsDoc.createElementNS(relsDoc.documentElement.namespaceURI || "http://schemas.openxmlformats.org/package/2006/relationships", 'Relationship');
                                    newRel.setAttribute('Id', `rId${maxId + 1}`);
                                    newRel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide');
                                    newRel.setAttribute('Target', `../notesSlides/notesSlide${slideIndex}.xml`);
                                    relsDoc.documentElement.appendChild(newRel);
                                    
                                    const newRelsXml = serializer.serializeToString(relsDoc);
                                    zip.file(relsPath, newRelsXml);
                                }
                            }
                        }
                    }
                }
            }
            
            const finalContentTypesXml = serializer.serializeToString(contentTypesDoc);
            zip.file('[Content_Types].xml', finalContentTypesXml);
            const pText = document.querySelector('#processingOverlay p');
            if (pText) pText.innerText = `處理中，請稍候...`;
        }

        return await zip.generateAsync({ type: "blob" });
    }

    // --- OCR Helpers ---
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function performOCR(base64Image, mimeType, apiKey, modelName = 'gemini-1.5-flash') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const requestBody = {
            contents: [{
                parts: [
                    { text: "請辨識圖片中的所有文字，並直接輸出辨識到的文字，不要加上任何其他說明與格式。如果沒有文字，請輸出空字串。" },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Image
                        }
                    }
                ]
            }]
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const data = await response.json();
            if (data.error) {
                console.error('Gemini API Error:', data.error);
                return '';
            }
            return data.candidates[0]?.content?.parts[0]?.text || '';
        } catch (e) {
            console.error('OCR Error:', e);
            return '';
        }
    }

    async function performOCRWithLayout(base64Image, mimeType, apiKey, modelName = 'gemini-1.5-flash') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const requestBody = {
            generationConfig: {
                responseMimeType: "application/json"
            },
            contents: [{
                parts: [
                    { text: `請分析圖片中的每個文字區塊。

每個區塊請回傳：

{
  "text": "",
  "box": [ymin,xmin,ymax,xmax],
  "font_size_px": 32,
  "font_family_guess": "Arial",
  "font_weight": 700,
  "text_align": "center",
  "line_height": 1.2,
  "letter_spacing": 0,
  "text_color": "#FFFFFF",
  "background_color": null,
  "is_italic": false,
  "rotation": 0,
  "opacity": 1.0
}

其中 box 是一個包含 4 個整數的陣列 [ymin, xmin, ymax, xmax]， normalized 為 0-1000。
回傳結果必須嚴格符合 JSON 格式，為一個包含上述物件的 JSON 陣列，不要包含任何其他 markdown 或說明文字。` },
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Image
                        }
                    }
                ]
            }]
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            const data = await response.json();
            if (data.error) {
                console.error('Gemini API Error:', data.error);
                return [];
            }
            const textContent = data.candidates[0]?.content?.parts[0]?.text || '[]';
            return JSON.parse(textContent);
        } catch (e) {
            console.error('OCR Layout Error:', e);
            return [];
        }
    }

    function createShapeXml(id, text, x, y, cx, cy, colorStr, ptFontSize = 20, align = 'center') {
        let hexColor = '000000';
        if (colorStr && colorStr.startsWith('#')) {
            hexColor = colorStr.substring(1);
        } else if (colorStr) {
            const lowerColor = colorStr.toLowerCase();
            if (lowerColor.includes('blue')) hexColor = '0070C0';
            else if (lowerColor.includes('red')) hexColor = 'FF0000';
            else if (lowerColor.includes('white')) hexColor = 'FFFFFF';
            else if (lowerColor.includes('gray') || lowerColor.includes('grey')) hexColor = '808080';
            else if (lowerColor.includes('green')) hexColor = '00B050';
        }

        const alignMap = {
            left: 'l',
            center: 'ctr',
            right: 'r',
            justify: 'just'
        };
        const pptAlign = alignMap[align] || 'ctr';

        // PPTX 字級單位是 1/100 Point
        const finalXmlSize = ptFontSize * 100;

        // 處理多行文字並支援對齊
        const paragraphs = text.split('\n').map(line => {
            const escapedLine = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `
        <a:p>
            <a:pPr algn="${pptAlign}"/>
            <a:r>
                <a:rPr lang="zh-TW" sz="${finalXmlSize}">
                    <a:solidFill><a:srgbClr val="${hexColor}"/></a:solidFill>
                </a:rPr>
                <a:t>${escapedLine}</a:t>
            </a:r>
        </a:p>`;
        }).join('');

        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sp xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:nvSpPr>
        <p:cNvPr id="${id}" name="TextBox ${id}"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
        <a:xfrm>
            <a:off x="${Math.round(x)}" y="${Math.round(y)}"/>
            <a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
    </p:spPr>
    <p:txBody>
        <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0">
            <a:noAutofit/>
        </a:bodyPr>
        <a:lstStyle/>
${paragraphs}
    </p:txBody>
</p:sp>`;
    }

    // UI Helper to show result
    function addResultItem(originalName, blob) {
        const downloadUrl = URL.createObjectURL(blob);
        const newName = originalName.replace(/\.[^/.]+$/, "") + "_no_watermark." + originalName.split('.').pop();
        
        const item = document.createElement('div');
        item.className = 'result-item';
        
        const icon = originalName.toLowerCase().endsWith('pdf') ? '📄' : 
                     originalName.toLowerCase().endsWith('pptx') ? '📊' : '🖼️';

        item.innerHTML = `
            <div class="result-info">
                <span class="file-icon">${icon}</span>
                <span class="file-name">${newName}</span>
            </div>
            <div class="result-actions">
                <a href="${downloadUrl}" download="${newName}">下載</a>
            </div>
        `;
        
        // Prepend so newest is on top
        resultsContainer.prepend(item);
        
        // Auto trigger download
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = newName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // Dynamic Watermark Calculation Helper
    function removeWatermarkFromCanvas(canvas, ctx) {
        // Tighter search area: bottom right 8% width, 5% height
        const searchW = Math.floor(canvas.width * 0.08);
        const searchH = Math.floor(canvas.height * 0.05);
        const startX = canvas.width - searchW;
        const startY = canvas.height - searchH;

        // Sample background color safely ABOVE the watermark search area
        // This ensures we never accidentally sample the watermark itself if it touches the bottom
        const bgX = canvas.width - 10;
        const bgY = Math.max(0, startY - 5);
        const bgPixelData = ctx.getImageData(bgX, bgY, 1, 1).data;
        const bgR = bgPixelData[0], bgG = bgPixelData[1], bgB = bgPixelData[2];

        // Get pixel data for the search area
        const imgData = ctx.getImageData(startX, startY, searchW, searchH);
        const data = imgData.data;

        let minX = searchW, minY = searchH, maxX = 0, maxY = 0;
        let found = false;
        // Lower tolerance slightly to catch faint anti-aliased text edges
        const tolerance = 30; 

        // Scan pixels to find the exact bounding box of the watermark
        for (let y = 0; y < searchH; y++) {
            for (let x = 0; x < searchW; x++) {
                const i = (y * searchW + x) * 4;
                const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                
                if (a < 50) continue; // Ignore transparent

                // If pixel differs from background color, it's part of the watermark
                if (Math.abs(r - bgR) > tolerance || Math.abs(g - bgG) > tolerance || Math.abs(b - bgB) > tolerance) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    found = true;
                }
            }
        }

        // Fill exactly the calculated bounding box with the sampled background color
        if (found) {
            const pad = 3; // Re-add a very tiny 3px padding to cover the faint blurry edges
            const finalX = Math.max(0, startX + minX - pad);
            const finalY = Math.max(0, startY + minY - pad);
            const finalW = (maxX - minX) + pad * 2;
            const finalH = (maxY - minY) + pad * 2;

            ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
            ctx.fillRect(finalX, finalY, finalW, finalH);
        }
    }

    function removeWhiteBackgroundCanvas(canvas, ctx) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        
        // Threshold for distance from pure white (255, 255, 255)
        const threshold = 60;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            
            const dist = Math.sqrt(Math.pow(255 - r, 2) + Math.pow(255 - g, 2) + Math.pow(255 - b, 2));
            
            if (dist < threshold) {
                // Smooth alpha transition to prevent jagged edges/halos
                const alpha = Math.floor((dist / threshold) * 255);
                data[i+3] = alpha;
            }
        }
        ctx.putImageData(imgData, 0, 0);
    }

    function eraseTextBlocksCanvas(canvas, ctx, layoutBlocks) {
        layoutBlocks.forEach(block => {
            const box = block.box || block.boundingBox || block.bounding_box || block.coordinates;
            if (box && Array.isArray(box) && box.length === 4) {
                const ymin = box[0], xmin = box[1], ymax = box[2], xmax = box[3];
                const y = (ymin / 1000) * canvas.height;
                const x = (xmin / 1000) * canvas.width;
                const h = ((ymax - ymin) / 1000) * canvas.height;
                const w = ((xmax - xmin) / 1000) * canvas.width;
                
                // 擴張邊界框 (Padding)，確保涵蓋所有陰影和反鋸齒
                const padX = w * 0.05; 
                const padY = h * 0.05;
                
                const finalX = Math.floor(Math.max(0, x - padX));
                const finalY = Math.floor(Math.max(0, y - padY));
                const finalW = Math.floor(Math.min(canvas.width - finalX, w + (padX * 2)));
                const finalH = Math.floor(Math.min(canvas.height - finalY, h + (padY * 2)));

                if (finalW <= 0 || finalH <= 0) return;

                // 備份原圖，用來疊加保留淡淡原字
                const originalCanvas = document.createElement('canvas');
                originalCanvas.width = finalW;
                originalCanvas.height = finalH;
                const octx = originalCanvas.getContext('2d');
                octx.putImageData(ctx.getImageData(finalX, finalY, finalW, finalH), 0, 0);

                // 使用 Pattern Fill 進行修補 (Inpainting)
                const patternCanvas = document.createElement('canvas');
                patternCanvas.width = finalW;
                patternCanvas.height = finalH;
                const pctx = patternCanvas.getContext('2d');
                
                // 取文字框上方一小塊來做 pattern fill
                const sampleHeight = Math.min(20, finalY);
                if (sampleHeight > 0) {
                    pctx.drawImage(
                        canvas,
                        finalX,
                        finalY - sampleHeight,
                        finalW,
                        sampleHeight,
                        0,
                        0,
                        finalW,
                        sampleHeight
                    );
                } else {
                    // 若上方無空間，取下方
                    const bottomSampleHeight = Math.min(20, canvas.height - (finalY + finalH));
                    if (bottomSampleHeight > 0) {
                        pctx.drawImage(
                            canvas,
                            finalX,
                            finalY + finalH,
                            finalW,
                            bottomSampleHeight,
                            0,
                            0,
                            finalW,
                            bottomSampleHeight
                        );
                    }
                }
                
                if (sampleHeight > 0 || (canvas.height - (finalY + finalH) > 0)) {
                    const pattern = ctx.createPattern(patternCanvas, 'repeat-y');
                    ctx.fillStyle = pattern;
                    ctx.fillRect(finalX, finalY, finalW, finalH);
                }

                // 將原圖文字淡化疊加回去 (保留 15% opacity 的透明文字層)
                ctx.globalAlpha = 0.15;
                ctx.drawImage(originalCanvas, finalX, finalY);
                ctx.globalAlpha = 1.0;
            }
        });
    }

    // --- Tab Switching Logic ---
    const navItems = document.querySelectorAll('.nav-item');
    const toolSections = document.querySelectorAll('.tool-section');
    const currentToolTitle = document.getElementById('current-tool-title');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            if (!targetId) return;

            // Update Active Tab
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Update Header Title
            currentToolTitle.textContent = item.textContent.split(' (')[0];

            // Show Target Section
            toolSections.forEach(section => {
                section.style.display = section.id === targetId ? 'block' : 'none';
            });
        });
    });

    // --- Prompt Generation Logic ---
    
    // 1. 自訂表達 (Custom Expression)
    document.getElementById('btn-generate-custom')?.addEventListener('click', () => {
        const narrative = document.getElementById('custom-narrative').value;
        const style = document.getElementById('custom-style').value;
        const audience = document.getElementById('custom-audience').value || '一般大眾';

        const prompt = `請扮演一位頂尖的簡報設計師與文案專家。
接下來，我將提供一份原始文本，請你根據以下參數，將其轉化為高質量的簡報大綱與講稿：

【敘事結構】：${narrative}
【視覺與語氣風格】：${style}
【目標受眾】：${audience}

請針對每一頁投影片提供：
1. 標題 (精煉有力)
2. 核心視覺建議 (描述該頁畫面配置或圖表)
3. 講者備忘錄 (口語化的演講稿)

請確保輸出的語言為臺灣繁體中文。`;
        
        document.getElementById('output-custom').value = prompt;
    });

    // 2. 一鍵風格 (One-Click Style)
    const styleYamls = {
        'ink-wash-classical': `# 古典中國風簡報 / Classical Chinese Ink Style Presentation
style: ink-wash-classical

background: 米白宣紙底 / rice-paper off-white (#F5F0E6)
accent_colors:
  - 硃砂紅 / vermillion red (#8B2500)
  - 墨黑 / ink black (#1A1A1A)
  - 古銅金 / antique gold (#B8860B)

typography:
  headings: 書法楷體 / calligraphic Kai, bold
  body: 明體 / Ming serif, regular
  size_ratio: 標題為內文 3 倍 / headings 3x body size

layout_rules:
  - 大量留白，內容佔比 ≤ 40% / 40% content, 60% whitespace
  - 水墨暈染作為區塊分隔 / ink wash as section dividers
  - 直式標題可穿插使用 / vertical headings allowed
  - 印章元素標記重點 / seal stamp for emphasis marks
  - 每頁僅一個核心概念 / one core concept per slide

visual_elements:
  - 山水潑墨背景 / landscape ink splash backgrounds
  - 竹、梅、蘭裝飾邊框 / bamboo, plum, orchid ornamental borders
  - 雲紋、回紋作為分隔線 / cloud and key-fret patterns as dividers
  - 水墨漸層過渡 / ink wash gradient transitions
  - 印章（方、圓）標注重點 / seal stamps (square, round) for highlights

content_rules:
  - 引言使用古詩詞格式 / quotes in classical poetry format
  - 數據以書卷軸形式呈現 / data in scroll format
  - 標題不超過 10 字 / headings ≤ 10 characters
  - 使用繁體中文（台灣用語）/ use Traditional Chinese (Taiwan)

prohibitions:
  - 禁用漸層色塊 / no gradient color blocks
  - 禁用圓角卡片 / no rounded corner cards
  - 禁用螢光色 / no fluorescent colors
  - 禁用西式裝飾線 / no western ornamental rules
  - 禁用 emoji / no emoji icons`,

        'tech-analytical': `# 理工解析風簡報 / Tech Analytical Presentation
style: tech-analytical

background: 科技深藍 / tech dark blue (#0A192F)
accent_colors:
  - 數據青 / data cyan (#64FFDA)
  - 警示橘 / alert orange (#FF6B6B)
  - 網格灰 / grid gray (#8892B0)

typography:
  headings: 現代黑體 / modern sans-serif, bold
  body: 等寬字體 / monospace, regular
  size_ratio: 標題為內文 2.5 倍

layout_rules:
  - 嚴格對齊，網格系統 / strict alignment, grid system
  - 內容區塊模組化 / modular content blocks
  - 數據可視化優先 / data visualization first
  - 大量使用線條與節點 / heavy use of lines and nodes

visual_elements:
  - 點陣圖或網格背景 / dot matrix or grid backgrounds
  - 流程圖、樹狀圖、雷達圖 / flowcharts, tree diagrams, radar charts
  - 代碼視窗樣式卡片 / code-window style cards
  - 發光線條與微光效 / glowing lines and subtle bloom

content_rules:
  - 條列式說明 / bullet points
  - 精準數據佐證 / exact data proof
  - 邏輯推演步驟 / logical deduction steps
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用花俏字體 / no decorative fonts
  - 禁用隨機裝飾 / no random ornaments
  - 禁用過度漸層 / no excessive gradients`,

        'comic-hero': `# 美漫英雄風簡報 / Comic Hero Style Presentation
style: comic-hero

background: 網點紙紋底 / halftone dot pattern (#FDF8E4)
accent_colors:
  - 英雄紅 / hero red (#E62429)
  - 閃電黃 / bolt yellow (#FFD700)
  - 漫畫黑 / comic black (#151515)

typography:
  headings: 粗黑體 / heavy sans-serif, bold italic
  body: 手寫漫畫體 / comic lettering style, regular

layout_rules:
  - 不對齊切割，斜角排版 / diagonal splits, dynamic layout
  - 文字在對話框或爆炸框內 / text inside speech bubbles
  - 粗黑邊框分隔 / thick black borders
  - 每頁具有強烈動態感 / strong sense of motion

visual_elements:
  - 半色調網點 / halftone dots
  - 速度線與集中線 / speed lines and action focus lines
  - 撞色高對比 / high contrast, solid color blocking
  - 粗大陰影線條 / heavy ink drop shadows

content_rules:
  - 關鍵字加上爆炸效果 / keywords with burst effects
  - 語氣充滿能量與熱情 / energetic and passionate tone
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用柔和漸層 / no soft gradients
  - 禁用細緻線條 / no fine thin lines
  - 禁用極簡風格 / no minimalist empty spaces`,

        'clay-art': `# 黏土藝術風簡報 / Clay Art Style Presentation
style: clay-art

background: 馬卡龍粉底 / macaron pastel background (#FCE4EC)
accent_colors:
  - 奶油黃 / butter yellow (#FFF9C4)
  - 薄荷綠 / mint green (#B2DFDB)
  - 嬰兒藍 / baby blue (#BBDEFB)

typography:
  headings: 圓體 / rounded sans-serif, heavy
  body: 圓體 / rounded sans-serif, regular

layout_rules:
  - 置中排版為主 / mostly centered layout
  - 柔軟圓潤的卡片設計 / soft, rounded card designs
  - 留白空間寬裕 / generous whitespace
  - 元素間具有厚度與立體感 / elements have thickness and 3D volume

visual_elements:
  - 3D 黏土模型材質 / 3D clay modeling texture
  - 柔和的全局光照陰影 / soft global illumination shadows
  - 無銳角，全部倒圓角 / no sharp corners, all rounded
  - 童趣可愛的插圖 / playful and cute illustrations

content_rules:
  - 語氣親切活潑 / friendly and lively tone
  - 概念用擬人化物件比喻 / concepts as anthropomorphic clay objects
  - 適合教育或兒童產品 / suitable for education or kids products
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用銳利幾何形狀 / no sharp geometric shapes
  - 禁用寫實照片 / no realistic photography
  - 禁用暗黑或賽博龐克色調 / no dark or cyberpunk palettes`,

        'watercolor-storybook': `# 繪本水彩風簡報 / Watercolor Storybook Presentation
style: watercolor-storybook

background: 粗糙水彩紙紋 / rough watercolor paper (#FAFAFA)
accent_colors:
  - 暖陽橘 / warm sun orange (#FFA726)
  - 森林綠 / forest green (#66BB6A)
  - 晚霞紫 / dusk purple (#AB47BC)

typography:
  headings: 手寫童趣體 / playful handwriting font, bold
  body: 柔和明體 / soft serif, regular

layout_rules:
  - 邊緣不規則暈染 / irregular edge washes
  - 不受網格拘束的自由排版 / free-form layout
  - 插圖與文字自然交融 / illustrations naturally blending with text
  - 畫面焦點集中於中央 / focus centralized on the slide

visual_elements:
  - 水彩暈染邊緣 / watercolor wash edges
  - 透明度疊加效果 / transparent color overlays
  - 手繪鉛筆輪廓線 / hand-drawn pencil outlines
  - 溫暖的色調與柔光 / warm tones and soft lighting

content_rules:
  - 用說故事的口吻 / storytelling tone
  - 情感導向的文字描述 / emotion-driven text descriptions
  - 敘事具有起承轉合 / narrative has clear structure
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用向量扁平圖標 / no vector flat icons
  - 禁用金屬或螢光質感 / no metallic or fluorescent textures
  - 禁用冷硬的科技排版 / no cold, rigid tech layouts`,

        'ligne-claire': `# 清線藝術風簡報 / Ligne Claire Style Presentation
style: ligne-claire

background: 畫布米白 / canvas off-white (#FFFDF7)
accent_colors:
  - 丁丁藍 / tintin blue (#2980B9)
  - 芥末黃 / mustard yellow (#F1C40F)
  - 復古紅 / retro red (#E74C3C)

typography:
  headings: 復古無襯線 / retro sans-serif, bold
  body: 現代無襯線 / modern sans-serif, light

layout_rules:
  - 排版整潔、像藝廊展品 / clean layout, like a gallery exhibit
  - 清晰的分隔線 / clear divider lines
  - 大面積純色填色 / large areas of flat color
  - 留白與圖文比例 1:1 / 1:1 whitespace to image/text ratio

visual_elements:
  - 統一粗細的黑色輪廓線 / uniform black outline (Ligne claire)
  - 無陰影、無漸層 / no shadows, no gradients
  - 色彩飽和度中等、明度高 / medium saturation, high brightness
  - 歐洲漫畫或波普藝術感 / European comic or Pop Art feel

content_rules:
  - 說明清晰、直指核心 / clear explanations
  - 高雅的藝廊調性 / elegant gallery tone
  - 避免冗長文字，多用圖說 / avoid long text, use captions
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用陰影與立體效果 / no drop shadows or 3D effects
  - 禁用漸層色 / no gradient colors
  - 禁用複雜的背景圖 / no complex background images`,

        'bande-dessinee': `# 歐漫文學風簡報 / Bande Dessinée Literary Presentation
style: bande-dessinee

background: 舊紙張色 / aged paper color (#F4EFE6)
accent_colors:
  - 墨水藍 / ink blue (#1B263B)
  - 赭石色 / ochre (#B08968)
  - 灰綠色 / sage green (#7F5539)

typography:
  headings: 古典襯線體 / classical serif, bold
  body: 復古手寫或襯線 / retro handwriting or serif

layout_rules:
  - 如同圖文小說的分鏡 / layout like a graphic novel
  - 文字常伴隨手繪插圖 / text often accompanies hand-drawn illustrations
  - 邊框具手繪質感 / borders have hand-drawn texture
  - 敘事步調緩慢、具沈浸感 / slow narrative pacing, immersive

visual_elements:
  - 濃密的墨線交叉排線 / dense cross-hatching ink lines
  - 低飽和度水彩或淡彩上色 / low-saturation watercolor washes
  - 陰影以線條表現而非色塊 / shadows depicted by lines
  - 帶有深度與憂鬱的文學感 / deep, literary feel

content_rules:
  - 文字帶有哲思與文學性 / text has philosophical qualities
  - 用詞優美、具隱喻 / beautiful wording, metaphorical
  - 適合文化、藝術主題 / suitable for culture, art themes
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用鮮豔飽和色 / no bright saturated colors
  - 禁用向量幾何圖形 / no vector geometric shapes
  - 禁用過度歡樂的卡通風格 / no overly cheerful cartoon styles`,

        'webtoon': `# Webtoon 韓漫風簡報 / Webtoon Style Presentation
style: webtoon

background: 數位螢幕白 / digital screen white (#FFFFFF)
accent_colors:
  - 浪漫粉紫 / romantic pink-purple (#DDA0DD)
  - 魔法青光 / magic cyan glow (#00FFFF)
  - 深邃黑 / deep black (#121212)

typography:
  headings: 韓式黑體 / korean style gothic, extra bold
  body: 清晰無襯線 / clear sans-serif, regular

layout_rules:
  - 垂直流動的視覺引導 / vertical flow visual guidance
  - 大量使用跨頁/滿版畫面 / heavy use of full-bleed frames
  - 對話框式文字排版 / speech bubble text layout
  - 適合手機螢幕閱讀的比例 / proportions suited for mobile

visual_elements:
  - 高飽和度的數位上色 / high-saturation digital coloring
  - 華麗的光影與發光特效 / gorgeous lighting and glow effects
  - 人物/主體帶有細緻高光 / subjects with detailed highlights
  - 閃爍的星點或特效網點 / sparkling stars or effect screentones

content_rules:
  - 節奏明快、充滿戲劇張力 / fast-paced, full of dramatic tension
  - 常用狀聲詞或情緒符號 / frequent use of sound effects
  - 吸引年輕數位原生世代 / appeals to young digital natives
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用老舊紙張紋理 / no old paper textures
  - 禁用沉悶的低對比色 / no dull, low-contrast colors
  - 禁用擁擠的長篇文字 / no crowded long text blocks`,

        'yonkoma': `# 四格漫畫風簡報 / 4-Koma Comic Presentation
style: yonkoma

background: 漫畫網點底 / comic screentone base (#F0F0F0)
accent_colors:
  - 經典藍 / classic blue (#0047AB)
  - 活力橘 / energetic orange (#FF7F50)
  - 漫畫黑 / comic black (#000000)

typography:
  headings: 粗圓體 / heavy rounded, bold
  body: 漫畫手寫體 / comic handwriting

layout_rules:
  - 嚴格的四格等分結構 / strict 4-panel equal split structure
  - 起 (引言)、承 (發展)、轉 (高潮/意外)、合 (結論)
  - 格與格之間有明確框線 / clear borders between panels
  - 閱讀動線由上至下 / top-to-bottom reading flow

visual_elements:
  - 簡單的線條與大色塊 / simple lines and large color blocks
  - 誇張的面部表情符號 / exaggerated facial expressions
  - 背景簡單，聚焦主體 / simple backgrounds, focus on subjects
  - 對話框與內心獨白框 / speech bubbles and thought balloons

content_rules:
  - 每一頁就是一個完整的短篇故事 / each slide is a complete short story
  - 用幽默或反差來傳達概念 / use humor or contrast
  - 文字極度精簡，依賴圖文配合 / extremely concise text
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用複雜的3D渲染 / no complex 3D renders
  - 禁用無邊界的散亂排版 / no borderless scattered layouts
  - 禁用嚴肅枯燥的數據羅列 / no serious, dry data listing`,

        'paper-cut': `# 紙雕剪影風簡報 / Paper Cut Silhouette Presentation
style: paper-cut

background: 深邃夜藍 / deep night blue (#0B132B)
accent_colors:
  - 紙張白 / paper white (#FDFFFC)
  - 晨曦金 / dawn gold (#FF9F1C)
  - 剪影灰 / silhouette gray (#3A506B)

typography:
  headings: 優雅襯線 / elegant serif, bold
  body: 俐落黑體 / clean sans-serif, light

layout_rules:
  - 畫面具有深度的同心圓或同心矩形構圖 / concentric depth layout
  - 內容被包圍在紙雕框架中 / content framed within paper cut layers
  - 留白用以展現紙張厚度 / whitespace used to show paper thickness
  - 視覺引導朝向畫面深處 / visual flow directed towards the depth

visual_elements:
  - 多層次紙張堆疊效果 / multi-layered paper stacking effect
  - 精緻的邊緣剪影輪廓 / intricate edge silhouette outlines
  - 柔和的背光與強烈的投影 / soft backlighting and strong drop shadows
  - 單色或鄰近色層層遞進 / monochromatic colors stepping in depth

content_rules:
  - 帶有童話或夢幻般的敘事 / fairytale or dreamlike narrative
  - 適合傳達深刻、詩意的主題 / suitable for profound, poetic themes
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用寫實質感的照片 / no photorealistic textures
  - 禁用扁平無陰影的設計 / no flat, shadowless designs
  - 禁用混亂的色彩搭配 / no chaotic color schemes`,

        'magic-academy': `# 魔法學院風簡報 / Magic Academy Presentation
style: magic-academy

background: 泛黃羊皮紙 / aged parchment (#EADCA6)
accent_colors:
  - 魔法深紅 / magic crimson (#722F37)
  - 祖母綠 / emerald green (#046307)
  - 燙金黃 / foil gold (#CFB53B)

typography:
  headings: 華麗哥德體 / ornate gothic or blackletter, bold
  body: 古典襯線體 / classic serif, regular

layout_rules:
  - 對稱的學院徽章排版 / symmetrical academy crest layout
  - 文字四周環繞古典花框 / text surrounded by classical borders
  - 像是一本古老魔法書的內頁 / looks like an ancient spellbook
  - 首字母放大裝飾 (Drop Cap) / decorated drop caps

visual_elements:
  - 羊皮紙紋理與墨水污漬 / parchment texture and ink stains
  - 蠟封印章、羽毛筆、魔杖圖騰 / wax seals, quills, wand motifs
  - 神秘的星象圖或盧恩符文 / mysterious astrological charts
  - 微微閃爍的金粉魔法特效 / slightly sparkling gold dust magic

content_rules:
  - 將概念包裝成「魔法咒語」 / package concepts as "spells"
  - 語氣神秘、充滿知識底蘊 / mysterious, knowledgeable tone
  - 適合遊戲化培訓 / suitable for gamified training
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用現代扁平化設計 / no modern flat design
  - 禁用霓虹色與科技感元素 / no neon colors or tech elements
  - 禁用無襯線現代字體 / no modern sans-serif fonts`,

        'tilt-shift': `# 微縮模型風簡報 / Tilt-shift Miniature Presentation
style: tilt-shift

background: 柔和純色底板 / soft solid color baseplate (#E0E0E0)
accent_colors:
  - 玩具紅 / toy red (#E63946)
  - 模型草綠 / diorama grass green (#4CAF50)
  - 塑膠藍 / plastic blue (#1D3557)

typography:
  headings: 圓潤粗黑體 / rounded heavy gothic, bold
  body: 乾淨黑體 / clean sans-serif, regular

layout_rules:
  - 俯瞰或 45 度角等角透視構圖 / top-down or isometric layout
  - 畫面中央清晰，邊緣極度模糊 / center clear, edges extremely blurred
  - 資訊框像是立在模型旁的標籤板 / info boxes look like labels
  - 元素排列如精緻的沙盤推演 / arranged like a sandbox diorama

visual_elements:
  - 移軸攝影的極淺景深 / very shallow depth of field (Tilt-shift)
  - 塑膠、木頭質感的微縮物件 / plastic, wood textured miniature objects
  - 柔和的頂光與真實的實體陰影 / soft top lighting and realistic shadows
  - 具有宏觀視角觀察微小世界的感覺 / macro perspective of a micro world

content_rules:
  - 適合呈現城市規劃、系統架構 / good for urban planning, architecture
  - 將大概念具象化為小物件 / physicalize big concepts into small objects
  - 語氣客觀且具總覽性 / objective and overarching tone
  - 使用繁體中文（台灣用語）

prohibitions:
  - 禁用全景深清晰照片 / no deep-focus clear photos
  - 禁用扁平的 2D 繪圖 / no flat 2D drawings
  - 禁用黑暗憂鬱的色調 / no dark, gloomy tones`
    };

    document.querySelectorAll('.style-card').forEach(card => {
        card.addEventListener('click', () => {
            const styleId = card.getAttribute('data-style-id');
            const styleYaml = styleYamls[styleId];
            
            const prompt = `請扮演一位頂尖的視覺藝術總監。
接下來的簡報大綱，請你完全遵循以下 YAML 格式定義的設計規範，來進行每一頁的設計指導：

\`\`\`yaml
${styleYaml}
\`\`\`

請在輸出每一頁的「視覺建議」時，嚴格遵守上述 YAML 中定義的 typography, layout_rules, visual_elements 與 prohibitions，詳細描述畫面。
輸出請使用臺灣繁體中文。`;
            document.getElementById('output-style').value = prompt;
        });
    });

    // 3. GPT 海報攝影 (GPT Poster)
    document.getElementById('btn-generate-poster')?.addEventListener('click', () => {
        const subject = document.getElementById('poster-subject').value || '一個令人驚豔的畫面';
        const type = document.getElementById('poster-type').value;
        const style = document.getElementById('poster-style').value;
        const rules = document.getElementById('poster-rules').value;

        let prompt = `Please generate an image with the following specifications:

Subject: ${subject}
Type: ${type}
Visual Style: ${style}
`;
        if (rules) {
            prompt += `Additional Rules: ${rules}\n`;
        }

        prompt += `\nThe image should be highly detailed, professional, and visually striking. Do not include any text in the image unless explicitly requested.`;

        document.getElementById('output-poster').value = prompt;
    });
});
