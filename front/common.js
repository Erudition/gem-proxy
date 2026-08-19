// =====================================================================
// GCLI2API Control Panel PublicJavaScriptModule
// =====================================================================

// =====================================================================
// Global State Management
// =====================================================================
const AppState = {
    // Authentication Related
    authToken: '',
    authInProgress: false,
    currentProjectId: '',

    // AntigravityAuthentication
    antigravityAuthState: null,
    antigravityAuthInProgress: false,

    // Credential Management
    creds: createCredsManager('normal'),
    antigravityCreds: createCredsManager('antigravity'),

    // File Upload
    uploadFiles: createUploadManager('normal'),
    antigravityUploadFiles: createUploadManager('antigravity'),

    // Configuration Management
    currentConfig: {},
    envLockedFields: new Set(),

    // Log Management
    logWebSocket: null,
    allLogs: [],
    filteredLogs: [],
    currentLogFilter: 'all',

    // Usage Statistics
    usageStatsData: {},

    // Cooldown Countdown
    cooldownTimerInterval: null
};

// =====================================================================
// Credential Manager Factory
// =====================================================================
function createCredsManager(type) {
    const modeParam = type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';

    return {
        type: type,
        data: {},
        filteredData: {},
        currentPage: 1,
        pageSize: 20,
        selectedFiles: new Set(),
        totalCount: 0,
        currentStatusFilter: 'all',
        currentErrorCodeFilter: 'all',
        currentCooldownFilter: 'all',
        statsData: { total: 0, normal: 0, disabled: 0 },

        // APIEndpoint
        getEndpoint: (action) => {
            const endpoints = {
                status: `./creds/status`,
                action: `./creds/action`,
                batchAction: `./creds/batch-action`,
                download: `./creds/download`,
                downloadAll: `./creds/download-all`,
                detail: `./creds/detail`,
                fetchEmail: `./creds/fetch-email`,
                refreshAllEmails: `./creds/refresh-all-emails`,
                deduplicate: `./creds/deduplicate-by-email`,
                verifyProject: `./creds/verify-project`,
                quota: `./creds/quota`
            };
            return endpoints[action] || '';
        },

        // GetmodeParameters
        getModeParam: () => modeParam,

        // DOMElementIDprefix
        getElementId: (suffix) => {
            // for normal credentialsIDLowercase first letter,such as credsLoading
            // AntigravityofIDYes antigravity + Uppercase first letter,such as antigravityCredsLoading
            if (type === 'antigravity') {
                return 'antigravity' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
            }
            return suffix.charAt(0).toLowerCase() + suffix.slice(1);
        },

        // Refresh credential list
        async refresh() {
            const loading = document.getElementById(this.getElementId('CredsLoading'));
            const list = document.getElementById(this.getElementId('CredsList'));

            try {
                loading.style.display = 'block';
                list.innerHTML = '';

                const offset = (this.currentPage - 1) * this.pageSize;
                const errorCodeFilter = this.currentErrorCodeFilter || 'all';
                const cooldownFilter = this.currentCooldownFilter || 'all';
                const response = await fetch(
                    `${this.getEndpoint('status')}?offset=${offset}&limit=${this.pageSize}&status_filter=${this.currentStatusFilter}&error_code_filter=${errorCodeFilter}&cooldown_filter=${cooldownFilter}&${this.getModeParam()}`,
                    { headers: getAuthHeaders() }
                );

                const data = await response.json();

                if (response.ok) {
                    this.data = {};
                    data.items.forEach(item => {
                        this.data[item.filename] = {
                            filename: item.filename,
                            status: {
                                disabled: item.disabled,
                                error_codes: item.error_codes || [],
                                last_success: item.last_success,
                            },
                            user_email: item.user_email,
                            model_cooldowns: item.model_cooldowns || {}
                        };
                    });

                    this.totalCount = data.total;
                    // Use global statistics returned by backend
                    if (data.stats) {
                        this.statsData = data.stats;
                    } else {
                        // Compatible with old backend versions
                        this.calculateStats();
                    }
                    this.updateStatsDisplay();
                    this.filteredData = this.data;
                    this.renderList();
                    this.updatePagination();

                    let msg = `Loaded ${data.total} units${type === 'antigravity' ? 'Antigravity' : ''}Credential File`;
                    if (this.currentStatusFilter !== 'all') {
                        msg += ` (Filter: ${this.currentStatusFilter === 'enabled' ? 'Enabled only' : 'Disabled only'})`;
                    }
                    showStatus(msg, 'success');
                } else {
                    showStatus(`Loading failed: ${data.detail || data.error || 'Unknown Error'}`, 'error');
                }
            } catch (error) {
                showStatus(`Network Error: ${error.message}`, 'error');
            } finally {
                loading.style.display = 'none';
            }
        },

        // Calculate statistics (only for old backend compatibility)
        calculateStats() {
            this.statsData = { total: this.totalCount, normal: 0, disabled: 0 };
            Object.values(this.data).forEach(credInfo => {
                if (credInfo.status.disabled) {
                    this.statsData.disabled++;
                } else {
                    this.statsData.normal++;
                }
            });
        },

        // Update statistics display
        updateStatsDisplay() {
            document.getElementById(this.getElementId('StatTotal')).textContent = this.statsData.total;
            document.getElementById(this.getElementId('StatNormal')).textContent = this.statsData.normal;
            document.getElementById(this.getElementId('StatDisabled')).textContent = this.statsData.disabled;
        },

        // Render credential list
        renderList() {
            const list = document.getElementById(this.getElementId('CredsList'));
            list.innerHTML = '';

            const entries = Object.entries(this.filteredData);

            if (entries.length === 0) {
                const msg = this.totalCount === 0 ? 'No credential files' : 'No data under current filter';
                list.innerHTML = `<p style="text-align: center; color: #666;">${msg}</p>`;
                document.getElementById(this.getElementId('PaginationContainer')).style.display = 'none';
                return;
            }

            entries.forEach(([, credInfo]) => {
                list.appendChild(createCredCard(credInfo, this));
            });

            document.getElementById(this.getElementId('PaginationContainer')).style.display =
                this.getTotalPages() > 1 ? 'flex' : 'none';
            this.updateBatchControls();
        },

        // Get total pages
        getTotalPages() {
            return Math.ceil(this.totalCount / this.pageSize);
        },

        // Update pagination info
        updatePagination() {
            const totalPages = this.getTotalPages();
            const startItem = (this.currentPage - 1) * this.pageSize + 1;
            const endItem = Math.min(this.currentPage * this.pageSize, this.totalCount);

            document.getElementById(this.getElementId('PaginationInfo')).textContent =
                `No. ${this.currentPage} pages ${totalPages} Page (Show ${startItem}-${endItem}, total ${this.totalCount} items)`;

            document.getElementById(this.getElementId('PrevPageBtn')).disabled = this.currentPage <= 1;
            document.getElementById(this.getElementId('NextPageBtn')).disabled = this.currentPage >= totalPages;
        },

        // Switch page
        changePage(direction) {
            const newPage = this.currentPage + direction;
            if (newPage >= 1 && newPage <= this.getTotalPages()) {
                this.currentPage = newPage;
                this.refresh();
            }
        },

        // Change page size
        changePageSize() {
            this.pageSize = parseInt(document.getElementById(this.getElementId('PageSizeSelect')).value);
            this.currentPage = 1;
            this.refresh();
        },

        // Apply status filter
        applyStatusFilter() {
            this.currentStatusFilter = document.getElementById(this.getElementId('StatusFilter')).value;
            const errorCodeFilterEl = document.getElementById(this.getElementId('ErrorCodeFilter'));
            const cooldownFilterEl = document.getElementById(this.getElementId('CooldownFilter'));
            this.currentErrorCodeFilter = errorCodeFilterEl ? errorCodeFilterEl.value : 'all';
            this.currentCooldownFilter = cooldownFilterEl ? cooldownFilterEl.value : 'all';
            this.currentPage = 1;
            this.refresh();
        },

        // Update batch controls
        updateBatchControls() {
            const selectedCount = this.selectedFiles.size;
            document.getElementById(this.getElementId('SelectedCount')).textContent = `Selected ${selectedCount} items`;

            const batchBtns = ['Enable', 'Disable', 'Delete', 'Verify'].map(action =>
                document.getElementById(this.getElementId(`Batch${action}Btn`))
            );
            batchBtns.forEach(btn => btn && (btn.disabled = selectedCount === 0));

            const selectAllCheckbox = document.getElementById(this.getElementId('SelectAllCheckbox'));
            if (!selectAllCheckbox) return;

            const checkboxes = document.querySelectorAll(`.${this.getElementId('file-checkbox')}`);
            const currentPageSelectedCount = Array.from(checkboxes)
                .filter(cb => this.selectedFiles.has(cb.getAttribute('data-filename'))).length;

            if (currentPageSelectedCount === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (currentPageSelectedCount === checkboxes.length) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
            }

            checkboxes.forEach(cb => {
                cb.checked = this.selectedFiles.has(cb.getAttribute('data-filename'));
            });
        },

        // Credential Operation
        async action(filename, action) {
            try {
                const response = await fetch(`${this.getEndpoint('action')}?${this.getModeParam()}`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ filename, action })
                });

                const data = await response.json();

                if (response.ok) {
                    showStatus(data.message || `Operation successful: ${action}`, 'success');
                    await this.refresh();
                } else {
                    showStatus(`Operation failed: ${data.detail || data.error || 'Unknown Error'}`, 'error');
                }
            } catch (error) {
                showStatus(`Network Error: ${error.message}`, 'error');
            }
        },

        // Batch Operation
        async batchAction(action) {
            const selectedFiles = Array.from(this.selectedFiles);

            if (selectedFiles.length === 0) {
                showStatus('Please select files to operate on first', 'error');
                return;
            }

            const actionNames = { enable: 'Enable', disable: 'Disable', delete: 'Delete' };
            const confirmMsg = action === 'delete'
                ? `Are you sure you want to delete the selected ${selectedFiles.length} files?\nNote: This operation is irreversible!`
                : `Are you sure you want to${actionNames[action]}the selected ${selectedFiles.length} files?`;

            if (!confirm(confirmMsg)) return;

            try {
                showStatus(`Executing batch${actionNames[action]}operation...`, 'info');

                const response = await fetch(`${this.getEndpoint('batchAction')}?${this.getModeParam()}`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ action, filenames: selectedFiles })
                });

                const data = await response.json();

                if (response.ok) {
                    const successCount = data.success_count || data.succeeded;
                    showStatus(`Batch operation complete: successfully processed ${successCount}/${selectedFiles.length} files`, 'success');
                    this.selectedFiles.clear();
                    this.updateBatchControls();
                    await this.refresh();
                } else {
                    showStatus(`Batch operation failed: ${data.detail || data.error || 'Unknown Error'}`, 'error');
                }
            } catch (error) {
                showStatus(`Batch operation network error: ${error.message}`, 'error');
            }
        }
    };
}

