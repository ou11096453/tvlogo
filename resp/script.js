document.addEventListener('DOMContentLoaded', function() {
    const sendBtn = document.getElementById('send-btn');
    const clearBtn = document.getElementById('clear-btn');
    const exampleBtn = document.getElementById('example-btn');
    const loading = document.getElementById('loading');
    const responseContainer = document.getElementById('response-container');
    const noResponse = document.getElementById('no-response');
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const historyList = document.getElementById('history-list');
    const logContainer = document.getElementById('log-container');
    
    const redirectCountText = document.getElementById('redirect-count'); 
    const redirectCountBadge = document.getElementById('redirect-count-badge'); 
    const headersBadge = document.getElementById('headers-badge');

    const HISTORY_STORAGE_KEY = 'requestHistory';
    const MAX_HISTORY_ITEMS = 50;
    const VISIBLE_HISTORY_ITEMS = 5;

    function checkBackendConnection(context = '') {
        const contextText = context ? `(${context})` : '';
        
        return fetch('api.php', { method: 'HEAD' })
            .then(res => {
                if (res.ok) {
                    addLog(`PHP代理后端连接正常 ${contextText}`, 'success');
                    return true;
                } else {
                    addLog(`PHP代理后端连接失败${contextText}，状态码: ${res.status}`, 'error');
                    return false;
                }
            })
            .catch(err => {
                addLog(`无法连接到api.php${contextText}: ${err.message}`, 'error');
                return false;
            });
    }

    function saveHistoryItem(config, result) {
        let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || [];
        
        const historyItem = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            displayTime: formatTime(new Date()),
            url: config.url,
            config: {
                url: config.url,
                host: config.host || '',
                userAgent: config.headers['User-Agent'] || '',
                referer: config.headers['Referer'] || '',
                otherHeaders: config.otherHeaders || '',
                timeout: config.timeout || 16,
                proxyAddress: config.proxy || '',
                proxyUsername: config.proxy_username || '',
                proxyPassword: config.proxy_password || '',
                followRedirects: config.follow_redirects ? 'auto' : 'none',
                maxRedirects: config.max_redirects || 10
            },
            result: {
                status: result.status_code || 0,
                time: result.time || 0,
                size: result.size || 0,
                redirectCount: result.redirect_count || 0,
                errorType: result.error_type || null,
                proxyError: result.proxy_error || false,
                errorDetails: result.error_details || null,
                proxyUsed: result.proxy_used || false
            }
        };
        
        const existingIndex = history.findIndex(item => {
            return item.url === historyItem.url && 
                   JSON.stringify(item.config) === JSON.stringify(historyItem.config);
        });
        
        if (existingIndex !== -1) {
            history[existingIndex].timestamp = historyItem.timestamp;
            history[existingIndex].displayTime = historyItem.displayTime;
            history[existingIndex].result = historyItem.result;
            
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
            
            addLog('已更新历史记录并置顶', 'info');
        } else {
            history.unshift(historyItem);
            addLog('已保存新历史记录', 'info');
        }
        
        if (history.length > MAX_HISTORY_ITEMS) {
            history = history.slice(0, MAX_HISTORY_ITEMS);
        }
        
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
        return history;
    }

    function formatTime(date) {
        return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}:${date.getSeconds().toString().padStart(2,'0')}`;
    }

    function formatDisplayTime(timestamp) {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    // 修正：保持URL原样，不进行任何格式化
    function formatLongUrl(url) {
        return url || '';
    }

// 在 loadHistory 函数中，更新状态判断部分
function loadHistory() {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || [];
    updateHistoryDisplay(history);
    return history;
}

    function clearAllHistory() {
        if (confirm('确定要清除所有历史记录吗？此操作不可恢复。')) {
            localStorage.removeItem(HISTORY_STORAGE_KEY);
            updateHistoryDisplay([]);
            addLog('已清除所有历史记录', 'info');
        }
    }

    function updateHistoryDisplay(history) {
        historyList.innerHTML = '';
        
        if (history.length === 0) {
            historyList.innerHTML = `
                <div class="history-item placeholder">
                    <div class="history-url">暂无请求历史</div>
                </div>`;
            return;
        }
        
        const historyContainer = document.createElement('div');
        historyContainer.className = 'history-container';
        
        history.forEach((item, index) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'history-item';
            if (index >= VISIBLE_HISTORY_ITEMS) {
                itemEl.classList.add('history-hidden');
            }
            itemEl.setAttribute('data-id', item.id);
            itemEl.setAttribute('data-status-code', item.result.status);
            
            const date = new Date(item.timestamp);
            const timeStr = formatTime(date);
            const displayTime = formatDisplayTime(item.timestamp);
            
            let statusClass = 'status-info';
            let statusText = item.result.status;

            // 先检查是否有错误类型
            if (item.result.errorType) {
    // 有错误
    if (item.result.errorType === 'proxy_auth_failed') {
        statusClass = 'status-proxy-error';
        statusText = '代理认证失败';
    } else if (item.result.errorType === 'proxy_timeout' || item.result.proxyError) {
        statusClass = 'status-proxy-error';
        statusText = '504';
    } else if (item.result.errorType === 'url_timeout') {
        // 如果是url_timeout错误类型，检查状态码
        if (item.result.status === 504) {
            statusClass = 'status-504';
            statusText = '504';
        } else {
            statusClass = 'status-url-error';
            statusText = '超时';
        }
    } else {
        statusClass = 'status-error';
        statusText = item.result.status || '错误';
    }
} else if (item.result.status >= 200 && item.result.status < 300) {
                statusClass = 'status-success';
            } else if (item.result.status >= 300 && item.result.status < 400) {
                statusClass = 'status-warning';
            } else if (item.result.status === 504) {
                statusClass = 'status-504';
                statusText = '504';
            } else if (item.result.status > 0) {
                statusClass = 'status-error';
                statusText = item.result.status;
            } else {
                statusClass = 'status-error';
                statusText = '错误';
            }
            
            itemEl.innerHTML = `
                <div class="history-info">
                    <div class="history-url" title="${item.url}">${item.url}</div>
                    <div class="history-details">
                        <span class="history-time" title="${timeStr}">${displayTime}</span>
                        <span class="status-badge ${statusClass} history-status">${statusText}</span>
                        <span>${item.result.redirectCount}次重定向</span>
                        <span>${(item.result.time * 1000).toFixed(0)}ms</span>
                        <span>${formatBytes(item.result.size)}</span>
                        ${item.result.proxyUsed ? '<span style="color:var(--warning-color);">代理</span>' : ''}
                    </div>
                </div>
                <div class="history-actions">
                    <button class="history-fill-btn" title="回填配置">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <button class="history-delete-btn" title="删除记录">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
            
            const fillBtn = itemEl.querySelector('.history-fill-btn');
            fillBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                fillFormWithConfig(item.config);
                addLog(`已加载历史配置: ${item.url}`, 'info');
                moveHistoryToTop(item.id);
            });
            
            const deleteBtn = itemEl.querySelector('.history-delete-btn');
            deleteBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteHistoryItem(item.id);
            });
            
            itemEl.addEventListener('click', function(e) {
                if (!e.target.closest('.history-actions')) {
                    fillFormWithConfig(item.config);
                    addLog(`已加载历史配置: ${item.url}`, 'info');
                    moveHistoryToTop(item.id);
                }
            });
            
            historyContainer.appendChild(itemEl);
        });
        
        if (history.length > VISIBLE_HISTORY_ITEMS) {
            const toggleBtn = document.createElement('div');
            toggleBtn.className = 'history-toggle-btn';
            toggleBtn.innerHTML = `
                <span>显示全部 (${history.length})</span>
                <i class="fas fa-chevron-down"></i>
            `;
            
            toggleBtn.addEventListener('click', function() {
                const hiddenItems = historyContainer.querySelectorAll('.history-hidden');
                const isHidden = hiddenItems.length > 0;
                
                if (isHidden) {
                    hiddenItems.forEach(item => {
                        item.classList.remove('history-hidden');
                    });
                    toggleBtn.innerHTML = '<span>收起</span><i class="fas fa-chevron-up"></i>';
                    toggleBtn.classList.add('expanded');
                } else {
                    const allItems = historyContainer.querySelectorAll('.history-item');
                    allItems.forEach((item, index) => {
                        if (index >= VISIBLE_HISTORY_ITEMS) {
                            item.classList.add('history-hidden');
                        }
                    });
                    toggleBtn.innerHTML = `<span>显示全部 (${history.length})</span><i class="fas fa-chevron-down"></i>`;
                    toggleBtn.classList.remove('expanded');
                }
            });
            
            historyContainer.appendChild(toggleBtn);
        }
        
        const clearAllBtn = document.createElement('div');
        clearAllBtn.className = 'history-clear-all';
        clearAllBtn.innerHTML = '<i class="fas fa-trash"></i> 清除所有历史记录';
        clearAllBtn.addEventListener('click', clearAllHistory);
        
        historyContainer.appendChild(clearAllBtn);
        historyList.appendChild(historyContainer);
    }

    function moveHistoryToTop(id) {
        let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || [];
        const index = history.findIndex(item => item.id === id);
        
        if (index !== -1) {
            history[index].timestamp = new Date().toISOString();
            history[index].displayTime = formatTime(new Date());
            const item = history.splice(index, 1)[0];
            history.unshift(item);
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
            loadHistory();
        }
    }

    function deleteHistoryItem(id) {
        if (confirm('确定要删除这条历史记录吗？')) {
            let history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || [];
            history = history.filter(item => item.id !== id);
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
            updateHistoryDisplay(history);
            addLog('已删除历史记录', 'info');
        }
    }

    function fillFormWithConfig(config) {
        document.getElementById('url').value = config.url || '';
        document.getElementById('host').value = config.host || '';
        document.getElementById('user-agent').value = config.userAgent || 'Okhttp/3.15';
        document.getElementById('referer').value = config.referer || '';
        document.getElementById('other-headers').value = config.otherHeaders || '';
        document.getElementById('timeout').value = config.timeout || 16;
        document.getElementById('proxy-address').value = config.proxyAddress || '';
        document.getElementById('proxy-username').value = config.proxyUsername || '';
        document.getElementById('proxy-password').value = config.proxyPassword || '';
        document.getElementById('follow-redirects').value = config.followRedirects || 'auto';
        document.getElementById('max-redirects').value = config.maxRedirects || 10;
        
        window.scrollTo(0, 0);
        const urlInput = document.getElementById('url');
        urlInput.style.backgroundColor = '#e8f5e9';
        urlInput.style.borderColor = '#4caf50';
        setTimeout(() => {
            urlInput.style.backgroundColor = '';
            urlInput.style.borderColor = '';
        }, 1000);
    }

    const sectionToggles = document.querySelectorAll('.compact-group-title');
    sectionToggles.forEach(toggle => {
        const sectionId = toggle.id.replace('-toggle', '-content');
        const content = document.getElementById(sectionId);
        const arrow = toggle.querySelector('.compact-group-arrow');

        toggle.addEventListener('click', function() {
            content.classList.toggle('expanded');
            arrow.classList.toggle('fa-chevron-up');
            arrow.classList.toggle('fa-chevron-down');
        });
    });

    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId + '-tab').classList.add('active');
        });
    });

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getHttpReasonPhrase(code) {
        const reasons = {
            200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
            301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 
            307: 'Temporary Redirect', 308: 'Permanent Redirect', 
            400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
            405: 'Method Not Allowed', 408: 'Request Timeout', 429: 'Too Many Requests',
            500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
            504: 'Gateway Timeout'
        };
        return reasons[code] || 'Unknown Status';
    }

    function updateRedirectDisplay(redirects) {
        const container = document.getElementById('redirect-chain-container');
        container.innerHTML = '';
        document.getElementById('final-url-container').style.display = 'none';

        if (!redirects || redirects.length === 0) {
            container.innerHTML = `<div class="no-redirects">
                <i class="fas fa-arrow-right" style="font-size: 28px; color: var(--text-secondary); margin-bottom: 10px;"></i>
                <p>直连成功，无重定向</p>
                <small style="color: var(--text-secondary);">请求直接到达最终地址</small>
            </div>`;
            return;
        }

        document.getElementById('final-url-container').style.display = 'block';

        redirects.forEach((step, index) => {
            const stepDiv = document.createElement('div');
            stepDiv.className = 'redirect-step';
            stepDiv.setAttribute('data-status-code', step.status_code);

            const isFinal = index === redirects.length - 1;
            
            if (isFinal) {
                stepDiv.classList.add('final-response-step');
            }

            let statusClass = 'status-info';
            if (step.status_code >= 200 && step.status_code < 300) {
                statusClass = 'status-success';
            } else if (step.status_code >= 300 && step.status_code < 400) {
                statusClass = 'status-warning';
            } else if (step.status_code === 504) {
                statusClass = 'status-504';
            } else {
                statusClass = 'status-error';
            }

            const headerHTML = `<div class="redirect-step-header">
                <span class="redirect-seq-badge ${statusClass}">${index + 1}</span>
                <span class="status-badge ${statusClass}">
                    ${step.status_code} ${getHttpReasonPhrase(step.status_code)}
                </span>
                ${isFinal ? '<span style="font-size: 0.9rem;margin-left: 10px; font-weight: bold; color: var(--secondary-color);">← 最终响应</span>' : ''}
            </div>`;
            
            const urlHTML = `<div class="redirect-step-url">${step.url}</div>`;

            stepDiv.innerHTML = headerHTML + urlHTML;
            container.appendChild(stepDiv);
        });
        
        document.getElementById('final-url').textContent = redirects[redirects.length - 1].url;
    }

    function updateHeadersDisplay(headers) {
        const tbody = document.getElementById('headers-body');
        tbody.innerHTML = '';
        
        if (!headers || Object.keys(headers).length === 0) {
            tbody.innerHTML = '<tr><td colspan="2">无响应头</td></tr>';
            return;
        }
        
        for (const [key, value] of Object.entries(headers)) {
            const row = tbody.insertRow();
            const cell1 = row.insertCell();
            const cell2 = row.insertCell();
            cell1.textContent = key;
            cell2.textContent = value;
        }
    }

    function updateBodyDisplay(body, headers, downloadUrl = null, data = {}) {
        const pre = document.getElementById('response-body');
        const tabContent = document.getElementById('body-tab');
        
        const existingDownloadSection = tabContent.querySelector('.download-section');
        if (existingDownloadSection) {
            existingDownloadSection.remove();
        }
        
        const errorDetails = data.error_details || null;
        const errorType = data.error_type || null;
        const isProxyError = data.proxy_error || false;
        const proxyUsed = data.proxy_used || false;
        
        if (errorDetails) {
            const errorSection = document.createElement('div');
            errorSection.className = 'download-section';
            
            let errorColor = 'var(--error-color)';
            let errorIcon = 'fas fa-exclamation-circle';
            let errorTitle = '请求失败';
            
            if (errorType === 'proxy_timeout' || isProxyError) {
                errorColor = 'var(--warning-color)';
                errorIcon = 'fas fa-plug';
                errorTitle = 'SOCKS5代理连接失败';
            } else if (errorType === 'url_timeout') {
                errorColor = 'var(--error-color)';
                errorIcon = 'fas fa-clock';
                errorTitle = '目标URL访问超时';
            }
            
            errorSection.style.backgroundColor = errorColor + '10';
            errorSection.style.borderColor = errorColor;
            errorSection.style.borderLeft = `4px solid ${errorColor}`;
            
            // 使用原始URL，不格式化
            const formattedUrl = data.url || '未知';
            
            errorSection.innerHTML = `
                <div style="margin-bottom: 10px; font-weight: 600; color: ${errorColor};">
                    <i class="${errorIcon}"></i> ${errorTitle}
                </div>
              
                <div class="error-url" style="margin: 10px 0;">
                    <strong>URL:</strong><br>
                    ${formattedUrl}
                </div>
                <div style="font-size: 0.85em; color: var(--error-color); word-break: break-all; white-space: normal;">
                    <i class="fas fa-info-circle"></i> 
                    ${errorType === 'proxy_timeout' ? 
                        '建议：请检查SOCKS5代理地址、端口和认证信息是否正确，代理服务器是否正常运行。' : 
                      errorType === 'url_timeout' ? 
                        '建议：目标服务器可能无法访问或响应过慢，请检查URL是否正确或尝试增加超时时间。' :
                      errorType === 'curl_error' ?
                        '建议：网络连接可能有问题，请检查网络设置和防火墙。' :
                        '建议：请检查网络连接、目标URL和代理设置。'
                    }
                </div>
            `;
            
            pre.parentNode.insertBefore(errorSection, pre);
            
            // 构建错误信息体 - 保持URL原样
            let errorBody = `${errorTitle}\n`;
            errorBody += '='.repeat(40) + '\n\n';
            errorBody += `错误详情: ${errorDetails}\n\n`;
            
            if (data.curl_error_code) {
                errorBody += `CURL错误码: ${data.curl_error_code}\n`;
            }
            if (data.curl_error_message) {
                errorBody += `CURL错误信息: ${data.curl_error_message}\n`;
            }
            
           // errorBody += `\nURL:\n${data.url || '未知'}\n`;  // 直接使用原始URL
            errorBody += `请求时间: ${(data.time * 1000).toFixed(0)}ms\n`;
            errorBody += `是否使用代理: ${proxyUsed ? '是' : '否'}\n`;
            errorBody += `错误类型: ${errorType || '未知'}\n`;
            
            pre.textContent = errorBody;
            return;
        }
        
        const skipBody = data.skip_body || false;
        const fileType = data.file_type || '';
        const isM3U8 = data.is_m3u8 || false;
        
        const contentType = headers && headers['content-type'] ? headers['content-type'].toLowerCase() : '';
        const isM3U8Content = contentType.includes('application/x-mpegurl') || 
                              contentType.includes('application/vnd.apple.mpegurl') ||
                              contentType.includes('audio/x-mpegurl') ||
                              (body && body.trim().startsWith('#EXTM3U'));
        
        const isTruncated = data.truncated || false;
        const downloadAvailable = data.download_available || false;
        
        if (skipBody && !isM3U8 && !isM3U8Content) {
            pre.textContent = body;
            
            if (fileType === 'media') {
                createMediaFileSection(pre, headers, data);
            } else if (fileType === 'large_file') {
                createLargeFileSection(pre, headers, data);
            }
            return;
        }
        
        if (isM3U8 || isM3U8Content) {
            pre.textContent = body;
            pre.classList.add('m3u8-content');
            createM3U8ActionButtons(pre, headers, data, downloadUrl, downloadAvailable);
            return;
        }
        
        if (isTruncated && downloadUrl) {
            pre.textContent = body;
            createDownloadSection(pre, body, contentType, downloadUrl, false, true, data.size, data.final_url || data.url, data);
        } else if (isTruncated && !downloadUrl) {
            pre.textContent = body;
            createNoDownloadSection(pre, body, contentType, false, true);
        } else if (body) {
            if (body.length > 5000) {
                pre.textContent = body.substring(0, 5000) + '\n\n... (响应体过长，仅显示前5000字符) ...';
            } else {
                pre.textContent = body;
            }
        } else if (contentType.includes('video/') || contentType.includes('audio/')) {
            const size = headers && headers['content-length'] ? 
                formatBytes(parseInt(headers['content-length'])) : '未知大小';
            pre.textContent = `[二进制或流媒体内容] 类型: ${contentType}，大小: ${size}`;
        } else {
            pre.textContent = '响应体为空';
        }
    }

    function createM3U8ActionButtons(pre, headers, data, downloadUrl, downloadAvailable) {
        const actionSection = document.createElement('div');
        actionSection.className = 'download-section m3u8-actions';
        actionSection.style.marginTop = '10px';
        actionSection.style.padding = '10px';
        actionSection.style.backgroundColor = '#f8f9fa';
        actionSection.style.borderRadius = '6px';
        actionSection.style.border = '1px solid var(--border-color)';
        
        let lineCount = 0;
        let tsCount = 0;
        let duration = 0;
        if (data.body) {
            const lines = data.body.split('\n');
            lineCount = lines.length;
            let currentDuration = 0;
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('#EXTINF:')) {
                    const match = trimmed.match(/#EXTINF:([\d\.]+)/);
                    if (match) {
                        currentDuration = parseFloat(match[1]);
                    }
                } else if (trimmed && !trimmed.startsWith('#') && (trimmed.endsWith('.ts') || trimmed.includes('.ts?'))) {
                    tsCount++;
                    duration += currentDuration;
                    currentDuration = 0;
                }
            }
        }
        
        actionSection.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <div style="font-size: 0.85em; color: var(--text-secondary);">
                    共 ${lineCount} 行，${tsCount} 个TS片段${duration > 0 ? `，总时长 ${duration.toFixed(1)} 秒` : ''}
                </div>
                <div style="flex: 1;"></div>
                ${downloadAvailable ? `
                <button class="btn download-m3u8-btn" style="background-color: var(--secondary-color); padding: 6px 12px; font-size: 0.85rem;">
                    <i class="fas fa-download"></i> 下载M3U8
                </button>
                ` : ''}
                <button class="btn copy-m3u8-btn" style="background-color: var(--primary-color); padding: 6px 12px; font-size: 0.85rem;">
                    <i class="fas fa-copy"></i> 复制内容
                </button>
            </div>
        `;
        
        if (downloadAvailable) {
            const downloadBtn = actionSection.querySelector('.download-m3u8-btn');
            if (downloadBtn) {
                downloadBtn.onclick = function() {
                    // 从URL提取原始文件名
                    const url = data.final_url || data.url;
                    const filename = extractFilenameFromUrl(url, 'playlist.m3u8');
                    downloadFile(downloadUrl, filename);
                    addLog('开始下载M3U8文件...', 'info');
                };
            }
        }
        
        const copyBtn = actionSection.querySelector('.copy-m3u8-btn');
        if (copyBtn) {
            copyBtn.onclick = function() {
                copyToClipboard(data.body || '');
                this.innerHTML = '<i class="fas fa-check"></i> 已复制';
                this.style.backgroundColor = 'var(--secondary-color)';
                setTimeout(() => {
                    this.innerHTML = '<i class="fas fa-copy"></i> 复制内容';
                    this.style.backgroundColor = 'var(--primary-color)';
                }, 2000);
                addLog('已复制M3U8内容到剪贴板', 'success');
            };
        }
        
        pre.parentNode.insertBefore(actionSection, pre.nextSibling);
    }

function extractFilenameFromUrl(url, defaultName = 'downloaded_file') {
    try {
        // 如果URL无效，返回默认名
        if (!url || url === '') return defaultName;
        
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        
        // 从路径中提取文件名
        if (pathname && pathname !== '/') {
            const segments = pathname.split('/').filter(s => s);
            if (segments.length > 0) {
                const lastSegment = segments[segments.length - 1];
                
                // 检查是否有扩展名
                if (lastSegment.includes('.') && lastSegment.length > 1) {
                    return decodeURIComponent(lastSegment);
                }
                
                // 没有扩展名，但可能是一个文件名
                if (lastSegment.length > 0 && lastSegment !== 'index' && lastSegment !== 'default') {
                    return decodeURIComponent(lastSegment);
                }
            }
        }
        
        // 从查询参数中尝试提取文件名
        const params = parsedUrl.searchParams;
        const filenameParams = ['filename', 'file', 'name', 'download'];
        for (const param of filenameParams) {
            if (params.has(param)) {
                const value = params.get(param);
                if (value && value.trim() !== '') {
                    const decoded = decodeURIComponent(value);
                    // 确保文件名是安全的
                    return decoded.replace(/[^\w\-\.]/g, '_');
                }
            }
        }
        
        // 生成基于域名的文件名
        const domain = parsedUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_');
        const timestamp = new Date().toTimeString().split(' ')[0].replace(/:/g, '');
        return `${domain}_${timestamp}`;
        
    } catch (e) {
        console.warn('无法解析URL提取文件名:', e);
        return defaultName;
    }
}

    function getFileExtension(defaultName) {
        const extMatch = defaultName.match(/\.(\w+)$/);
        return extMatch ? '.' + extMatch[1] : '';
    }

    function copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    function createMediaFileSection(pre, headers, data) {
        const contentType = headers && headers['content-type'] ? headers['content-type'] : '未指定';
        
        const isM3U8Content = contentType.includes('application/x-mpegurl') || 
                              contentType.includes('application/vnd.apple.mpegurl') ||
                              contentType.includes('audio/x-mpegurl');
        
        if (isM3U8Content) {
            return;
        }
        
        const mediaSection = document.createElement('div');
        mediaSection.className = 'download-section';
        mediaSection.style.backgroundColor = '#e3f2fd';
        mediaSection.style.borderColor = '#bbdefb';
        
        const contentLength = headers && headers['content-length'] ? 
            formatBytes(parseInt(headers['content-length'])) : '未知大小';
        const statusCode = data.status_code || '未知';
        
        mediaSection.innerHTML = `
            <div style="margin-bottom: 10px; font-weight: 600; color: var(--primary-color);">
                <i class="fas fa-file-video"></i> 媒体文件信息
            </div>
            <div style="margin-bottom: 10px; font-size: 0.9em;">
                <div style="margin-bottom: 5px;">状态码: <strong>${statusCode}</strong></div>
                <div style="margin-bottom: 5px;">内容类型: <code>${contentType}</code></div>
                <div style="margin-bottom: 5px;">文件大小: <strong>${contentLength}</strong></div>
                <div style="margin-bottom: 5px;">最终URL: <small style="word-break: break-all;">${data.final_url || data.url}</small></div>
            </div>
            <div style="font-size: 0.85em; color: var(--text-secondary);">
                <i class="fas fa-info-circle"></i> 此文件为媒体文件（视频/音频），为节省资源未获取完整响应体。如需测试播放，请使用专门的播放器。
            </div>
        `;
        
        pre.parentNode.insertBefore(mediaSection, pre.nextSibling);
    }

    function createLargeFileSection(pre, headers, data) {
        const largeFileSection = document.createElement('div');
        largeFileSection.className = 'download-section';
        largeFileSection.style.backgroundColor = '#fff3cd';
        largeFileSection.style.borderColor = '#ffeaa7';
        largeFileSection.style.color = '#856404';
        
        const contentType = headers && headers['content-type'] ? headers['content-type'] : '未指定';
        const contentLength = headers && headers['content-length'] ? 
            formatBytes(parseInt(headers['content-length'])) : '未知大小';
        const statusCode = data.status_code || '未知';
        
        largeFileSection.innerHTML = `
            <div style="margin-bottom: 10px; font-weight: 600; color: #856404;">
                <i class="fas fa-exclamation-triangle"></i> 大文件信息
            </div>
            <div style="margin-bottom: 10px; font-size: 0.9em;">
                <div style="margin-bottom: 5px;">状态码: <strong>${statusCode}</strong></div>
                <div style="margin-bottom: 5px;">内容类型: <code>${contentType}</code></div>
                <div style="margin-bottom: 5px;">文件大小: <strong>${contentLength}</strong> (超过2MB)</div>
                <div style="margin-bottom: 5px;">最终URL: <small style="word-break: break-all;">${data.final_url || data.url}</small></div>
            </div>
            <div style="font-size: 0.85em;">
                <i class="fas fa-info-circle"></i> 此文件大小超过2MB，为节省资源未获取完整响应体。如果这是您需要的文件，请直接使用下载工具。
            </div>
        `;
        
        pre.parentNode.insertBefore(largeFileSection, pre.nextSibling);
    }

function createDownloadSection(pre, body, contentType, downloadUrl, isM3U8, isTruncated, originalSize = null, originalUrl = null, data = {}) {
    const downloadSection = document.createElement('div');
    downloadSection.className = 'download-section';
    
    const displaySize = originalSize ? formatBytes(originalSize) : formatBytes(body.length);
    // 优先使用服务器建议的文件名
    const filename = data.suggested_filename || extractFilenameFromUrl(originalUrl || downloadUrl, getFilename(contentType, 'response'));
    
    downloadSection.innerHTML = `
        <div style="margin-bottom: 10px; font-weight: 600; color: var(--primary-color);">
            <i class="fas fa-download"></i> 下载完整响应
        </div>
        <div style="margin-bottom: 10px; font-size: 0.9em;">
            <div style="margin-bottom: 5px;">文件名: <code>${filename}</code></div>
            <div style="margin-bottom: 5px;">响应大小: <strong>${displaySize}</strong></div>
            <div style="margin-bottom: 5px;">内容类型: <code>${contentType || '未指定'}</code></div>
            ${isM3U8 ? '<div style="margin-bottom: 5px; color: var(--warning-color);"><i class="fas fa-exclamation-triangle"></i> 检测到M3U8播放列表</div>' : ''}
            ${isTruncated ? '<div style="margin-bottom: 5px; color: var(--info);"><i class="fas fa-info-circle"></i> 响应体已截断显示</div>' : ''}
        </div>
        <button class="btn download-full-btn" style="background-color: var(--secondary-color); padding: 8px 16px; font-size: 0.9rem;">
            <i class="fas fa-download"></i> 下载完整文件
        </button>
        <div style="margin-top: 10px; font-size: 0.85em; color: var(--text-secondary);">
            <i class="fas fa-info-circle"></i> 下载链接5分钟内有效
        </div>
    `;
    
    downloadSection.querySelector('.download-full-btn').onclick = function() {
        downloadFile(downloadUrl, filename);
        addLog(`开始下载文件: ${filename}`, 'info');
    };
    
    pre.parentNode.insertBefore(downloadSection, pre.nextSibling);
}

    function createNoDownloadSection(pre, body, contentType, isM3U8, isTruncated) {
        const noDownloadSection = document.createElement('div');
        noDownloadSection.className = 'download-section';
        noDownloadSection.style.backgroundColor = '#fff3cd';
        noDownloadSection.style.borderColor = '#ffeaa7';
        
        noDownloadSection.innerHTML = `
            <div style="margin-bottom: 10px; font-weight: 600; color: var(--warning-color);">
                <i class="fas fa-exclamation-triangle"></i> 响应体过大但无法提供下载
            </div>
            <div style="margin-bottom: 10px; font-size: 0.9em;">
                内容类型: <code>${contentType || '未指定'}</code><br>
                ${isM3U8 ? '检测到M3U8播放列表<br>' : ''}
                ${isTruncated ? '响应体已截断显示前2000字符。<br>' : ''}
            </div>
            <div style="font-size: 0.85em; color: var(--text-secondary);">
                下载功能不可用，可能是服务器权限问题或响应类型不支持。
            </div>
        `;
        
        pre.parentNode.insertBefore(noDownloadSection, pre.nextSibling);
    }

    function getFilename(contentType, defaultName) {
        if (contentType.includes('application/json')) return `${defaultName}.json`;
        if (contentType.includes('text/html')) return `${defaultName}.html`;
        if (contentType.includes('text/plain')) return `${defaultName}.txt`;
        if (contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) 
            return `${defaultName}.m3u8`;
        if (contentType.includes('video/')) return `${defaultName}.${contentType.split('/')[1]}`;
        if (contentType.includes('audio/')) return `${defaultName}.${contentType.split('/')[1]}`;
        return `${defaultName}`; // 不带扩展名，让extractFilenameFromUrl处理
    }

function downloadFile(url, filename) {
    // 创建一个临时的a标签来触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'downloaded_file';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    // 清理
    setTimeout(() => {
        if (document.body.contains(a)) {
            document.body.removeChild(a);
        }
    }, 1000);
    
    addLog(`开始下载文件: ${filename || '未命名文件'}`, 'info');
}

    function addLog(message, type = 'info') {
        const logItem = document.createElement('div');
        logItem.className = 'log-item';
        
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        
        logItem.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-message ${type}">${message}</span>`;
        
        logContainer.prepend(logItem);
    }
    
    clearBtn.addEventListener('click', function() {
        document.getElementById('url').value = '';
        document.getElementById('host').value = '';
        document.getElementById('timeout').value = '16';
        document.getElementById('user-agent').value = 'Okhttp/3.15';
        document.getElementById('referer').value = '';
        document.getElementById('other-headers').value = '';
        document.getElementById('proxy-address').value = '';
        document.getElementById('proxy-username').value = '';
        document.getElementById('proxy-password').value = '';
        document.getElementById('follow-redirects').value = 'auto';
        document.getElementById('max-redirects').value = '10';

        responseContainer.style.display = 'none';
        noResponse.style.display = 'block';
        logContainer.innerHTML = '';
        
        addLog('表单已清除', 'info');
    });
    
    exampleBtn.addEventListener('click', function() {
        document.getElementById('url').value = 'http://221.213.200.40:6610/00000003/2/H_YINGSHI?virtualDomain=00000003.live_hls.zte.com&programid=xxx&stbid=hotel&userid=hotel';
        addLog('已填充示例直播源', 'info');
    });

    const togglePasswordBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('proxy-password');

    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', function() {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            
            const icon = this.querySelector('i');
            if (type === 'text') {
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
                this.setAttribute('title', '隐藏密码');
            } else {
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
                this.setAttribute('title', '显示密码');
            }
        });
        
        togglePasswordBtn.setAttribute('title', '显示密码');
    }

