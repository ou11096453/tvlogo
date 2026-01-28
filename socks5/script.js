/**
 * SOCKS5代理批量验证工具 - 前端逻辑
 * 支持批量代理测试、直播源匹配、并发控制、测试记录等功能
 */

// 全局变量
let currentTestId = 0;
let isTesting = false;
let stopTesting = false;
let testQueue = [];
let activeTests = 0;
let proxyResults = [];
let streamResults = [];
let proxyStreamResults = {}; // 按代理存储直播源测试结果
let proxyCards = {}; // 存储每个代理的卡片DOM元素和状态
let concurrentLimit = 3;
let proxyTimeout = 5;
let streamTimeout = 8;
let testAnonymity = true;
let testOnlyM3U8 = true;
let keepGrouping = true;
let userAgent = 'okhttp/3.15';
let referer = '';
let testHistory = [];
let totalStreamTasks = 0;
let completedStreamTasks = 0;
let isStreamTestPhase = false;
// 在全局变量中添加最大记录数
const MAX_HISTORY_ITEMS = 20;

// DOM元素变量声明（将在init中初始化）
let proxyListTextarea, streamListTextarea, proxyCountElement, streamCountElement;
let proxyTimeoutInput, streamTimeoutInput, proxyConcurrentInput;
let testAnonymityCheckbox, testOnlyM3U8Checkbox, keepGroupingCheckbox;
let userAgentInput, refererInput;
let testProxiesBtn, fullTestBtn, stopTestBtn;
let loadExampleProxiesBtn, clearProxiesBtn;
let loadExampleStreamsBtn, clearStreamsBtn, loadSampleTxtBtn;
let logBox, exportLogBtn, clearLogBtn, copyLatestLogBtn;
let progressFill, totalProxiesStat, availableProxiesStat, failedProxiesStat, avgResponseStat, successRateStat;
let proxyResultBody, exportProxyResultBtn, clearProxyResultsBtn;
let totalStreamsStat, matchedStreamsStat, bestProxyStat, matchRateStat;
let proxyCardsContainer, exportMatchResultBtn, copyMatchedUrlsBtn;
let fileUpload, testStatusElement, testInfoElement, testDetailsElement;
let clearAllResultsBtn, proxyResultsBadge, streamResultsBadge;
let historyList, clearHistoryBtn, historyCountElement;
let tabs, tabContents;
let paramsToggle, paramsContent;
let clearAllConfigBtn, proxyCountBadge, streamCountBadge;

function init() {
    console.log('开始初始化...');
    
    // 初始化DOM元素
    initDomElements();
    
    // 更新统计信息
    updateProxyCount();
    updateStreamCount();
    
    // 加载测试记录
    loadTestHistory();
    // 注意：loadTestHistory中已经调用了updateHistoryCount
    
    // 绑定事件监听器
    bindEvents();
    
    // 初始化折叠面板（仅测试参数配置折叠）
    initCompactGroups();
    
    // 初始化标签页
    initTabs();
    
    // 初始化日志
    addLog('系统', '工具已就绪，请配置代理和直播源后开始测试', 'info');
    
    console.log('初始化完成');
}

// 初始化DOM元素
function initDomElements() {
    console.log('初始化DOM元素...');
    
    // 获取所有需要的DOM元素
    proxyListTextarea = document.getElementById('proxy-list');
    streamListTextarea = document.getElementById('stream-list');
  //  proxyCountElement = document.getElementById('proxy-count');
   // streamCountElement = document.getElementById('stream-count');
    proxyTimeoutInput = document.getElementById('proxy-timeout');
    streamTimeoutInput = document.getElementById('stream-timeout');
    proxyConcurrentInput = document.getElementById('proxy-concurrent');
    testAnonymityCheckbox = document.getElementById('test-anonymity');
    testOnlyM3U8Checkbox = document.getElementById('test-only-m3u8');
    keepGroupingCheckbox = document.getElementById('keep-grouping');
    userAgentInput = document.getElementById('user-agent');
    refererInput = document.getElementById('referer');
    testProxiesBtn = document.getElementById('test-proxies-btn');
    fullTestBtn = document.getElementById('full-test-btn');
    stopTestBtn = document.getElementById('stop-test-btn');
    loadExampleStreamsBtn = document.getElementById('load-example-streams');
    loadSampleTxtBtn = document.getElementById('load-sample-txt');
    logBox = document.getElementById('log-box');
    clearLogBtn = document.getElementById('clear-log-btn');
    progressFill = document.getElementById('progress-fill');
    totalProxiesStat = document.getElementById('total-proxies-stat');
    availableProxiesStat = document.getElementById('available-proxies-stat');
    failedProxiesStat = document.getElementById('failed-proxies-stat');
    avgResponseStat = document.getElementById('avg-response-stat');
    successRateStat = document.getElementById('success-rate-stat');
    proxyResultBody = document.getElementById('proxy-result-body');
    exportProxyResultBtn = document.getElementById('export-proxy-result-btn');
    clearProxyResultsBtn = document.getElementById('clear-proxy-results-btn');
    totalStreamsStat = document.getElementById('total-streams-stat');
    matchedStreamsStat = document.getElementById('matched-streams-stat');
    bestProxyStat = document.getElementById('best-proxy-stat');
    matchRateStat = document.getElementById('match-rate-stat');
    proxyCardsContainer = document.getElementById('proxy-cards-container');
    exportMatchResultBtn = document.getElementById('export-match-result-btn');
    copyMatchedUrlsBtn = document.getElementById('copy-matched-urls-btn');
    fileUpload = document.getElementById('file-upload');
    testStatusElement = document.getElementById('test-status');
    testInfoElement = document.getElementById('test-info');
    testDetailsElement = document.getElementById('test-details');
    clearAllResultsBtn = document.getElementById('clear-all-results-btn');
    proxyResultsBadge = document.getElementById('proxy-results-badge');
    streamResultsBadge = document.getElementById('stream-results-badge');
    
    // 测试记录相关元素
    historyList = document.getElementById('history-list');
    clearHistoryBtn = document.getElementById('clear-history-btn');
    historyCountElement = document.getElementById('history-count'); // 注意：这里获取的是计数显示元素
    
    // 标签页切换
    tabs = document.querySelectorAll('.tab');
    tabContents = document.querySelectorAll('.tab-content');
    
    // 折叠面板元素（仅测试参数配置）
    paramsToggle = document.getElementById('params-toggle');
    paramsContent = document.getElementById('params-content');
    
    // 配置操作元素
    clearAllConfigBtn = document.getElementById('clear-all-config');
    proxyCountBadge = document.getElementById('proxy-count-badge');
    streamCountBadge = document.getElementById('stream-count-badge');
    
    // 验证关键元素是否存在
    const criticalElements = [
        { name: 'proxy-list', element: proxyListTextarea },
        { name: 'stream-list', element: streamListTextarea },
        { name: 'test-proxies-btn', element: testProxiesBtn },
        { name: 'full-test-btn', element: fullTestBtn },
        { name: 'log-box', element: logBox }
    ];
    
    let allElementsFound = true;
    criticalElements.forEach(item => {
        if (!item.element) {
            console.error(`未找到关键元素: ${item.name}`);
            allElementsFound = false;
        }
    });
    
    if (!allElementsFound) {
        console.error('部分关键DOM元素未找到，请检查HTML结构');
    } else {
        console.log('所有DOM元素初始化完成');
    }
}

// 绑定事件监听器
function bindEvents() {
    console.log('绑定事件监听器...');
    
    // 检查关键元素是否存在
    if (!proxyListTextarea || !streamListTextarea) {
        console.error('输入框元素未找到，无法绑定事件');
        return;
    }
    
    // 输入框变化事件
    proxyListTextarea.addEventListener('input', updateProxyCount);
    streamListTextarea.addEventListener('input', updateStreamCount);
    
    if (proxyTimeoutInput) proxyTimeoutInput.addEventListener('change', () => proxyTimeout = parseInt(proxyTimeoutInput.value));
    if (streamTimeoutInput) streamTimeoutInput.addEventListener('change', () => streamTimeout = parseInt(streamTimeoutInput.value));
    if (proxyConcurrentInput) proxyConcurrentInput.addEventListener('change', () => concurrentLimit = parseInt(proxyConcurrentInput.value));
    if (testAnonymityCheckbox) testAnonymityCheckbox.addEventListener('change', () => testAnonymity = testAnonymityCheckbox.checked);
    if (testOnlyM3U8Checkbox) testOnlyM3U8Checkbox.addEventListener('change', () => testOnlyM3U8 = testOnlyM3U8Checkbox.checked);
    if (keepGroupingCheckbox) keepGroupingCheckbox.addEventListener('change', () => keepGrouping = keepGroupingCheckbox.checked);
    
    // 请求头输入框事件
    if (userAgentInput) userAgentInput.addEventListener('change', () => userAgent = userAgentInput.value.trim() || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    if (refererInput) refererInput.addEventListener('change', () => referer = refererInput.value.trim());
    
    // 按钮点击事件 - 检查元素是否存在
    if (testProxiesBtn) testProxiesBtn.addEventListener('click', startProxyTest);
    if (fullTestBtn) fullTestBtn.addEventListener('click', startFullTest);
    if (stopTestBtn) stopTestBtn.addEventListener('click', stopCurrentTest);
    if (loadExampleStreamsBtn) loadExampleStreamsBtn.addEventListener('click', loadExampleStreams);
    if (loadSampleTxtBtn) loadSampleTxtBtn.addEventListener('click', () => fileUpload ? fileUpload.click() : console.error('fileUpload未找到'));
    
    // 日志相关按钮
    if (clearLogBtn) clearLogBtn.addEventListener('click', clearLog);
    
    // 结果相关按钮
    if (exportProxyResultBtn) exportProxyResultBtn.addEventListener('click', exportProxyResults);
    if (clearProxyResultsBtn) clearProxyResultsBtn.addEventListener('click', clearProxyResults);
    if (exportMatchResultBtn) exportMatchResultBtn.addEventListener('click', exportStreamResults);
    if (copyMatchedUrlsBtn) copyMatchedUrlsBtn.addEventListener('click', copyMatchedUrls);
    if (clearAllResultsBtn) clearAllResultsBtn.addEventListener('click', clearAllResults);
    
    // 配置操作按钮
    if (clearAllConfigBtn) clearAllConfigBtn.addEventListener('click', clearAllConfig);
    
    // 文件上传事件
    if (fileUpload) fileUpload.addEventListener('change', handleFileUpload);
    
    // 测试记录事件
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearTestHistory);
    }
    
    // 窗口大小变化时调整UI
    window.addEventListener('resize', adjustUIForMobile);
    
    // 初始调整
    adjustUIForMobile();
    
    console.log('事件监听器绑定完成');
}