// =====================================================================
// File Upload Manager Factory
// =====================================================================
function createUploadManager(type) {
    const modeParam = type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';
    const endpoint = `./creds/upload?${modeParam}`;

    return {
        type: type,
        selectedFiles: [],

        getElementId: (suffix) => {
            // for normal uploadIDLowercase first letter,such as fileList
            // AntigravityofIDYes antigravity + Uppercase first letter,such as antigravityFileList
            if (type === 'antigravity') {
                return 'antigravity' + suffix.charAt(0).toUpperCase() + suffix.slice(1);
            }
            return suffix.charAt(0).toLowerCase() + suffix.slice(1);
        },

        handleFileSelect(event) {
            this.addFiles(Array.from(event.target.files));
        },

        addFiles(files) {
            files.forEach(file => {
                const isValid = file.type === 'application/json' || file.name.endsWith('.json') ||
                    file.type === 'application/zip' || file.name.endsWith('.zip');

                if (isValid) {
                    if (!this.selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
                        this.selectedFiles.push(file);
                    }
                } else {
                    showStatus(`File ${file.name} Format not supported; only supportsJSONandZIPFile`, 'error');
                }
            });
            this.updateFileList();
        },

        updateFileList() {
            const list = document.getElementById(this.getElementId('FileList'));
            const section = document.getElementById(this.getElementId('FileListSection'));

            if (!list || !section) {
                console.warn('File list elements not found:', this.getElementId('FileList'));
                return;
            }

            if (this.selectedFiles.length === 0) {
                section.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            list.innerHTML = '';

            this.selectedFiles.forEach((file, index) => {
                const isZip = file.name.endsWith('.zip');
                const fileIcon = isZip ? '📦' : '📄';
                const fileType = isZip ? ' (ZIPzip package)' : ' (JSONFile)';

                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.innerHTML = `
                    <div>
                        <span class="file-name">${fileIcon} ${file.name}</span>
                        <span class="file-size">(${formatFileSize(file.size)}${fileType})</span>
                    </div>
                    <button class="remove-btn" onclick="${type === 'antigravity' ? 'removeAntigravityFile' : 'removeFile'}(${index})">Delete</button>
                `;
                list.appendChild(fileItem);
            });
        },

        removeFile(index) {
            this.selectedFiles.splice(index, 1);
            this.updateFileList();
        },

        clearFiles() {
            this.selectedFiles = [];
            this.updateFileList();
        },

        async upload() {
            if (this.selectedFiles.length === 0) {
                showStatus('Please select files to upload', 'error');
                return;
            }

            const progressSection = document.getElementById(this.getElementId('UploadProgressSection'));
            const progressFill = document.getElementById(this.getElementId('ProgressFill'));
            const progressText = document.getElementById(this.getElementId('ProgressText'));

            progressSection.classList.remove('hidden');

            const formData = new FormData();
            this.selectedFiles.forEach(file => formData.append('files', file));

            if (this.selectedFiles.some(f => f.name.endsWith('.zip'))) {
                showStatus('Uploading and extractingZIPFile...', 'info');
            }

            try {
                const xhr = new XMLHttpRequest();
                xhr.timeout = 300000; // 5minutes

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = (event.loaded / event.total) * 100;
                        progressFill.style.width = percent + '%';
                        progressText.textContent = Math.round(percent) + '%';
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            showStatus(`Successfully uploaded ${data.uploaded_count} units${type === 'antigravity' ? 'Antigravity' : ''}File`, 'success');
                            this.clearFiles();
                            progressSection.classList.add('hidden');
                        } catch (e) {
                            showStatus('Upload failed: Server response format error', 'error');
                        }
                    } else {
                        try {
                            const error = JSON.parse(xhr.responseText);
                            showStatus(`Upload failed: ${error.detail || error.error || 'Unknown Error'}`, 'error');
                        } catch (e) {
                            showStatus(`Upload failed: HTTP ${xhr.status}`, 'error');
                        }
                    }
                };

                xhr.onerror = () => {
                    showStatus(`Upload failed: connection interrupted - Possible reason: too many files(${this.selectedFiles.length}units)or network unstable. Recommended to upload in batches.`, 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.ontimeout = () => {
                    showStatus('Upload failed: request timeout - File processing took too long; please reduce file count or check network', 'error');
                    progressSection.classList.add('hidden');
                };

                xhr.open('POST', endpoint);
                xhr.setRequestHeader('Authorization', `Bearer ${AppState.authToken}`);
                xhr.send(formData);
            } catch (error) {
                showStatus(`Upload failed: ${error.message}`, 'error');
            }
        }
    };
}

// =====================================================================
// Utility Functions
// =====================================================================
function showStatus(message, type = 'info') {
    const statusSection = document.getElementById('statusSection');
    if (statusSection) {
        // Clear previous timer
        if (window._statusTimeout) {
            clearTimeout(window._statusTimeout);
        }

        // Create new toast
        statusSection.innerHTML = `<div class="status ${type}">${message}</div>`;
        const statusDiv = statusSection.querySelector('.status');

        // Force redraw to trigger animation
        statusDiv.offsetHeight;
        statusDiv.classList.add('show');

        // 3Fade out and remove after seconds
        window._statusTimeout = setTimeout(() => {
            statusDiv.classList.add('fade-out');
            setTimeout(() => {
                statusSection.innerHTML = '';
            }, 300); // Wait for fade-out animation to complete
        }, 3000);
    } else {
        alert(message);
    }
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.authToken}`
    };
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / (1024 * 1024)) + ' MB';
}

function formatCooldownTime(remainingSeconds) {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

// =====================================================================
// Credential Card Creation (General)
// =====================================================================
function createCredCard(credInfo, manager) {
    const div = document.createElement('div');
    const { status, filename } = credInfo;
    const managerType = manager.type;

    // Card Style
    div.className = status.disabled ? 'cred-card disabled' : 'cred-card';

    // Status Badge
    let statusBadges = '';
    statusBadges += status.disabled
        ? '<span class="status-badge disabled">Disabled</span>'
        : '<span class="status-badge enabled">Enabled</span>';

    if (status.error_codes && status.error_codes.length > 0) {
        statusBadges += `<span class="error-codes">Error Code: ${status.error_codes.join(', ')}</span>`;
        const autoBan = status.error_codes.filter(c => c === 400 || c === 403);
        if (autoBan.length > 0 && status.disabled) {
            statusBadges += '<span class="status-badge" style="background-color: #e74c3c; color: white;">AUTO_BAN</span>';
        }
    } else {
        statusBadges += '<span class="status-badge" style="background-color: #28a745; color: white;">No Error</span>';
    }

    // Model-level Cooldown Status
    if (credInfo.model_cooldowns && Object.keys(credInfo.model_cooldowns).length > 0) {
        const currentTime = Date.now() / 1000;
        const activeCooldowns = Object.entries(credInfo.model_cooldowns)
            .filter(([, until]) => until > currentTime)
            .map(([model, until]) => {
                const remaining = Math.max(0, Math.floor(until - currentTime));
                const shortModel = model.replace('gemini-', '').replace('-exp', '')
                    .replace('2.0-', '2-').replace('1.5-', '1.5-');
                return {
                    model: shortModel,
                    time: formatCooldownTime(remaining).replace(/s$/, '').replace(/ /g, ''),
                    fullModel: model
                };
            });

        if (activeCooldowns.length > 0) {
            activeCooldowns.slice(0, 2).forEach(item => {
                statusBadges += `<span class="cooldown-badge" style="background-color: #17a2b8;" title="Model: ${item.fullModel}">🔧 ${item.model}: ${item.time}</span>`;
            });
            if (activeCooldowns.length > 2) {
                const remaining = activeCooldowns.length - 2;
                const remainingModels = activeCooldowns.slice(2).map(i => `${i.fullModel}: ${i.time}`).join('\n');
                statusBadges += `<span class="cooldown-badge" style="background-color: #17a2b8;" title="Other Models:\n${remainingModels}">+${remaining}</span>`;
            }
        }
    }

    // PathID
    const pathId = (managerType === 'antigravity' ? 'ag_' : '') + btoa(encodeURIComponent(filename)).replace(/[+/=]/g, '_');

    // Operation Buttons
    const actionButtons = `
        ${status.disabled
            ? `<button class="cred-btn enable" data-filename="${filename}" data-action="enable">Enable</button>`
            : `<button class="cred-btn disable" data-filename="${filename}" data-action="disable">Disable</button>`
        }
        <button class="cred-btn view" onclick="toggle${managerType === 'antigravity' ? 'Antigravity' : ''}CredDetails('${pathId}')">View Content</button>
        <button class="cred-btn download" onclick="download${managerType === 'antigravity' ? 'Antigravity' : ''}Cred('${filename}')">Download</button>
        <button class="cred-btn email" onclick="fetch${managerType === 'antigravity' ? 'Antigravity' : ''}UserEmail('${filename}')">View Account Email</button>
        ${managerType === 'antigravity' ? `<button class="cred-btn" style="background-color: #17a2b8;" onclick="toggleAntigravityQuotaDetails('${pathId}')" title="View quota info for this credential">View Quota</button>` : ''}
        <button class="cred-btn" style="background-color: #ff9800;" onclick="verify${managerType === 'antigravity' ? 'Antigravity' : ''}ProjectId('${filename}')" title="Re-acquireProject ID, recoverable 403Error">Verify</button>
        <button class="cred-btn delete" data-filename="${filename}" data-action="delete">Delete</button>
    `;

    // Email Info
    const emailInfo = credInfo.user_email
        ? `<div class="cred-email" style="font-size: 12px; color: #666; margin-top: 2px;">${credInfo.user_email}</div>`
        : '<div class="cred-email" style="font-size: 12px; color: #999; margin-top: 2px; font-style: italic;">Email not obtained</div>';

    const checkboxClass = manager.getElementId('file-checkbox');

    div.innerHTML = `
        <div class="cred-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" class="${checkboxClass}" data-filename="${filename}" onchange="toggle${managerType === 'antigravity' ? 'Antigravity' : ''}FileSelection('${filename}')">
                <div>
                    <div class="cred-filename">${filename}</div>
                    ${emailInfo}
                </div>
            </div>
            <div class="cred-status">${statusBadges}</div>
        </div>
        <div class="cred-actions">${actionButtons}</div>
        <div class="cred-details" id="details-${pathId}">
            <div class="cred-content" data-filename="${filename}" data-loaded="false">Click"View Content"button to load file details...</div>
        </div>
        ${managerType === 'antigravity' ? `
        <div class="cred-quota-details" id="quota-${pathId}" style="display: none;">
            <div class="cred-quota-content" data-filename="${filename}" data-loaded="false">
                Click"View Quota"button to load quota info...
            </div>
        </div>
        ` : ''}
    `;

    // Add event listener
    div.querySelectorAll('[data-filename][data-action]').forEach(button => {
        button.addEventListener('click', function () {
            const fn = this.getAttribute('data-filename');
            const action = this.getAttribute('data-action');
            if (action === 'delete') {
                if (confirm(`Are you sure you want to delete${managerType === 'antigravity' ? ' Antigravity ' : ''}credential file?\n${fn}`)) {
                    manager.action(fn, action);
                }
            } else {
                manager.action(fn, action);
            }
        });
    });

    return div;
}

// =====================================================================
// Credential details toggle
// =====================================================================
async function toggleCredDetails(pathId) {
    await toggleCredDetailsCommon(pathId, AppState.creds);
}

async function toggleAntigravityCredDetails(pathId) {
    await toggleCredDetailsCommon(pathId, AppState.antigravityCreds);
}

async function toggleCredDetailsCommon(pathId, manager) {
    const details = document.getElementById('details-' + pathId);
    if (!details) return;

    const isShowing = details.classList.toggle('show');

    if (isShowing) {
        const contentDiv = details.querySelector('.cred-content');
        const filename = contentDiv.getAttribute('data-filename');
        const loaded = contentDiv.getAttribute('data-loaded');

        if (loaded === 'false' && filename) {
            contentDiv.textContent = 'Loading file content...';

            try {
                const modeParam = manager.type === 'antigravity' ? 'mode=antigravity' : 'mode=geminicli';
                const endpoint = `./creds/detail/${encodeURIComponent(filename)}?${modeParam}`;

                const response = await fetch(endpoint, { headers: getAuthHeaders() });

                const data = await response.json();
                if (response.ok && data.content) {
                    contentDiv.textContent = JSON.stringify(data.content, null, 2);
                    contentDiv.setAttribute('data-loaded', 'true');
                } else {
                    contentDiv.textContent = 'Unable to load file content: ' + (data.error || data.detail || 'Unknown Error');
                }
            } catch (error) {
                contentDiv.textContent = 'Failed to load file content: ' + error.message;
            }
        }
    }
}

// =====================================================================
// Login-related functions
// =====================================================================
async function login() {
    const password = document.getElementById('loginPassword').value;

    if (!password) {
        showStatus('Please enter password', 'error');
        return;
    }

    try {
        const response = await fetch('./auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (response.ok) {
            AppState.authToken = data.token;
            localStorage.setItem('gcli2api_auth_token', AppState.authToken);
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('Login successful', 'success');
            // Initialize slider after showing panel
            requestAnimationFrame(() => initTabSlider());
        } else {
            showStatus(`Login failed: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