sendBtn.addEventListener('click', function() {
    const url = document.getElementById('url').value.trim();
    if (!url) {
        addLog('请输入直播源URL', 'error');
        return;
    }

    loading.classList.add('active');
    responseContainer.style.display = 'none';
    noResponse.style.display = 'none';

    const headers = {
        'User-Agent': document.getElementById('user-agent').value,
        'Referer': document.getElementById('referer').value,
    };
    
    const otherHeadersText = document.getElementById('other-headers').value;
    otherHeadersText.split('\n').forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join(':').trim();
            if (name) {
                headers[name] = value;
            }
        }
    });
    
    const requestData = {
        url: url,
        method: 'GET',
        host: document.getElementById('host').value.trim(),
        timeout: parseInt(document.getElementById('timeout').value),
        proxy: document.getElementById('proxy-address').value.trim(),
        proxy_username: document.getElementById('proxy-username').value.trim(),
        proxy_password: document.getElementById('proxy-password').value.trim(),
        follow_redirects: document.getElementById('follow-redirects').value === 'auto',
        max_redirects: parseInt(document.getElementById('max-redirects').value),
        headers: headers,
        otherHeaders: otherHeadersText
    };
    
    addLog(`正在发送请求: ${url}`, 'info');

    if (requestData.proxy) {
        addLog(`使用SOCKS5代理: ${requestData.proxy}`, 'info');
    }

    fetch('api.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
    })
    .then(res => {
        if (!res.ok) {
            throw new Error(`HTTP错误: ${res.status} ${res.statusText}`);
        }
        
        return res.text().then(text => {
            try {
                if (!text || text.trim() === '') {
                    throw new Error('服务器返回空响应');
                }
                return JSON.parse(text);
            } catch (e) {
                console.error('JSON解析失败，原始响应:', text.substring(0, 500));
                throw new Error(`JSON解析失败: ${e.message}，响应: ${text.substring(0, 200)}...`);
            }
        });
    })