// 初始化折叠面板（仅测试参数配置）
function initCompactGroups() {
    console.log('初始化折叠面板（测试参数配置）');
    
    // 检查元素是否存在
    if (!paramsToggle || !paramsContent) {
        console.warn('测试参数折叠面板元素未找到，跳过初始化');
        return;
    }
    
    // 默认收起状态
    paramsContent.style.maxHeight = '0';
    paramsContent.style.padding = '0 15px';
    paramsContent.style.overflow = 'hidden';
    paramsContent.style.transition = 'max-height 0.3s ease-out, padding 0.3s ease-out';
    
    const paramsArrow = paramsToggle.querySelector('.compact-group-arrow');
    if (paramsArrow) {
        paramsArrow.style.transform = 'rotate(0deg)';
        paramsArrow.style.transition = 'transform 0.3s ease';
    }
    
    // 绑定折叠面板点击事件
    paramsToggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('点击测试参数折叠面板');
        toggleCompactGroup(this);
    });
    
    console.log('折叠面板初始化完成');
}

// 切换折叠面板
function toggleCompactGroup(toggleElement) {
    console.log('切换折叠面板:', toggleElement);
    
    const content = toggleElement.nextElementSibling;
    const arrow = toggleElement.querySelector('.compact-group-arrow');
    
    if (!content || !arrow) {
        console.error('找不到折叠内容或箭头');
        return;
    }
    
    if (content.style.maxHeight && content.style.maxHeight !== '0px') {
        // 当前是展开状态，收起
        content.style.maxHeight = '0';
        content.style.padding = '0 15px';
        arrow.style.transform = 'rotate(0deg)';
        console.log('折叠面板收起');
    } else {
        // 当前是收起状态，展开
        content.style.maxHeight = '1000px';
        content.style.padding = '15px';
        arrow.style.transform = 'rotate(180deg)';
        console.log('折叠面板展开');
    }
}

// ================ 修改：清空所有配置 ================
function clearAllConfig() {
    if (confirm('确定要清空所有配置吗？这将会清空代理列表和直播源列表。')) {
        if (proxyListTextarea) proxyListTextarea.value = '';
        if (streamListTextarea) streamListTextarea.value = '';
        
        // 清空请求头配置
        if (userAgentInput) userAgentInput.value = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
        if (refererInput) refererInput.value = '';
        
        // 重置进度相关变量
        totalStreamTasks = 0;
        completedStreamTasks = 0;
        isStreamTestPhase = false;
        
        updateProxyCount();
        updateStreamCount();
        updateOverallProgress(); // 重置进度条
        addLog('系统', '所有配置已清空', 'success');
    }
}

// 根据屏幕大小调整UI
function adjustUIForMobile() {
    const isMobile = window.innerWidth <= 767;
    
    // 调整日志显示方式
    const logEntries = document.querySelectorAll('.log-item');
    logEntries.forEach(entry => {
        if (isMobile) {
            entry.style.flexWrap = 'wrap';
        } else {
            entry.style.flexWrap = 'nowrap';
        }
    });
    
    // 调整复选框网格布局
    const checkboxGrid = document.querySelector('.checkbox-grid');
    if (checkboxGrid) {
        if (isMobile) {
            checkboxGrid.style.gridTemplateColumns = '1fr';
        } else if (window.innerWidth <= 1200) {
            checkboxGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        } else {
            checkboxGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        }
    }
}

// 处理文件上传
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.txt')) {
        addLog('系统', '请选择TXT文件', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const content = event.target.result;
        if (streamListTextarea) {
            streamListTextarea.value = content;
            updateStreamCount();
            addLog('系统', `已导入文件: ${file.name}`, 'success');
        }
    };
    reader.onerror = function() {
        addLog('系统', '文件读取失败', 'error');
    };
    reader.readAsText(file);
    
    // 清空文件input，以便可以再次选择同一个文件
    if (fileUpload) {
        fileUpload.value = '';
    }
}

// 更新代理计数
function updateProxyCount() {
    // 检查必需的元素是否存在
    if (!proxyListTextarea || !totalProxiesStat) {
        console.error('更新代理计数失败：缺少必需的元素');
        return;
    }
    
    const text = proxyListTextarea.value.trim();
    const lines = text ? text.split('\n').filter(line => line.trim() !== '') : [];
    const count = lines.length;
    
    // 只更新徽章和总代理统计
    if (proxyCountBadge) {
        proxyCountBadge.textContent = count;
    } else {
        console.warn('proxyCountBadge 元素未找到');
    }
    
    totalProxiesStat.textContent = count;
    
     // 可选：添加样式反馈
    if (proxyCountBadge) {
        if (count === 0) {
            proxyCountBadge.style.backgroundColor = '#dc3545'; // 红色
        } else if (count < 5) {
            proxyCountBadge.style.backgroundColor = '#ffc107'; // 黄色
        } else {
            proxyCountBadge.style.backgroundColor = '#28a745'; // 绿色
        }
    }
    
    console.log(`代理计数更新：${count} 个代理`);
}

// 更新直播源计数
function updateStreamCount() {
    // 检查必需的元素是否存在
    if (!streamListTextarea) {
        console.error('streamListTextarea 元素未找到');
        return;
    }
    
    const text = streamListTextarea.value.trim();
    const lines = text ? text.split('\n') : [];
    let count = 0;
    let inGroup = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine === '') continue;
        
        // 检查是否是分组行
        if (trimmedLine.includes(',#genre#')) {
            inGroup = true;
            continue;
        }
        
        // 检查是否是URL
        let url = trimmedLine;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
        }
        
        // 验证URL格式
        try {
            new URL(url);
            count++;
        } catch (e) {
            // 不是有效的URL，跳过
        }
    }
    
    // 更新徽章
    if (streamCountBadge) {
        streamCountBadge.textContent = count;
    } else {
        console.warn('streamCountBadge 元素未找到');
    }
    
    // 更新总直播源统计
    if (totalStreamsStat) {
        totalStreamsStat.textContent = count;
    }
    
    // 可选：添加样式反馈
    if (streamCountBadge) {
        if (count === 0) {
            streamCountBadge.style.backgroundColor = '#dc3545'; // 红色
        } else if (count < 5) {
            streamCountBadge.style.backgroundColor = '#ffc107'; // 黄色
        } else {
            streamCountBadge.style.backgroundColor = '#28a745'; // 绿色
        }
    }
    
    console.log(`直播源计数更新：${count} 个直播源`);
    return count; // 返回计数值，供其他函数使用
}
// 添加日志
function addLog(source, message, type = 'info') {
    if (!logBox) return;
    
    const time = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = 'log-item';
    
    let icon = 'fa-info-circle';
    let color = '#2196f3';
    
    switch(type) {
        case 'success':
            icon = 'fa-check-circle';
            color = '#4caf50';
            break;
        case 'error':
            icon = 'fa-times-circle';
            color = '#f44336';
            break;
        case 'warning':
            icon = 'fa-exclamation-circle';
            color = '#ff9800';
            break;
    }
    
    // 移动端优化：换行显示
    const isMobile = window.innerWidth <= 767;
    
    if (isMobile) {
        logEntry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-message ${type}" style="display: block; width: 100%;">
                <i class="fas ${icon}" style="color: ${color}; margin-right: 5px;"></i>
                [${source}] ${message}
            </span>
        `;
    } else {
        logEntry.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-message ${type}">
                <i class="fas ${icon}" style="color: ${color}; margin-right: 5px;"></i>
                [${source}] ${message}
            </span>
        `;
    }
    
    logBox.appendChild(logEntry);
    logBox.scrollTop = logBox.scrollHeight;
    
    // 更新测试信息
    updateTestInfo(`${source}: ${message}`);
}

// 更新测试信息
function updateTestInfo(message) {
    if (testDetailsElement) {
        const time = new Date().toLocaleTimeString();
        testDetailsElement.innerHTML = `<span style="color: #666;">[${time}]</span> ${message}`;
    }
}

// 更新测试状态
function updateTestStatus(status, type = 'info') {
    if (testStatusElement) {
        testStatusElement.textContent = status;
        testStatusElement.className = `status-badge status-${type}`;
    }
}

// 解析代理信息 - 支持 socks5:// 前缀，但移除前缀
function parseProxy(proxyStr) {
    const proxy = {
        address: '',
        ip: '',
        port: 1080,
        username: '',
        password: '',
        hasAuth: false
    };
    
    // 清理字符串
    let cleanStr = proxyStr.trim();
    
    // 移除 socks5:// 前缀（如果存在）
    if (cleanStr.toLowerCase().startsWith('socks5://')) {
        cleanStr = cleanStr.substring(9); // 移除 "socks5://"
    }
    
    // 检查是否有认证信息
    if (cleanStr.includes('@')) {
        const parts = cleanStr.split('@');
        const addressPart = parts[0];
        const authPart = parts[1];
        
        proxy.address = cleanStr;
        
        // 解析地址部分
        const addressParts = addressPart.split(':');
        proxy.ip = addressParts[0];
        proxy.port = parseInt(addressParts[1]) || 1080;
        
        // 解析认证部分
        if (authPart.includes(':')) {
            const authParts = authPart.split(':');
            proxy.username = authParts[0];
            proxy.password = authParts[1];
            proxy.hasAuth = true;
        }
    } else {
        // 没有认证信息
        const parts = cleanStr.split(':');
        proxy.ip = parts[0];
        proxy.port = parseInt(parts[1]) || 1080;
        proxy.address = cleanStr;
        proxy.hasAuth = false;
    }
    
    return proxy;
}