async function autoLogin() {
    const savedToken = localStorage.getItem('gcli2api_auth_token');
    if (!savedToken) return false;

    AppState.authToken = savedToken;

    try {
        const response = await fetch('./config/get', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AppState.authToken}`
            }
        });

        if (response.ok) {
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('mainSection').classList.remove('hidden');
            showStatus('Auto-login successful', 'success');
            // Initialize slider after showing panel
            requestAnimationFrame(() => initTabSlider());
            return true;
        } else if (response.status === 401) {
            localStorage.removeItem('gcli2api_auth_token');
            AppState.authToken = '';
            return false;
        }
        return false;
    } catch (error) {
        return false;
    }
}

function logout() {
    localStorage.removeItem('gcli2api_auth_token');
    AppState.authToken = '';
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('mainSection').classList.add('hidden');
    showStatus('Logged out', 'info');
    const passwordInput = document.getElementById('loginPassword');
    if (passwordInput) passwordInput.value = '';
}

function handlePasswordEnter(event) {
    if (event.key === 'Enter') login();
}

// =====================================================================
// Tab switching
// =====================================================================

// Update slider position
function updateTabSlider(targetTab, animate = true) {
    const slider = document.querySelector('.tab-slider');
    const tabs = document.querySelector('.tabs');
    if (!slider || !tabs || !targetTab) return;

    // Get button position and container width
    const tabLeft = targetTab.offsetLeft;
    const tabWidth = targetTab.offsetWidth;
    const tabsWidth = tabs.scrollWidth;

    // Use left and right Control simultaneously to ensure animation synchronization
    const rightValue = tabsWidth - tabLeft - tabWidth;

    if (animate) {
        slider.style.left = `${tabLeft}px`;
        slider.style.right = `${rightValue}px`;
    } else {
        // Do not use animation on first load
        slider.style.transition = 'none';
        slider.style.left = `${tabLeft}px`;
        slider.style.right = `${rightValue}px`;
        // Restore transition after forced redraw
        slider.offsetHeight;
        slider.style.transition = '';
    }
}

// Initialize slider position
function initTabSlider() {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
        updateTabSlider(activeTab, false);
    }
}

// Initialize slider on page load and window resize
document.addEventListener('DOMContentLoaded', initTabSlider);
window.addEventListener('resize', () => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) updateTabSlider(activeTab, false);
});

function switchTab(tabName) {
    // Get current active content area
    const currentContent = document.querySelector('.tab-content.active');
    const targetContent = document.getElementById(tabName + 'Tab');

    // If the clicked tab is the current one
    if (currentContent === targetContent) return;

    // Find target tab button
    const targetTab = event && event.target ? event.target :
        document.querySelector(`.tab[onclick*="'${tabName}'"]`);

    // Remove from all tabsactiveStatus
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

    // Add to currently clicked tabactiveStatus
    if (targetTab) {
        targetTab.classList.add('active');
        // Update slider position (with animation)
        updateTabSlider(targetTab, true);
    }

    // Fade out current content
    if (currentContent) {
        // Set fade-out transition
        currentContent.style.transition = 'opacity 0.18s ease-out, transform 0.18s ease-out';
        currentContent.style.opacity = '0';
        currentContent.style.transform = 'translateX(-12px)';

        setTimeout(() => {
            currentContent.classList.remove('active');
            currentContent.style.transition = '';
            currentContent.style.opacity = '';
            currentContent.style.transform = '';

            // Fade in new content
            if (targetContent) {
                // Set initial state first (before adding active class)
                targetContent.style.opacity = '0';
                targetContent.style.transform = 'translateX(12px)';
                targetContent.style.transition = 'none'; // Temporarily disable transition

                // Add active class makes element visible
                targetContent.classList.add('active');

                // Use double requestAnimationFrame Ensure browser completes redraw
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Enable transition and apply final state
                        targetContent.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
                        targetContent.style.opacity = '1';
                        targetContent.style.transform = 'translateX(0)';

                        // Clean up inline styles and perform data loading
                        setTimeout(() => {
                            targetContent.style.transition = '';
                            targetContent.style.opacity = '';
                            targetContent.style.transform = '';

                            // Trigger data loading after animation completes
                            triggerTabDataLoad(tabName);
                        }, 260);
                    });
                });
            }
        }, 180);
    } else {
        // If no current content (first load)
        if (targetContent) {
            targetContent.classList.add('active');
            // Trigger data loading directly
            triggerTabDataLoad(tabName);
        }
    }
}

// Tab data loading (separated from animation)
function triggerTabDataLoad(tabName) {
    if (tabName === 'manage') AppState.creds.refresh();
    if (tabName === 'antigravity-manage') AppState.antigravityCreds.refresh();
    if (tabName === 'config') loadConfig();
    if (tabName === 'logs') connectWebSocket();
}


// =====================================================================
// OAuthAuthentication-related functions
// =====================================================================
async function startAuth() {
    const projectId = document.getElementById('projectId').value.trim();
    AppState.currentProjectId = projectId || null;

    const btn = document.getElementById('getAuthBtn');
    btn.disabled = true;
    btn.textContent = 'Fetching authentication link...';

    try {
        const requestBody = projectId ? { project_id: projectId } : {};
        showStatus(projectId ? 'Use specified projectIDGenerate authentication link...' : 'Will attempt to auto-detect projectID...', 'info');

        const response = await fetch('./auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('authUrl').href = data.auth_url;
            document.getElementById('authUrl').textContent = data.auth_url;
            document.getElementById('authUrlSection').classList.remove('hidden');

            const msg = data.auto_project_detection
                ? 'Auth link generated (project will be auto-detected after authID)'
                : `Auth link generated (ProjectID: ${data.detected_project_id})`;
            showStatus(msg, 'info');
            AppState.authInProgress = true;
        } else {
            showStatus(`Error: ${data.error || 'Failed to get authentication link'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Get authentication link';
    }
}

async function getCredentials() {
    if (!AppState.authInProgress) {
        showStatus('Please get the auth link and complete authorization first', 'error');
        return;
    }

    const btn = document.getElementById('getCredsBtn');
    btn.disabled = true;
    btn.textContent = 'Waiting forOAuthIn callback...';

    try {
        showStatus('WaitingOAuthcallback...', 'info');

        const requestBody = AppState.currentProjectId ? { project_id: AppState.currentProjectId } : {};

        const response = await fetch('./auth/callback', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('credentialsContent').textContent = JSON.stringify(data.credentials, null, 2);

            const msg = data.auto_detected_project
                ? `✅ Authentication successful! ProjectIDAuto-detected as: ${data.credentials.project_id}: ${data.file_path}`
                : `✅ Authentication successful! File saved to: ${data.file_path}`;
            showStatus(msg, 'success');

            document.getElementById('credentialsSection').classList.remove('hidden');
            AppState.authInProgress = false;
        } else if (data.requires_project_selection && data.available_projects) {
            let projectOptions = "Please select a project:\n\n";
            data.available_projects.forEach((project, index) => {
                projectOptions += `${index + 1}. ${project.name} (${project.project_id})\n`;
            });
            projectOptions += `\nPlease enter the serial number (1-${data.available_projects.length}):`;

            const selection = prompt(projectOptions);
            const projectIndex = parseInt(selection) - 1;

            if (projectIndex >= 0 && projectIndex < data.available_projects.length) {
                AppState.currentProjectId = data.available_projects[projectIndex].project_id;
                btn.textContent = 'Retry fetching authentication file';
                showStatus(`Retry with selected project...`, 'info');
                setTimeout(() => getCredentials(), 1000);
                return;
            } else {
                showStatus('Invalid selection', 'error');
            }
        } else if (data.requires_manual_project_id) {
            const userProjectId = prompt('Unable to auto-detect projectIDGoogle CloudProjectID:');
            if (userProjectId && userProjectId.trim()) {
                AppState.currentProjectId = userProjectId.trim();
                btn.textContent = 'Retry fetching authentication file';
                showStatus('Use manually entered projectIDRetry...', 'info');
                setTimeout(() => getCredentials(), 1000);
                return;
            } else {
                showStatus('Project requiredIDto complete authenticationID', 'error');
            }
        } else {
            showStatus(`❌ Error: ${data.error || 'Failed to get authentication file'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Get authentication file';
    }
}

// =====================================================================
// Antigravity Authentication-related functions
// =====================================================================
async function startAntigravityAuth() {
    const btn = document.getElementById('getAntigravityAuthBtn');
    btn.disabled = true;
    btn.textContent = 'Generating authentication link...';

    try {
        showStatus('Generating Antigravity Authentication link...', 'info');

        const response = await fetch('./auth/start', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ mode: 'antigravity' })
        });

        const data = await response.json();

        if (response.ok) {
            AppState.antigravityAuthState = data.state;
            AppState.antigravityAuthInProgress = true;

            const authUrlLink = document.getElementById('antigravityAuthUrl');
            authUrlLink.href = data.auth_url;
            authUrlLink.textContent = data.auth_url;
            document.getElementById('antigravityAuthUrlSection').classList.remove('hidden');

            showStatus('✅ Antigravity Auth link generated! Please click the link to complete authorization', 'success');
        } else {
            showStatus(`❌ Error: ${data.error || 'Failed to generate authentication link'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Get Antigravity Authentication link';
    }
}

async function getAntigravityCredentials() {
    if (!AppState.antigravityAuthInProgress) {
        showStatus('Please get Antigravity auth link and complete authorization', 'error');
        return;
    }

    const btn = document.getElementById('getAntigravityCredsBtn');
    btn.disabled = true;
    btn.textContent = 'Waiting forOAuthIn callback...';

    try {
        showStatus('Waiting Antigravity OAuthCallback...', 'info');

        const response = await fetch('./auth/callback', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ mode: 'antigravity' })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('antigravityCredsContent').textContent = JSON.stringify(data.credentials, null, 2);
            document.getElementById('antigravityCredsSection').classList.remove('hidden');
            AppState.antigravityAuthInProgress = false;
            showStatus(`✅ Antigravity Authentication successful! File saved to: ${data.file_path}`, 'success');
        } else {
            showStatus(`❌ Error: ${data.error || 'Failed to get authentication file'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Get Antigravity Credentials';
    }
}

function downloadAntigravityCredentials() {
    const content = document.getElementById('antigravityCredsContent').textContent;
    const blob = new Blob([content], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antigravity-credential-${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// =====================================================================
// CallbackURLProcess
// =====================================================================
function toggleProjectIdSection() {
    const section = document.getElementById('projectIdSection');
    const icon = document.getElementById('projectIdToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(90deg)';
        icon.textContent = '▼';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▶';
    }
}

function toggleCallbackUrlSection() {
    const section = document.getElementById('callbackUrlSection');
    const icon = document.getElementById('callbackUrlToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '▲';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    }
}

function toggleAntigravityCallbackUrlSection() {
    const section = document.getElementById('antigravityCallbackUrlSection');
    const icon = document.getElementById('antigravityCallbackUrlToggleIcon');

    if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        icon.textContent = '▲';
    } else {
        section.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        icon.textContent = '▼';
    }
}

async function processCallbackUrl() {
    const callbackUrl = document.getElementById('callbackUrlInput').value.trim();

    if (!callbackUrl) {
        showStatus('Please enter callbackURL', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('Please enter a validURL(withhttp://orhttps://start)', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ This is not a valid callbackURL! Please ensure:\n1. CompletedGoogle OAuthAuthorization\n2. Copied the full browser address barURL\n3. URLcontainscodeandstateParameters', 'error');
        return;
    }

    showStatus('Getting credentials from callbackURLGet credentials...', 'info');

    try {
        const projectId = document.getElementById('projectId')?.value.trim() || null;

        const response = await fetch('./auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ callback_url: callbackUrl, project_id: projectId })
        });

        const result = await response.json();

        if (result.credentials) {
            showStatus(result.message || 'From callbackURLSuccessfully obtained credentials!', 'success');
            document.getElementById('credentialsContent').innerHTML = '<pre>' + JSON.stringify(result.credentials, null, 2) + '</pre>';
            document.getElementById('credentialsSection').classList.remove('hidden');
        } else if (result.requires_manual_project_id) {
            showStatus('Project needs to be specified manuallyIDGoogle CloudProjectIDand try again', 'error');
        } else if (result.requires_project_selection) {
            let msg = '<br><strong>Available projects:</strong><br>';
            result.available_projects.forEach(p => {
                msg += `• ${p.name} (ID: ${p.project_id})<br>`;
            });
            showStatus('Multiple projects detectedID:' + msg, 'error');
        } else {
            showStatus(result.error || 'From callbackURLFailed to get credentials', 'error');
        }

        document.getElementById('callbackUrlInput').value = '';
    } catch (error) {
        showStatus(`From callbackURLFailed to get credentials: ${error.message}`, 'error');
    }
}

async function processAntigravityCallbackUrl() {
    const callbackUrl = document.getElementById('antigravityCallbackUrlInput').value.trim();

    if (!callbackUrl) {
        showStatus('Please enter callbackURL', 'error');
        return;
    }

    if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
        showStatus('Please enter a validURL(withhttp://orhttps://start)', 'error');
        return;
    }

    if (!callbackUrl.includes('code=') || !callbackUrl.includes('state=')) {
        showStatus('❌ This is not a valid callbackURL! Please ensure it containscodeandstateParameters', 'error');
        return;
    }

    showStatus('Getting credentials from callbackURLGet Antigravity Credentials...', 'info');

    try {
        const response = await fetch('./auth/callback-url', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ callback_url: callbackUrl, mode: 'antigravity' })
        });

        const result = await response.json();

        if (result.credentials) {
            showStatus(result.message || 'From callbackURLGet Antigravity Credentials successful!', 'success');
            document.getElementById('antigravityCredsContent').textContent = JSON.stringify(result.credentials, null, 2);
            document.getElementById('antigravityCredsSection').classList.remove('hidden');
        } else {
            showStatus(result.error || 'From callbackURLGet Antigravity Credentials failed', 'error');
        }

        document.getElementById('antigravityCallbackUrlInput').value = '';
    } catch (error) {
        showStatus(`From callbackURLGet Antigravity Credentials failed: ${error.message}`, 'error');
    }
}

// =====================================================================
// Global compatibility functions (forHTMLcalls)
// =====================================================================
// Standard credential management
function refreshCredsStatus() { AppState.creds.refresh(); }
function applyStatusFilter() { AppState.creds.applyStatusFilter(); }
function changePage(direction) { AppState.creds.changePage(direction); }
function changePageSize() { AppState.creds.changePageSize(); }
function toggleFileSelection(filename) {
    if (AppState.creds.selectedFiles.has(filename)) {
        AppState.creds.selectedFiles.delete(filename);
    } else {
        AppState.creds.selectedFiles.add(filename);
    }
    AppState.creds.updateBatchControls();
}
function toggleSelectAll() {
    const checkbox = document.getElementById('selectAllCheckbox');
    const checkboxes = document.querySelectorAll('.file-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => AppState.creds.selectedFiles.add(cb.getAttribute('data-filename')));
    } else {
        AppState.creds.selectedFiles.clear();
    }
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    AppState.creds.updateBatchControls();
}
function batchAction(action) { AppState.creds.batchAction(action); }
function downloadCred(filename) {
    fetch(`./creds/download/${filename}`, { headers: { 'Authorization': `Bearer ${AppState.authToken}` } })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus(`File downloaded: ${filename}`, 'success');
        })
        .catch(() => showStatus(`Download failed: ${filename}`, 'error'));
}
async function downloadAllCreds() {
    try {
        const response = await fetch('./creds/download-all', {
            headers: { 'Authorization': `Bearer ${AppState.authToken}` }
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'credentials.zip';
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus('All credential files downloaded', 'success');
        }
    } catch (error) {
        showStatus(`Packaged download failed: ${error.message}`, 'error');
    }
}

// AntigravityCredential Management
function refreshAntigravityCredsList() { AppState.antigravityCreds.refresh(); }
function applyAntigravityStatusFilter() { AppState.antigravityCreds.applyStatusFilter(); }
function changeAntigravityPage(direction) { AppState.antigravityCreds.changePage(direction); }
function changeAntigravityPageSize() { AppState.antigravityCreds.changePageSize(); }
function toggleAntigravityFileSelection(filename) {
    if (AppState.antigravityCreds.selectedFiles.has(filename)) {
        AppState.antigravityCreds.selectedFiles.delete(filename);
    } else {
        AppState.antigravityCreds.selectedFiles.add(filename);
    }
    AppState.antigravityCreds.updateBatchControls();
}
function toggleSelectAllAntigravity() {
    const checkbox = document.getElementById('selectAllAntigravityCheckbox');
    const checkboxes = document.querySelectorAll('.antigravityFile-checkbox');

    if (checkbox.checked) {
        checkboxes.forEach(cb => AppState.antigravityCreds.selectedFiles.add(cb.getAttribute('data-filename')));
    } else {
        AppState.antigravityCreds.selectedFiles.clear();
    }
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    AppState.antigravityCreds.updateBatchControls();
}
function batchAntigravityAction(action) { AppState.antigravityCreds.batchAction(action); }
function downloadAntigravityCred(filename) {
    fetch(`./creds/download/${filename}?mode=antigravity`, { headers: getAuthHeaders() })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus(`✅ Downloaded: ${filename}`, 'success');
        })
        .catch(() => showStatus(`Download failed: ${filename}`, 'error'));
}
function deleteAntigravityCred(filename) {
    if (confirm(`Are you sure you want to delete ${filename} ?`)) {
        AppState.antigravityCreds.action(filename, 'delete');
    }
}
async function downloadAllAntigravityCreds() {
    try {
        const response = await fetch('./creds/download-all?mode=antigravity', { headers: getAuthHeaders() });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `antigravity_credentials_${Date.now()}.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
            showStatus('✅ AllAntigravityCredentials packaged and downloaded', 'success');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

// File Upload
function handleFileSelect(event) { AppState.uploadFiles.handleFileSelect(event); }
function removeFile(index) { AppState.uploadFiles.removeFile(index); }
function clearFiles() { AppState.uploadFiles.clearFiles(); }
function uploadFiles() { AppState.uploadFiles.upload(); }

function handleAntigravityFileSelect(event) { AppState.antigravityUploadFiles.handleFileSelect(event); }
function handleAntigravityFileDrop(event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = '#007bff';
    event.currentTarget.style.backgroundColor = '#f8f9fa';
    AppState.antigravityUploadFiles.addFiles(Array.from(event.dataTransfer.files));
}
function removeAntigravityFile(index) { AppState.antigravityUploadFiles.removeFile(index); }
function clearAntigravityFiles() { AppState.antigravityUploadFiles.clearFiles(); }
function uploadAntigravityFiles() { AppState.antigravityUploadFiles.upload(); }

// Email related
// Helper: Update email display in card based on filename
function updateEmailDisplay(filename, email, managerType = 'normal') {
    // Find corresponding credential card
    const containerId = managerType === 'antigravity' ? 'antigravityCredsList' : 'credsList';
    const container = document.getElementById(containerId);
    if (!container) return false;

    // via data-filename Find corresponding checkbox
    const checkbox = container.querySelector(`input[data-filename="${filename}"]`);
    if (!checkbox) return false;

    // find corresponding cred-card Element
    const card = checkbox.closest('.cred-card');
    if (!card) return false;

    // Find email display element
    const emailDiv = card.querySelector('.cred-email');
    if (emailDiv) {
        emailDiv.textContent = email;
        emailDiv.style.color = '#666';
        emailDiv.style.fontStyle = 'normal';
        return true;
    }
    return false;
}

async function fetchUserEmail(filename) {
    try {
        showStatus('Fetching user email...', 'info');
        const response = await fetch(`./creds/fetch-email/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok && data.user_email) {
            showStatus(`Email fetched successfully: ${data.user_email}`, 'success');
            // Update email display in card directly without refreshing the list
            updateEmailDisplay(filename, data.user_email, 'normal');
        } else {
            showStatus(data.message || 'Unable to fetch user email', 'error');
        }
    } catch (error) {
        showStatus(`Failed to fetch email: ${error.message}`, 'error');
    }
}

async function fetchAntigravityUserEmail(filename) {
    try {
        showStatus('Fetching user email...', 'info');
        const response = await fetch(`./creds/fetch-email/${encodeURIComponent(filename)}?mode=antigravity`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok && data.user_email) {
            showStatus(`Email fetched successfully: ${data.user_email}`, 'success');
            // Update email display in card directly without refreshing the list
            updateEmailDisplay(filename, data.user_email, 'antigravity');
        } else {
            showStatus(data.message || 'Unable to fetch user email', 'error');
        }
    } catch (error) {
        showStatus(`Failed to fetch email: ${error.message}`, 'error');
    }
}

async function verifyProjectId(filename) {
    try {
        // Show loading status
        showStatus('🔍 VerifyingProject ID...', 'info');

        const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok && data.success) {
            // Show green success message andProject ID
            const successMsg = `✅ Verification successful!\nFile: ${filename}\nProject ID: ${data.project_id}\n\n${data.message}`;
            showStatus(successMsg.replace(/\n/g, '<br>'), 'success');

            // Pop up success tip
            alert(`✅ Verification successful!\n\nFile: ${filename}\nProject ID: ${data.project_id}\n\n${data.message}`);

            await AppState.creds.refresh();
        } else {
            // Show red error message on failure
            const errorMsg = data.message || 'Verification failed';
            showStatus(`❌ ${errorMsg}`, 'error');
            alert(`❌ Verification failed\n\n${errorMsg}`);
        }
    } catch (error) {
        const errorMsg = `Verification failed: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        alert(`❌ ${errorMsg}`);
    }
}

async function verifyAntigravityProjectId(filename) {
    try {
        // Show loading status
        showStatus('🔍 VerifyingAntigravity Project ID...', 'info');

        const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}?mode=antigravity`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();

        if (response.ok && data.success) {
            // Show green success message andProject ID
            const successMsg = `✅ Verification successful!\nFile: ${filename}\nProject ID: ${data.project_id}\n\n${data.message}`;
            showStatus(successMsg.replace(/\n/g, '<br>'), 'success');

            // Pop up success tip
            alert(`✅ AntigravityVerification successful!\n\nFile: ${filename}\nProject ID: ${data.project_id}\n\n${data.message}`);

            await AppState.antigravityCreds.refresh();
        } else {
            // Show red error message on failure
            const errorMsg = data.message || 'Verification failed';
            showStatus(`❌ ${errorMsg}`, 'error');
            alert(`❌ Verification failed\n\n${errorMsg}`);
        }
    } catch (error) {
        const errorMsg = `Verification failed: ${error.message}`;
        showStatus(`❌ ${errorMsg}`, 'error');
        alert(`❌ ${errorMsg}`);
    }
}

async function toggleAntigravityQuotaDetails(pathId) {
    const quotaDetails = document.getElementById('quota-' + pathId);
    if (!quotaDetails) return;

    // Toggle display status
    const isShowing = quotaDetails.style.display === 'block';

    if (isShowing) {
        // Collapse
        quotaDetails.style.display = 'none';
    } else {
        // Expand
        quotaDetails.style.display = 'block';

        const contentDiv = quotaDetails.querySelector('.cred-quota-content');
        const filename = contentDiv.getAttribute('data-filename');
        const loaded = contentDiv.getAttribute('data-loaded');

        // Load data if not already loaded
        if (loaded === 'false' && filename) {
            contentDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">📊 Loading quota information...</div>';

            try {
                const response = await fetch(`./creds/quota/${encodeURIComponent(filename)}?mode=antigravity`, {
                    method: 'GET',
                    headers: getAuthHeaders()
                });
                const data = await response.json();

                if (response.ok && data.success) {
                    // Render beautified quota info on success
                    const models = data.models || {};

                    if (Object.keys(models).length === 0) {
                        contentDiv.innerHTML = `
                            <div style="text-align: center; padding: 20px; color: #999;">
                                <div style="font-size: 48px; margin-bottom: 10px;">📊</div>
                                <div>No quota information available</div>
                            </div>
                        `;
                    } else {
                        let quotaHTML = `
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; border-radius: 8px 8px 0 0; margin: -10px -10px 15px -10px;">
                                <h4 style="margin: 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 20px;">📊</span>
                                    <span>Quota information details</span>
                                </h4>
                                <div style="font-size: 12px; opacity: 0.9; margin-top: 5px;">File: ${filename}</div>
                            </div>
                            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
                        `;

                        for (const [modelName, quotaData] of Object.entries(models)) {
                            // Backend returns remaining ratio (0-1)
                            const remainingFraction = quotaData.remaining || 0;
                            const resetTime = quotaData.resetTime || 'N/A';

                            // Calculate used percentage (1 - remaining ratio)
                            const usedPercentage = Math.round((1 - remainingFraction) * 100);
                            const remainingPercentage = Math.round(remainingFraction * 100);

                            // Select color based on usage
                            let percentageColor = '#28a745'; // Green: Low usage
                            if (usedPercentage >= 90) percentageColor = '#dc3545'; // Red: High usage
                            else if (usedPercentage >= 70) percentageColor = '#ffc107'; // Yellow: Moderate-high usage
                            else if (usedPercentage >= 50) percentageColor = '#17a2b8'; // Blue: Medium usage

                            quotaHTML += `
                                <div style="background: white; border-left: 4px solid ${percentageColor}; border-radius: 4px; padding: 8px 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <div style="font-weight: bold; color: #333; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;" title="${modelName} - Remaining${remainingPercentage}% - ${resetTime}">
                                            ${modelName}
                                        </div>
                                        <div style="font-size: 13px; font-weight: bold; color: ${percentageColor}; white-space: nowrap;">
                                            ${remainingPercentage}%
                                        </div>
                                    </div>
                                    <div style="width: 100%; height: 8px; background-color: #e9ecef; border-radius: 4px; overflow: hidden; margin-bottom: 4px;">
                                        <div style="width: ${usedPercentage}%; height: 100%; background-color: ${percentageColor}; transition: width 0.3s ease;"></div>
                                    </div>
                                    <div style="font-size: 10px; color: #666; text-align: right;">
                                        ${resetTime !== 'N/A' ? '🔄 ' + resetTime : ''}
                                    </div>
                                </div>
                            `;
                        }

                        quotaHTML += '</div>';
                        contentDiv.innerHTML = quotaHTML;
                    }

                    contentDiv.setAttribute('data-loaded', 'true');
                    showStatus('✅ Quota information loaded successfully', 'success');
                } else {
                    // Show error on failure
                    const errorMsg = data.error || 'Failed to get quota information';
                    contentDiv.innerHTML = `
                        <div style="text-align: center; padding: 20px; color: #dc3545;">
                            <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                            <div style="font-weight: bold; margin-bottom: 5px;">Failed to get quota information</div>
                            <div style="font-size: 13px; color: #666;">${errorMsg}</div>
                        </div>
                    `;
                    showStatus(`❌ ${errorMsg}`, 'error');
                }
            } catch (error) {
                contentDiv.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #dc3545;">
                        <div style="font-size: 48px; margin-bottom: 10px;">❌</div>
                        <div style="font-weight: bold; margin-bottom: 5px;">Network Error</div>
                        <div style="font-size: 13px; color: #666;">${error.message}</div>
                    </div>
                `;
                showStatus(`❌ Failed to get quota information: ${error.message}`, 'error');
            }
        }
    }
}

async function batchVerifyProjectIds() {
    const selectedFiles = Array.from(AppState.creds.selectedFiles);
    if (selectedFiles.length === 0) {
        showStatus('❌ Please select credentials to verify first', 'error');
        alert('Please select credentials to verify first');
        return;
    }

    if (!confirm(`Are you sure you want to batch verify ${selectedFiles.length} credentials'Project ID?\n\nParallel verification will be used to speed up.`)) {
        return;
    }

    showStatus(`🔍 Parallel verification in progress ${selectedFiles.length} credentials...`, 'info');

    // Execute all verification requests in parallel
    const promises = selectedFiles.map(async (filename) => {
        try {
            const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await response.json();

            if (response.ok && data.success) {
                return { success: true, filename, projectId: data.project_id, message: data.message };
            } else {
                return { success: false, filename, error: data.message || 'Failed' };
            }
        } catch (error) {
            return { success: false, filename, error: error.message };
        }
    });

    // Wait for all requests to complete
    const results = await Promise.all(promises);

    // Statistics results
    let successCount = 0;
    let failCount = 0;
    const resultMessages = [];

    results.forEach(result => {
        if (result.success) {
            successCount++;
            resultMessages.push(`✅ ${result.filename}: ${result.projectId}`);
        } else {
            failCount++;
            resultMessages.push(`❌ ${result.filename}: ${result.error}`);
        }
    });

    await AppState.creds.refresh();

    const summary = `Batch verification complete!\n\nSuccess: ${successCount} units\nFailed: ${failCount} units\nTotal: ${selectedFiles.length} units\n\nDetailed results:\n${resultMessages.join('\n')}`;

    if (failCount === 0) {
        showStatus(`✅ All verifications successful! Successfully verified ${successCount}/${selectedFiles.length} credentials`, 'success');
    } else if (successCount === 0) {
        showStatus(`❌ All verifications failed! Failed ${failCount}/${selectedFiles.length} credentials`, 'error');
    } else {
        showStatus(`⚠️ Batch verification complete: Success ${successCount}/${selectedFiles.length} files, failed ${failCount} units`, 'info');
    }

    console.log(summary);
    alert(summary);
}

async function batchVerifyAntigravityProjectIds() {
    const selectedFiles = Array.from(AppState.antigravityCreds.selectedFiles);
    if (selectedFiles.length === 0) {
        showStatus('❌ Please select theAntigravityCredentials', 'error');
        alert('Please select theAntigravityCredentials');
        return;
    }

    if (!confirm(`Are you sure you want to batch verify ${selectedFiles.length} unitsAntigravitycredentials'Project ID?\n\nParallel verification will be used to speed up.`)) {
        return;
    }

    showStatus(`🔍 Parallel verification in progress ${selectedFiles.length} unitsAntigravitycredentials...`, 'info');

    // Execute all verification requests in parallel
    const promises = selectedFiles.map(async (filename) => {
        try {
            const response = await fetch(`./creds/verify-project/${encodeURIComponent(filename)}?mode=antigravity`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await response.json();

            if (response.ok && data.success) {
                return { success: true, filename, projectId: data.project_id, message: data.message };
            } else {
                return { success: false, filename, error: data.message || 'Failed' };
            }
        } catch (error) {
            return { success: false, filename, error: error.message };
        }
    });

    // Wait for all requests to complete
    const results = await Promise.all(promises);

    // Statistics results
    let successCount = 0;
    let failCount = 0;
    const resultMessages = [];

    results.forEach(result => {
        if (result.success) {
            successCount++;
            resultMessages.push(`✅ ${result.filename}: ${result.projectId}`);
        } else {
            failCount++;
            resultMessages.push(`❌ ${result.filename}: ${result.error}`);
        }
    });

    await AppState.antigravityCreds.refresh();

    const summary = `AntigravityBatch verification complete!\n\nSuccess: ${successCount} units\nFailed: ${failCount} units\nTotal: ${selectedFiles.length} units\n\nDetailed results:\n${resultMessages.join('\n')}`;

    if (failCount === 0) {
        showStatus(`✅ All verifications successful! Successfully verified ${successCount}/${selectedFiles.length} unitsAntigravityCredentials`, 'success');
    } else if (successCount === 0) {
        showStatus(`❌ All verifications failed! Failed ${failCount}/${selectedFiles.length} unitsAntigravityCredentials`, 'error');
    } else {
        showStatus(`⚠️ Batch verification complete: Success ${successCount}/${selectedFiles.length} files, failed ${failCount} units`, 'info');
    }

    console.log(summary);
    alert(summary);
}


async function refreshAllEmails() {
    if (!confirm('Are you sure you want to refresh all user emails? This may take some time.')) return;

    try {
        showStatus('Refreshing all user emails...', 'info');
        const response = await fetch('./creds/refresh-all-emails', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`Email refresh complete: Successfully fetched ${data.success_count}/${data.total_count} email addresses`, 'success');
            await AppState.creds.refresh();
        } else {
            showStatus(data.message || 'Email refresh failed', 'error');
        }
    } catch (error) {
        showStatus(`Email refresh network error: ${error.message}`, 'error');
    }
}

async function refreshAllAntigravityEmails() {
    if (!confirm('Are you sure you want to refresh allAntigravitycredentials' user email? This may take some time.')) return;

    try {
        showStatus('Refreshing all user emails...', 'info');
        const response = await fetch('./creds/refresh-all-emails?mode=antigravity', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            showStatus(`Email refresh complete: Successfully fetched ${data.success_count}/${data.total_count} email addresses`, 'success');
            await AppState.antigravityCreds.refresh();
        } else {
            showStatus(data.message || 'Email refresh failed', 'error');
        }
    } catch (error) {
        showStatus(`Email refresh network error: ${error.message}`, 'error');
    }
}

async function deduplicateByEmail() {
    if (!confirm('Are you sure you want to perform one-click credential deduplication?\n\nOnly one credential per email will be kept\nThis action cannot be undone!')) return;

    try {
        showStatus('One-click credential deduplication in progress...', 'info');
        const response = await fetch('./creds/deduplicate-by-email', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            const msg = `Deduplication complete: Deleted ${data.deleted_count} duplicate credentials ${data.kept_count} credentials (${data.unique_emails_count} unique emails)`;
            showStatus(msg, 'success');
            await AppState.creds.refresh();
            
            // Show detailed information
            if (data.duplicate_groups && data.duplicate_groups.length > 0) {
                let details = 'Deduplication details:\n\n';
                data.duplicate_groups.forEach(group => {
                    details += `Email: ${group.email}\nKeep: ${group.kept_file}\nDelete: ${group.deleted_files.join(', ')}\n\n`;
                });
                console.log(details);
            }
        } else {
            showStatus(data.message || 'Deduplication failed', 'error');
        }
    } catch (error) {
        showStatus(`Deduplication network error: ${error.message}`, 'error');
    }
}

async function deduplicateAntigravityByEmail() {
    if (!confirm('Are you sure you want to performAntigravitycredentials for one-click deduplication?\n\nOnly one credential per email will be kept\nThis action cannot be undone!')) return;

    try {
        showStatus('One-click credential deduplication in progress...', 'info');
        const response = await fetch('./creds/deduplicate-by-email?mode=antigravity', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const data = await response.json();
        if (response.ok) {
            const msg = `Deduplication complete: Deleted ${data.deleted_count} duplicate credentials ${data.kept_count} credentials (${data.unique_emails_count} unique emails)`;
            showStatus(msg, 'success');
            await AppState.antigravityCreds.refresh();
            
            // Show detailed information
            if (data.duplicate_groups && data.duplicate_groups.length > 0) {
                let details = 'Deduplication details:\n\n';
                data.duplicate_groups.forEach(group => {
                    details += `Email: ${group.email}\nKeep: ${group.kept_file}\nDelete: ${group.deleted_files.join(', ')}\n\n`;
                });
                console.log(details);
            }
        } else {
            showStatus(data.message || 'Deduplication failed', 'error');
        }
    } catch (error) {
        showStatus(`Deduplication network error: ${error.message}`, 'error');
    }
}

// =====================================================================
// WebSocketLog related
// =====================================================================
function connectWebSocket() {
    if (AppState.logWebSocket && AppState.logWebSocket.readyState === WebSocket.OPEN) {
        showStatus('WebSocketConnected', 'info');
        return;
    }

    try {
        const wsPath = new URL('./logs/stream', window.location.href).href;
        const wsUrl = wsPath.replace(/^http/, 'ws');

        // Add token Authentication parameters
        const wsUrlWithAuth = `${wsUrl}?token=${encodeURIComponent(AppState.authToken)}`;

        document.getElementById('connectionStatusText').textContent = 'Connecting...';
        document.getElementById('logConnectionStatus').className = 'status info';

        AppState.logWebSocket = new WebSocket(wsUrlWithAuth);

        AppState.logWebSocket.onopen = () => {
            document.getElementById('connectionStatusText').textContent = 'Connected';
            document.getElementById('logConnectionStatus').className = 'status success';
            showStatus('Log stream connected successfully', 'success');
            clearLogsDisplay();
        };

        AppState.logWebSocket.onmessage = (event) => {
            const logLine = event.data;
            if (logLine.trim()) {
                AppState.allLogs.push(logLine);
                if (AppState.allLogs.length > 1000) {
                    AppState.allLogs = AppState.allLogs.slice(-1000);
                }
                filterLogs();
                if (document.getElementById('autoScroll').checked) {
                    const logContainer = document.getElementById('logContainer');
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            }
        };

        AppState.logWebSocket.onclose = () => {
            document.getElementById('connectionStatusText').textContent = 'Connection disconnected';
            document.getElementById('logConnectionStatus').className = 'status error';
            showStatus('Log stream connection disconnected', 'info');
        };

        AppState.logWebSocket.onerror = (error) => {
            document.getElementById('connectionStatusText').textContent = 'Connection error';
            document.getElementById('logConnectionStatus').className = 'status error';
            showStatus('Log stream connection error: ' + error, 'error');
        };
    } catch (error) {
        showStatus('CreateWebSocketConnection failed: ' + error.message, 'error');
        document.getElementById('connectionStatusText').textContent = 'Connection failed';
        document.getElementById('logConnectionStatus').className = 'status error';
    }
}

function disconnectWebSocket() {
    if (AppState.logWebSocket) {
        AppState.logWebSocket.close();
        AppState.logWebSocket = null;
        document.getElementById('connectionStatusText').textContent = 'Not connected';
        document.getElementById('logConnectionStatus').className = 'status info';
        showStatus('Log stream connection has been disconnected', 'info');
    }
}

function clearLogsDisplay() {
    AppState.allLogs = [];
    AppState.filteredLogs = [];
    document.getElementById('logContent').textContent = 'Logs cleared...';
}

async function downloadLogs() {
    try {
        const response = await fetch('./logs/download', { headers: getAuthHeaders() });

        if (response.ok) {
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = 'gcli2api_logs.txt';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename=(.+)/);
                if (match) filename = match[1];
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);

            showStatus(`Log file downloaded successfully: ${filename}`, 'success');
        } else {
            const data = await response.json();
            showStatus(`Failed to download logs: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network error while downloading logs: ${error.message}`, 'error');
    }
}

async function clearLogs() {
    try {
        const response = await fetch('./logs/clear', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            clearLogsDisplay();
            showStatus(data.message, 'success');
        } else {
            showStatus(`Failed to clear logs: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        clearLogsDisplay();
        showStatus(`Network error while clearing logs: ${error.message}`, 'error');
    }
}

function filterLogs() {
    const filter = document.getElementById('logLevelFilter').value;
    AppState.currentLogFilter = filter;

    if (filter === 'all') {
        AppState.filteredLogs = [...AppState.allLogs];
    } else {
        AppState.filteredLogs = AppState.allLogs.filter(log => log.toUpperCase().includes(filter));
    }

    displayLogs();
}

function displayLogs() {
    const logContent = document.getElementById('logContent');
    if (AppState.filteredLogs.length === 0) {
        logContent.textContent = AppState.currentLogFilter === 'all' ?
            'No logs available...' : `None${AppState.currentLogFilter}level logs...`;
    } else {
        logContent.textContent = AppState.filteredLogs.join('\n');
    }
}

// =====================================================================
// Environment variable credential management
// =====================================================================
async function checkEnvCredsStatus() {
    const loading = document.getElementById('envStatusLoading');
    const content = document.getElementById('envStatusContent');

    try {
        loading.style.display = 'block';
        content.classList.add('hidden');

        const response = await fetch('./auth/env-creds-status', { headers: getAuthHeaders() });
        const data = await response.json();

        if (response.ok) {
            const envVarsList = document.getElementById('envVarsList');
            envVarsList.textContent = Object.keys(data.available_env_vars).length > 0
                ? Object.keys(data.available_env_vars).join(', ')
                : 'Not foundGCLI_CREDS_*Environment Variables';

            const autoLoadStatus = document.getElementById('autoLoadStatus');
            autoLoadStatus.textContent = data.auto_load_enabled ? '✅ Enabled' : '❌ Not enabled';
            autoLoadStatus.style.color = data.auto_load_enabled ? '#28a745' : '#dc3545';

            document.getElementById('envFilesCount').textContent = `${data.existing_env_files_count} files`;

            const envFilesList = document.getElementById('envFilesList');
            envFilesList.textContent = data.existing_env_files.length > 0
                ? data.existing_env_files.join(', ')
                : 'None';

            content.classList.remove('hidden');
            showStatus('Environment variable status check complete', 'success');
        } else {
            showStatus(`Failed to get environment variable status: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

async function loadEnvCredentials() {
    try {
        showStatus('Importing credentials from environment variables...', 'info');

        const response = await fetch('./auth/load-env-creds', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            if (data.loaded_count > 0) {
                showStatus(`✅ Successfully imported ${data.loaded_count}/${data.total_count} credential files`, 'success');
                setTimeout(() => checkEnvCredsStatus(), 1000);
            } else {
                showStatus(`⚠️ ${data.message}`, 'info');
            }
        } else {
            showStatus(`Import failed: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

async function clearEnvCredentials() {
    if (!confirm('Are you sure you want to clear all credential files imported from environment variables?\nThis will delete all authentication files starting with "env-" prefix.')) {
        return;
    }

    try {
        showStatus('Clearing environment variable credential files...', 'info');

        const response = await fetch('./auth/env-creds', {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (response.ok) {
            showStatus(`✅ Successfully deleted ${data.deleted_count} environment variable credential files`, 'success');
            setTimeout(() => checkEnvCredsStatus(), 1000);
        } else {
            showStatus(`Clear failed: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

// =====================================================================
// Configuration Management
// =====================================================================
async function loadConfig() {
    const loading = document.getElementById('configLoading');
    const form = document.getElementById('configForm');

    try {
        loading.style.display = 'block';
        form.classList.add('hidden');

        const response = await fetch('./config/get', { headers: getAuthHeaders() });
        const data = await response.json();

        if (response.ok) {
            AppState.currentConfig = data.config;
            AppState.envLockedFields = new Set(data.env_locked || []);

            populateConfigForm();
            form.classList.remove('hidden');
            showStatus('Configuration loaded successfully', 'success');
        } else {
            showStatus(`Failed to load configuration: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function populateConfigForm() {
    const c = AppState.currentConfig;

    setConfigField('host', c.host || '0.0.0.0');
    setConfigField('port', c.port || 7861);
    setConfigField('configApiPassword', c.api_password || '');
    setConfigField('configPanelPassword', c.panel_password || '');
    setConfigField('configPassword', c.password || 'pwd');
    setConfigField('credentialsDir', c.credentials_dir || '');
    setConfigField('proxy', c.proxy || '');
    setConfigField('codeAssistEndpoint', c.code_assist_endpoint || '');
    setConfigField('oauthProxyUrl', c.oauth_proxy_url || '');
    setConfigField('googleapisProxyUrl', c.googleapis_proxy_url || '');
    setConfigField('resourceManagerApiUrl', c.resource_manager_api_url || '');
    setConfigField('serviceUsageApiUrl', c.service_usage_api_url || '');
    setConfigField('antigravityApiUrl', c.antigravity_api_url || '');

    document.getElementById('autoBanEnabled').checked = Boolean(c.auto_ban_enabled);
    setConfigField('autoBanErrorCodes', (c.auto_ban_error_codes || []).join(','));
    setConfigField('callsPerRotation', c.calls_per_rotation || 10);

    document.getElementById('retry429Enabled').checked = Boolean(c.retry_429_enabled);
    setConfigField('retry429MaxRetries', c.retry_429_max_retries || 20);
    setConfigField('retry429Interval', c.retry_429_interval || 0.1);

    document.getElementById('compatibilityModeEnabled').checked = Boolean(c.compatibility_mode_enabled);
    document.getElementById('returnThoughtsToFrontend').checked = Boolean(c.return_thoughts_to_frontend !== false);
    document.getElementById('antigravityStream2nostream').checked = Boolean(c.antigravity_stream2nostream !== false);

    setConfigField('antiTruncationMaxAttempts', c.anti_truncation_max_attempts || 3);
}

function setConfigField(fieldId, value) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.value = value;
        const configKey = fieldId.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (AppState.envLockedFields.has(configKey)) {
            field.disabled = true;
            field.classList.add('env-locked');
        } else {
            field.disabled = false;
            field.classList.remove('env-locked');
        }
    }
}

async function saveConfig() {
    try {
        const getValue = (id, def = '') => document.getElementById(id)?.value.trim() || def;
        const getInt = (id, def = 0) => parseInt(document.getElementById(id)?.value) || def;
        const getFloat = (id, def = 0.0) => parseFloat(document.getElementById(id)?.value) || def;
        const getChecked = (id, def = false) => document.getElementById(id)?.checked || def;

        const config = {
            host: getValue('host', '0.0.0.0'),
            port: getInt('port', 7861),
            api_password: getValue('configApiPassword'),
            panel_password: getValue('configPanelPassword'),
            password: getValue('configPassword', 'pwd'),
            code_assist_endpoint: getValue('codeAssistEndpoint'),
            credentials_dir: getValue('credentialsDir'),
            proxy: getValue('proxy'),
            oauth_proxy_url: getValue('oauthProxyUrl'),
            googleapis_proxy_url: getValue('googleapisProxyUrl'),
            resource_manager_api_url: getValue('resourceManagerApiUrl'),
            service_usage_api_url: getValue('serviceUsageApiUrl'),
            antigravity_api_url: getValue('antigravityApiUrl'),
            auto_ban_enabled: getChecked('autoBanEnabled'),
            auto_ban_error_codes: getValue('autoBanErrorCodes').split(',')
                .map(c => parseInt(c.trim())).filter(c => !isNaN(c)),
            calls_per_rotation: getInt('callsPerRotation', 10),
            retry_429_enabled: getChecked('retry429Enabled'),
            retry_429_max_retries: getInt('retry429MaxRetries', 20),
            retry_429_interval: getFloat('retry429Interval', 0.1),
            compatibility_mode_enabled: getChecked('compatibilityModeEnabled'),
            return_thoughts_to_frontend: getChecked('returnThoughtsToFrontend'),
            antigravity_stream2nostream: getChecked('antigravityStream2nostream'),
            anti_truncation_max_attempts: getInt('antiTruncationMaxAttempts', 3)
        };

        const response = await fetch('./config/save', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ config })
        });

        const data = await response.json();

        if (response.ok) {
            let message = 'Configuration saved successfully';

            if (data.hot_updated && data.hot_updated.length > 0) {
                message += `: ${data.hot_updated.join(', ')}`;
            }

            if (data.restart_required && data.restart_required.length > 0) {
                message += `\n⚠️ Restart reminder: ${data.restart_notice}`;
                showStatus(message, 'info');
            } else {
                showStatus(message, 'success');
            }

            setTimeout(() => loadConfig(), 1000);
        } else {
            showStatus(`Failed to save configuration: ${data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

// Mirror URL configuration
const mirrorUrls = {
    codeAssistEndpoint: 'https://gcli-api.sukaka.top/cloudcode-pa',
    oauthProxyUrl: 'https://gcli-api.sukaka.top/oauth2',
    googleapisProxyUrl: 'https://gcli-api.sukaka.top/googleapis',
    resourceManagerApiUrl: 'https://gcli-api.sukaka.top/cloudresourcemanager',
    serviceUsageApiUrl: 'https://gcli-api.sukaka.top/serviceusage',
    antigravityApiUrl: 'https://gcli-api.sukaka.top/daily-cloudcode-pa'
};

const officialUrls = {
    codeAssistEndpoint: 'https://cloudcode-pa.googleapis.com',
    oauthProxyUrl: 'https://oauth2.googleapis.com',
    googleapisProxyUrl: 'https://www.googleapis.com',
    resourceManagerApiUrl: 'https://cloudresourcemanager.googleapis.com',
    serviceUsageApiUrl: 'https://serviceusage.googleapis.com',
    antigravityApiUrl: 'https://daily-cloudcode-pa.sandbox.googleapis.com'
};

function useMirrorUrls() {
    if (confirm('Are you sure you want to configure all endpoints as mirror URLs?')) {
        for (const [fieldId, url] of Object.entries(mirrorUrls)) {
            const field = document.getElementById(fieldId);
            if (field && !field.disabled) field.value = url;
        }
        showStatus('✅ Switched to mirror URL configuration"Save configuration"button to save settings', 'success');
    }
}

function restoreOfficialUrls() {
    if (confirm('Are you sure you want to configure all endpoints as official addresses?')) {
        for (const [fieldId, url] of Object.entries(officialUrls)) {
            const field = document.getElementById(fieldId);
            if (field && !field.disabled) field.value = url;
        }
        showStatus('✅ Switched to official endpoint configuration"Save configuration"button to save settings', 'success');
    }
}

// =====================================================================
// Usage Statistics
// =====================================================================
async function refreshUsageStats() {
    const loading = document.getElementById('usageLoading');
    const list = document.getElementById('usageList');

    try {
        loading.style.display = 'block';
        list.innerHTML = '';

        const [statsResponse, aggregatedResponse] = await Promise.all([
            fetch('./usage/stats', { headers: getAuthHeaders() }),
            fetch('./usage/aggregated', { headers: getAuthHeaders() })
        ]);

        if (statsResponse.status === 401 || aggregatedResponse.status === 401) {
            showStatus('Authentication failed', 'error');
            setTimeout(() => location.reload(), 1500);
            return;
        }

        const statsData = await statsResponse.json();
        const aggregatedData = await aggregatedResponse.json();

        if (statsResponse.ok && aggregatedResponse.ok) {
            AppState.usageStatsData = statsData.success ? statsData.data : statsData;

            const aggData = aggregatedData.success ? aggregatedData.data : aggregatedData;
            document.getElementById('totalApiCalls').textContent = aggData.total_calls_24h || 0;
            document.getElementById('totalFiles').textContent = aggData.total_files || 0;
            document.getElementById('avgCallsPerFile').textContent = (aggData.avg_calls_per_file || 0).toFixed(1);

            renderUsageList();

            showStatus(`Loaded ${aggData.total_files || Object.keys(AppState.usageStatsData).length} usage statistics for files`, 'success');
        } else {
            const errorMsg = statsData.detail || aggregatedData.detail || 'Failed to load usage statistics';
            showStatus(`Error: ${errorMsg}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function renderUsageList() {
    const list = document.getElementById('usageList');
    list.innerHTML = '';

    if (Object.keys(AppState.usageStatsData).length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #666;">No usage statistics data available</p>';
        return;
    }

    for (const [filename, stats] of Object.entries(AppState.usageStatsData)) {
        const card = document.createElement('div');
        card.className = 'usage-card';

        const calls24h = stats.calls_24h || 0;

        card.innerHTML = `
            <div class="usage-header">
                <div class="usage-filename">${filename}</div>
            </div>
            <div class="usage-info">
                <div class="usage-info-item" style="grid-column: 1 / -1;">
                    <span class="usage-info-label">24calls within hours</span>
                    <span class="usage-info-value" style="font-size: 24px; font-weight: bold; color: #007bff;">${calls24h}</span>
                </div>
            </div>
            <div class="usage-actions">
                <button class="usage-btn reset" onclick="resetSingleUsageStats('${filename}')">Reset statistics</button>
            </div>
        `;

        list.appendChild(card);
    }
}

async function resetSingleUsageStats(filename) {
    if (!confirm(`Are you sure you want to reset ${filename} usage statistics?`)) return;

    try {
        const response = await fetch('./usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ filename })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`Reset failed: ${data.message || data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

async function resetAllUsageStats() {
    if (!confirm('Are you sure you want to reset usage statistics for all files? This action cannot be undone!')) return;

    try {
        const response = await fetch('./usage/reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showStatus(data.message, 'success');
            await refreshUsageStats();
        } else {
            showStatus(`Reset failed: ${data.message || data.detail || data.error || 'Unknown Error'}`, 'error');
        }
    } catch (error) {
        showStatus(`Network Error: ${error.message}`, 'error');
    }
}

// =====================================================================
// Cooldown countdown auto-update
// =====================================================================
function startCooldownTimer() {
    if (AppState.cooldownTimerInterval) {
        clearInterval(AppState.cooldownTimerInterval);
    }

    AppState.cooldownTimerInterval = setInterval(() => {
        updateCooldownDisplays();
    }, 1000);
}

function stopCooldownTimer() {
    if (AppState.cooldownTimerInterval) {
        clearInterval(AppState.cooldownTimerInterval);
        AppState.cooldownTimerInterval = null;
    }
}

function updateCooldownDisplays() {
    let needsRefresh = false;

    // Check if model-level cooldown has expired
    for (const credInfo of Object.values(AppState.creds.data)) {
        if (credInfo.model_cooldowns && Object.keys(credInfo.model_cooldowns).length > 0) {
            const currentTime = Date.now() / 1000;
            const hasExpiredCooldowns = Object.entries(credInfo.model_cooldowns).some(([, until]) => until <= currentTime);

            if (hasExpiredCooldowns) {
                needsRefresh = true;
                break;
            }
        }
    }

    if (needsRefresh) {
        AppState.creds.renderList();
        return;
    }

    // Update model-level cooldown display
    document.querySelectorAll('.cooldown-badge').forEach(badge => {
        const card = badge.closest('.cred-card');
        const filenameEl = card?.querySelector('.cred-filename');
        if (!filenameEl) return;

        const filename = filenameEl.textContent;
        const credInfo = Object.values(AppState.creds.data).find(c => c.filename === filename);

        if (credInfo && credInfo.model_cooldowns) {
            const currentTime = Date.now() / 1000;
            const titleMatch = badge.getAttribute('title')?.match(/Model: (.+)/);
            if (titleMatch) {
                const model = titleMatch[1];
                const cooldownUntil = credInfo.model_cooldowns[model];
                if (cooldownUntil) {
                    const remaining = Math.max(0, Math.floor(cooldownUntil - currentTime));
                    if (remaining > 0) {
                        const shortModel = model.replace('gemini-', '').replace('-exp', '')
                            .replace('2.0-', '2-').replace('1.5-', '1.5-');
                        const timeDisplay = formatCooldownTime(remaining).replace(/s$/, '').replace(/ /g, '');
                        badge.innerHTML = `🔧 ${shortModel}: ${timeDisplay}`;
                    }
                }
            }
        }
    });
}

// =====================================================================
// Version information management
// =====================================================================

// Get and display version info (without checking for updates)
async function fetchAndDisplayVersion() {
    try {
        const response = await fetch('./version/info');
        const data = await response.json();

        const versionText = document.getElementById('versionText');

        if (data.success) {
            // Show version number only
            versionText.textContent = `v${data.version}`;
            versionText.title = `Full version: ${data.full_hash}\nCommit message: ${data.message}\nCommit time: ${data.date}`;
            versionText.style.cursor = 'help';
        } else {
            versionText.textContent = 'Unknown version';
            versionText.title = data.error || 'Unable to get version information';
        }
    } catch (error) {
        console.error('Failed to get version information:', error);
        const versionText = document.getElementById('versionText');
        if (versionText) {
            versionText.textContent = 'Version information retrieval failed';
        }
    }
}

// Check for updates
async function checkForUpdates() {
    const checkBtn = document.getElementById('checkUpdateBtn');
    if (!checkBtn) return;

    const originalText = checkBtn.textContent;

    try {
        // Show checking status
        checkBtn.textContent = 'Checking...';
        checkBtn.disabled = true;

        // CallAPICheck for updates
        const response = await fetch('./version/info?check_update=true');
        const data = await response.json();

        if (data.success) {
            if (data.check_update === false) {
                // Failed to check for updates
                showStatus(`Failed to check for updates: ${data.update_error || 'Unknown Error'}`, 'error');
            } else if (data.has_update === true) {
                // Update available
                const updateMsg = `New version found!\nCurrent: v${data.version}\nLatest: v${data.latest_version}\n\nUpdate content: ${data.latest_message || 'None'}`;
                showStatus(updateMsg.replace(/\n/g, ' '), 'warning');

                // Update button style
                checkBtn.style.backgroundColor = '#ffc107';
                checkBtn.textContent = 'New version available';

                setTimeout(() => {
                    checkBtn.style.backgroundColor = '#17a2b8';
                    checkBtn.textContent = originalText;
                }, 5000);
            } else if (data.has_update === false) {
                // Already latest
                showStatus('Already the latest version!', 'success');

                checkBtn.style.backgroundColor = '#28a745';
                checkBtn.textContent = 'Already latest';

                setTimeout(() => {
                    checkBtn.style.backgroundColor = '#17a2b8';
                    checkBtn.textContent = originalText;
                }, 3000);
            } else {
                // Unable to determine
                showStatus('Unable to determine if there is an update', 'info');
            }
        } else {
            showStatus(`Failed to check for updates: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Failed to check for updates:', error);
        showStatus(`Failed to check for updates: ${error.message}`, 'error');
    } finally {
        checkBtn.disabled = false;
        if (checkBtn.textContent === 'Checking...') {
            checkBtn.textContent = originalText;
        }
    }
}

// =====================================================================
// Page initialization
// =====================================================================
window.onload = async function () {
    const autoLoginSuccess = await autoLogin();

    if (!autoLoginSuccess) {
        showStatus('Please enter password to log in', 'info');
    } else {
        // Get version info after successful login
        await fetchAndDisplayVersion();
    }

    startCooldownTimer();

    const antigravityAuthBtn = document.getElementById('getAntigravityAuthBtn');
    if (antigravityAuthBtn) {
        antigravityAuthBtn.addEventListener('click', startAntigravityAuth);
    }
};

// Drag and drop functionality - Initialization
document.addEventListener('DOMContentLoaded', function () {
    const uploadArea = document.getElementById('uploadArea');

    if (uploadArea) {
        uploadArea.addEventListener('dragover', (event) => {
            event.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (event) => {
            event.preventDefault();
            uploadArea.classList.remove('dragover');
            AppState.uploadFiles.addFiles(Array.from(event.dataTransfer.files));
        });
    }
});