.then(data => {
        console.log("API响应数据:", data);
        
        loading.classList.remove('active');
        responseContainer.style.display = 'block';

        // 修改：检查是否是错误响应（包括代理错误、代理认证失败和其他错误）
        const isErrorResponse = data.error || data.error_type || data.proxy_error || data.proxy_auth_failed;
        
        const code = data.status_code;
        const statusBadge = document.getElementById('response-status');
        
        document.getElementById('response-time').textContent = `${(data.time * 1000).toFixed(0)} ms`;
        document.getElementById('response-size').textContent = formatBytes(data.size);
        
        const redirectCount = data.redirect_count || (data.redirects && data.redirects.length > 0 ? data.redirects.length - 1 : 0);
        const chainLength = data.redirects ? data.redirects.length : 0;
        
        redirectCountText.textContent = `${redirectCount} 次`;
        redirectCountBadge.textContent = chainLength;
        
        const headerCount = data.headers ? Object.keys(data.headers).length : 0;
        headersBadge.textContent = headerCount;

        statusBadge.textContent = `HTTP/${data.http_version || '1.1'} ${code} ${getHttpReasonPhrase(code)}`;
        if (code >= 200 && code < 300) statusBadge.className = 'status-badge status-success';
        else if (code >= 300 && code < 400) statusBadge.className = 'status-badge status-warning';
        else if (code === 504) statusBadge.className = 'status-badge status-504';
        else if (code === 502 && data.proxy_auth_failed) statusBadge.className = 'status-badge status-proxy-error';
        else statusBadge.className = 'status-badge status-error';

        updateRedirectDisplay(data.redirects || []);
        updateHeadersDisplay(data.headers || {});
        updateBodyDisplay(data.body || '', data.headers || {}, data.download_url || null, data);

        saveHistoryItem(requestData, data);
        loadHistory();

        // 修改日志显示逻辑
        const proxyInfo = requestData.proxy ? ` (通过代理 ${requestData.proxy})` : '';
        
        if (isErrorResponse) {
            // 代理认证失败
            if (data.proxy_auth_failed) {
                let errorMsg = data.error_details || data.error || 'SOCKS5代理认证失败';
                addLog(`SOCKS5代理认证失败${proxyInfo}: ${errorMsg}`, 'error');
            }
            // 代理连接错误
            else if (data.proxy_error) {
                let errorMsg = data.error_details || data.error || '代理连接失败';
                addLog(`SOCKS5代理错误${proxyInfo}: ${errorMsg}`, 'error');
            }
            // URL访问超时
            else if (data.error_type === 'url_timeout') {
                let errorMsg = data.error_details || data.error || '访问超时';
                addLog(`URL访问超时${proxyInfo}: ${errorMsg}`, 'error');
            }
            // 其他错误
            else if (data.error_type === 'general_error' || data.error) {
                let errorMsg = data.error_details || data.error || '请求失败';
                addLog(`请求失败${proxyInfo}: ${errorMsg}`, 'error');
            }
            // 504网关超时（非代理错误）
            else if (code === 504 && !data.proxy_error) {
                addLog(`网关超时${proxyInfo}: 目标服务器无法访问或响应超时`, 'error');
            }
            // 502错误（非代理认证失败）
            else if (code === 502 && !data.proxy_auth_failed) {
                addLog(`HTTP 502 Bad Gateway${proxyInfo}: 网关错误`, 'error');
            }
            // 其他HTTP错误
            else if (code >= 400) {
                addLog(`HTTP ${code} ${getHttpReasonPhrase(code)}${proxyInfo}`, 'error');
            }
        } else {
            // 成功响应
            addLog(`请求成功${proxyInfo}: HTTP ${code} (${(data.time * 1000).toFixed(0)}ms，大小 ${formatBytes(data.size)})`, 'success');
        }
    })
    .catch(err => {
        loading.classList.remove('active');
        responseContainer.style.display = 'none';
        noResponse.style.display = 'block';
        
        const errorMessage = err.message || '未知错误';
        document.getElementById('response-status').textContent = errorMessage;
        document.getElementById('response-status').className = 'status-badge status-error';
        document.getElementById('response-time').textContent = '0 ms';
        document.getElementById('response-size').textContent = '0 B';
        redirectCountText.textContent = '0 次';
        redirectCountBadge.textContent = '0';
        headersBadge.textContent = '0';
        
        const errorText = err.message || '';
        if (errorText.includes('SOCKS5') || errorText.includes('代理')) {
            addLog(`SOCKS5代理连接失败: ${errorMessage}`, 'error');
        } else if (errorText.includes('超时') || errorText.includes('timeout')) {
            addLog(`请求超时: ${errorMessage}`, 'error');
        } else {
            addLog(`请求失败: ${errorMessage}`, 'error');
        }
        
        console.error('请求详细错误:', err);
        checkBackendConnection('请求失败后检查');
    });
});

    checkBackendConnection('页面加载');
        
    document.getElementById('headers-content').classList.remove('expanded');
    document.getElementById('proxy-content').classList.remove('expanded');
    document.getElementById('redirect-content').classList.remove('expanded');
    
    loadHistory();
});