// 初始化标签页
function initTabs() {
    console.log('初始化标签页，找到标签数量:', tabs.length);
    
    if (tabs.length === 0) {
        console.warn('未找到标签元素');
        return;
    }
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const tabName = this.getAttribute('data-tab');
            console.log('点击标签:', tabName);
            
            // 移除所有active类
            tabs.forEach(t => {
                t.classList.remove('active');
            });
            tabContents.forEach(tc => {
                tc.classList.remove('active');
            });
            
            // 添加active类
            this.classList.add('active');
            const targetTab = document.getElementById(`${tabName}-tab`);
            if (targetTab) {
                targetTab.classList.add('active');
                console.log('切换到标签页:', tabName);
                
                // 切换后滚动到顶部
                targetTab.scrollTop = 0;
            } else {
                console.error('找不到标签页内容:', `${tabName}-tab`);
            }
        });
    });
    
    console.log('标签页初始化完成');
}

// 测试单个代理
async function testSingleProxy(proxyStr, testId) {
    if (stopTesting) return null;
    
    const proxy = parseProxy(proxyStr);
    
    addLog('代理测试', `开始测试代理: ${proxy.address}`, 'info');
    
    try {
        // 使用相对路径，确保API可以正确访问
        const apiUrl = 'api.php';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                test_type: 'proxy',
                proxy: proxy.address,
                proxy_username: proxy.username,
                proxy_password: proxy.password,
                timeout: proxyTimeout,
                test_anonymity: testAnonymity
            })
        });
        
        if (!response.ok) {
            throw new Error(`API响应错误: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // 添加测试结果
        const testResult = {
            id: testId,
            proxy: proxy.address,
            ip: proxy.ip,
            port: proxy.port,
            hasAuth: proxy.hasAuth,
            success: result.success,
            response_time: result.response_time,
            status_code: result.status_code || 0,
            is_anonymous: result.is_anonymous || false,
            real_ip: result.real_ip || null,
            error: result.error || null,
            status: result.status || 'failed',
            test_time: new Date().toLocaleTimeString(),
            ip_location: result.ip_location || null,
            real_ip_location: result.real_ip_location || null
        };
        
        return testResult;
        
    } catch (error) {
        addLog('代理测试', `代理 ${proxy.address} 测试失败: ${error.message}`, 'error');
        
        return {
            id: testId,
            proxy: proxy.address,
            ip: proxy.ip,
            port: proxy.port,
            hasAuth: proxy.hasAuth,
            success: false,
            response_time: 0,
            status_code: 0,
            is_anonymous: false,
            real_ip: null,
            error: error.message,
            status: 'failed',
            test_time: new Date().toLocaleTimeString(),
            ip_location: null,
            real_ip_location: null
        };
    }
}

// 通过代理测试直播源
async function testStreamWithProxy(streamUrl, proxyStr, testId) {
    if (stopTesting) return null;
    
    const proxy = parseProxy(proxyStr);
    
    // 构建请求头
    const headers = {
        'User-Agent': userAgent
    };
    
    // 如果有Referer，添加到请求头
    if (referer) {
        headers['Referer'] = referer;
    }
    
    try {
        // 使用相对路径，确保API可以正确访问
        const apiUrl = 'api.php';
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                test_type: 'stream',
                url: streamUrl,
                proxy: proxy.address,
                proxy_username: proxy.username,
                proxy_password: proxy.password,
                timeout: streamTimeout,
                check_m3u8: testOnlyM3U8,
                headers: headers
            })
        });
        
        if (!response.ok) {
            throw new Error(`API响应错误: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // 添加测试结果
        const testResult = {
            id: testId,
            stream_url: streamUrl,
            proxy: proxy.address,
            success: result.success,
            response_time: result.response_time,
            status_code: result.status_code || 0,
            is_m3u8: result.is_m3u8 || false,
            is_valid_m3u8: result.is_valid_m3u8 || false,
            error: result.error || null,
            status: result.status || 'failed',
            test_time: new Date().toLocaleTimeString(),
            final_url: result.final_url || streamUrl,
            redirect_count: result.redirect_count || 0
        };
        
        return testResult;
        
    } catch (error) {
        addLog('直播源测试', `直播源 ${streamUrl} 测试失败: ${error.message}`, 'error');
        
        return {
            id: testId,
            stream_url: streamUrl,
            proxy: proxy.address,
            success: false,
            response_time: 0,
            status_code: 0,
            is_m3u8: false,
            is_valid_m3u8: false,
            error: error.message,
            status: 'failed',
            test_time: new Date().toLocaleTimeString()
        };
    }
}

// 解析直播源列表
function parseStreamList(text) {
    const lines = text.split('\n');
    const streams = [];
    let currentGroup = '未分组';
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine === '') continue;
        
        // 检查是否是分组行
        if (trimmedLine.includes(',#genre#')) {
            currentGroup = trimmedLine.split(',#genre#')[0];
            continue;
        }
        
        // 检查是否是URL
        let url = trimmedLine;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
        }
        
        // 验证URL格式
        try {
            new URL(url);
            streams.push({
                url: url,
                original_text: trimmedLine,
                group: currentGroup
            });
        } catch (e) {
            console.warn(`无效的URL: ${trimmedLine}`);
        }
    }
    
    // 更新徽章（如果正在解析）
    if (streamCountBadge) {
        streamCountBadge.textContent = streams.length;
    }
    
    return streams;
}



// ================ 修改：执行代理测试队列 ================
async function executeProxyTestQueue(proxies) {
    const results = [];
    let completed = 0;
    const total = proxies.length;
    
    // 清空之前的代理结果
    proxyResults = [];
    updateProxyResultsTable([]);
    
    // 更新进度条
    updateOverallProgress(); // 使用新的总体进度函数
    updateTestStatus('代理测试中...', 'warning');
    
    // 创建测试队列
    testQueue = [...proxies];
    activeTests = 0;
    stopTesting = false;
    
    // 执行测试
    while (testQueue.length > 0 && !stopTesting) {
        if (activeTests >= concurrentLimit) {
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }
        
        const proxy = testQueue.shift();
        activeTests++;
        currentTestId++;
        
        testSingleProxy(proxy, currentTestId).then(result => {
            activeTests--;
            
            if (result) {
                results.push(result);
                proxyResults.push(result);
                
                completed++;
                updateOverallProgress(); // 使用新的总体进度函数
                updateProxyStats(results);
                updateProxyResultsTable(proxyResults);
                // 修改这里：显示成功代理数而不是总代理数
                const successfulProxies = proxyResults.filter(r => r.success).length;
                updateProxyResultsBadge(successfulProxies);
                
                addLog('测试', 
                    `代理 ${result.proxy} 测试${result.success ? '成功' : '失败'}, 响应时间: ${result.response_time}ms, 位置: ${result.ip_location || '未知'}`, 
                    result.success ? 'success' : 'error');
            }
        });
        
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    while (activeTests > 0 && !stopTesting) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!stopTesting) {
        updateTestStatus('完成', 'success');
        addLog('系统', `代理测试完成，共测试 ${results.length} 个代理`, 'success');
    } else {
        updateTestStatus('已停止', 'warning');
        addLog('系统', '代理测试已停止', 'warning');
    }
    
    return results;
}

