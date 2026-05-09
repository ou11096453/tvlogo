class LiveStreamScanner {
constructor() {
    this.state = {
        scanning: false,
        paused: false,
        stopped: false,
        queue: [],
        active: 0,
        results: {
            valid: [],
            timeout: [],
            invalid: []
        },
        stats: {
            total: 0,
            completed: 0,
            valid: 0,
            timeout: 0,
            invalid: 0,
            startTime: null,
            endTime: null
        }
    };
    
    this.config = {
        concurrent: 3,
        timeout: 5,
        retryCount: 1,
        delay: 200,
        autoSave: true
    };
    
    this.MAX_HISTORY = 20; // 最多保存20条记录
    this.history = [];
    
    // 添加扫描序号计数器
    this.scanSequence = 0;
    
    this.init();
}
    
    init() {
        console.log('初始化LiveStreamScanner');
        this.loadSettings();
        this.loadHistory();
        this.updateUI();
        this.addLog('扫描器初始化完成，等待输入模板...', 'info');
    }
    
    loadSettings() {
        const saved = JSON.parse(localStorage.getItem('scanner_settings') || '{}');
        
        // 加载配置值
        Object.keys(this.config).forEach(key => {
            if (saved[key] !== undefined) {
                this.config[key] = saved[key];
            }
        });
        
        // 更新UI输入框
        const elements = {
            'concurrent': 'concurrent',
            'timeout': 'timeout',
            'retryCount': 'retry-count',
            'delay': 'delay',
            'autoSave': 'auto-save'
        };
        
        Object.entries(elements).forEach(([key, id]) => {
            const element = document.getElementById(id);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = this.config[key];
                } else {
                    element.value = this.config[key];
                }
            }
        });
        
        // 加载其他设置
        const otherSettings = [
            'scan-template', 'proxy-address', 'proxy-username', 'proxy-password',
            'user-agent', 'referer', 'host', 'other-headers'
        ];
        
        otherSettings.forEach(id => {
            const element = document.getElementById(id);
            if (element && saved[id] !== undefined) {
                element.value = saved[id];
            }
        });
    }
    
    saveSettings() {
        if (!this.config.autoSave) return;
        
        const settings = {
            ...this.config,
            'scan-template': document.getElementById('scan-template').value,
            'proxy-address': document.getElementById('proxy-address').value,
            'proxy-username': document.getElementById('proxy-username').value,
            'proxy-password': document.getElementById('proxy-password').value,
            'user-agent': document.getElementById('user-agent').value,
            'referer': document.getElementById('referer').value,
            'host': document.getElementById('host').value,
            'other-headers': document.getElementById('other-headers').value
        };
        
        localStorage.setItem('scanner_settings', JSON.stringify(settings));
    }
    
    parseTemplate(template) {
        const urls = [];
        const lines = template.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            // 提取所有变量 [start-end]
            const variableMatches = [];
            const regex = /\[(\d+)-(\d+)\]/g;
            let match;
            
            while ((match = regex.exec(line)) !== null) {
                variableMatches.push({
                    full: match[0],
                    start: parseInt(match[1]),
                    end: parseInt(match[2]),
                    length: match[1].length
                });
            }
            
            if (variableMatches.length === 0) {
                urls.push(line);
                continue;
            }
            
            // 生成变量值的所有组合
            const valueSets = variableMatches.map(v => {
                const values = [];
                for (let i = v.start; i <= v.end; i++) {
                    values.push(i.toString().padStart(v.length, '0'));
                }
                return values;
            });
            
            // 计算笛卡尔积
            const combinations = this.cartesianProduct(...valueSets);
            
            // 生成URL
            combinations.forEach(combo => {
                let url = line;
                variableMatches.forEach((v, index) => {
                    url = url.replace(v.full, combo[index]);
                });
                urls.push(url);
            });
        }
        
        return urls;
    }
    
    cartesianProduct(...arrays) {
        return arrays.reduce((acc, curr) => {
            const result = [];
            for (const a of acc) {
                for (const b of curr) {
                    result.push([...a, b]);
                }
            }
            return result;
        }, [[]]);
    }
    
    async start() {
    if (this.state.scanning) {
        this.addLog('扫描正在进行中...', 'warning');
        return;
    }
    
    const template = document.getElementById('scan-template').value.trim();
    if (!template) {
        this.addLog('请输入扫描模板', 'error');
        this.showNotification('请输入扫描模板', 'error');
        return;
    }
    
    // 更新配置
    this.updateConfig();
    this.saveSettings();
    
    try {
        this.addLog('正在解析模板...', 'info');
        const urls = this.parseTemplate(template);
        
        if (urls.length === 0) {
            this.addLog('未生成任何URL，请检查模板格式', 'error');
            this.showNotification('未生成URL，请检查模板格式', 'error');
            return;
        }
        
        this.addLog(`成功生成 ${urls.length} 个URL`, 'success');
        
        // 重置扫描序号
        this.scanSequence = 0;
        
        // 初始化状态
        this.state = {
            scanning: true,
            paused: false,
            stopped: false,
            queue: [...urls],
            active: 0,
            results: {
                valid: [],
                timeout: [],
                invalid: []
            },
            stats: {
                total: urls.length,
                completed: 0,
                valid: 0,
                timeout: 0,
                invalid: 0,
                startTime: new Date(),
                endTime: null
            }
        };
        
        // 更新UI
        this.updateUI();
        this.updateStats();
        
        // 开始扫描
        this.addLog(`开始扫描，并发数: ${this.config.concurrent}`, 'info');
        this.showNotification(`开始扫描 ${urls.length} 个URL`, 'info');
        
        for (let i = 0; i < this.config.concurrent; i++) {
            this.processNext();
        }
        
    } catch (error) {
        this.addLog(`解析模板失败: ${error.message}`, 'error');
        this.showNotification('模板解析失败', 'error');
        console.error('模板解析错误:', error);
    }
}
    
    updateConfig() {
        this.config.concurrent = parseInt(document.getElementById('concurrent').value) || 3;
        this.config.timeout = parseInt(document.getElementById('timeout').value) || 5;
        this.config.retryCount = parseInt(document.getElementById('retry-count').value) || 1;
        this.config.delay = parseInt(document.getElementById('delay').value) || 200;
        this.config.autoSave = document.getElementById('auto-save').checked;
    }
    
    async processNext() {
        if (this.state.paused || this.state.stopped || this.state.queue.length === 0) {
            if (this.state.active === 0 && !this.state.paused && !this.state.stopped) {
                this.finish();
            }
            return;
        }
        
        const url = this.state.queue.shift();
        if (!url) return;
        
        this.state.active++;
        
        try {
            await this.scanUrl(url);
        } catch (error) {
            console.error('扫描URL出错:', error);
            this.addLog(`扫描出错: ${url}`, 'error');
        } finally {
            this.state.active--;
            
            // 延迟
            if (this.config.delay > 0 && !this.state.stopped) {
                await new Promise(resolve => setTimeout(resolve, this.config.delay));
            }
            
            // 处理下一个
            if (!this.state.stopped) {
                this.processNext();
            }
        }
    }
    
    async scanUrl(url, retry = 0) {
        if (this.state.stopped) return;
        
        const startTime = Date.now();
        
        try {
            // 构建请求头
            const headers = {
                'User-Agent': document.getElementById('user-agent').value || 'Okhttp/3.15',
                'Referer': document.getElementById('referer').value || ''
            };
            
            // 添加其他请求头
            const otherHeaders = document.getElementById('other-headers').value;
            if (otherHeaders) {
                otherHeaders.split('\n').forEach(line => {
                    const parts = line.split(':');
                    if (parts.length >= 2) {
                        const name = parts[0].trim();
                        const value = parts.slice(1).join(':').trim();
                        if (name) {
                            headers[name] = value;
                        }
                    }
                });
            }
            
            // 构建请求数据
            const requestData = {
                url: url,
                method: 'GET',
                timeout: this.config.timeout,
                proxy: document.getElementById('proxy-address').value.trim(),
                proxy_username: document.getElementById('proxy-username').value.trim(),
                proxy_password: document.getElementById('proxy-password').value.trim(),
                host: document.getElementById('host').value.trim(),
                follow_redirects: true,
                max_redirects: 5,
                headers: headers,
                scan_mode: true
            };
            
            const response = await fetch('api.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }
            
            const data = await response.json();
            const elapsed = Date.now() - startTime;
            
            // 判断结果类型
            let resultType = 'invalid';
            let logType = 'error';
            let logMessage = `无效（status：${data.status_code}）: ${url} (${elapsed}ms)`;
            let statusDetails = '';
            
            // 1. 先检查是否是CURL回调中断（扫描模式限制）
            if (data.error_type === 'callback_aborted') {
                resultType = 'invalid';
                logType = 'warning';
                logMessage = `请求被中断（扫描模式限制）: ${url} (${elapsed}ms)`;
                statusDetails = 'CURL回调中断，可能是扫描模式限制了响应大小';
            }
            // 2. 检查是否是代理相关错误
            else if (data.error_type === 'proxy_timeout' || data.proxy_error) {
                resultType = 'timeout';
                logType = 'warning';
                if (elapsed < 1000) {
                    logMessage = `代理快速失败: ${url} (${elapsed}ms)`;
                    statusDetails = '代理服务器快速拒绝或超时';
                } else {
                    logMessage = `代理超时: ${url} (${elapsed}ms)`;
                    statusDetails = '代理连接超时';
                }
            }
            // 3. 检查是否是URL连接超时
            else if (data.error_type === 'url_timeout') {
                resultType = 'timeout';
                logType = 'warning';
                logMessage = `连接超时: ${url} (${elapsed}ms)`;
                statusDetails = '无法连接到目标服务器';
            }
            // 4. 检查是否是服务器返回的504
            else if (data.status_code === 504) {
                resultType = 'timeout';
                logType = 'warning';
                if (elapsed < 2000) {
                    logMessage = `服务器快速504: ${url} (${elapsed}ms)`;
                    statusDetails = '服务器快速返回504网关超时';
                } else {
                    logMessage = `服务器504超时: ${url} (${elapsed}ms)`;
                    statusDetails = '服务器网关超时';
                }
            }
            // 5. 检查是否是有效的M3U8
            else if (data.status_code === 200) {
                // 检查是否为M3U8
                const contentType = data.headers['content-type'] || '';
                const isM3U8Content = contentType.includes('application/x-mpegurl') || 
                                     contentType.includes('application/vnd.apple.mpegurl') ||
                                     contentType.includes('audio/x-mpegurl');
                const isM3U8Body = data.body && data.body.trim().startsWith('#EXTM3U');
                let isM3U8Url = false;
                
                try {
                    const urlObj = new URL(url);
                    const urlPath = urlObj.pathname;
                    isM3U8Url = urlPath.endsWith('.m3u8') || urlPath.endsWith('.m3u');
                } catch (e) {
                    // URL解析失败，使用字符串检查
                    isM3U8Url = url.includes('.m3u8') || url.includes('.m3u');
                }
                
                if (isM3U8Content || isM3U8Body || isM3U8Url) {
                    resultType = 'valid';
                    logType = 'success';
                    logMessage = `有效（status：${data.status_code}）: ${url} (${elapsed}ms)`;
                    statusDetails = '有效的M3U8直播源';
                } else {
                    logMessage = `无效（非M3U8，status：${data.status_code}）: ${url} (${elapsed}ms)`;
                    statusDetails = '返回200但不是M3U8格式';
                }
            }
            // 6. 其他状态码
            else if (data.status_code >= 400 && data.status_code < 500) {
                // 4xx客户端错误
                logMessage = `无效（status：${data.status_code}）: ${url} (${elapsed}ms)`;
                statusDetails = `无效: ${data.status_code}`;
            } else if (data.status_code >= 500 && data.status_code < 600) {
                // 5xx服务器错误
                resultType = 'timeout';
                logType = 'warning';
                logMessage = `超时（status：${data.status_code}）: ${url} (${elapsed}ms)`;
                statusDetails = `超时: ${data.status_code}`;
            }
            
// 在成功扫描的部分，保存结果之前添加：
const result = {
    url: url,
    type: resultType,
    status_code: data.status_code || 0,
    time: elapsed,
    size: data.size || 0,
    final_url: data.final_url || url,
    error_type: data.error_type || '',
    proxy_error: data.proxy_error || false,
    details: statusDetails,
    data: data, // 保存完整的API响应用于调试
    sequence: ++this.scanSequence // 添加扫描序号
};


            this.state.results[resultType].push(result);
            this.state.stats[resultType]++;
            this.state.stats.completed++;
            
            // 更新UI
            this.updateResultsDisplay();
            this.updateStats();
            
            // 添加日志
            this.addLog(logMessage, logType);
            
        } catch (error) {
            // 重试逻辑
            if (retry < this.config.retryCount) {
                this.addLog(`重试 ${url} (${retry + 1}/${this.config.retryCount})`, 'warning');
                return this.scanUrl(url, retry + 1);
            }
            
            // 记录为超时
            const result = {
                url: url,
                type: 'timeout',
                status_code: 0,
                time: Date.now() - startTime,
                size: 0,
                final_url: url,
                error_type: 'network_error',
                proxy_error: false,
                details: `网络错误: ${error.message}`
            };
            
            this.state.results.timeout.push(result);
            this.state.stats.timeout++;
            this.state.stats.completed++;
            
            this.updateResultsDisplay();
            this.updateStats();
            this.addLog(`网络失败: ${url} (${error.message})`, 'error');
        }
    }
    
    togglePause() {
        if (!this.state.scanning) return;
        
        this.state.paused = !this.state.paused;
        
        if (this.state.paused) {
            this.addLog('扫描已暂停', 'warning');
            document.getElementById('pause-btn').innerHTML = '<i class="fas fa-play"></i> 继续';
            document.getElementById('scan-status').textContent = '已暂停';
            document.getElementById('scan-status').className = 'status-badge status-warning';
        } else {
            this.addLog('扫描继续', 'info');
            document.getElementById('pause-btn').innerHTML = '<i class="fas fa-pause"></i> 暂停';
            document.getElementById('scan-status').textContent = '扫描中';
            document.getElementById('scan-status').className = 'status-badge status-info';
            
            // 继续处理
            for (let i = 0; i < this.config.concurrent - this.state.active; i++) {
                this.processNext();
            }
        }
        
        this.updateUI();
    }
    
    stop() {
        if (!this.state.scanning) return;
        
        this.state.stopped = true;
        this.state.scanning = false;
        this.state.paused = false;
        
        this.addLog('扫描已停止', 'warning');
        this.updateUI();
        
        document.getElementById('scan-status').textContent = '已停止';
        document.getElementById('scan-status').className = 'status-badge status-error';
        document.getElementById('export-btn').disabled = false;
        
        // 显示扫描信息
        document.getElementById('scan-info').style.display = 'block';
    }
    
    finish() {
        this.state.scanning = false;
        this.state.paused = false;
        this.state.stats.endTime = new Date();
        
        const totalTime = (this.state.stats.endTime - this.state.stats.startTime) / 1000;
        const speed = (this.state.stats.total / totalTime).toFixed(1);
        
        this.addLog(`扫描完成！总计: ${this.state.stats.total}, 有效: ${this.state.stats.valid}, 超时: ${this.state.stats.timeout}, 无效: ${this.state.stats.invalid}, 耗时: ${totalTime.toFixed(1)}秒`, 'success');
        this.showNotification(`扫描完成！发现 ${this.state.stats.valid} 个有效源`, 'success');
        
        document.getElementById('scan-status').textContent = '已完成';
        document.getElementById('scan-status').className = 'status-badge status-success';
        document.getElementById('export-btn').disabled = false;
        
        // 更新扫描信息
        document.getElementById('scan-info').style.display = 'block';
        const scanDetails = document.getElementById('scan-details');
        scanDetails.innerHTML = `
            扫描完成: ${this.state.stats.total}个URL<br>
            有效源: ${this.state.stats.valid} | 超时源: ${this.state.stats.timeout} | 无效源: ${this.state.stats.invalid}<br>
            成功率: ${((this.state.stats.valid / this.state.stats.total) * 100).toFixed(1)}% | 耗时: ${totalTime.toFixed(1)}秒<br>
            点击"导出结果"保存扫描报告
        `;
        
        // 保存扫描记录
        this.saveScanHistory();
        
        this.updateUI();
    }
    
    saveScanHistory() {
        if (this.state.stats.total === 0) return;
        
        const historyItem = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            displayTime: this.formatDateTime(new Date()),
            shortTime: this.formatShortTime(new Date()),
            template: document.getElementById('scan-template').value,
            config: {
                concurrent: this.config.concurrent,
                timeout: this.config.timeout,
                retryCount: this.config.retryCount,
                delay: this.config.delay,
                proxyAddress: document.getElementById('proxy-address').value,
                proxyUsername: document.getElementById('proxy-username').value,
                proxyPassword: document.getElementById('proxy-password').value,
                userAgent: document.getElementById('user-agent').value,
                referer: document.getElementById('referer').value,
                host: document.getElementById('host').value,
                otherHeaders: document.getElementById('other-headers').value
            },
            results: {
                total: this.state.stats.total,
                valid: this.state.stats.valid,
                timeout: this.state.stats.timeout,
                invalid: this.state.stats.invalid,
                time: Math.round((this.state.stats.endTime - this.state.stats.startTime) / 1000)
            }
        };
        
        // 加载现有历史记录
        this.loadHistory();
        
        // 检查是否有相同模板的记录，如果有则更新，没有则添加
        const existingIndex = this.history.findIndex(item => item.template === historyItem.template);
        
        if (existingIndex !== -1) {
            // 更新现有记录
            this.history[existingIndex] = historyItem;
            // 按时间重新排序，最新的在前面
            this.history.sort((a, b) => b.id - a.id);
        } else {
            // 添加到历史记录开头
            this.history.unshift(historyItem);
        }
        
        // 限制数量
        if (this.history.length > this.MAX_HISTORY) {
            this.history = this.history.slice(0, this.MAX_HISTORY);
        }
        
        // 保存到localStorage
        localStorage.setItem('scanner_history', JSON.stringify(this.history));
        
        // 更新显示
        this.updateHistoryDisplay();
    }
    
    loadHistory() {
        this.history = JSON.parse(localStorage.getItem('scanner_history') || '[]');
        this.updateHistoryDisplay();
    }
    
    updateHistoryDisplay() {
        const container = document.getElementById('scan-history-list');
        
        if (this.history.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-history"></i>
                    <p>暂无扫描记录</p>
                    <small>扫描完成后将保存记录</small>
                </div>
            `;
            return;
        }
        
        container.innerHTML = '';
        
        this.history.forEach((item, index) => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.setAttribute('data-id', item.id);
            
            historyItem.innerHTML = `
                <div class="history-info">
                    <div class="history-template" title="${item.template}">${item.template}</div>
                    <div class="history-meta">
                        <div class="history-time-badge">${item.displayTime}</div>
                        <div class="history-stats">
                            <span class="history-valid">有效: ${item.results.valid}</span>
                            <span class="history-timeout">超时: ${item.results.timeout}</span>
                            <span class="history-invalid">无效: ${item.results.invalid}</span>
                        </div>
                        <div class="history-summary">
                            <span>总计: ${item.results.total}</span>
                            <span>耗时: ${item.results.time}s</span>
                        </div>
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
            
            // 绑定回填按钮事件
            const fillBtn = historyItem.querySelector('.history-fill-btn');
            fillBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.fillConfigFromHistory(item);
            });
            
            // 绑定删除按钮事件
            const deleteBtn = historyItem.querySelector('.history-delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteHistoryItem(item.id);
            });
            
            // 点击整个项目也可以回填
            historyItem.addEventListener('click', (e) => {
                if (!e.target.closest('.history-actions')) {
                    this.fillConfigFromHistory(item);
                }
            });
            
            container.appendChild(historyItem);
        });
    }
    
    fillConfigFromHistory(item) {
        // 回填模板
        document.getElementById('scan-template').value = item.template;
        
        // 回填配置
        document.getElementById('concurrent').value = item.config.concurrent;
        document.getElementById('timeout').value = item.config.timeout;
        document.getElementById('retry-count').value = item.config.retryCount;
        document.getElementById('delay').value = item.config.delay;
        document.getElementById('proxy-address').value = item.config.proxyAddress;
        document.getElementById('proxy-username').value = item.config.proxyUsername;
        document.getElementById('proxy-password').value = item.config.proxyPassword;
        document.getElementById('user-agent').value = item.config.userAgent;
        document.getElementById('referer').value = item.config.referer;
        document.getElementById('host').value = item.config.host;
        document.getElementById('other-headers').value = item.config.otherHeaders;
        
        // 更新扫描器配置
        this.config.concurrent = item.config.concurrent;
        this.config.timeout = item.config.timeout;
        this.config.retryCount = item.config.retryCount;
        this.config.delay = item.config.delay;
        
        // 保存设置
        this.saveSettings();
        
        // 显示提示
        this.addLog(`已回填扫描配置: ${item.template.substring(0, 50)}${item.template.length > 50 ? '...' : ''}`, 'success');
        
        // 滚动到顶部
        window.scrollTo(0, 0);
    }
    
    deleteHistoryItem(id) {
        if (confirm('确定要删除这条扫描记录吗？')) {
            this.history = this.history.filter(item => item.id !== id);
            localStorage.setItem('scanner_history', JSON.stringify(this.history));
            this.updateHistoryDisplay();
            this.addLog('已删除扫描记录', 'info');
        }
    }
    
    clearHistory() {
        if (this.history.length === 0) {
            this.addLog('没有可清除的扫描记录', 'info');
            return;
        }
        
        if (confirm('确定要清空所有扫描记录吗？此操作不可恢复。')) {
            this.history = [];
            localStorage.removeItem('scanner_history');
            this.updateHistoryDisplay();
            this.addLog('已清空所有扫描记录', 'info');
        }
    }
    
    formatTime(date) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
    
    formatDateTime(date) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    formatShortTime(date) {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    updateUI() {
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const stopBtn = document.getElementById('stop-btn');
        const exportBtn = document.getElementById('export-btn');
        const scanInfo = document.getElementById('scan-info');
        
        if (this.state.scanning) {
            startBtn.disabled = true;
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
            scanInfo.style.display = 'block';
            
            if (this.state.paused) {
                pauseBtn.innerHTML = '<i class="fas fa-play"></i> 继续';
            } else {
                pauseBtn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
            }
        } else {
            startBtn.disabled = false;
            pauseBtn.disabled = true;
            stopBtn.disabled = true;
            
            if (this.state.stats.completed > 0) {
                exportBtn.disabled = false;
                scanInfo.style.display = 'block';
            }
        }
    }
    
    updateStats() {
        // 更新计数
        document.getElementById('valid-count').textContent = this.state.stats.valid;
        document.getElementById('timeout-count').textContent = this.state.stats.timeout;
        document.getElementById('invalid-count').textContent = this.state.stats.invalid;
        
        // 更新进度
        const progress = this.state.stats.total > 0 ? (this.state.stats.completed / this.state.stats.total * 100) : 0;
        document.getElementById('total-progress').textContent = `${progress.toFixed(1)}%`;
        document.getElementById('scan-progress').textContent = `${this.state.stats.completed}/${this.state.stats.total}`;
        
        // 更新进度条
        document.getElementById('progress-bar').style.width = `${progress}%`;
        
        // 更新标签页徽章
        document.getElementById('valid-badge').textContent = this.state.stats.valid;
        document.getElementById('timeout-badge').textContent = this.state.stats.timeout;
        document.getElementById('invalid-badge').textContent = this.state.stats.invalid;
        document.getElementById('all-badge').textContent = this.state.stats.completed;
        
        // 更新扫描速度
        if (this.state.stats.startTime && this.state.scanning && !this.state.paused) {
            const elapsed = (new Date() - this.state.stats.startTime) / 1000;
            if (elapsed > 0) {
                const speed = (this.state.stats.completed / elapsed).toFixed(1);
                document.getElementById('scan-speed').textContent = `${speed}个/秒`;
            }
        }
        
        // 更新扫描详情
        const scanDetails = document.getElementById('scan-details');
        if (this.state.scanning) {
            scanDetails.innerHTML = `
                已扫描: ${this.state.stats.completed}/${this.state.stats.total} (${progress.toFixed(1)}%)<br>
                有效源: ${this.state.stats.valid} | 超时源: ${this.state.stats.timeout} | 无效源: ${this.state.stats.invalid}<br>
                ${this.state.paused ? '状态: 已暂停' : '状态: 扫描中'}
            `;
        }
    }
    
updateResultsDisplay() {
    // 更新有效源列表
    this.updateResultList('valid', this.state.results.valid);
    
    // 更新超时源列表
    this.updateResultList('timeout', this.state.results.timeout);
    
    // 更新无效源列表
    this.updateResultList('invalid', this.state.results.invalid);
    
    // 更新全部结果列表（按扫描顺序）
    const allResults = [
        ...this.state.results.valid,
        ...this.state.results.timeout,
        ...this.state.results.invalid
    ];
    
    // 按扫描序号排序
    allResults.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    
    this.updateResultList('all', allResults);
}
    
updateResultList(type, results) {
    const container = document.getElementById(`${type}-list`);
    
    if (!results || results.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <i class="fas fa-${type === 'valid' ? 'check-circle' : type === 'timeout' ? 'clock' : type === 'invalid' ? 'times-circle' : 'list'}"></i>
                <p>暂无${type === 'valid' ? '有效' : type === 'timeout' ? '超时' : type === 'invalid' ? '无效' : '扫描'}直播源</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    // 按扫描顺序排序（如果有时间戳的话）
    // 这里我们假设结果添加的顺序就是扫描顺序
    // 所以不需要额外排序
    
    results.forEach((result, index) => {
        const item = document.createElement('div');
        item.className = `result-item ${result.type || result.displayType}`;
        
        const displayType = result.displayType || result.type;
        
        // 根据不同类型显示不同的状态文本
        let statusText = '';
        let statusClass = displayType;
        
        if (displayType === 'valid') {
            statusText = `有效(${result.status_code})`;
            statusClass = 'valid';
        } else if (displayType === 'timeout') {
            if (result.error_type === 'proxy_timeout' || result.proxy_error) {
                statusText = `代理超时`;
                statusClass = 'proxy-timeout';
            } else if (result.status_code === 504) {
                if (result.time < 2000) {
                    statusText = `快速504`;
                    statusClass = 'fast-timeout';
                } else {
                    statusText = `连接超时`;
                }
            } else if (result.status_code === 0) {
                statusText = `连接超时`;
            } else if (result.status_code >= 500) {
                statusText = `服务器${result.status_code}`;
                statusClass = 'server-error';
            } else {
                statusText = `超时(${result.status_code})`;
            }
        } else if (displayType === 'invalid') {
            if (result.status_code === 200) {
                statusText = `非M3U8`;
                statusClass = 'non-m3u8';
            } else {
                statusText = `无效(${result.status_code})`;
            }
        }
        
        item.innerHTML = `
            <div class="result-url" title="${result.url}">${result.url}</div>
            <div class="result-meta">
                <span class="result-status ${statusClass}">${statusText}</span>
                <span class="result-time">${result.time}ms</span>
            </div>
        `;
        
        // 点击查看详情
        item.addEventListener('click', () => {
            this.showResultDetails(result);
        });
        
        container.appendChild(item);
    });
    
    // 如果正在扫描且是全部结果页面，自动滚动到底部
    if (type === 'all' && this.state.scanning && !this.state.paused) {
        // 等待DOM更新后滚动
        setTimeout(() => {
            const allTab = document.getElementById('all-tab');
            if (allTab) {
                allTab.scrollTop = allTab.scrollHeight;
            }
        }, 10);
    }
}
    
    showResultDetails(result) {
        let details = `URL: ${result.url}\n`;
        details += `最终URL: ${result.final_url}\n`;
        details += `状态码: ${result.status_code}\n`;
        details += `耗时: ${result.time}ms\n`;
        details += `类型: ${result.type}\n`;
        
        if (result.details) {
            details += `详情: ${result.details}\n`;
        }
        
        if (result.error_type) {
            details += `错误类型: ${result.error_type}\n`;
        }
        
        if (result.proxy_error) {
            details += `代理错误: 是\n`;
        }
        
        if (result.data && result.data.redirects && result.data.redirects.length > 0) {
            details += `\n重定向历史:\n`;
            result.data.redirects.forEach((redirect, index) => {
                details += `  ${index + 1}. ${redirect.url} (${redirect.status_code}, ${redirect.time.toFixed(3)}s)\n`;
            });
        }
        
        if (result.data && result.data.curl_error_message) {
            details += `CURL错误: ${result.data.curl_error_message}\n`;
        }
        
        // 显示详细错误信息
        this.addLog(`结果详情: ${result.url}`, 'info', details);
    }
    
exportResults() {
    if (this.state.stats.completed === 0) {
        this.addLog('没有可导出的结果', 'warning');
        return;
    }
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    let content = `${timestamp}\n`;
    content += `# 报告由直播源扫描工具制作\n`;
    
    const proxy = document.getElementById('proxy-address').value;
    if (proxy) {
        content += `# 使用socks5代理：socks5://${proxy}\n`;
    }
    
    // 解析模板，获取所有URL及其变量值
    const template = document.getElementById('scan-template').value.trim();
    
    // 创建一个映射表：URL -> 变量组合
    let urlVarMap = {};  // 修改：使用let而不是const
    
    // 解析模板并生成映射
    const parseTemplateAndCreateMap = (templateStr) => {
        const map = {};
        const lines = templateStr.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            // 提取所有变量 [start-end]
            const variableMatches = [];
            const regex = /\[(\d+)-(\d+)\]/g;
            let match;
            
            while ((match = regex.exec(line)) !== null) {
                variableMatches.push({
                    full: match[0],
                    start: parseInt(match[1]),
                    end: parseInt(match[2]),
                    length: match[1].length
                });
            }
            
            if (variableMatches.length === 0) {
                // 没有变量，直接使用URL
                map[line] = '未知';
                continue;
            }
            
            // 生成变量值的所有组合
            const valueSets = variableMatches.map(v => {
                const values = [];
                for (let i = v.start; i <= v.end; i++) {
                    values.push(i.toString().padStart(v.length, '0'));
                }
                return values;
            });
            
            // 计算笛卡尔积
            const combinations = this.cartesianProduct(...valueSets);
            
            // 生成URL和变量映射
            combinations.forEach(combo => {
                let url = line;
                variableMatches.forEach((v, index) => {
                    url = url.replace(v.full, combo[index]);
                });
                // 变量值用短横线连接
                map[url] = combo.join('-');
            });
        }
        
        return map;
    };
    
    try {
        // 创建URL到变量值的映射
        urlVarMap = parseTemplateAndCreateMap(template);
        
        // 有效源
        if (this.state.results.valid.length > 0) {
            content += `\n= 有效源 =\n`;
            this.state.results.valid.forEach(result => {
                // 直接从映射表中获取变量组合
                const channel = urlVarMap[result.url] || '未知';
                content += `${channel},${result.url}\n`;
            });
        }
        
        // 超时源
        if (this.state.results.timeout.length > 0) {
            content += `\n= 超时源 =\n`;
            this.state.results.timeout.forEach(result => {
                const channel = urlVarMap[result.url] || '未知';
                content += `${channel},${result.url}\n`;
            });
        }
        
        // 统计信息
        content += `\n# 统计信息\n`;
        content += `总计: ${this.state.stats.total}\n`;
        content += `有效: ${this.state.stats.valid}\n`;
        content += `超时: ${this.state.stats.timeout}\n`;
        content += `无效: ${this.state.stats.invalid}\n`;
        content += `成功率: ${((this.state.stats.valid / this.state.stats.total) * 100).toFixed(1)}%\n`;
        
        // 创建下载链接
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `直播源扫描结果_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.addLog('结果已导出', 'success');
        
    } catch (error) {
        this.addLog(`导出失败: ${error.message}`, 'error');
        console.error('导出错误:', error);
    }
}
    
    clearResults() {
    if (this.state.scanning) {
        this.addLog('扫描进行中，请先停止扫描', 'error');
        return;
    }
    
    if (confirm('确定要清空所有扫描结果吗？')) {
        this.state.results = { valid: [], timeout: [], invalid: [] };
        this.state.stats = {
            total: 0,
            completed: 0,
            valid: 0,
            timeout: 0,
            invalid: 0,
            startTime: null,
            endTime: null
        };
        
        // 重置扫描序号
        this.scanSequence = 0;
        
        this.updateResultsDisplay();
        this.updateStats();
        this.addLog('已清空所有扫描结果', 'info');
        
        document.getElementById('scan-info').style.display = 'none';
        document.getElementById('export-btn').disabled = true;
    }
}
    
    clearLog() {
        const logContainer = document.getElementById('log-container');
        if (logContainer.children.length > 1) {
            logContainer.innerHTML = '<div class="log-item"><span class="log-time">[系统]</span><span class="log-message info">日志已清空</span></div>';
        }
    }
    
    addLog(message, type = 'info', details = null) {
        const logContainer = document.getElementById('log-container');
        const logItem = document.createElement('div');
        logItem.className = 'log-item';
        
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        
        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'warning') icon = 'exclamation-triangle';
        if (type === 'error') icon = 'exclamation-circle';
        
        let logContent = `<span class="log-time">[${timeStr}]</span> <span class="log-message ${type}"><i class="fas fa-${icon}"></i> ${message}</span>`;
        
        if (details) {
            logContent += `<div class="log-details">${details}</div>`;
        }
        
        logItem.innerHTML = logContent;
        
        // 点击日志项展开/收起详情
        if (details) {
            const logMessage = logItem.querySelector('.log-message');
            logMessage.style.cursor = 'pointer';
            logMessage.addEventListener('click', function(e) {
                const detailsDiv = this.parentElement.querySelector('.log-details');
                if (detailsDiv) {
                    detailsDiv.style.display = detailsDiv.style.display === 'block' ? 'none' : 'block';
                }
            });
        }
        
        logContainer.appendChild(logItem);
        
        // 自动滚动到底部
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // 限制日志数量
        const logs = logContainer.querySelectorAll('.log-item');
        if (logs.length > 200) {
            for (let i = 0; i < 50; i++) {
                if (logs[i]) logs[i].remove();
            }
        }
    }
    
    showNotification(message, type = 'info') {
        // 简单的通知显示
        this.addLog(`通知: ${message}`, type);
    }
}

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM加载完成，初始化扫描器...');
    
    // 创建全局扫描器实例
    window.scanner = new LiveStreamScanner();
    
    // 绑定事件
    bindEvents();
    
    console.log('扫描器初始化完成');
});

function bindEvents() {
    // 扫描控制按钮
    document.getElementById('start-btn').addEventListener('click', function() {
        window.scanner.start();
    });
    
    document.getElementById('pause-btn').addEventListener('click', function() {
        window.scanner.togglePause();
    });
    
    document.getElementById('stop-btn').addEventListener('click', function() {
        window.scanner.stop();
    });
    
    document.getElementById('export-btn').addEventListener('click', function() {
        window.scanner.exportResults();
    });
    
    // 清空结果按钮
    document.getElementById('clear-results-btn').addEventListener('click', function() {
        window.scanner.clearResults();
    });
    
    // 清空日志按钮
    document.getElementById('clear-log-btn').addEventListener('click', function() {
        window.scanner.clearLog();
    });
    
    // 清空历史记录按钮
    document.getElementById('clear-history-btn').addEventListener('click', function() {
        window.scanner.clearHistory();
    });
    
    // 标签页切换（注意新的标签页顺序）
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // 配置面板切换
    document.querySelectorAll('.compact-group-title').forEach(btn => {
        btn.addEventListener('click', function() {
            const contentId = this.id.replace('-toggle', '-content');
            const content = document.getElementById(contentId);
            const arrow = this.querySelector('.compact-group-arrow');
            
            if (content) {
                content.classList.toggle('expanded');
                if (arrow) {
                    arrow.classList.toggle('fa-chevron-up');
                    arrow.classList.toggle('fa-chevron-down');
                }
            }
        });
    });
    
    // 密码显示切换
    const togglePasswordBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('proxy-password');
    
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', function() {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            const icon = this.querySelector('i');
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        });
    }
    
    // 自动保存设置
    document.getElementById('auto-save').addEventListener('change', function() {
        window.scanner.config.autoSave = this.checked;
        window.scanner.saveSettings();
    });
    
    // 输入框自动保存
    const autoSaveInputs = [
        'scan-template', 'concurrent', 'timeout', 'retry-count', 'delay',
        'proxy-address', 'proxy-username', 'proxy-password',
        'user-agent', 'referer', 'host', 'other-headers'
    ];
    
    autoSaveInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', function() {
                if (window.scanner.config.autoSave) {
                    window.scanner.saveSettings();
                }
            });
        }
    });
}

function switchTab(tabId) {
    // 移除所有active类
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // 添加active类到选中的标签
    const selectedTab = document.querySelector(`.tab[data-tab="${tabId}"]`);
    const selectedContent = document.getElementById(`${tabId}-tab`);
    
    if (selectedTab) selectedTab.classList.add('active');
    if (selectedContent) selectedContent.classList.add('active');
}