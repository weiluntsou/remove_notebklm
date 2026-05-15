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
    const processingOverlay = document.getElementById('processingOverlay');
    const resultsContainer = document.getElementById('resultsContainer');

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
    function processImage(file, ext) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                
                // Draw original image
                ctx.drawImage(img, 0, 0);

                removeWatermarkFromCanvas(canvas, ctx);

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

        // 2. NotebookLM PPTX exports usually bake the slides and watermark into images.
        // We need to process all large images in ppt/media/ and mask the bottom right.
        const mediaRegex = /^ppt\/media\/image\d+\.(png|jpeg|jpg)$/i;
        
        for (const relativePath in zip.files) {
            if (mediaRegex.test(relativePath)) {
                const imgBlob = await zip.file(relativePath).async("blob");
                const ext = relativePath.split('.').pop().toLowerCase();
                const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
                
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
                
                zip.file(relativePath, modifiedImgBlob);
            }
        }

        return await zip.generateAsync({ type: "blob" });
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
    document.querySelectorAll('.style-card').forEach(card => {
        card.addEventListener('click', () => {
            const stylePrompt = card.getAttribute('data-style');
            const prompt = `請扮演一位頂尖的視覺藝術總監。
接下來的簡報大綱，請你完全套用以下視覺風格來進行每一頁的設計指導：

【指定視覺風格】：${stylePrompt}

請在輸出每一頁的「視覺建議」時，詳細描述應使用什麼配色、材質、圖形或照片風格，確保符合上述指定的調性。
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