// ================ 新增：创建代理卡片 ================
function createProxyCard(proxy, totalStreams) {
    if (!proxyCardsContainer) return;
    
    // 移除"无结果"提示
    const noResults = proxyCardsContainer.querySelector('.no-results');
    if (noResults) {
        noResults.remove();
    }
    
    // 检查是否已存在该代理的卡片
    if (proxyCards[proxy]) {
        return proxyCards[proxy];
    }
    
    // 创建卡片元素
    const card = document.createElement('div');
    card.className = 'proxy-card';
    card.id = `proxy-card-${proxy.replace(/[^\w]/g, '-')}`;
    
    // 初始化卡片数据
    proxyCards[proxy] = {
        element: card,
        total: totalStreams,
        tested: 0,
        successful: 0,
        failed: 0,
        results: [],
        streamsContainer: null,
        isActive: true
    };
    
    // 卡片HTML结构
    card.innerHTML = `
        <div class="proxy-card-header">
            <div class="proxy-card-title">
                <span class="proxy-card-proxy">${proxy}</span>
                <span class="proxy-card-status status-testing">测试中...</span>
            </div>
            <div class="proxy-card-stats">
                <span class="proxy-card-progress">进度: 0/${totalStreams}</span>
                <span class="proxy-card-success">成功: 0</span>
                <span class="proxy-card-failed">失败: 0</span>
                <span class="proxy-card-success-rate">成功率: 0%</span>
            </div>
        </div>
        <div class="proxy-card-content">
            <div class="streams-container">
                <div class="streams-list" id="streams-list-${proxy.replace(/[^\w]/g, '-')}">
                    <div class="no-streams-message">
                        <i class="fas fa-spinner fa-spin"></i> 正在测试直播源...
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 存储streams容器引用
    proxyCards[proxy].streamsContainer = card.querySelector('.streams-list');
    
    // 添加到容器
    proxyCardsContainer.appendChild(card);
    
    // 滚动到新卡片
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    return proxyCards[proxy];
}

// ================ 修改：更新总体进度条 ================
function updateOverallProgress() {
    if (!progressFill) return;
    
    // 计算总体进度
    let overallProgress = 0;
    
    if (isTesting) {
        if (stopTesting) {
            // 测试已停止，显示当前进度
            if (isStreamTestPhase) {
                // 直播源测试阶段
                if (totalStreamTasks > 0) {
                    overallProgress = (completedStreamTasks / totalStreamTasks) * 100;
                }
            } else {
                // 代理测试阶段
                const totalProxies = getTotalProxies();
                if (totalProxies > 0) {
                    overallProgress = (proxyResults.length / totalProxies) * 100;
                }
            }
        } else {
            // 正在测试中
            if (isStreamTestPhase) {
                // 直播源测试阶段
                if (totalStreamTasks > 0) {
                    overallProgress = (completedStreamTasks / totalStreamTasks) * 100;
                }
            } else {
                // 代理测试阶段
                const totalProxies = getTotalProxies();
                if (totalProxies > 0) {
                    overallProgress = (proxyResults.length / totalProxies) * 100;
                }
            }
        }
    }
    
    // 确保进度在0-100之间
    overallProgress = Math.max(0, Math.min(100, overallProgress));
    progressFill.style.width = `${overallProgress}%`;
    
    // 显示进度百分比
    const progressText = Math.round(overallProgress);
    progressFill.textContent = `${progressText}%`;
    progressFill.style.textAlign = 'right';
    progressFill.style.color = '#fff';
    progressFill.style.fontSize = '9px';
    //progressFill.style.fontWeight = 'bold';
    
    console.log(`进度更新: ${overallProgress.toFixed(1)}%, 已完成: ${completedStreamTasks}/${totalStreamTasks}`);
}

// ================ 修改：获取总代理数 ================
function getTotalProxies() {
    if (!proxyListTextarea) return 0;
    const proxyText = proxyListTextarea.value.trim();
    return proxyText ? proxyText.split('\n').filter(line => line.trim() !== '').length : 0;
}

// ================ 新增：获取总直播源数 ================
function getTotalStreams() {
    const streamText = streamListTextarea.value.trim();
    return parseStreamList(streamText).length;
}

// ================ 新增：计算直播源任务 ================
function calculateStreamTasks() {
    const proxies = Object.keys(proxyCards);
    let total = 0;
    let completed = 0;
    
    proxies.forEach(proxy => {
        const cardData = proxyCards[proxy];
        if (cardData) {
            total += cardData.total;
            completed += cardData.tested;
        }
    });
    
    return { total, completed };
}

// ================ 新增：更新进度文本 ================
function updateProgressText(progress) {
    // 如果需要显示进度百分比，可以在这里实现
    // 例如：document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
}

// ================ 修改：更新代理卡片时也更新总体进度 ================
function updateProxyCard(proxy) {
    const cardData = proxyCards[proxy];
    if (!cardData || !cardData.element) return;
    
    const card = cardData.element;
    const successfulResults = cardData.results.filter(r => r.success);
    const successRate = cardData.tested > 0 ? Math.round((cardData.successful / cardData.tested) * 100) : 0;
    
    // 更新状态
    let statusText = '测试中...';
    let statusClass = 'status-testing';
    
    // 判断卡片是否已停止（手动停止或完成）
    if (!cardData.isActive) {
        if (cardData.tested >= cardData.total) {
            if (cardData.successful > 0) {
                statusText = '测试完成';
                statusClass = 'status-success';
            } else {
                statusText = '无可用直播源';
                statusClass = 'status-failed';
            }
        } else {
            statusText = '已停止';
            statusClass = 'status-failed';
        }
    } else if (cardData.tested >= cardData.total) {
        if (cardData.successful > 0) {
            statusText = '测试完成';
            statusClass = 'status-success';
        } else {
            statusText = '无可用直播源';
            statusClass = 'status-failed';
        }
    } else if (cardData.successful > 0) {
        statusText = '匹配到直播源';
        statusClass = 'status-success';
    }
    
    // 更新标题区域
    const title = card.querySelector('.proxy-card-title');
    if (title) {
        const statusSpan = title.querySelector('.proxy-card-status');
        if (statusSpan) {
            statusSpan.textContent = statusText;
            statusSpan.className = `proxy-card-status ${statusClass}`;
        }
    }
    
    // 更新统计信息
    const stats = card.querySelector('.proxy-card-stats');
    if (stats) {
        const progressSpan = stats.querySelector('.proxy-card-progress');
        const successSpan = stats.querySelector('.proxy-card-success');
        const failedSpan = stats.querySelector('.proxy-card-failed');
        const successRateSpan = stats.querySelector('.proxy-card-success-rate');
        
        if (progressSpan) progressSpan.textContent = `进度: ${cardData.tested}/${cardData.total}`;
        if (successSpan) successSpan.textContent = `成功: ${cardData.successful}`;
        if (failedSpan) failedSpan.textContent = `失败: ${cardData.failed}`;
        if (successRateSpan) successRateSpan.textContent = `成功率: ${successRate}%`;
    }
    
    // 更新直播源列表
    updateProxyCardStreams(proxy);
    
    // 更新总体进度
    updateOverallProgress();
}

// ================ 修改：更新代理卡片的直播源列表 ================
function updateProxyCardStreams(proxy) {
    const cardData = proxyCards[proxy];
    if (!cardData || !cardData.streamsContainer) return;
    
    const streamsContainer = cardData.streamsContainer;
    const successfulResults = cardData.results.filter(r => r.success);
    
    // 清空当前内容
    streamsContainer.innerHTML = '';
    
    // 如果卡片已停止（手动停止或完成），使用不同的显示逻辑
    if (!cardData.isActive) {
        if (successfulResults.length === 0) {
            // 停止时没有成功结果
            if (cardData.tested >= cardData.total) {
                // 测试完成但无成功结果
                streamsContainer.innerHTML = `
                    <div class="no-streams-message">
                        <i class="fas fa-times-circle"></i> 该代理没有成功匹配的直播源
                    </div>
                `;
            } else {
                // 测试停止但无成功结果
                streamsContainer.innerHTML = `
                    <div class="no-streams-message">
                        <i class="fas fa-stop-circle"></i> 测试已停止，该代理没有成功匹配的直播源
                    </div>
                `;
            }
            return;
        }
        
        // 显示已测试成功的直播源
        successfulResults.forEach((result, index) => {
            const streamItem = document.createElement('div');
            streamItem.className = 'stream-item';
            
            streamItem.innerHTML = `
                <div class="stream-url">${result.stream_url}</div>
                <div class="stream-info">
                    <span class="stream-group">${result.group || '未分组'}</span>
                    <span class="stream-status">${result.response_time}ms${result.redirect_count > 0 ? ` (${result.redirect_count}次跳转)` : ''}</span>
                </div>
            `;
            
            streamsContainer.appendChild(streamItem);
        });
        
        // 如果测试停止了但未完成，添加提示
        if (cardData.tested < cardData.total) {
            const stoppedItem = document.createElement('div');
            stoppedItem.className = 'stream-item stopped-item';
            stoppedItem.innerHTML = `
                <div class="stream-url">
                    <i class="fas fa-stop-circle"></i> 测试已停止，${cardData.total - cardData.tested} 个直播源未测试
                </div>
            `;
            streamsContainer.appendChild(stoppedItem);
        }
        return;
    }
    
    // 正常测试中的显示逻辑
    if (successfulResults.length === 0) {
        // 测试中但暂无成功结果
        streamsContainer.innerHTML = `
            <div class="no-streams-message">
                <i class="fas fa-spinner fa-spin"></i> 正在测试直播源...
            </div>
        `;
        return;
    }
    
    // 显示成功的直播源
    successfulResults.forEach((result, index) => {
        const streamItem = document.createElement('div');
        streamItem.className = 'stream-item';
        
        streamItem.innerHTML = `
            <div class="stream-url">${result.stream_url}</div>
            <div class="stream-info">
                <span class="stream-group">${result.group || '未分组'}</span>
                <span class="stream-status">${result.response_time}ms${result.redirect_count > 0 ? ` (${result.redirect_count}次跳转)` : ''}</span>
            </div>
        `;
        
        streamsContainer.appendChild(streamItem);
    });
    
    // 如果还有未测试的直播源，显示进度
    if (cardData.tested < cardData.total) {
        const progressItem = document.createElement('div');
        progressItem.className = 'stream-item progress-item';
        progressItem.innerHTML = `
            <div class="stream-url">
                <i class="fas fa-spinner fa-spin"></i> 还有 ${cardData.total - cardData.tested} 个直播源等待测试...
            </div>
        `;
        streamsContainer.appendChild(progressItem);
    }
}

// ================ 修改：为单个代理测试所有直播源（修复统计更新） ================
async function testAllStreamsForProxy(proxy, streams) {
    // 创建代理卡片
    createProxyCard(proxy, streams.length);
    
    addLog('直播源测试', `开始通过代理 ${proxy} 测试 ${streams.length} 个直播源`, 'info');
    
    // 初始化该代理的测试结果数组
    if (!proxyStreamResults[proxy]) {
        proxyStreamResults[proxy] = [];
    }
    
    const batchSize = Math.min(5, concurrentLimit);
    
    for (let i = 0; i < streams.length; i += batchSize) {
        if (stopTesting) break;
        
        const batch = streams.slice(i, i + batchSize);
        const batchPromises = [];
        
        for (const stream of batch) {
            if (stopTesting) break;
            
            const testPromise = testStreamWithProxy(stream.url, proxy, currentTestId++).then(result => {
                if (result) {
                    const streamResult = {
                        ...result,
                        stream_name: stream.original_text,
                        group: stream.group
                    };
                    
                    // 添加到代理结果数组
                    proxyStreamResults[proxy].push(streamResult);
                    
                    // 更新代理卡片数据
                    if (proxyCards[proxy]) {
                        proxyCards[proxy].results.push(streamResult);
                        proxyCards[proxy].tested++;
                        if (result.success) {
                            proxyCards[proxy].successful++;
                        } else {
                            proxyCards[proxy].failed++;
                        }
                        
                        // 更新卡片显示
                        updateProxyCard(proxy);
                    }
                    
                    // 更新总体进度计数
                    completedStreamTasks++;
                    updateOverallProgress();
                    
                    // 更新总体统计信息
                    updateOverallStats();
                    
                    addLog('测试', 
                        ` ${proxy} -> ${stream.group} ${stream.original_text} 测试${result.success ? '成功' : '失败'}`, 
                        result.success ? 'success' : 'error');
                }
                
                return result;
            });
            
            batchPromises.push(testPromise);
        }
        
        await Promise.all(batchPromises);
        
        // 批次间延迟，避免请求过于密集
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 标记卡片为完成状态
    if (proxyCards[proxy]) {
        proxyCards[proxy].isActive = false;
        updateProxyCard(proxy);
    }
    
    // 确保最后一次更新统计
    updateOverallStats();
    
    return proxyStreamResults[proxy];
}

// ================ 修改：更新总体统计信息 ================
function updateOverallStats() {
    if (!proxyCardsContainer || !totalStreamsStat || !matchedStreamsStat || !bestProxyStat || !matchRateStat) return;
    
    const proxies = Object.keys(proxyStreamResults);
    
    if (proxies.length === 0) {
        // 如果没有代理，则显示提示信息
        if (proxyCardsContainer.querySelectorAll('.proxy-card').length === 0) {
            proxyCardsContainer.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-list"></i>
                    <p>直播源匹配结果将在此按代理卡片展示</p>
                </div>
            `;
        }
        
        // 重置统计信息
        totalStreamsStat.textContent = '0';
        matchedStreamsStat.textContent = '0';
        bestProxyStat.textContent = '-';
        matchRateStat.textContent = '0%';
        updateStreamResultsBadge(0);
        return;
    }
    
    let totalStreams = 0;
    let totalMatched = 0;
    let bestProxy = null;
    let bestProxyMatchCount = 0;
    
    proxies.forEach(proxy => {
        const streamResults = proxyStreamResults[proxy];
        const successfulStreams = streamResults.filter(r => r.success);
        
        totalStreams += streamResults.length;
        totalMatched += successfulStreams.length;
        
        if (successfulStreams.length > bestProxyMatchCount) {
            bestProxyMatchCount = successfulStreams.length;
            bestProxy = proxy;
        }
    });
    
    const matchRate = totalStreams > 0 ? Math.round((totalMatched / totalStreams) * 100) : 0;
    
    totalStreamsStat.textContent = totalStreams;
    matchedStreamsStat.textContent = totalMatched;
    bestProxyStat.textContent = bestProxy ? (bestProxy.length > 20 ? bestProxy.substring(0, 20) + '...' : bestProxy) : '-';
    matchRateStat.textContent = `${matchRate}%`;
    updateStreamResultsBadge(totalMatched);
}

