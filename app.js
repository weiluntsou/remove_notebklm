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
                            removeTextUsingMaskAndInpaint(canvas, ctx, layoutBlocks);
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

                                    const adjustedCy = cy * 1.25;
                                    
                                    // 四、字級估算
                                    let estimatedPt = 20;
                                    if (block.font_size_px) {
                                        estimatedPt = block.font_size_px * 0.75;
                                    } else {
                                        const canvasHeight = 720; 
                                        const boxHeightPx = ((ymax - ymin) / 1000) * canvasHeight;
                                        const lineCount = (block.text.match(/\n/g) || []).length + 1;
                                        const singleLinePx = (boxHeightPx / lineCount) * 0.65;
                                        estimatedPt = singleLinePx * 0.75;
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
                    { text: `請分析圖片中的所有文字區塊。

每個區塊請回傳：

{
  "text": "",
  "box": [ymin,xmin,ymax,xmax],
  "text_color": "#RRGGBB",
  "shadow_color": "#RRGGBB",
  "background_color": "#RRGGBB",
  "font_size_px": 32,
  "font_weight": 700,
  "font_family_guess": "",
  "is_bold": true,
  "text_align": "left"
}

text_color 必須是真實 HEX 色碼。
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
                    <a:solidFill>
                        <a:srgbClr val="${hexColor}">
                            <a:alpha val="92000"/>
                        </a:srgbClr>
                    </a:solidFill>
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

    function removeTextUsingMaskAndInpaint(canvas, ctx, layoutBlocks) {
        if (typeof cv === 'undefined') {
            console.warn('OpenCV.js is not loaded yet');
            return;
        }

        const hexToRgb = (hex) => {
            if (!hex) return {r:0, g:0, b:0};
            hex = hex.replace('#','');
            if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
            return {
                r: parseInt(hex.substring(0,2), 16),
                g: parseInt(hex.substring(2,4), 16),
                b: parseInt(hex.substring(4,6), 16)
            };
        };

        const colorDistance = (r1, g1, b1, r2, g2, b2) => {
            return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
        };

        let src = cv.imread(canvas);
        let mask = new cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC1);

        layoutBlocks.forEach(block => {
            const box = block.box || block.boundingBox || block.bounding_box || block.coordinates;
            if (!box || !Array.isArray(box) || box.length !== 4) return;
            
            const ymin = box[0], xmin = box[1], ymax = box[2], xmax = box[3];
            const y = Math.max(0, (ymin / 1000) * canvas.height);
            const x = Math.max(0, (xmin / 1000) * canvas.width);
            const h = Math.min(canvas.height - y, ((ymax - ymin) / 1000) * canvas.height);
            const w = Math.min(canvas.width - x, ((xmax - xmin) / 1000) * canvas.width);
            
            const padX = w * 0.05; 
            const padY = h * 0.05;
            
            const finalX = Math.floor(Math.max(0, x - padX));
            const finalY = Math.floor(Math.max(0, y - padY));
            const finalW = Math.floor(Math.min(canvas.width - finalX, w + (padX * 2)));
            const finalH = Math.floor(Math.min(canvas.height - finalY, h + (padY * 2)));

            if (finalW <= 0 || finalH <= 0) return;

            const targetColor = hexToRgb(block.text_color || '#000000');
            const threshold = 75;

            for (let row = finalY; row < finalY + finalH; row++) {
                for (let col = finalX; col < finalX + finalW; col++) {
                    let pixel = src.ucharPtr(row, col);
                    let r = pixel[0], g = pixel[1], b = pixel[2];
                    let dist = colorDistance(r, g, b, targetColor.r, targetColor.g, targetColor.b);
                    
                    if (dist < threshold) {
                        mask.ucharPtr(row, col)[0] = 255;
                    }
                }
            }
        });

        // 加入 morphology 擴張以消滅 anti alias 殘影
        let M = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(mask, mask, M, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

        // OpenCV Telea Inpainting
        let dst = new cv.Mat();
        cv.inpaint(src, mask, dst, 3, cv.INPAINT_TELEA);

        cv.imshow(canvas, dst);

        src.delete();
        mask.delete();
        M.delete();
        dst.delete();
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

    // ============================================================
    // PDF 轉可編輯 PPTX 功能
    // ============================================================
    (function initPdf2Pptx() {
        // 設定 pdf.js worker
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const dropzone   = document.getElementById('pdf2pptx-dropzone');
        const fileInput  = document.getElementById('pdf2pptx-file-input');
        const convertBtn = document.getElementById('pdf2pptx-convert-btn');
        const clearBtn   = document.getElementById('pdf2pptx-clear-btn');
        const overlay    = document.getElementById('pdf2pptx-overlay');
        const statusEl   = document.getElementById('pdf2pptx-status');
        const progressWrap = document.getElementById('pdf2pptx-progress-wrap');
        const progressBar  = document.getElementById('pdf2pptx-progress-bar');
        const progressLabel = document.getElementById('pdf2pptx-progress-label');
        const progressPct   = document.getElementById('pdf2pptx-progress-pct');
        const previewGrid  = document.getElementById('pdf2pptx-preview-grid');
        const resultsEl    = document.getElementById('pdf2pptx-results');
        const apiKeyInput  = document.getElementById('pdf2pptx-api-key');
        const modelSelect  = document.getElementById('pdf2pptx-model-select');

        if (!dropzone) return;

        // 持久化儲存 API Key，並在輸入後自動刷新模型列表
        const savedKey = localStorage.getItem('googleApiKey');
        if (savedKey) {
            apiKeyInput.value = savedKey;
            // 頁面載入時若已有 key，延遲 300ms 自動刷新一次
            setTimeout(() => refreshModelList(savedKey, false), 300);
        }

        let _refreshTimer = null;
        apiKeyInput.addEventListener('input', () => {
            const key = apiKeyInput.value.trim();
            localStorage.setItem('googleApiKey', apiKeyInput.value);
            clearTimeout(_refreshTimer);
            if (!key) {
                resetModelSelect();
                return;
            }
            setModelSelectStatus('loading');
            _refreshTimer = setTimeout(() => refreshModelList(key, true), 800);
        });

        /** 從 Gemini API 取得可用模型並填入 select */
        async function refreshModelList(apiKey, showFeedback) {
            if (!apiKey) return;
            setModelSelectStatus('loading');
            try {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
                );
                const data = await res.json();
                if (data.error) {
                    setModelSelectStatus('error', data.error.message);
                    return;
                }
                const geminiModels = (data.models || []).filter(m =>
                    m.name.includes('gemini') &&
                    Array.isArray(m.supportedGenerationMethods) &&
                    m.supportedGenerationMethods.includes('generateContent')
                );
                if (geminiModels.length === 0) {
                    setModelSelectStatus('error', '找不到可用模型');
                    return;
                }
                const currentVal = modelSelect.value;
                modelSelect.innerHTML = '';
                geminiModels.forEach(m => {
                    const id = m.name.replace('models/', '');
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = (m.displayName || id) + '  (' + id + ')';
                    modelSelect.appendChild(opt);
                });
                // 優先保留上次選擇的值
                const preferred = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
                if (Array.from(modelSelect.options).some(o => o.value === currentVal)) {
                    modelSelect.value = currentVal;
                } else {
                    for (const p of preferred) {
                        const match = Array.from(modelSelect.options).find(o => o.value.startsWith(p));
                        if (match) { modelSelect.value = match.value; break; }
                    }
                }
                setModelSelectStatus('ok', `已載入 ${geminiModels.length} 個模型`);
            } catch (e) {
                setModelSelectStatus('error', '網路錯誤，請確認 API Key');
            }
        }

        /** 重置 select 為預設選項 */
        function resetModelSelect() {
            modelSelect.innerHTML = `
                <option value="gemini-2.5-flash-preview-05-20">Gemini 2.5 Flash (最新，推薦)</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (速度快)</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (精確度高)</option>
                <option value="gemini-2.5-pro-preview-05-06">Gemini 2.5 Pro (最高精確)</option>`;
            setModelSelectStatus('idle');
        }

        /** 顯示模型列表狀態 badge */
        function setModelSelectStatus(state, msg) {
            let badge = document.getElementById('pdf2pptx-model-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.id = 'pdf2pptx-model-badge';
                badge.style.cssText = 'font-size:12px; padding:2px 10px; border-radius:20px; font-weight:600; margin-left:8px; display:inline-block; transition: all 0.3s;';
                modelSelect.parentElement.appendChild(badge);
            }
            const styles = {
                loading: ['#EDE7F6','#6A1B9A','🔄 刷新中...'],
                ok:      ['#E8F5E9','#2E7D32', '✓ ' + (msg||'')],
                error:   ['#FFEBEE','#C62828', '✗ ' + (msg||'錯誤')],
                idle:    ['#F5F5F5','#999',    ''],
            };
            const [bg, color, text] = styles[state] || styles.idle;
            badge.style.background = bg;
            badge.style.color = color;
            badge.textContent = text;
        }

        let pdfPages = []; // { pageNum, canvas, dataUrl }
        let currentFile = null;

        // Drag & Drop
        ['dragenter','dragover','dragleave','drop'].forEach(ev => {
            dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
        });
        ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.add('dragover')));
        ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));
        dropzone.addEventListener('drop', e => handlePdfFile(e.dataTransfer.files[0]));
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => { if (e.target.files[0]) handlePdfFile(e.target.files[0]); fileInput.value=''; });

        clearBtn.addEventListener('click', () => {
            pdfPages = [];
            currentFile = null;
            previewGrid.innerHTML = '';
            resultsEl.innerHTML = '';
            progressWrap.style.display = 'none';
            convertBtn.disabled = true;
        });

        convertBtn.addEventListener('click', () => startConversion());

        async function handlePdfFile(file) {
            if (!file || file.type !== 'application/pdf') {
                alert('請上傳 PDF 格式的檔案。');
                return;
            }
            currentFile = file;
            pdfPages = [];
            previewGrid.innerHTML = '';
            resultsEl.innerHTML = '';
            progressWrap.style.display = 'none';
            convertBtn.disabled = true;

            if (typeof pdfjsLib === 'undefined') {
                alert('pdf.js 尚未載入，請稍候重試。');
                return;
            }

            overlay.classList.add('active');
            statusEl.textContent = '讀取 PDF...';

            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const totalPages = pdf.numPages;

                statusEl.textContent = `渲染 PDF 共 ${totalPages} 頁...`;

                for (let i = 1; i <= totalPages; i++) {
                    statusEl.textContent = `渲染第 ${i} / ${totalPages} 頁...`;
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 1 });
                    const scale = 1920 / viewport.width;
                    const scaledViewport = page.getViewport({ scale });

                    // 渲染至 Canvas
                    const canvas = document.createElement('canvas');
                    canvas.width  = scaledViewport.width;
                    canvas.height = scaledViewport.height;
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

                    // 抽取 PDF 文字層
                    statusEl.textContent = `抽取第 ${i} / ${totalPages} 頁文字層...`;
                    let pdfTextBlocks = [];
                    try {
                        const textContent = await page.getTextContent();
                        pdfTextBlocks = groupPdfTextItems(textContent.items, scaledViewport, canvas.width, canvas.height);
                    } catch(e) {
                        console.warn(`第 ${i} 頁文字層抽取失敗:`, e);
                    }
                    const hasPdfText = pdfTextBlocks.length > 0;

                    pdfPages.push({ pageNum: i, canvas, dataUrl, width: canvas.width, height: canvas.height, pdfTextBlocks, hasPdfText });

                    // 預覽卡片
                    const card = document.createElement('div');
                    card.className = 'pdf2pptx-page-card';
                    card.id = `pdf2pptx-card-${i}`;
                    const badge = hasPdfText
                        ? `<span class="page-status done">📝 ${pdfTextBlocks.length} 個文字塊</span>`
                        : `<span class="page-status" style="background:#FFF3E0;color:#E65100">🖼 圖像頁面</span>`;
                    card.innerHTML = `
                        <img src="${dataUrl}" alt="第 ${i} 頁">
                        <div class="page-label"><span>第 ${i} 頁</span>${badge}</div>`;
                    previewGrid.appendChild(card);
                }

                convertBtn.disabled = false;
            } catch (err) {
                console.error('PDF 讀取失敗:', err);
                alert('PDF 讀取失敗：' + err.message);
            } finally {
                overlay.classList.remove('active');
            }
        }

        /**
         * 將 pdf.js getTextContent() 返回的分散文字項目，
         * 依基準線 Y 分行、依水平間距合併，輸出 layoutBlocks 陣列。
         */
        function groupPdfTextItems(items, viewport, canvasW, canvasH) {
            if (!items || items.length === 0) return [];

            // viewport.scale: PDF 單位 → canvas 像素的縮放比例
            // convertToViewportPoint() 已內建此轉換，但 item.width/height 還是原始 PDF 單位
            const scale = viewport.scale;

            const parsed = [];
            for (const item of items) {
                if (typeof item.str !== 'string' || !item.str.trim()) continue;
                const tf = item.transform; // [a,b,c,d,e,f]

                // 文字基準線起始點（PDF 空間 → canvas 像素，已含 scale 與 y 翻轉）
                const [vx, vy] = viewport.convertToViewportPoint(tf[4], tf[5]);

                // 字級（PDF units）× scale → canvas pixels
                const fontSizePdf = Math.abs(tf[3]) > 0 ? Math.abs(tf[3]) : Math.abs(tf[0]);
                const fontSizePx  = fontSizePdf * scale;

                // item.width/height 是 PDF units，需乘 scale
                const widthPx  = (item.width  || 0) * scale;
                const heightPx = ((item.height || fontSizePdf) > 0
                    ? (item.height || fontSizePdf)
                    : fontSizePdf) * scale;

                if (widthPx <= 0 || fontSizePx <= 0) continue;
                parsed.push({ str: item.str, vx, vy, widthPx, heightPx, fontSizePx });
            }
            if (!parsed.length) return [];

            console.log(`[PDF Text] 共 ${parsed.length} 個文字 item，scale=${scale.toFixed(2)}`);

            // 依 Y 排序（canvas 座標，y 值小 = 靠上）
            parsed.sort((a, b) => a.vy - b.vy || a.vx - b.vx);

            // 分行：ΔY ≤ 0.8 個字高視為同一行
            const lines = [[parsed[0]]];
            for (let i = 1; i < parsed.length; i++) {
                const cur  = parsed[i];
                const prev = lines[lines.length - 1][0];
                const tol  = Math.max(prev.heightPx, cur.heightPx) * 0.8;
                if (Math.abs(cur.vy - prev.vy) <= tol) {
                    lines[lines.length - 1].push(cur);
                } else {
                    lines.push([cur]);
                }
            }

            const blocks = [];
            for (const line of lines) {
                line.sort((a, b) => a.vx - b.vx);
                // 水平合併：間距 ≤ 3 個字高視為同一組
                const groups = [[line[0]]];
                for (let i = 1; i < line.length; i++) {
                    const g    = groups[groups.length - 1];
                    const last = g[g.length - 1];
                    const gap  = line[i].vx - (last.vx + last.widthPx);
                    const maxGap = Math.max(last.heightPx, line[i].heightPx) * 3;
                    if (gap <= maxGap) { g.push(line[i]); }
                    else { groups.push([line[i]]); }
                }
                for (const g of groups) {
                    const text = g.map(t => t.str).join('');
                    if (!text.trim()) continue;
                    const x1 = Math.min(...g.map(t => t.vx));
                    const x2 = Math.max(...g.map(t => t.vx + t.widthPx));
                    const y1 = Math.min(...g.map(t => t.vy - t.heightPx));
                    const y2 = Math.max(...g.map(t => t.vy + t.heightPx * 0.25));
                    const xmin = Math.max(0,    Math.round((x1 / canvasW) * 1000));
                    const ymin = Math.max(0,    Math.round((y1 / canvasH) * 1000));
                    const xmax = Math.min(1000, Math.round((x2 / canvasW) * 1000));
                    const ymax = Math.min(1000, Math.round((y2 / canvasH) * 1000));
                    if (xmax > xmin && ymax > ymin) {
                        blocks.push({
                            text: text.trim(),
                            box: [ymin, xmin, ymax, xmax],
                            font_size_px: g[0].fontSizePx,
                            text_color: '#000000',
                            text_align: 'left',
                            is_bold: false,
                        });
                    }
                }
            }
            console.log(`[PDF Text] 合併後 ${blocks.length} 個文字塊`);
            return blocks;
        }


        async function startConversion() {
            if (pdfPages.length === 0) { alert('請先上傳 PDF 檔案。'); return; }

            const total = pdfPages.length;
            convertBtn.disabled = true;
            progressWrap.style.display = 'block';
            resultsEl.innerHTML = '';

            const PPTX_W = 9144000;
            const PPTX_H = 5143500;
            const allPageData = [];

            for (let i = 0; i < total; i++) {
                const { pageNum, dataUrl, width, height, pdfTextBlocks } = pdfPages[i];
                updateProgress(i, total, `處理第 ${pageNum} / ${total} 頁...`);
                setPageStatus(pageNum, 'processing', '抹除文字中...');

                // 直接使用 PDF 文字層
                const layoutBlocks = pdfTextBlocks || [];

                // 從背景圖抹除文字區塊
                let cleanDataUrl = dataUrl;
                if (layoutBlocks.length > 0) {
                    try {
                        cleanDataUrl = await eraseTextFromImage(dataUrl, layoutBlocks);
                    } catch(e) {
                        console.warn('文字抹除失敗，使用原圖:', e);
                    }
                }

                const cleanBase64 = cleanDataUrl.split(',')[1];
                setPageStatus(pageNum, 'done', `✓ ${layoutBlocks.length} 個文字塊`);
                allPageData.push({ imgBase64: cleanBase64, imgExt: 'jpeg', layoutBlocks, width, height });
                updateProgress(i + 1, total, `已完成第 ${i + 1} / ${total} 頁`);
            }

            updateProgress(total, total, '組裝 PPTX 檔案...');

            try {
                const pptxBlob = await buildEditablePptx(allPageData, PPTX_W, PPTX_H);
                const baseName = (currentFile?.name || 'output').replace(/\.pdf$/i, '');
                const fileName = `${baseName}_可編輯.pptx`;
                showDownloadResult(pptxBlob, fileName, total);
            } catch (err) {
                console.error('PPTX 組裝失敗:', err);
                alert('PPTX 組裝失敗：' + err.message);
            }

            convertBtn.disabled = false;
        }


        function updateProgress(done, total, label) {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            progressBar.style.width = pct + '%';
            progressLabel.textContent = label || `處理第 ${done} / ${total} 頁`;
            progressPct.textContent = pct + '%';
        }

        function setPageStatus(pageNum, cls, text) {
            const el = document.getElementById(`pdf2pptx-status-${pageNum}`);
            if (!el) return;
            el.className = `page-status ${cls}`;
            el.textContent = text;
        }

        async function callGeminiOcrLayout(base64Image, mimeType, apiKey, modelName) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            const prompt = `請分析圖片中的所有文字區塊，並回傳 JSON 陣列。

每個物件格式：
{
  "text": "文字內容（多行用\\n分隔）",
  "box": [ymin, xmin, ymax, xmax],
  "text_color": "#RRGGBB",
  "background_color": "#RRGGBB",
  "font_size_px": 32,
  "is_bold": true,
  "text_align": "left"
}

box 為 normalized 座標 0-1000（整數）。
回傳必須是純 JSON 陣列，不要 markdown 或說明文字。`;

            const body = {
                generationConfig: { responseMimeType: 'application/json' },
                contents: [{
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType, data: base64Image } }
                    ]
                }]
            };
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            try { return JSON.parse(raw); } catch { return []; }
        }

        /**
         * 從圖片中抹除所有 OCR 偵測到的文字區塊。
         * 對每個文字框，取其外圍一圈像素作為「背景樣本」，
         * 再用雙線性插值填入框內，讓原始文字消失但背景保持平滑。
         */
        function eraseTextFromImage(dataUrl, layoutBlocks) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width  = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);

                    for (const block of layoutBlocks) {
                        const box = block.box;
                        if (!box || !Array.isArray(box) || box.length !== 4) continue;
                        const [ymin, xmin, ymax, xmax] = box;
                        if (xmax <= xmin || ymax <= ymin) continue;

                        // 轉換 normalized 座標 → pixel，並加 6px padding
                        const pad = 6;
                        const px1 = Math.max(0,              Math.floor((xmin / 1000) * canvas.width)  - pad);
                        const py1 = Math.max(0,              Math.floor((ymin / 1000) * canvas.height) - pad);
                        const px2 = Math.min(canvas.width,  Math.ceil( (xmax / 1000) * canvas.width)  + pad);
                        const py2 = Math.min(canvas.height, Math.ceil( (ymax / 1000) * canvas.height) + pad);
                        const bw = px2 - px1;
                        const bh = py2 - py1;
                        if (bw <= 0 || bh <= 0) continue;

                        // 取邊框外側 4 個角落的顏色，作為雙線性插值基準
                        const samplePad = 2;
                        const getPixel = (sx, sy) => {
                            sx = Math.max(0, Math.min(canvas.width  - 1, sx));
                            sy = Math.max(0, Math.min(canvas.height - 1, sy));
                            const d = ctx.getImageData(sx, sy, 1, 1).data;
                            return [d[0], d[1], d[2]];
                        };

                        // 4 corner samples just outside the bounding box
                        const cTL = getPixel(px1 - samplePad, py1 - samplePad);
                        const cTR = getPixel(px2 + samplePad, py1 - samplePad);
                        const cBL = getPixel(px1 - samplePad, py2 + samplePad);
                        const cBR = getPixel(px2 + samplePad, py2 + samplePad);

                        // 取得整個區塊的 ImageData 一次性填色（效能考量）
                        const regionData = ctx.getImageData(px1, py1, bw, bh);
                        const pxArr = regionData.data;

                        for (let row = 0; row < bh; row++) {
                            const ty = row / Math.max(bh - 1, 1); // 0→1
                            for (let col = 0; col < bw; col++) {
                                const tx = col / Math.max(bw - 1, 1); // 0→1
                                // Bilinear interpolation
                                const r = Math.round(
                                    cTL[0] * (1-tx)*(1-ty) + cTR[0] * tx*(1-ty) +
                                    cBL[0] * (1-tx)*ty     + cBR[0] * tx*ty);
                                const g = Math.round(
                                    cTL[1] * (1-tx)*(1-ty) + cTR[1] * tx*(1-ty) +
                                    cBL[1] * (1-tx)*ty     + cBR[1] * tx*ty);
                                const b = Math.round(
                                    cTL[2] * (1-tx)*(1-ty) + cTR[2] * tx*(1-ty) +
                                    cBL[2] * (1-tx)*ty     + cBR[2] * tx*ty);

                                const idx = (row * bw + col) * 4;
                                pxArr[idx]     = r;
                                pxArr[idx + 1] = g;
                                pxArr[idx + 2] = b;
                                pxArr[idx + 3] = 255;
                            }
                        }
                        ctx.putImageData(regionData, px1, py1);
                    }

                    resolve(canvas.toDataURL('image/jpeg', 0.95));
                };
                img.onerror = reject;
                img.src = dataUrl;
            });
        }

        async function buildEditablePptx(pages, PPTX_W, PPTX_H) {
            if (typeof PptxGenJS === 'undefined') {
                throw new Error('PptxGenJS 尚未載入，請確認網路連線後重新整理頁面。');
            }

            // EMU → 英吋 (1 inch = 914400 EMU)
            const W_IN = PPTX_W / 914400;  // e.g. 10
            const H_IN = PPTX_H / 914400;  // e.g. 5.625

            const pptx = new PptxGenJS();
            pptx.defineLayout({ name: 'CUSTOM', width: W_IN, height: H_IN });
            pptx.layout = 'CUSTOM';

            const alignMap = { left: 'left', center: 'center', right: 'right', justify: 'justify' };

            for (const { imgBase64, layoutBlocks } of pages) {
                const slide = pptx.addSlide();

                // 背景圖（全版面）
                slide.addImage({
                    data: 'data:image/jpeg;base64,' + imgBase64,
                    x: 0, y: 0,
                    w: W_IN, h: H_IN,
                });

                // 文字框
                for (const block of (layoutBlocks || [])) {
                    const box = block.box;
                    if (!box || !Array.isArray(box) || box.length !== 4) continue;
                    const [ymin, xmin, ymax, xmax] = box;
                    if (xmax <= xmin || ymax <= ymin) continue;

                    const x = (xmin / 1000) * W_IN;
                    const y = (ymin / 1000) * H_IN;
                    const w = Math.max(0.1, ((xmax - xmin) / 1000) * W_IN);
                    const h = Math.max(0.1, ((ymax - ymin) / 1000) * H_IN * 1.3);

                    // 顏色驗證
                    const rawColor = (block.text_color || '#000000').replace('#', '');
                    const color = /^[0-9A-Fa-f]{6}$/.test(rawColor) ? rawColor.toUpperCase() : '000000';

                    // 字級
                    let fontSize = 18;
                    if (block.font_size_px && block.font_size_px > 0) {
                        fontSize = Math.round(block.font_size_px * 0.75);
                    } else {
                        const boxHPx = ((ymax - ymin) / 1000) * 720;
                        const lines  = ((block.text || '').match(/\n/g) || []).length + 1;
                        fontSize = Math.round((boxHPx / lines) * 0.55);
                    }
                    fontSize = Math.max(8, Math.min(fontSize, 96));

                    const textAlign = alignMap[block.text_align] || 'left';
                    const isBold    = block.is_bold || false;

                    // 多行文字處理
                    const lines = (block.text || '').split('\n');
                    const textParts = [];
                    lines.forEach((line, idx) => {
                        textParts.push({
                            text: line,
                            options: {
                                color,
                                fontSize,
                                bold: isBold,
                                align: textAlign,
                                fontFace: 'Microsoft JhengHei',
                                breakLine: idx < lines.length - 1,
                            }
                        });
                    });

                    slide.addText(textParts, {
                        x, y, w, h,
                        align: textAlign,
                        fill: { type: 'none' },
                        line: { type: 'none' },
                        wrap: true,
                        autoFit: false,
                    });
                }
            }

            // 輸出 Blob
            return await pptx.write({ outputType: 'blob' });
        }





        function showDownloadResult(blob, fileName, pageCount) {
            // 用 DOM API 建立元素，避免 innerHTML 在 file:// 下對 blob: URL 的安全限制
            const url = URL.createObjectURL(blob);

            const banner = document.createElement('div');
            banner.className = 'pdf2pptx-success-banner';

            const icon = document.createElement('span');
            icon.className = 'success-icon';
            icon.textContent = '🎉';

            const textWrap = document.createElement('div');
            textWrap.className = 'success-text';
            const h3 = document.createElement('h3');
            h3.textContent = '轉換成功！';
            const p = document.createElement('p');
            p.textContent = `共 ${pageCount} 頁，每頁文字均為可編輯文字框，原始背景完整保留。`;
            textWrap.appendChild(h3);
            textWrap.appendChild(p);

            const dlBtn = document.createElement('a');
            dlBtn.className = 'success-btn';
            dlBtn.textContent = `⬇ 下載 ${fileName}`;
            dlBtn.href = url;
            dlBtn.download = fileName;

            banner.appendChild(icon);
            banner.appendChild(textWrap);
            banner.appendChild(dlBtn);

            resultsEl.innerHTML = '';
            resultsEl.appendChild(banner);

            // 自動觸發下載
            const autoA = document.createElement('a');
            autoA.href = url;
            autoA.download = fileName;
            autoA.style.display = 'none';
            document.body.appendChild(autoA);
            autoA.click();
            setTimeout(() => {
                document.body.removeChild(autoA);
                // 不要過早 revoke，讓手動點「下載」按鈕仍有效
                // URL.revokeObjectURL(url);
            }, 5000);
        }

    })();

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
