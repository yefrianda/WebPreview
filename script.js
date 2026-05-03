class SharedPengumumanApp {
    constructor() {
        this.DB_NAME = 'SharedPengumumanDB';
        this.DB_VERSION = 1;
        this.STORE_NAME = 'pdfs';
        this.currentFile = null;
        this.pdfDoc = null;
        this.scale = 1.2;
        this.maxScale = 3.0;
        this.minScale = 0.5;
        this.db = null;
        this.init();
    }

    async init() {
        await this.initDB();
        this.bindEvents();
        this.setupPDFJS();
        await this.loadSharedData();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    setupPDFJS() {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    bindEvents() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const clearBtn = document.getElementById('clearBtn');
        const downloadBtn = document.getElementById('downloadBtn');
        const zoomInBtn = document.getElementById('zoomIn');
        const zoomOutBtn = document.getElementById('zoomOut');

        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadZone.addEventListener('drop', this.handleDrop.bind(this));
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        uploadBtn.addEventListener('click', () => this.shareFile());
        clearBtn.addEventListener('click', () => this.clearSharedData());
        downloadBtn.addEventListener('click', () => this.downloadFile());
        zoomInBtn.addEventListener('click', () => this.zoomIn());
        zoomOutBtn.addEventListener('click', () => this.zoomOut());
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.currentTarget.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.selectFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.selectFile(file);
        }
    }

    selectFile(file) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            this.showToast('❌ Hanya file PDF yang didukung!', 'error');
            return;
        }

        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            this.showToast('❌ Ukuran file maksimal 50MB!', 'error');
            return;
        }

        this.currentFile = file;
        document.getElementById('uploadBtn').textContent = `📤 Share ${file.name}`;
        document.getElementById('uploadBtn').disabled = false;
        this.showToast(`✅ File siap di-share: ${file.name} (${(file.size/1024/1024).toFixed(1)}MB)`, 'success');
    }

    // 🚀 LOAD LATEST SHARED PDF
    async loadSharedData() {
        try {
            this.showLoading(true);
            const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
            const store = transaction.objectStore(this.STORE_NAME);
            const request = store.get('latest');
            
            return new Promise((resolve) => {
                request.onsuccess = async (e) => {
                    const data = e.target.result;
                    if (data) {
                        this.currentFile = this.base64ToBlob(data.base64data, 'application/pdf');
                        document.getElementById('fileNameText').textContent = data.filename;
                        document.getElementById('fileName').classList.remove('hidden');
                        document.getElementById('downloadBtn').classList.remove('hidden');
                        document.getElementById('sharedStatus').classList.remove('hidden');
                        
                        this.updateStatusIndicator(data.filename, true);
                        
                        const arrayBuffer = await this.currentFile.arrayBuffer();
                        this.pdfDoc = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
                        await this.renderAllPages();
                        
                        this.showToast(`✅ Loaded: ${data.filename}`, 'success');
                    }
                    resolve();
                };
                
                request.onerror = () => {
                    console.log('No shared PDF found');
                    resolve();
                };
            });
        } catch (error) {
            console.error('Load error:', error);
            this.showToast('Gagal load data shared', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // 🚀 SHARE NEW PDF - Update untuk semua user
    async shareFile() {
        if (!this.currentFile) {
            this.showToast('Pilih file PDF dulu!', 'warning');
            return;
        }

        this.showLoading(true);
        
        try {
            const base64data = await this.fileToBase64(this.currentFile);
            const filename = this.currentFile.name;
            const data = {
                id: 'latest',
                filename,
                base64data,
                timestamp: new Date().toISOString(),
                size: this.currentFile.size
            };

            // 🚀 Save to IndexedDB - UNLIMITED STORAGE
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            await store.put(data);
            
            // Update UI
            document.getElementById('fileNameText').textContent = filename;
            document.getElementById('fileName').classList.remove('hidden');
            document.getElementById('downloadBtn').classList.remove('hidden');
            document.getElementById('sharedStatus').classList.remove('hidden');
            
            // Render
            const arrayBuffer = await this.currentFile.arrayBuffer();
            this.pdfDoc = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
            await this.renderAllPages();
            
            this.updateStatusIndicator(filename, true);
            this.showToast(`🎉 Berhasil di-share ke semua user: ${filename}`, 'success');
            
        } catch (error) {
            console.error('Share error:', error);
            this.showToast('Gagal upload PDF!', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // File to Base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
        });
    }

    // Base64 to Blob
    base64ToBlob(base64, mime) {
        try {
            const byteCharacters = atob(base64.split(',')[1]);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray], { type: mime });
        } catch (e) {
            throw new Error('Invalid base64 data');
        }
    }

    async renderAllPages() {
        const container = document.getElementById('previewContainer');
        container.innerHTML = '<div class="flex flex-col items-center space-y-6 w-full px-4"></div>';
        const pagesContainer = container.querySelector('div');

        if (!this.pdfDoc) return;

        const totalPages = this.pdfDoc.numPages;
        
        // Page info
        const pageInfo = document.createElement('div');
        pageInfo.className = 'bg-white/80 backdrop-blur-sm rounded-3xl px-8 py-4 shadow-xl text-center w-full max-w-4xl border';
        pageInfo.innerHTML = `
            <div class="text-lg font-bold text-gray-800 mb-1">
                📄 ${totalPages} Halaman Pengumuman
            </div>
            <div class="text-sm text-gray-600 flex items-center justify-center">
                <i class="fas fa-users mr-2 text-green-500"></i>
                Tersedia untuk semua user • Zoom: +/- 
            </div>
        `;
        pagesContainer.appendChild(pageInfo);

        // Render each page
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            try {
                const pageElement = await this.renderSinglePage(pageNum);
                pagesContainer.appendChild(pageElement);
            } catch (error) {
                console.error(`Error rendering page ${pageNum}:`, error);
            }
        }
    }

    async renderSinglePage(pageNum) {
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.scale });
        
        const wrapper = document.createElement('div');
        wrapper.className = 'w-full flex flex-col items-center space-y-4';
        
        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'bg-white rounded-3xl shadow-2xl p-4 border border-gray-200 w-full max-w-4xl';
        
        const canvas = document.createElement('canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = 'pdf-canvas w-full h-auto rounded-2xl';
        
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        
        canvasWrapper.appendChild(canvas);
        
        const pageLabel = document.createElement('div');
        pageLabel.className = 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-2 rounded-2xl text-sm font-bold shadow-lg';
        pageLabel.innerHTML = `<i class="fas fa-layer-group mr-2"></i> Halaman ${pageNum}`;
        
        wrapper.appendChild(canvasWrapper);
        wrapper.appendChild(pageLabel);
        
        return wrapper;
    }

    zoomIn() {
        if (this.scale < this.maxScale) {
            this.scale += 0.3;
            this.reRenderPDF();
        }
    }

    zoomOut() {
        if (this.scale > this.minScale) {
            this.scale -= 0.3;
            this.reRenderPDF();
        }
    }

    async reRenderPDF() {
        if (this.pdfDoc) {
            await this.renderAllPages();
        }
    }

    async clearSharedData() {
        if (confirm('⚠️ Hapus pengumuman untuk SEMUA USER?')) {
            const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
            const store = transaction.objectStore(this.STORE_NAME);
            await store.delete('latest');
            
            this.clearUI();
            this.showToast('🗑️ Pengumuman dihapus untuk semua user', 'info');
        }
    }

    clearUI() {
        document.getElementById('previewContainer').innerHTML = `
            <div class="text-center py-20">
                <i class="fas fa-file-pdf text-9xl text-gray-300 mb-12"></i>
                <h3 class="text-4xl font-bold text-gray-400 mb-6">Belum Ada Pengumuman Aktif</h3>
                <p class="text-2xl text-gray-500 mb-8">Upload PDF untuk dibagikan ke semua user</p>
                <div class="bg-blue-100 border border-blue-200 rounded-2xl p-6 max-w-md mx-auto">
                    <i class="fas fa-link text-blue-500 text-2xl mb-3 block"></i>
                    <p class="text-blue-800 font-semibold">Bagikan link ini!</p>
                    <p class="text-sm text-blue-600">Semua yang buka link sama akan lihat PDF yang sama</p>
                </div>
            </div>
        `;
        document.getElementById('fileName').classList.add('hidden');
        document.getElementById('downloadBtn').classList.add('hidden');
        document.getElementById('sharedStatus').classList.add('hidden');
        document.getElementById('uploadBtn').textContent = '📤 Pilih File Dulu';
        document.getElementById('uploadBtn').disabled = true;
        this.currentFile = null;
        this.pdfDoc = null;
        this.scale = 1.2;
        this.updateStatusIndicator('Tidak ada', false);
    }

    downloadFile() {
        if (this.currentFile) {
            const url = URL.createObjectURL(this.currentFile);
            const a = document.createElement('a');
            a.href = url;
            a.download = this.currentFile.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast('📥 PDF diunduh!', 'success');
        }
    }

    updateStatusIndicator(filename, hasFile) {
        const statusIndicator = document.getElementById('statusIndicator');
        if (hasFile) {
            statusIndicator.innerHTML = `
                <div class="bg-green-100 border-2 border-green-300 rounded-2xl p-6 text-center shadow-lg">
                    <i class="fas fa-check-circle text-4xl text-green-500 mb-4"></i>
                    <div class="font-bold text-xl text-gray-800 truncate" title="${filename}">${filename}</div>
                    <div class="text-sm text-green-700 font-semibold mt-2 flex items-center justify-center">
                        <i class="fas fa-users mr-2"></i> ✅ Tersedia untuk SEMUA user
                    </div>
                </div>
            `;
        } else {
            statusIndicator.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-cloud-upload-alt text-5xl text-gray-400 mb-4"></i>
                    <p class="text-xl font-semibold text-gray-600">Belum ada pengumuman</p>
                    <p class="text-sm text-gray-500">Upload PDF pertama</p>
                </div>
            `;
        }
    }

    showLoading(show) {
        document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
        document.getElementById('loadingOverlay').querySelector('h3').textContent = show ? 'Memuat pengumuman...' : '';
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-triangle',
            warning: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };
        
        const colors = {
            success: 'bg-green-500/90 shadow-green-500/25',
            error: 'bg-red-500/90 shadow-red-500/25',
            warning: 'bg-yellow-500/90 shadow-yellow-500/25',
            info: 'bg-blue-500/90 shadow-blue-500/25'
        };
        
        toast.className = `fixed top-24 right-6 z-50 p-6 rounded-3xl shadow-2xl text-white transform translate-x-full transition-all duration-300 max-w-sm font-medium border backdrop-blur-md ${colors[type] || colors.info}`;
        toast.innerHTML = `
            <div class="flex items-center">
                <i class="${icons[type] || icons.info} text-xl mr-3"></i>
                <div>${message}</div>
            </div>
        `;
        
        container.appendChild(toast);
        setTimeout(() => toast.classList.remove('translate-x-full'), 100);
        
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => container.removeChild(toast), 400);
        }, 5000);
    }
}

// 🚀 Start app
document.addEventListener('DOMContentLoaded', async () => {
    const app = new SharedPengumumanApp();
});