// ================ 新增：清除所有代理卡片 ================
function clearAllProxyCards() {
    proxyCards = {};
    if (proxyCardsContainer) {
        proxyCardsContainer.innerHTML = `
            <div class="no-results">
                <i class="fas fa-list"></i>
                <p>暂无直播源匹配结果</p>
            </div>
        `;
    }
}

// 更新代理统计信息
function updateProxyStats(results) {
    if (!totalProxiesStat || !availableProxiesStat || !failedProxiesStat || !avgResponseStat || !successRateStat) return;
    
    if (!results || results.length === 0) {
        totalProxiesStat.textContent = '0';
        availableProxiesStat.textContent = '0';
        failedProxiesStat.textContent = '0';
        avgResponseStat.textContent = '0ms';
        successRateStat.textContent = '0%';
        return;
    }
    
    const total = results.length;
    const successful = results.filter(r => r.success).length;
    const failed = total - successful;
    
    const successfulResults = results.filter(r => r.success && r.response_time);
    const avgResponse = successfulResults.length > 0 
        ? Math.round(successfulResults.reduce((sum, r) => sum + r.response_time, 0) / successfulResults.length)
        : 0;
    
    const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;
    
    totalProxiesStat.textContent = total;
    availableProxiesStat.textContent = successful;
    failedProxiesStat.textContent = failed;
    avgResponseStat.textContent = `${avgResponse}ms`;
    successRateStat.textContent = `${successRate}%`;
}

// 更新代理结果表格
function updateProxyResultsTable(results) {
    if (!proxyResultBody) return;
    
    if (!results || results.length === 0) {
        proxyResultBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">
                    <div class="no-results1">
                            <i class="fas fa-list"></i>
                            <p>暂无代理验证结果</p>
                        </div>
                </td>
            </tr>
        `;
        return;
    }
    
    let html = '';
    
    results.forEach((result, index) => {
        const statusColor = result.success ? '#4caf50' : '#f44336';
        const statusText = result.success ? '成功' : '失败';
        const statusIcon = result.success ? 'fa-check-circle' : 'fa-times-circle';
        
        const anonymityColor = result.is_anonymous ? '#4caf50' : '#ff9800';
        const anonymityText = result.is_anonymous ? '匿名' : '非匿名';
        const anonymityIcon = result.is_anonymous ? 'fa-user-secret' : 'fa-user';
        
        // 获取IP位置信息
        const ipLocation = result.ip_location || '未知';
        const realIpLocation = result.real_ip_location || '';
        
        html += `
            <tr>
                <td style="text-align: center; width: 40px;">${index + 1}</td>
                <td style="width: 180px;">
                    <div style="font-weight: 600; word-break: break-all; font-size: 0.85rem; line-height: 1.2;">${result.proxy}</div>
                    ${result.hasAuth ? '<div style="font-size: 0.7rem; color: #666; margin-top: 2px;">需要认证</div>' : ''}
                    <!-- 显示IP归属地 - 使用CSS类 -->
                    <div class="ip-location">
                        <i class="fas fa-map-marker-alt"></i> ${ipLocation}
                    </div>
                </td>
                <td style="text-align: center; width: 70px;">
                    <span style="color: ${statusColor}; font-weight: 600; font-size: 0.85rem;">
                        <i class="fas ${statusIcon}"></i> ${statusText}
                    </span>
                </td>
                <td style="text-align: center; width: 70px;">
                    ${result.success ? `<span style="font-weight: 600; font-size: 0.85rem;">${result.response_time}ms</span>` : '-'}
                </td>
                <td style="text-align: center; width: 120px;">
                    ${result.success ? `
                        <div style="color: ${anonymityColor}; font-weight: 600; font-size: 0.85rem;">
                            <i class="fas ${anonymityIcon}"></i> ${anonymityText}
                        </div>
                        ${result.is_anonymous && result.real_ip ? `
                            <div class="real-ip-info">
                                真实IP: ${result.real_ip}
                                ${realIpLocation ? `<div class="real-ip-location">${realIpLocation}</div>` : ''}
                            </div>
                        ` : ''}
                    ` : '-'}
                </td>
            </tr>
        `;
    });
    
    proxyResultBody.innerHTML = html;
}

// 更新代理结果徽章
function updateProxyResultsBadge(count) {
    if (proxyResultsBadge) {
        proxyResultsBadge.textContent = count;
    }
}

// 更新直播源结果徽章
function updateStreamResultsBadge(count) {
    if (streamResultsBadge) {
        streamResultsBadge.textContent = count;
    }
}

// 更新进度条
function updateProgress(percentage) {
    if (!progressFill) return;
    
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    progressFill.style.width = `${clampedPercentage}%`;
}

// 开始代理测试
async function startProxyTest() {
    if (isTesting) {
        addLog('系统', '已有测试正在进行，请等待完成或停止当前测试', 'warning');
        return;
    }
    
    if (!proxyListTextarea) {
        addLog('系统', '代理列表输入框未找到', 'error');
        return;
    }
    
    const proxyText = proxyListTextarea.value.trim();
    if (!proxyText) {
        addLog('系统', '请先输入代理列表', 'warning');
        return;
    }
    
    const proxies = proxyText.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
    
    if (proxies.length === 0) {
        addLog('系统', '没有找到有效的代理地址', 'warning');
        return;
    }
    
    // 保存测试配置到历史记录
    saveTestHistory('代理测试', {
        proxies: proxyText,
        proxyTimeout: proxyTimeout,
        proxyConcurrent: concurrentLimit,
        testAnonymity: testAnonymity,
        userAgent: userAgent,
        referer: referer
    });
    
    isTesting = true;
    stopTesting = false;
    currentTestId = 0;
    testQueue = [];
    activeTests = 0;
    
    if (testProxiesBtn) testProxiesBtn.disabled = true;
    if (fullTestBtn) fullTestBtn.disabled = true;
    if (stopTestBtn) {
        stopTestBtn.disabled = false;
        stopTestBtn.style.display = 'block';
    }
    
    updateTestStatus('测试中...', 'warning');
    addLog('系统', `开始测试 ${proxies.length} 个代理，并发数: ${concurrentLimit}`, 'info');
    
    try {
        await executeProxyTestQueue(proxies);
    } catch (error) {
        updateTestStatus('错误', 'error');
        addLog('系统', `测试过程中出现错误: ${error.message}`, 'error');
    } finally {
        if (testProxiesBtn) testProxiesBtn.disabled = false;
        if (fullTestBtn) fullTestBtn.disabled = false;
        if (stopTestBtn) {
            stopTestBtn.disabled = true;
            stopTestBtn.style.display = 'none';
        }
        isTesting = false;
        updateProgress(100);
    }
}

function startStreamTestPhase(availableProxyAddresses, streams) {
    isStreamTestPhase = true;
    
    // 计算总任务数：可用代理数 × 直播源数
    totalStreamTasks = availableProxyAddresses.length * streams.length;
    completedStreamTasks = 0;
    
    console.log(`开始直播源测试阶段，总任务数: ${totalStreamTasks}`);
    updateOverallProgress();
}

// ================ 修改：开始完整测试（代理+直播源） - 修复统计初始化 ================
async function startFullTest() {
    if (isTesting) {
        addLog('系统', '已有测试正在进行，请等待完成或停止当前测试', 'warning');
        return;
    }
    
    if (!proxyListTextarea || !streamListTextarea) {
        addLog('系统', '代理列表或直播源列表输入框未找到', 'error');
        return;
    }
    
    const proxyText = proxyListTextarea.value.trim();
    const streamText = streamListTextarea.value.trim();
    
    if (!proxyText) {
        addLog('系统', '请先输入代理列表', 'warning');
        return;
    }
    
    if (!streamText) {
        addLog('系统', '请先输入直播源列表', 'warning');
        return;
    }
    
    const proxies = proxyText.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
    
    if (proxies.length === 0) {
        addLog('系统', '没有找到有效的代理地址', 'warning');
        return;
    }
    
    const streams = parseStreamList(streamText);
    if (streams.length === 0) {
        addLog('系统', '没有找到有效的直播源', 'warning');
        return;
    }
    
    // 保存测试配置到历史记录
    saveTestHistory('完整测试', {
        proxies: proxyText,
        streams: streamText,
        proxyTimeout: proxyTimeout,
        streamTimeout: streamTimeout,
        proxyConcurrent: concurrentLimit,
        testAnonymity: testAnonymity,
        testOnlyM3U8: testOnlyM3U8,
        keepGrouping: keepGrouping,
        userAgent: userAgent,
        referer: referer
    });
    
    // 初始化状态
    isTesting = true;
    stopTesting = false;
    isStreamTestPhase = false; // 开始是代理测试阶段
    currentTestId = 0;
    testQueue = [];
    activeTests = 0;
    proxyStreamResults = {}; // 重置直播源结果
    
    // 清除之前的代理卡片
    clearAllProxyCards();
    
    // 重置统计信息
    updateOverallStats();
    
    if (testProxiesBtn) testProxiesBtn.disabled = true;
    if (fullTestBtn) fullTestBtn.disabled = true;
    if (stopTestBtn) {
        stopTestBtn.disabled = false;
        stopTestBtn.style.display = 'block';
    }
    
    updateTestStatus('代理测试中...', 'warning');
    addLog('系统', `开始完整测试: ${proxies.length} 个代理, ${streams.length} 个直播源`, 'info');
    
    try {
        // 第一阶段：代理测试
        addLog('系统', '第一阶段：开始测试代理可用性', 'info');
        const proxyResults = await executeProxyTestQueue(proxies);
        
        if (stopTesting) {
            updateTestStatus('已停止', 'warning');
            addLog('系统', '测试已停止', 'warning');
            return;
        }
        
        const availableProxies = proxyResults.filter(r => r.success);
        
        if (availableProxies.length === 0) {
            updateTestStatus('完成', 'success');
            addLog('系统', '没有可用的代理，停止直播源测试', 'warning');
            return;
        }
        
        addLog('系统', `找到 ${availableProxies.length} 个可用代理，开始直播源测试`, 'success');
        
        // 第二阶段：直播源测试
        isStreamTestPhase = true; // 切换到直播源测试阶段
        updateTestStatus('直播源测试中...', 'warning');
        addLog('系统', '第二阶段：开始测试直播源', 'info');
        
        const availableProxyAddresses = availableProxies.map(p => p.proxy);
        
        // 初始化直播源测试阶段的进度计数
        totalStreamTasks = availableProxyAddresses.length * streams.length;
        completedStreamTasks = 0;
        
        addLog('进度', `总任务数: ${totalStreamTasks} (${availableProxyAddresses.length}个代理 × ${streams.length}个直播源)`, 'info');
        
        for (const proxy of availableProxyAddresses) {
            if (stopTesting) break;
            
            addLog('直播源测试', `开始为代理 ${proxy} 测试所有直播源`, 'info');
            await testAllStreamsForProxy(proxy, streams);
            
            if (!stopTesting) {
                addLog('直播源测试', `代理 ${proxy} 的直播源测试完成`, 'success');
            }
        }
        
        if (!stopTesting) {
            updateTestStatus('完成', 'success');
            addLog('系统', '直播源测试完成', 'success');
            addLog('系统', `所有测试完成，共测试 ${availableProxies.length} 个代理，${streams.length} 个直播源`, 'success');
        } else {
            updateTestStatus('已停止', 'warning');
            addLog('系统', '直播源测试已停止', 'warning');
        }
        
    } catch (error) {
        updateTestStatus('错误', 'error');
        addLog('系统', `测试过程中出现错误: ${error.message}`, 'error');
    } finally {
        if (testProxiesBtn) testProxiesBtn.disabled = false;
        if (fullTestBtn) fullTestBtn.disabled = false;
        if (stopTestBtn) {
            stopTestBtn.disabled = true;
            stopTestBtn.style.display = 'none';
        }
        isTesting = false;
        isStreamTestPhase = false;
        updateOverallProgress();
        updateOverallStats(); // 确保最终更新统计
    }
}

// 停止当前测试
function stopCurrentTest() {
    if (isTesting) {
        stopTesting = true;
        updateTestStatus('停止中...', 'warning');
        addLog('系统', '正在停止测试...', 'warning');
        
        // 更新所有代理卡片状态为已停止
        updateAllProxyCardsOnStop();
        
        if (stopTestBtn) {
            stopTestBtn.disabled = true;
        }
    }
}

// ================ 修改：停止测试时更新所有代理卡片 ================
function updateAllProxyCardsOnStop() {
    const proxies = Object.keys(proxyCards);
    
    proxies.forEach(proxy => {
        const cardData = proxyCards[proxy];
        if (cardData && cardData.isActive) {
            // 标记卡片为非活动状态
            cardData.isActive = false;
            
            // 更新卡片状态显示为"已停止"
            if (cardData.element) {
                const title = cardData.element.querySelector('.proxy-card-title');
                if (title) {
                    const statusSpan = title.querySelector('.proxy-card-status');
                    if (statusSpan) {
                        statusSpan.textContent = '已停止';
                        statusSpan.className = 'proxy-card-status status-failed';
                    }
                }
                
                // 更新直播源列表，移除等待测试的提示
                updateProxyCardStreamsOnStop(proxy);
            }
        }
    });
    
    // 更新总体进度
    updateOverallProgress();
}

// ================ 新增：停止测试时更新代理卡片的直播源列表 ================
function updateProxyCardStreamsOnStop(proxy) {
    const cardData = proxyCards[proxy];
    if (!cardData || !cardData.streamsContainer) return;
    
    const streamsContainer = cardData.streamsContainer;
    const successfulResults = cardData.results.filter(r => r.success);
    
    // 清空当前内容
    streamsContainer.innerHTML = '';
    
    if (successfulResults.length === 0) {
        // 停止时没有成功结果
        streamsContainer.innerHTML = `
            <div class="no-streams-message">
                <i class="fas fa-stop-circle"></i> 测试已停止，该代理没有成功匹配的直播源
            </div>
        `;
        return;
    }
    
    // 显示已测试成功的直播源
    successfulResults.forEach((result, index) => {
        const streamItem = document.createElement('div');
        streamItem.className = 'stream-item';
        
        streamItem.innerHTML = `
            <div class="stream-url">${result.stream_url}</div>
            <div class="stream-info">
                <span class="stream-group">${result.group || '未分组'}</span>
                <span class="stream-status">${result.response_time}ms${result.redirect_count > 0 ? ` (${result.redirect_count}次跳转)` : ''}</span>
            </div>
        `;
        
        streamsContainer.appendChild(streamItem);
    });
    
    // 添加已停止提示
    const stoppedItem = document.createElement('div');
    stoppedItem.className = 'stream-item stopped-item';
    stoppedItem.innerHTML = `
        <div class="stream-url">
            <i class="fas fa-stop-circle"></i> 测试已停止，${cardData.total - cardData.tested} 个直播源未测试
        </div>
    `;
    streamsContainer.appendChild(stoppedItem);
}

// 加载示例直播源
function loadExampleStreams() {
    // 尝试从服务器加载样本.txt文件
    fetch('样本.txt')
        .then(response => {
            if (!response.ok) {
                throw new Error('无法加载样本文件');
            }
            return response.text();
        })
        .then(text => {
            if (streamListTextarea) {
                streamListTextarea.value = text;
                updateStreamCount();
                addLog('系统', '已从 样本.txt 文件加载直播源', 'success');
            }
        })
        .catch(error => {
            console.error('加载样本文件失败:', error);
            const exampleStreams = `湖南移动,#genre#
http://tvgslb.hn.chinamobile.com:8089/180000001002/00000001000000000064000000308827/main.m3u8
http://39.134.240.5/PLTV/1/224/3221225628/index.m3u8
http://39.134.13.35:6610/000000001000//1000000005000265001/1.m3u8?channel-id=ystenlive&Contentid=1000000005000265001&livemode=1&stbId=lzz123

蜀小果,#genre#
http://live2.rxip.sc96655.com/live/CCTV-1H265_4000.m3u8?E=1&U=1&A=1&K=1&P=1&S=1
http://edge-cache04.live3.omd.sc96655.com/live/CCTV-1H265_4000.m3u8`;

            if (streamListTextarea) {
                streamListTextarea.value = exampleStreams;
                updateStreamCount();
                addLog('系统', '已加载内置示例直播源', 'success');
            }
        });
}

// 清空日志
function clearLog() {
    if (logBox) {
        logBox.innerHTML = '';
        addLog('系统', '日志已清空', 'success');
    }
}

// 导出代理结果 - 改为TXT格式
function exportProxyResults() {
    if (proxyResults.length === 0) {
        addLog('系统', '没有代理测试结果可导出', 'warning');
        return;
    }
    
    // 统计信息
    const total = proxyResults.length;
    const successful = proxyResults.filter(r => r.success).length;
    const failed = total - successful;
    const successRate = total > 0 ? Math.round((successful / total) * 100) : 0;
    
    // 计算平均响应时间（仅成功的代理）
    const successfulResults = proxyResults.filter(r => r.success && r.response_time);
    const avgResponse = successfulResults.length > 0 
        ? Math.round(successfulResults.reduce((sum, r) => sum + r.response_time, 0) / successfulResults.length)
        : 0;
    
    // 统计匿名代理数量
    const anonymousProxies = proxyResults.filter(r => r.success && r.is_anonymous).length;
    
    // 获取当前时间
    const currentDate = new Date().toLocaleString();
    
    // 生成TXT格式内容
    let txtContent = '';
    txtContent += '='.repeat(70) + '\n';
    txtContent += `SOCKS5代理测试结果 (${currentDate})\n`;
    txtContent += '='.repeat(70) + '\n';
    txtContent += `测试代理总数: ${total}  成功: ${successful}  失败: ${failed}  成功率: ${successRate}%\n`;
    txtContent += `平均响应时间: ${avgResponse}ms  匿名代理: ${anonymousProxies}\n`;
    txtContent += '='.repeat(70) + '\n\n';
    
    // 添加成功代理列表
    txtContent += '★ 成功代理列表:\n';
    txtContent += '-'.repeat(70) + '\n';
    
    proxyResults.forEach((result, index) => {
        if (result.success) {
            const status = result.success ? '成功' : '失败';
            const anonymity = result.is_anonymous ? '匿名' : '非匿名';
            const realIp = result.real_ip || '-';
            const realIpLocation = result.real_ip_location || '';
            const authInfo = result.hasAuth ? ' (需认证)' : '';
            
            txtContent += `[${index + 1}] socks5://${result.proxy}${authInfo}\n`;
            txtContent += `   位置: ${result.ip_location || '未知'}\n`;
            txtContent += `   状态: ${status}  响应: ${result.response_time}ms  匿名性: ${anonymity}\n`;
            if (result.is_anonymous && realIp !== '-') {
                txtContent += `   真实IP: ${realIp} ${realIpLocation ? `(${realIpLocation})` : ''}\n`;
            }
            txtContent += '\n';
        }
    });
    
    // 添加失败代理列表
    const failedProxies = proxyResults.filter(r => !r.success);
    if (failedProxies.length > 0) {
        txtContent += '★ 失败代理列表:\n';
        txtContent += '-'.repeat(70) + '\n';
        
        failedProxies.forEach((result, index) => {
            const authInfo = result.hasAuth ? ' (需认证)' : '';
            txtContent += `[${index + 1}] socks5://${result.proxy}${authInfo}\n`;
            txtContent += `   位置: ${result.ip_location || '未知'}\n`;
            txtContent += `   错误: ${result.error || '未知错误'}\n\n`;
        });
    }
    
    // 添加详细数据表格
    txtContent += '★ 详细数据表格:\n';
    txtContent += '-'.repeat(70) + '\n';
    txtContent += '序号'.padEnd(5) + '代理地址'.padEnd(25) + '位置'.padEnd(20) + '状态'.padEnd(8) + '响应时间'.padEnd(12) + '匿名性'.padEnd(10) + '备注\n';
    
    proxyResults.forEach((result, index) => {
        const status = result.success ? '成功' : '失败';
        const anonymity = result.is_anonymous ? '匿名' : '非匿名';
        const responseTime = result.success ? `${result.response_time}ms` : '-';
        const location = result.ip_location || '未知';
        const remark = result.hasAuth ? '需认证' : (result.is_anonymous && result.real_ip ? `真实IP: ${result.real_ip}${result.real_ip_location ? ` (${result.real_ip_location})` : ''}` : '');
        
        txtContent += 
            `${(index + 1).toString().padEnd(5)}` +
            `${result.proxy.substring(0, 24).padEnd(25)}` +
            `${location.substring(0, 19).padEnd(20)}` +
            `${status.padEnd(8)}` +
            `${responseTime.padEnd(12)}` +
            `${anonymity.padEnd(10)}` +
            `${remark}\n`;
    });
    
    txtContent += '\n' + '='.repeat(70) + '\n';
    txtContent += '导出时间: ' + currentDate + '\n';
    txtContent += '导出工具: SOCKS5代理批量验证工具\n';
    txtContent += '='.repeat(70);
    
    // 创建下载
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOCKS5验证结果-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    addLog('系统', '代理测试结果已导出为TXT格式', 'success');
}

// 清空代理结果
function clearProxyResults() {
    proxyResults = [];
    updateProxyResultsTable([]);
    updateProxyStats([]);
    updateProxyResultsBadge(0);
    addLog('系统', '代理测试结果已清空', 'success');
}

// ================ 修改：清空所有结果 - 修复统计重置 ================
function clearAllResults() {
    proxyResults = [];
    proxyStreamResults = {};
    updateProxyResultsTable([]);
    updateProxyStats([]);
    updateProxyResultsBadge(0);
    
    // 清除所有代理卡片
    clearAllProxyCards();
    
    // 重置进度相关变量
    totalStreamTasks = 0;
    completedStreamTasks = 0;
    isStreamTestPhase = false;
    
    // 重置直播源统计
    updateOverallStats();
    updateStreamResultsBadge(0);
    updateOverallProgress(); // 重置进度条
    addLog('系统', '所有测试结果已清空', 'success');
}

// 导出直播源匹配结果
function exportStreamResults() {
    const proxies = Object.keys(proxyStreamResults);
    
    if (proxies.length === 0) {
        addLog('系统', '没有直播源匹配结果可导出', 'warning');
        return;
    }
    
    let totalStreams = 0;
    let totalSuccessfulStreams = 0;
    let totalProxies = proxyResults.length;
    let availableProxies = proxyResults.filter(p => p.success).length;
    
    proxies.forEach(proxy => {
        const streamResults = proxyStreamResults[proxy];
        totalStreams += streamResults.length;
        const successfulStreams = streamResults.filter(r => r.success).length;
        totalSuccessfulStreams += successfulStreams;
    });
    
    const successRate = totalStreams > 0 ? ((totalSuccessfulStreams / totalStreams) * 100).toFixed(1) : '0.0';
    const currentDate = new Date().toLocaleString();
    
    let txtContent = '';
    txtContent += '='.repeat(70) + '\n';
    txtContent += `SOCKS5代理 M3U8 测试结果 (${currentDate})\n`;
    txtContent += '='.repeat(70) + '\n';
    txtContent += `总代理: ${totalProxies}  可用: ${availableProxies}  成功代理: ${proxies.length}\n`;
    txtContent += `M3U8源: ${totalStreams}  成功率: ${successRate}%\n`;
    txtContent += '='.repeat(70) + '\n\n';
    
    proxies.forEach(proxy => {
        const streamResults = proxyStreamResults[proxy];
        const successfulStreams = streamResults.filter(r => r.success);
        const failedStreams = streamResults.filter(r => !r.success);
        const successCount = successfulStreams.length;
        const totalCount = streamResults.length;
        const proxySuccessRate = totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(1) : '0.0';
        
        txtContent += `socks5://${proxy}  可用直播源: ${successCount}/${totalCount} (${proxySuccessRate}%)\n\n`;
        
        const groupedStreams = {};
        successfulStreams.forEach(stream => {
            const group = stream.group || '未分组';
            if (!groupedStreams[group]) {
                groupedStreams[group] = [];
            }
            groupedStreams[group].push(stream);
        });
        
        Object.keys(groupedStreams).forEach(group => {
            groupedStreams[group].forEach(stream => {
                txtContent += `  [${group}] ${stream.stream_url}\n`;
            });
        });
        
        txtContent += '\n' + '-'.repeat(70) + '\n\n';
    });
    
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOCKS5直播源测试结果-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    addLog('系统', '直播源匹配结果已导出为TXT格式', 'success');
}

// 复制可用直播源URL
function copyMatchedUrls() {
    const proxies = Object.keys(proxyStreamResults);
    
    if (proxies.length === 0) {
        addLog('系统', '没有可用的直播源', 'warning');
        return;
    }
    
    let urlsText = '';
    let totalUrls = 0;
    
    const groupedStreams = {};
    
    proxies.forEach(proxy => {
        const streamResults = proxyStreamResults[proxy];
        const successfulStreams = streamResults.filter(r => r.success);
        
        successfulStreams.forEach(stream => {
            const group = stream.group || '未分组';
            if (!groupedStreams[group]) {
                groupedStreams[group] = new Set();
            }
            groupedStreams[group].add(stream.stream_url);
        });
    });
    
    for (const [group, urlSet] of Object.entries(groupedStreams)) {
        if (urlSet.size > 0) {
            urlsText += `${group},#genre#\n`;
            urlSet.forEach(url => {
                urlsText += `${url}\n`;
                totalUrls++;
            });
            urlsText += '\n';
        }
    }
    
    if (totalUrls === 0) {
        addLog('系统', '没有可用的直播源', 'warning');
        return;
    }
    
    navigator.clipboard.writeText(urlsText.trim()).then(() => {
        addLog('系统', `已复制 ${totalUrls} 个可用直播源到剪贴板`, 'success');
    }).catch(err => {
        addLog('系统', '复制失败: ' + err.message, 'error');
    });
}

// ==================== 测试记录功能 ====================
// 创建配置标识符
function createConfigIdentifier(testType, config) {
    // 创建配置的唯一标识符
    // 包括：测试类型、代理列表、直播源列表、主要参数
    const proxyList = config.proxies ? config.proxies.split('\n').filter(line => line.trim() !== '').join('|') : '';
    const streamList = config.streams ? config.streams.split('\n').filter(line => line.trim() !== '').join('|') : '';
    
    // 主要参数组合（不包括时间、用户代理、referer等可能会变化的参数）
    const params = [
        testType,
        proxyList,
        streamList,
        config.proxyTimeout || 5,
        config.streamTimeout || 8,
        config.proxyConcurrent || 3,
        config.testAnonymity !== undefined ? config.testAnonymity : true,
        config.testOnlyM3U8 !== undefined ? config.testOnlyM3U8 : true,
        config.keepGrouping !== undefined ? config.keepGrouping : true
    ].join('_');
    
    // 使用简单的哈希函数生成标识符
    return simpleHash(params);
}

// 简单的哈希函数
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
    }
    return hash.toString(36);
}

// 查找相同配置的索引
function findExistingConfigIndex(configIdentifier) {
    for (let i = 0; i < testHistory.length; i++) {
        if (testHistory[i].configIdentifier === configIdentifier) {
            return i;
        }
    }
    return -1;
}

// 保存测试记录
function saveTestHistory(testType, config) {
    // 创建配置标识符
    const configIdentifier = createConfigIdentifier(testType, config);
    
    // 检查是否有相同配置的记录
    const existingIndex = findExistingConfigIndex(configIdentifier);
    
    const historyItem = {
        id: Date.now(),
        type: testType,
        config: config,
        timestamp: new Date().toLocaleString(),
        configIdentifier: configIdentifier,
        stats: {
            proxies: config.proxies ? config.proxies.split('\n').filter(l => l.trim()).length : 0,
            streams: config.streams ? parseStreamList(config.streams).length : 0
        }
    };
    
    if (existingIndex !== -1) {
        // 覆盖旧记录
        testHistory[existingIndex] = historyItem;
        console.log('更新相同配置的测试记录');
    } else {
        // 添加新记录
        testHistory.unshift(historyItem);
        
        // 如果超过最大限制，删除最旧的记录
        if (testHistory.length > MAX_HISTORY_ITEMS) {
            testHistory.pop();
            console.log('达到最大记录数，删除最旧记录');
        }
    }
    
    localStorage.setItem('proxyTestHistory', JSON.stringify(testHistory));
    
    updateHistoryDisplay();
    updateHistoryCount();
    
    if (existingIndex !== -1) {
        addLog('系统', '已更新相同配置的测试记录', 'info');
    }
}

// 加载测试记录
function loadTestHistory() {
    const savedHistory = localStorage.getItem('proxyTestHistory');
    if (savedHistory) {
        try {
            testHistory = JSON.parse(savedHistory);
            
            // 为旧的历史记录生成配置标识符（兼容性处理）
            testHistory.forEach(item => {
                if (!item.configIdentifier && item.config) {
                    item.configIdentifier = createConfigIdentifier(item.type, item.config);
                }
            });
            
            // 检查并移除重复的配置（确保旧数据中也只保留最新的一条）
            removeDuplicateConfigs();
            
            // 确保不超过最大记录数
            if (testHistory.length > MAX_HISTORY_ITEMS) {
                testHistory = testHistory.slice(0, MAX_HISTORY_ITEMS);
                console.log(`历史记录超过${MAX_HISTORY_ITEMS}条，截取前${MAX_HISTORY_ITEMS}条`);
            }
            
            updateHistoryDisplay();
            updateHistoryCount();
        } catch (e) {
            console.error('加载测试记录失败:', e);
            testHistory = [];
            updateHistoryCount();
        }
    } else {
        updateHistoryCount();
    }
}

// 修改 removeDuplicateConfigs 函数，确保不超过最大记录数
function removeDuplicateConfigs() {
    const seenConfigs = new Map();
    const uniqueHistory = [];
    
    // 按时间排序，确保最新的在前面
    testHistory.sort((a, b) => {
        try {
            return new Date(b.timestamp) - new Date(a.timestamp);
        } catch (e) {
            return b.id - a.id; // 如果时间解析失败，使用ID
        }
    });
    
    // 遍历并保留每个配置的最新一条记录
    for (const item of testHistory) {
        if (item.configIdentifier) {
            if (!seenConfigs.has(item.configIdentifier)) {
                seenConfigs.set(item.configIdentifier, true);
                uniqueHistory.push(item);
                
                // 达到最大限制就停止
                if (uniqueHistory.length >= MAX_HISTORY_ITEMS) {
                    break;
                }
            } else {
                console.log('移除重复配置的旧记录');
            }
        } else {
            // 没有配置标识符的记录保留
            uniqueHistory.push(item);
            
            // 达到最大限制就停止
            if (uniqueHistory.length >= MAX_HISTORY_ITEMS) {
                break;
            }
        }
    }
    
    testHistory = uniqueHistory;
}

// 更新测试记录显示
function updateHistoryDisplay() {
    if (!historyList) return;
    
    if (testHistory.length === 0) {
        historyList.innerHTML = `
            <div class="history-item placeholder">
                <div class="history-info">
                    <div class="history-first-line">暂无测试记录</div>
                    <div class="history-second-line">开始测试后，记录将显示在这里</div>
                </div>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    testHistory.forEach((item, index) => {
        const isFullTest = item.type === '完整测试';
        const testType = isFullTest ? '完整测试' : '代理验证';
        
        // 提取所有代理（带端口号）
        let proxyDisplay = '无代理';
        let proxyCount = 0;
        let proxyList = [];
        
        if (item.config && item.config.proxies) {
            const proxies = item.config.proxies.split('\n').filter(line => line.trim() !== '');
            proxyCount = proxies.length;
            
            if (proxies.length > 0) {
                // 提取代理的IP:端口部分（保留端口，去除认证信息）
                proxyList = proxies.map(proxy => {
                    // 处理格式：IP:端口 或 IP:端口@用户名:密码
                    if (proxy.includes('@')) {
                        // 有认证信息：IP:端口@用户名:密码
                        const atIndex = proxy.indexOf('@');
                        return proxy.substring(0, atIndex); // 返回 IP:端口
                    } else {
                        // 无认证信息：IP:端口
                        return proxy;
                    }
                });
                
                // 显示所有代理，用中文分号分隔
                proxyDisplay = proxyList.join('；'); // 注意：这是中文分号
            }
        }
        
        // 保持原有时间格式不变
        const time = item.timestamp;
        
        // 构建统计信息
        const stats = isFullTest 
            ? `代理: ${proxyCount}个, 直播源: ${item.stats.streams}个`
            : `代理: ${proxyCount}个`;
        
        html += `
            <div class="history-item" data-id="${item.id}">
                <div class="history-info">
                    <!-- 第一行：类型和时间 -->
                    <div class="history-first-line">
                        <span class="history-type">${testType}</span>
                        <span class="history-time">${time}</span>
                    </div>
                    
                    <!-- 第二行：代理和统计 -->
                    <div class="history-second-line">
                        <!-- 左侧：所有代理IP:端口 -->
                        <span class="history-proxy-list" title="${proxyList.join('\n')}">
                            ${proxyDisplay}
                        </span>
                        
                        <!-- 右侧：统计信息 -->
                        <span class="history-stats">${stats}</span>
                    </div>
                </div>
                <div class="history-actions">
                    <button class="history-fill-btn" title="回填配置">
                        <i class="fas fa-fill"></i>
                    </button>
                    <button class="history-delete-btn" title="删除记录">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    historyList.innerHTML = html;
    
    // 绑定历史记录事件
    document.querySelectorAll('.history-fill-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const historyItem = this.closest('.history-item');
            const historyId = parseInt(historyItem.dataset.id);
            fillConfigFromHistory(historyId);
        });
    });
    
    document.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const historyItem = this.closest('.history-item');
            const historyId = parseInt(historyItem.dataset.id);
            deleteHistoryItem(historyId);
        });
    });
}

// 回填配置
function fillConfigFromHistory(historyId) {
    const historyItem = testHistory.find(item => item.id === historyId);
    if (!historyItem) return;
    
    const config = historyItem.config;
    
    if (config.proxies && proxyListTextarea) {
        proxyListTextarea.value = config.proxies;
        updateProxyCount();
    }
    
    if (config.streams && streamListTextarea) {
        streamListTextarea.value = config.streams;
        updateStreamCount();
    }
    
    if (config.proxyTimeout && proxyTimeoutInput) proxyTimeoutInput.value = config.proxyTimeout;
    if (config.streamTimeout && streamTimeoutInput) streamTimeoutInput.value = config.streamTimeout;
    if (config.proxyConcurrent && proxyConcurrentInput) proxyConcurrentInput.value = config.proxyConcurrent;
    if (config.testAnonymity !== undefined && testAnonymityCheckbox) testAnonymityCheckbox.checked = config.testAnonymity;
    if (config.testOnlyM3U8 !== undefined && testOnlyM3U8Checkbox) testOnlyM3U8Checkbox.checked = config.testOnlyM3U8;
    if (config.keepGrouping !== undefined && keepGroupingCheckbox) keepGroupingCheckbox.checked = config.keepGrouping;
    
    if (config.userAgent && userAgentInput) userAgentInput.value = config.userAgent;
    if (config.referer && refererInput) refererInput.value = config.referer;
    
    proxyTimeout = parseInt(proxyTimeoutInput ? proxyTimeoutInput.value : 5);
    streamTimeout = parseInt(streamTimeoutInput ? streamTimeoutInput.value : 8);
    concurrentLimit = parseInt(proxyConcurrentInput ? proxyConcurrentInput.value : 3);
    testAnonymity = testAnonymityCheckbox ? testAnonymityCheckbox.checked : true;
    testOnlyM3U8 = testOnlyM3U8Checkbox ? testOnlyM3U8Checkbox.checked : true;
    keepGrouping = keepGroupingCheckbox ? keepGroupingCheckbox.checked : true;
    userAgent = userAgentInput ? userAgentInput.value.trim() : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    referer = refererInput ? refererInput.value.trim() : '';
    
    addLog('系统', `已回填${historyItem.type}配置`, 'success');
}

// 删除测试记录
function deleteHistoryItem(historyId) {
    testHistory = testHistory.filter(item => item.id !== historyId);
    localStorage.setItem('proxyTestHistory', JSON.stringify(testHistory));
    updateHistoryDisplay();
    updateHistoryCount();
    addLog('系统', '已删除测试记录', 'success');
}

// 清空测试记录
function clearTestHistory() {
    if (testHistory.length === 0) {
        addLog('系统', '没有测试记录可清空', 'warning');
        return;
    }
    
    if (confirm(`确定要清空所有测试记录吗？当前有 ${testHistory.length} 条记录。`)) {
        testHistory = [];
        localStorage.removeItem('proxyTestHistory');
        updateHistoryDisplay();
        updateHistoryCount();
        addLog('系统', '已清空所有测试记录', 'success');
    }
}

// 更新测试记录计数
function updateHistoryCount() {
    if (historyCountElement) {
        historyCountElement.textContent = `记录数: ${testHistory.length}/${MAX_HISTORY_ITEMS}`;
        
        // 根据记录数量添加样式
        if (testHistory.length >= MAX_HISTORY_ITEMS) {
            historyCountElement.style.backgroundColor = '#fff3cd';
            historyCountElement.style.color = '#856404';
            historyCountElement.style.borderColor = '#ffeaa7';
        } else if (testHistory.length >= MAX_HISTORY_ITEMS * 0.8) {
            historyCountElement.style.backgroundColor = '#fff3cd';
            historyCountElement.style.color = '#856404';
            historyCountElement.style.borderColor = '#ffeaa7';
        } else {
            historyCountElement.style.backgroundColor = '';
            historyCountElement.style.color = '';
            historyCountElement.style.borderColor = '';
        }
    }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}