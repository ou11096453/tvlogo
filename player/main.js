// ==================== 全局变量 ====================
let hlsInstance = null;
let xgPlayerInstance = null;
let nativeVideoPlayer = null;
let xgplayerContainerElement = null;
let activePlayer = null;
let currentPlayingMethod = 'none';
let currentVideoUrl = null;

let playbackHistory = [];
let currentLoopMode = 'none';
let currentPlayingHistoryIndex = -1;

let isSeeking = false;
let wasPlayingBeforeSeek = false;
let pendingSeekTime = null;  // 新增：存储待跳转的时间
let keyboardSeekTimeout = null;
let keyboardSeekCurrentTime = 0;
let isKeyboardSeeking = false;
let currentlyEditingIndex = -1;
let controlsHideTimeout = null;
let animationFrameId = null;
let systemTimeIntervalId = null;
let systemTimeDisplayMode = 'no-background';
let savedVolumeBeforeMute = 1.0;

// SOCKS5代理相关
let useProxy = false;
let proxyConfig = { host: '', port: '', user: '', pass: '' };
let proxyPhpUrl = 'proxy.php';

const supportedFormats = ['mp4', 'm3u8', 'flv', 'webm', 'mkv', 'mov', 'avi', 'wmv', '3gp', 'ogg', 'mpg', 'mpeg', 'vob', 'ts'];

let transformSettings = { rotate: 0, scaleX: 1, scaleY: 1, zoom: 100 };
let filterSettings = { brightness: 100, contrast: 100, saturation: 100, sharpen: 0 };
let backgroundSettings = { url: 'https://my.bing.xo.je/302/uhd_302.php', blur: 0 };

const filterPresets = {
  vibrant: { brightness: 105, contrast: 110, saturation: 150, sharpen: 0 },
  cinematic: { brightness: 95, contrast: 120, saturation: 80, sharpen: 0 },
  monochrome: { brightness: 100, contrast: 100, saturation: 0, sharpen: 0 },
};

// DOM 元素
let playPauseBtn, playPauseIcon, uploadPlaceholder, videoContainerElement;
let seekSlider, currentTimeDisplay, durationDisplay;
let volumeSlider, volumeIcon, muteButtonIcon, volumePercentageDisplay;
let inVideoControls, resolutionDisplay;
let inVideoPlayPauseBtn, inVideoPlayPauseIcon, inVideoSeekSlider;
let inVideoCurrentTimeDisplay, inVideoDurationDisplay;
let inVideoVolumeSlider, inVideoVolumeIcon, inVideoVolumePercentageDisplay, inVideoFullscreenBtn;
let settingsPanel, historyPanel, systemTimeDisplayElement, toggleSystemTimeBtn;

let waitingTimer = null;

// ==================== 工具函数 ====================
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getFileExtension(url) {
  if (!url) return '';
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\.([^.?]+)(?:\?|#|$)/);
    return match ? match[1].toLowerCase() : '';
  } catch {
    const match = url.match(/\.([^.?]+)(?:\?|#|$)/);
    return match ? match[1].toLowerCase() : '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

function updateStatus(status, message) {
  const indicator = document.getElementById('statusIndicator');
  if (indicator) {
    indicator.className = `status-indicator ${status}`;
    indicator.innerHTML = `<i class="fas fa-circle"></i> ${message}`;
  }
}

function saveAllSettings() {
  localStorage.setItem('transformSettings', JSON.stringify(transformSettings));
  localStorage.setItem('filterSettings', JSON.stringify(filterSettings));
  if (activePlayer) localStorage.setItem('playbackRate', activePlayer.playbackRate);
  localStorage.setItem('backgroundSettings', JSON.stringify(backgroundSettings));
  localStorage.setItem('loopMode', currentLoopMode);
}

function updateResolutionDisplay() {
  if (!resolutionDisplay) return;
  
  if (activePlayer && activePlayer.videoWidth && activePlayer.videoHeight) {
    resolutionDisplay.textContent = `${activePlayer.videoWidth}×${activePlayer.videoHeight}`;
    resolutionDisplay.classList.remove('hidden');
    
    // 获取帧率和码率
    let frameRate = null;
    let bitrateMbps = null;
    
    // 直接从 hlsInstance 获取当前级别信息
    if (hlsInstance && hlsInstance.levels && hlsInstance.levels.length > 0) {
      // 获取当前播放的级别索引
      let currentLevelIndex = hlsInstance.currentLevel;
      // 如果 currentLevel 是 -1，则取第一个或最后一个
      if (currentLevelIndex === -1 && hlsInstance.levels.length > 0) {
        currentLevelIndex = 0;
      }
      
      if (currentLevelIndex !== -1 && hlsInstance.levels[currentLevelIndex]) {
        const level = hlsInstance.levels[currentLevelIndex];
        if (level.frameRate) {
          frameRate = level.frameRate;
        }
        if (level.bitrate && level.bitrate > 0) {
          // 转换为 Mbps，保留一位小数
          bitrateMbps = (level.bitrate / 1000000).toFixed(1);
        }
      }
    }
    
    const fpsDisplay = document.getElementById('fpsDisplay');
    if (fpsDisplay) {
      let displayText = '';
      if (frameRate) {
        const fpsValue = Number.isInteger(frameRate) ? Math.round(frameRate) : frameRate.toFixed(1);
        displayText = `${fpsValue}P`;
      }
      if (bitrateMbps) {
        if (displayText) displayText += ` / `;
        displayText += `${bitrateMbps}M`;
      }
      
      console.log('显示信息:', displayText); // 调试日志
      
      if (displayText) {
        fpsDisplay.textContent = displayText;
        fpsDisplay.classList.remove('hidden');
      } else {
        fpsDisplay.textContent = '';  // 清空内容
        fpsDisplay.classList.add('hidden');
      }
    }
    
    // 控制显示/隐藏
    if (inVideoControls && inVideoControls.classList.contains('controls-visible')) {
      resolutionDisplay.classList.remove('hidden');
      if (fpsDisplay && fpsDisplay.textContent) {
        fpsDisplay.classList.remove('hidden');
      }
    } else {
      resolutionDisplay.classList.add('hidden');
      if (fpsDisplay) fpsDisplay.classList.add('hidden');
    }
  } else {
    resolutionDisplay.classList.add('hidden');
    const fpsDisplay = document.getElementById('fpsDisplay');
    if (fpsDisplay) fpsDisplay.classList.add('hidden');
  }
}

// ==================== 代理功能 ====================
function updateProxyButtonUI() {
  const toggleProxyBtn = document.getElementById('toggleProxyBtn');
  const proxyStatusText = document.getElementById('proxyStatusText');
  if (toggleProxyBtn) {
    if (useProxy) {
      toggleProxyBtn.classList.add('active');
      if (proxyStatusText) proxyStatusText.textContent = '代理: 开启';
    } else {
      toggleProxyBtn.classList.remove('active');
      if (proxyStatusText) proxyStatusText.textContent = '代理: 关闭';
    }
  }
}

function saveProxyConfig() {
  const hostInput = document.getElementById('proxyHost');
  const portInput = document.getElementById('proxyPort');
  const userInput = document.getElementById('proxyUser');
  const passInput = document.getElementById('proxyPass');
  
  proxyConfig = {
    host: hostInput?.value || '',
    port: portInput?.value || '',
    user: userInput?.value || '',
    pass: passInput?.value || ''
  };
  localStorage.setItem('proxyHost', proxyConfig.host);
  localStorage.setItem('proxyPort', proxyConfig.port);
  localStorage.setItem('proxyUser', proxyConfig.user);
  localStorage.setItem('proxyPass', proxyConfig.pass);
  updateStatus('playing', '代理配置已保存');
  setTimeout(() => updateStatus('stopped', '播放器已停止'), 2000);
}

async function testProxyConnection() {
  updateStatus('loading', '测试代理连接...');
  try {
    const response = await fetch(`${proxyPhpUrl}?action=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        proxy: {
          host: proxyHost.value,
          port: parseInt(proxyPort.value),
          user: proxyUser.value,
          pass: proxyPass.value
        }
      })
    });
    const result = await response.json();
    if (result.success) {
      // 修改这里：显示真实IP
      if (result.ip) {
        updateStatus('playing', `✓ 代理测试成功！出口IP: ${result.ip}`);
      } else {
        updateStatus('playing', `✓ 代理测试成功！`);
      }
      setTimeout(() => updateStatus('stopped', '播放器已停止'), 3000);
    } else {
      updateStatus('stopped', `✗ 代理测试失败: ${result.error}`);
    }
  } catch (e) {
    updateStatus('stopped', `✗ 代理测试失败: ${e.message}`);
  }
}

function getProxyUrl(originalUrl) {
  if (!useProxy) return originalUrl;
  if (originalUrl.startsWith('blob:') || originalUrl.startsWith('data:')) return originalUrl;
  if (originalUrl.includes('proxy.php')) return originalUrl;
  
  let proxyUrl = `${proxyPhpUrl}?action=stream&url=${encodeURIComponent(originalUrl)}`;
  if (proxyConfig.host && proxyConfig.port) {
    proxyUrl += `&proxy_host=${proxyConfig.host}&proxy_port=${proxyConfig.port}`;
  }
  if (proxyConfig.user) proxyUrl += `&proxy_user=${encodeURIComponent(proxyConfig.user)}`;
  if (proxyConfig.pass) proxyUrl += `&proxy_pass=${encodeURIComponent(proxyConfig.pass)}`;
  return proxyUrl;
}

// ==================== 画面变换与滤镜 ====================
function applyVideoTransformations() {
  const transform = `rotate(${transformSettings.rotate}deg) scaleX(${transformSettings.scaleX}) scaleY(${transformSettings.scaleY}) scale(${transformSettings.zoom / 100})`;
  if (nativeVideoPlayer && currentPlayingMethod !== 'xgplayer') {
    nativeVideoPlayer.style.transform = transform;
  }
  if (xgPlayerInstance && xgPlayerInstance.video && currentPlayingMethod === 'xgplayer') {
    xgPlayerInstance.video.style.transform = transform;
  }
}

function applyVideoFilters() {
  let filter = `brightness(${filterSettings.brightness}%) contrast(${filterSettings.contrast}%) saturate(${filterSettings.saturation}%)`;
  if (filterSettings.sharpen > 0) {
    filter += ` url(#sharpen-filter-${filterSettings.sharpen})`;
  }
  if (nativeVideoPlayer && currentPlayingMethod !== 'xgplayer') {
    nativeVideoPlayer.style.filter = filter;
  }
  if (xgPlayerInstance && xgPlayerInstance.video && currentPlayingMethod === 'xgplayer') {
    xgPlayerInstance.video.style.filter = filter;
  }
}

function createSharpenSVGElements() {
  const svgContainer = document.getElementById('sharpen-svg-filters');
  if (!svgContainer) return;
  svgContainer.innerHTML = '';
  
  for (let i = 1; i <= 10; i++) {
    const k = (5 + (8 * (i - 1) / 9)).toFixed(2);
    const e = (-0.5 + (-0.5 * (i - 1) / 9)).toFixed(2);
    const matrix = `${e} ${e} ${e} ${e} ${k} ${e} ${e} ${e} ${e}`;
    
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', `sharpen-filter-${i}`);
    const conv = document.createElementNS('http://www.w3.org/2000/svg', 'feConvolveMatrix');
    conv.setAttribute('order', '3');
    conv.setAttribute('kernelMatrix', matrix);
    filter.appendChild(conv);
    svgContainer.appendChild(filter);
  }
}

function applyBackground() {
  const imageUrl = backgroundSettings.url ? `url('${backgroundSettings.url}')` : 'none';
  document.body.style.setProperty('--player-bg-image', imageUrl);
  document.body.style.setProperty('--player-bg-blur', `${backgroundSettings.blur}px`);
}

// ==================== 系统时间 ====================
function updateSystemTime() {
  if (!systemTimeDisplayElement) return;
  const now = new Date();
  systemTimeDisplayElement.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

function startSystemTimeUpdate() {
  if (systemTimeIntervalId) clearInterval(systemTimeIntervalId);
  updateSystemTime();
  systemTimeIntervalId = setInterval(updateSystemTime, 1000);
}

function loadSystemTimeVisibility() {
  systemTimeDisplayMode = localStorage.getItem('systemTimeDisplayMode') || 'no-background';
  if (!systemTimeDisplayElement || !toggleSystemTimeBtn) return;
  
  if (systemTimeDisplayMode === 'hidden') {
    systemTimeDisplayElement.classList.add('hidden');
    toggleSystemTimeBtn.querySelector('i').className = 'fas fa-eye-slash';
  } else if (systemTimeDisplayMode === 'no-background') {
    systemTimeDisplayElement.classList.remove('hidden');
    systemTimeDisplayElement.classList.add('no-background-time');
    toggleSystemTimeBtn.querySelector('i').className = 'far fa-clock';
  } else {
    systemTimeDisplayElement.classList.remove('hidden');
    systemTimeDisplayElement.classList.remove('no-background-time');
    toggleSystemTimeBtn.querySelector('i').className = 'fas fa-clock';
  }
}

function toggleSystemTimeVisibility() {
  if (systemTimeDisplayMode === 'background') {
    systemTimeDisplayMode = 'no-background';
    systemTimeDisplayElement.classList.add('no-background-time');
    toggleSystemTimeBtn.querySelector('i').className = 'far fa-clock';
  } else if (systemTimeDisplayMode === 'no-background') {
    systemTimeDisplayMode = 'hidden';
    systemTimeDisplayElement.classList.add('hidden');
    systemTimeDisplayElement.classList.remove('no-background-time');
    toggleSystemTimeBtn.querySelector('i').className = 'fas fa-eye-slash';
  } else {
    systemTimeDisplayMode = 'background';
    systemTimeDisplayElement.classList.remove('hidden');
    systemTimeDisplayElement.classList.remove('no-background-time');
    toggleSystemTimeBtn.querySelector('i').className = 'fas fa-clock';
  }
  localStorage.setItem('systemTimeDisplayMode', systemTimeDisplayMode);
}

// ==================== UI控制 ====================
function showControls() {
  if (!inVideoControls) return;
  inVideoControls.classList.add('controls-visible');
  
  // 强制更新显示内容
  updateResolutionDisplay();
  
  // 只有分辨率有真实内容时才显示
  if (resolutionDisplay && resolutionDisplay.textContent && resolutionDisplay.textContent.trim() !== '') {
    resolutionDisplay.classList.remove('hidden');
  }
  
  // 只有帧率有真实内容时才显示
  const fpsDisplay = document.getElementById('fpsDisplay');
  if (fpsDisplay && fpsDisplay.textContent && fpsDisplay.textContent.trim() !== '') {
    fpsDisplay.classList.remove('hidden');
  }
  
  clearTimeout(controlsHideTimeout);
  const shouldAutoHide = window.innerWidth > 768 || (activePlayer && !activePlayer.paused);
  if (shouldAutoHide) {
    controlsHideTimeout = setTimeout(() => {
      hideControls();
    }, 3000);
  }
}

function hideControls() {
  if (inVideoControls) inVideoControls.classList.remove('controls-visible');
  if (resolutionDisplay) resolutionDisplay.classList.add('hidden');
  const fpsDisplay = document.getElementById('fpsDisplay');
  if (fpsDisplay) fpsDisplay.classList.add('hidden');
}

function startProgressBarUpdate() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  
  function updateFrame() {
    // 正在拖拽时不要更新进度条，避免冲突
    if (!activePlayer || activePlayer.paused || isSeeking || isKeyboardSeeking) {
      animationFrameId = requestAnimationFrame(updateFrame);
      return;
    }
    
    const duration = activePlayer.duration || 0;
    const current = Math.min(activePlayer.currentTime || 0, duration);
    
    if (seekSlider && seekSlider.max !== duration) {
      seekSlider.max = duration;
      if (inVideoSeekSlider) inVideoSeekSlider.max = duration;
      if (durationDisplay) durationDisplay.textContent = formatTime(duration);
      if (inVideoDurationDisplay) inVideoDurationDisplay.textContent = formatTime(duration);
    }
    
    // 只有在非拖拽状态下才更新进度条值
    if (!isSeeking) {
      if (seekSlider) seekSlider.value = current;
      if (inVideoSeekSlider) inVideoSeekSlider.value = current;
      if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(current);
      if (inVideoCurrentTimeDisplay) inVideoCurrentTimeDisplay.textContent = formatTime(current);
    }
    
    animationFrameId = requestAnimationFrame(updateFrame);
  }
  
  animationFrameId = requestAnimationFrame(updateFrame);
}

function stopProgressBarUpdate() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}


// ==================== 播放错误处理 ====================
function showPlayError(errorType, details, url, httpStatus = null) {
  let errorMessage = '';
  
  if (httpStatus) {
    switch (httpStatus) {
      case 403:
      case 401:
        errorMessage = `视频地址拒绝访问 (HTTP ${httpStatus})，可能是防盗链`;
        break;
      case 404:
        errorMessage = `视频地址不存在 (HTTP ${httpStatus})`;
        break;
      case 500:
      case 502:
      case 503:
        errorMessage = `服务器错误 (HTTP ${httpStatus})，请稍后重试`;
        break;
      default:
        if (httpStatus >= 400 && httpStatus < 500) {
          errorMessage = `客户端错误 (HTTP ${httpStatus})`;
        } else if (httpStatus >= 500) {
          errorMessage = `服务器错误 (HTTP ${httpStatus})`;
        } else {
          errorMessage = `HTTP ${httpStatus} 错误`;
        }
    }
  } else {
    switch(errorType) {
      case 'protocol':
        errorMessage = `${details}协议不被浏览器支持`;
        break;
      case 'network':
        errorMessage = '网络连接失败，请检查网络';
        break;
      case 'cors':
        errorMessage = useProxy ? '跨域访问被阻止，代理可能未正确配置' : '【跨域限制】视频源禁止了当前域名的访问 (CORS)，可尝试开启代理。';
        break;
      case 'decode':
        errorMessage = '视频解码失败，格式可能不兼容';
        break;
      case 'format':
        errorMessage = details || '视频格式不支持';
        break;
      default:
        errorMessage = details || '播放失败';
    }
  }
  
  console.error('[播放错误]', { errorType, details, url, httpStatus });
  updateStatus('stopped', errorMessage);
  
  if (uploadPlaceholder) uploadPlaceholder.classList.remove('hidden');
  if (videoContainerElement) videoContainerElement.classList.remove('visible');
  if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
  if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
}

// ==================== 停止播放 ====================
function stopPlaybackInternal(keepPlaceholder = false, keepUrl = false) {
  stopProgressBarUpdate();
  if (waitingTimer) clearTimeout(waitingTimer);
  
  if (activePlayer) {
    activePlayer.pause();
    if (activePlayer.src && activePlayer.src.startsWith('blob:')) {
      URL.revokeObjectURL(activePlayer.src);
    }
    if (currentPlayingMethod !== 'xgplayer') {
      activePlayer.removeAttribute('src');
      activePlayer.load();
    }
  }
  
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  
  if (xgPlayerInstance) {
    try { xgPlayerInstance.destroy(); } catch(e) {}
    xgPlayerInstance = null;
  }
  
  if (seekSlider) seekSlider.value = 0;
  if (inVideoSeekSlider) inVideoSeekSlider.value = 0;
  if (currentTimeDisplay) currentTimeDisplay.textContent = '00:00';
  if (inVideoCurrentTimeDisplay) inVideoCurrentTimeDisplay.textContent = '00:00';
  if (durationDisplay) durationDisplay.textContent = '00:00';
  if (inVideoDurationDisplay) inVideoDurationDisplay.textContent = '00:00';
  
  currentVideoUrl = null;
  updateStatus('stopped', '播放器已停止');
  
  if (!keepPlaceholder && uploadPlaceholder) {
    uploadPlaceholder.classList.remove('hidden');
    if (videoContainerElement) videoContainerElement.classList.remove('visible');
  }
  if (!keepUrl) {
    const urlInput = document.getElementById('videoURL');
    if (urlInput) urlInput.value = '';
  }
  
  if (nativeVideoPlayer) nativeVideoPlayer.style.display = 'none';
  if (xgplayerContainerElement) xgplayerContainerElement.style.display = 'none';
  
  activePlayer = nativeVideoPlayer;
  currentPlayingMethod = 'none';
  if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
  if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
  if (inVideoControls) inVideoControls.classList.add('controls-visible');
  
  updateResolutionDisplay();
}

function stopPlayback() {
  currentPlayingHistoryIndex = -1;
  stopPlaybackInternal(false, true);
}

// ==================== 视频结束处理 ====================
function handleVideoEnded() {
  stopProgressBarUpdate();
  updateStatus('stopped', '播放已结束');
  
  if (currentLoopMode === 'single') {
    if (activePlayer) {
      activePlayer.currentTime = 0;
      activePlayer.play();
      updateStatus('playing', '单曲循环中...');
    }
  } else if (currentLoopMode === 'list' && playbackHistory.length > 0) {
    let nextIdx = (currentPlayingHistoryIndex + 1) % playbackHistory.length;
    let attempts = 0;
    while (attempts < playbackHistory.length && 
           playbackHistory[nextIdx]?.type === 'local' && 
           !playbackHistory[nextIdx]?.fileObject) {
      nextIdx = (nextIdx + 1) % playbackHistory.length;
      attempts++;
    }
    if (playbackHistory[nextIdx] && 
        !(playbackHistory[nextIdx].type === 'local' && !playbackHistory[nextIdx].fileObject)) {
      playFromHistory(nextIdx);
    }
  } else if (currentLoopMode === 'shuffle' && playbackHistory.length > 0) {
    let newIdx;
    do {
      newIdx = Math.floor(Math.random() * playbackHistory.length);
    } while (playbackHistory.length > 1 && newIdx === currentPlayingHistoryIndex);
    if (playbackHistory[newIdx] && 
        !(playbackHistory[newIdx].type === 'local' && !playbackHistory[newIdx].fileObject)) {
      playFromHistory(newIdx);
    }
  }
}

function globalSeekedHandler() {
  console.log('seeked triggered');
  if (activePlayer) {
    // 恢复之前的播放状态 [cite: 91]
    if (wasPlayingBeforeSeek) {
      activePlayer.play().catch(e => console.error('播放失败:', e));
      wasPlayingBeforeSeek = false;
    }
    isSeeking = false;
    isKeyboardSeeking = false;
    pendingSeekTime = null;
    startProgressBarUpdate(); // 重新开启进度条自动更新 [cite: 92]
  }
}

// ==================== 进度条事件（修复版） ====================
function setupSeekEvents() {
  const syncSliders = (time) => {
    if (seekSlider) seekSlider.value = time;
    if (inVideoSeekSlider) inVideoSeekSlider.value = time;
    if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(time);
    if (inVideoCurrentTimeDisplay) inVideoCurrentTimeDisplay.textContent = formatTime(time);
  };

  const handleSeekStart = function(e) {
    // 允许滑动，不阻止默认行为以确保 range 控件正常工作，但标记正在拖拽 [cite: 94]
    isSeeking = true;
    if (activePlayer) {
      wasPlayingBeforeSeek = !activePlayer.paused;
      activePlayer.pause(); // 拖拽时暂停 [cite: 94]
      stopProgressBarUpdate(); // 停止自动更新进度条，防止跳变 [cite: 94]
    }
  };

  const handleSeekEnd = function(e) {
    if (activePlayer && isSeeking) {
      const targetTime = parseFloat(this.value); // 获取拖动后的值 [cite: 95]
      pendingSeekTime = targetTime;
      
      // 执行跳转
      activePlayer.currentTime = targetTime; // [cite: 96]
      
      // 如果之前是播放状态，跳转完成后由 globalSeekedHandler 接管播放 [cite: 91]
    }
  };

  const handleSeekInput = function() {
    const time = parseFloat(this.value);
    syncSliders(time); // 拖动过程中实时更新 UI 时间显示 [cite: 97, 98]
  };

  // 绑定外部进度条 [cite: 98, 99]
  if (seekSlider) {
    seekSlider.addEventListener('mousedown', handleSeekStart);
    seekSlider.addEventListener('mouseup', handleSeekEnd);
    seekSlider.addEventListener('input', handleSeekInput);
    seekSlider.addEventListener('change', handleSeekEnd); // 确保值改变后触发

    seekSlider.addEventListener('touchstart', handleSeekStart, { passive: true });
    seekSlider.addEventListener('touchend', handleSeekEnd, { passive: true });
  }

  // 绑定视频内进度条 [cite: 104, 105]
  if (inVideoSeekSlider) {
    inVideoSeekSlider.addEventListener('mousedown', handleSeekStart);
    inVideoSeekSlider.addEventListener('mouseup', handleSeekEnd);
    inVideoSeekSlider.addEventListener('input', handleSeekInput);
    inVideoSeekSlider.addEventListener('change', handleSeekEnd);

    inVideoSeekSlider.addEventListener('touchstart', handleSeekStart, { passive: true });
    inVideoSeekSlider.addEventListener('touchend', handleSeekEnd, { passive: true });
  }
}

// ==================== 音量控制 ====================
function setupVolumeSync() {
  const savedVolume = localStorage.getItem('volumePercentage');
  const volumeValue = savedVolume ? parseInt(savedVolume) : 100;
  
  if (volumeSlider) {
    volumeSlider.value = volumeValue;
    if (volumePercentageDisplay) volumePercentageDisplay.textContent = `${volumeValue}%`;
  }
  if (inVideoVolumeSlider) {
    inVideoVolumeSlider.value = volumeValue;
    if (inVideoVolumePercentageDisplay) inVideoVolumePercentageDisplay.textContent = `${volumeValue}%`;
  }
  if (activePlayer) {
    activePlayer.volume = volumeValue / 100;
    if (activePlayer.volume > 0) savedVolumeBeforeMute = activePlayer.volume;
  }
  
  const updateVolumeUI = (vol) => {
    const volume = vol / 100;
    const iconClass = volume === 0 ? 'fas fa-volume-off' : (volume < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up');
    if (volumeIcon) volumeIcon.className = iconClass;
    if (inVideoVolumeIcon) inVideoVolumeIcon.className = iconClass;
    if (muteButtonIcon) muteButtonIcon.className = iconClass;
  };
  
  if (volumeSlider) {
    volumeSlider.addEventListener('input', function() {
      if (!activePlayer) return;
      const vol = this.value / 100;
      activePlayer.volume = vol;
      if (volumePercentageDisplay) volumePercentageDisplay.textContent = `${this.value}%`;
      if (inVideoVolumeSlider) inVideoVolumeSlider.value = this.value;
      if (inVideoVolumePercentageDisplay) inVideoVolumePercentageDisplay.textContent = `${this.value}%`;
      localStorage.setItem('volumePercentage', this.value);
      if (vol > 0) {
        savedVolumeBeforeMute = vol;
        localStorage.setItem('savedVolumeBeforeMute', savedVolumeBeforeMute.toString());
      }
      updateVolumeUI(this.value);
    });
  }
  
  if (inVideoVolumeSlider) {
    inVideoVolumeSlider.addEventListener('input', function() {
      if (volumeSlider) volumeSlider.value = this.value;
      volumeSlider?.dispatchEvent(new Event('input'));
    });
  }
  
  if (volumeIcon) volumeIcon.addEventListener('click', toggleMute);
  if (inVideoVolumeIcon) inVideoVolumeIcon.addEventListener('click', toggleMute);
  updateVolumeUI(volumeValue);
}

function toggleMute() {
  if (!activePlayer) return;
  
  if (activePlayer.volume > 0) {
    activePlayer.volume = 0;
    if (volumeSlider) volumeSlider.value = 0;
    if (inVideoVolumeSlider) inVideoVolumeSlider.value = 0;
  } else {
    const target = savedVolumeBeforeMute > 0 ? savedVolumeBeforeMute : 1.0;
    activePlayer.volume = target;
    const percent = Math.round(target * 100);
    if (volumeSlider) volumeSlider.value = percent;
    if (inVideoVolumeSlider) inVideoVolumeSlider.value = percent;
  }
  
  localStorage.setItem('volumePercentage', volumeSlider?.value || '0');
  if (volumePercentageDisplay) volumePercentageDisplay.textContent = `${volumeSlider?.value || 0}%`;
  if (inVideoVolumePercentageDisplay) inVideoVolumePercentageDisplay.textContent = `${inVideoVolumeSlider?.value || 0}%`;
  
  const vol = activePlayer.volume;
  const iconClass = vol === 0 ? 'fas fa-volume-off' : (vol < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up');
  if (volumeIcon) volumeIcon.className = iconClass;
  if (inVideoVolumeIcon) inVideoVolumeIcon.className = iconClass;
  if (muteButtonIcon) muteButtonIcon.className = iconClass;
}

// ==================== 播放速度 ====================
function changeSpeed(speed, buttonElement) {
  if (activePlayer) {
    activePlayer.playbackRate = speed;
    document.querySelectorAll('#speedBtnGroup .btn, #speedMenu button').forEach(btn => {
      btn.classList.remove('active-speed-btn');
    });
    if (buttonElement) buttonElement.classList.add('active-speed-btn');
    if (!activePlayer.paused) {
      updateStatus('playing', `正在播放 (${speed}x)`);
    }
    saveAllSettings();
  }
}

// ==================== 全屏 ====================
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function toggleFullscreen() {
  if (!videoContainerElement) return;
  
  if (document.fullscreenElement) {
    document.exitFullscreen();
    videoContainerElement.classList.remove('fullscreen-active');
    if (isMobileDevice() && screen.orientation?.unlock) screen.orientation.unlock();
  } else {
    videoContainerElement.requestFullscreen();
    videoContainerElement.classList.add('fullscreen-active');
    if (isMobileDevice() && screen.orientation?.lock) {
      screen.orientation.lock('landscape').catch(e => console.warn(e));
    }
  }
}

// ==================== 播放核心 - 原生播放器 ====================
function playWithNativePlayer(url, isM3U8, fileObject = null) {
  currentPlayingMethod = 'native';
  if (nativeVideoPlayer) nativeVideoPlayer.style.display = 'block';
  if (xgplayerContainerElement) xgplayerContainerElement.style.display = 'none';
  activePlayer = nativeVideoPlayer;
  
  // 设置音量
  const savedVolume = localStorage.getItem('volumePercentage');
  const volumeValue = savedVolume ? parseInt(savedVolume) : 100;
  activePlayer.volume = volumeValue / 100;
  if (activePlayer.volume > 0) savedVolumeBeforeMute = activePlayer.volume;
  
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }
  
  // 协议检测
  if (url.indexOf('rtmp://') === 0 || url.indexOf('rtsp://') === 0) {
    showPlayError('protocol', url.split(':')[0], url);
    return;
  }
  
  let finalUrl = url;
  if (useProxy && !fileObject && !url.startsWith('blob:') && !url.includes('proxy.php')) {
    finalUrl = getProxyUrl(url);
  }
  
  // 清理旧的事件监听器
  if (nativeVideoPlayer._handlers) {
    const handlers = nativeVideoPlayer._handlers;
    nativeVideoPlayer.removeEventListener('play', handlers.handlePlay);
    nativeVideoPlayer.removeEventListener('pause', handlers.handlePause);
    nativeVideoPlayer.removeEventListener('waiting', handlers.handleWaiting);
    nativeVideoPlayer.removeEventListener('loadedmetadata', handlers.handleLoadedMetadata);
    nativeVideoPlayer.removeEventListener('resize', handlers.handleResize);
    nativeVideoPlayer.removeEventListener('ended', handlers.handleEnded);
    nativeVideoPlayer.removeEventListener('seeked', globalSeekedHandler);
  }
  
  // 定义事件处理器
  const handlePlay = () => {
    updateStatus('playing', `正在播放 (${activePlayer.playbackRate}x)`);
    if (playPauseIcon) playPauseIcon.className = 'fas fa-pause';
    if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-pause';
    if (uploadPlaceholder) uploadPlaceholder.classList.add('hidden');
    if (videoContainerElement) videoContainerElement.classList.add('visible');
    showControls();
    startProgressBarUpdate();
  };
  
  const handlePause = () => {
    stopProgressBarUpdate();
    if (!isSeeking && !isKeyboardSeeking) {
      updateStatus('stopped', '播放已暂停');
    }
    if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
    if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
    showControls();
  };
  
  const handleWaiting = () => {
    if (!isSeeking && !isKeyboardSeeking && activePlayer && !activePlayer.paused) {
      updateStatus('loading', '缓冲中...');
      if (waitingTimer) clearTimeout(waitingTimer);
      waitingTimer = setTimeout(() => {
        if (activePlayer && !activePlayer.paused && activePlayer.currentTime > 0) {
          updateStatus('playing', `正在播放 (${activePlayer.playbackRate}x)`);
        }
      }, 3000);
    }
  };
  
  const handleLoadedMetadata = () => {
    if (seekSlider) {
      seekSlider.max = nativeVideoPlayer.duration;
      seekSlider.value = nativeVideoPlayer.currentTime;
    }
    if (inVideoSeekSlider) {
      inVideoSeekSlider.max = nativeVideoPlayer.duration;
      inVideoSeekSlider.value = nativeVideoPlayer.currentTime;
    }
    if (durationDisplay) durationDisplay.textContent = formatTime(nativeVideoPlayer.duration);
    if (inVideoDurationDisplay) inVideoDurationDisplay.textContent = formatTime(nativeVideoPlayer.duration);
    if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(nativeVideoPlayer.currentTime);
    if (inVideoCurrentTimeDisplay) inVideoCurrentTimeDisplay.textContent = formatTime(nativeVideoPlayer.currentTime);
    updateResolutionDisplay();
  };
  
  const handleResize = () => updateResolutionDisplay();
  const handleEnded = handleVideoEnded;
  
  // 添加事件监听器
  nativeVideoPlayer.addEventListener('play', handlePlay);
  nativeVideoPlayer.addEventListener('pause', handlePause);
  nativeVideoPlayer.addEventListener('waiting', handleWaiting);
  nativeVideoPlayer.addEventListener('loadedmetadata', handleLoadedMetadata);
  nativeVideoPlayer.addEventListener('resize', handleResize);
  nativeVideoPlayer.addEventListener('ended', handleEnded);
  nativeVideoPlayer.addEventListener('seeked', globalSeekedHandler);
  
  // 存储以便清理
  nativeVideoPlayer._handlers = { handlePlay, handlePause, handleWaiting, handleLoadedMetadata, handleResize, handleEnded };
  
  // HLS播放
  if (isM3U8 && Hls.isSupported()) {
    currentPlayingMethod = 'hls';
    const hlsConfig = {
      startFragPrefetch: true,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      minBufferLength: 15,
      debug: false
    };
    
    hlsInstance = new Hls(hlsConfig);
    hlsInstance.loadSource(finalUrl);
    hlsInstance.attachMedia(nativeVideoPlayer);
    
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      nativeVideoPlayer.currentTime = 0.01;
      nativeVideoPlayer.play().catch(e => {
        console.log('HLS自动播放被阻止:', e);
        updateStatus('stopped', '点击播放按钮开始播放');
      });
      
      // ========== 获取HLS流帧率信息 ==========
      try {
        // 获取当前清晰度级别的帧率
        const currentLevelIndex = hlsInstance.currentLevel;
        const levels = hlsInstance.levels;
        
        if (levels && levels.length > 0) {
          // 显示所有级别的帧率信息
          console.log('=== HLS流级别信息 ===');
          levels.forEach((level, idx) => {
            const fps = level.frameRate || '未知';
            const resolution = level.width && level.height ? `${level.width}x${level.height}` : '未知分辨率';
            console.log(`级别 ${idx}: ${resolution}, 帧率: ${fps} fps, 码率: ${Math.round(level.bitrate/1000)} kbps`);
            
            // 如果是当前级别，额外标记
            if (idx === currentLevelIndex) {
              console.log(`  👆 当前播放级别`);
              // 更新状态栏显示帧率
              if (level.frameRate) {
                updateStatus('playing', `正在播放 (${activePlayer.playbackRate}x) | ${level.frameRate}fps`);
                setTimeout(() => {
                  if (!activePlayer.paused) {
                    updateStatus('playing', `正在播放 (${activePlayer.playbackRate}x)`);
                  }
                }, 3000);
              }
            }
          });
          
          // 存储到全局变量供其他地方使用
          window.hlsLevelsInfo = levels.map(level => ({
            width: level.width,
            height: level.height,
            frameRate: level.frameRate,
            bitrate: level.bitrate
          }));
        }
      } catch(e) {
        console.warn('获取HLS帧率信息失败:', e);
      }
    });
    
    // 监听清晰度切换，更新帧率显示
    hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
  try {
    const newLevel = hlsInstance.levels[data.level];
    if (newLevel && newLevel.frameRate) {
      console.log(`清晰度切换，新级别帧率: ${newLevel.frameRate} fps`);
      // 强制更新分辨率显示（会同时更新帧率和码率）
      updateResolutionDisplay();
    }
  } catch(e) {}
});
    
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      // 1. 尝试从多个来源获取状态码
      let httpStatus = 0;
      if (data.response && data.response.code !== undefined) {
        httpStatus = data.response.code;
      } else if (data.xhr && data.xhr.status !== undefined) {
        httpStatus = data.xhr.status;
      }

      console.error('HLS详细调试信息:', {
        details: data.details,
        status: httpStatus,
        fatal: data.fatal,
        url: data.url
      });

      if (!data.fatal) return;

      let errorMsg = '';
      let errorType = 'hls_error';

      // 2. 识别清单加载失败
      if (data.details === 'manifestLoadError') {
        // 【判断跨域的核心逻辑】
        // 情况 A：状态码为 0 或 undefined (此时 httpStatus 经过上面处理后为 0)
        // 情况 B：当前页面是 https，但视频地址是 http (Mixed Content)
        const isHttps = window.location.protocol === 'https:';
        const isVideoHttp = data.url && data.url.startsWith('http:');

        if (httpStatus === 0) {
          if (isHttps && isVideoHttp) {
            errorMsg = '【安全限制】HTTPS 页面无法直接加载 HTTP 视频流，可尝试开启代理或使用 HTTPS 链接。';
          } else {
            errorMsg = '【跨域限制】视频源禁止了当前域名的访问 (CORS)，可尝试开启代理。';
          }
          errorType = 'cors';
        } else {
          errorMsg = `M3U8 清单加载失败 (状态码: ${httpStatus})`;
        }
      } else {
        errorMsg = data.details || '播放失败';
      }

      showPlayError(errorType, errorMsg, finalUrl, httpStatus);

      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
    });
  } else {
    // 普通视频播放
    nativeVideoPlayer.src = fileObject ? URL.createObjectURL(fileObject) : finalUrl;
    nativeVideoPlayer.currentTime = 0.01;
    nativeVideoPlayer.play().catch(e => {
      console.error('原生播放错误:', e);
      let isCorsError = false;
      try {
        const currentOrigin = window.location.origin;
        const targetUrl = new URL(finalUrl);
        if (currentOrigin !== targetUrl.origin) isCorsError = true;
      } catch(e) {}
      
      if (isCorsError) {
        showPlayError('cors', null, finalUrl);
      } else if (e.name === 'NotSupportedError') {
        showPlayError('format', null, finalUrl);
      } else if (e.name === 'NetworkError') {
        showPlayError('network', null, finalUrl);
      } else {
        showPlayError('unknown', e.message, finalUrl);
      }
    });
  }
  
  const savedRate = localStorage.getItem('playbackRate');
  if (savedRate) activePlayer.playbackRate = parseFloat(savedRate);
  applyVideoTransformations();
  applyVideoFilters();
}

// ==================== 播放核心 - XGPlayer ====================
function playWithXGPlayer(url, fileObject = null) {
  currentPlayingMethod = 'xgplayer';
  if (nativeVideoPlayer) nativeVideoPlayer.style.display = 'none';
  if (xgplayerContainerElement) xgplayerContainerElement.style.display = 'block';
  
  try {
    if (xgPlayerInstance) {
      xgPlayerInstance.destroy();
      xgPlayerInstance = null;
    }
    
    const savedVolume = localStorage.getItem('volumePercentage');
    const volumeValue = savedVolume ? parseInt(savedVolume) : 100;
    
    const config = {
      id: 'xgplayerContainer',
      url: url,
      playsinline: true,
      fluid: true,
      controls: false,
      autoplay: true,
      isLive: true,
      volume: volumeValue / 100,
      height: '100%',
      width: '100%'
    };
    
    const ext = getFileExtension(url);
    const isFlv = ext === 'flv' || url.includes('.flv');
    
    if (isFlv && typeof FlvPlayer !== 'undefined') {
      config.plugins = [FlvPlayer];
      config.flvConfig = {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 128,
        isLive: true,
        lazyLoad: true,
        lazyLoadMaxDuration: 180,
        lazyLoadRecoverDuration: 30
      };
    }
    
    xgPlayerInstance = new Player(config);
    activePlayer = xgPlayerInstance;
    
    // 同步音量UI
    if (volumeSlider) volumeSlider.value = Math.round(activePlayer.volume * 100);
    if (inVideoVolumeSlider) inVideoVolumeSlider.value = volumeSlider?.value || 100;
    if (volumePercentageDisplay) volumePercentageDisplay.textContent = `${volumeSlider?.value || 100}%`;
    if (inVideoVolumePercentageDisplay) inVideoVolumePercentageDisplay.textContent = `${inVideoVolumeSlider?.value || 100}%`;
    
    xgPlayerInstance.on('play', () => {
      updateStatus('playing', `正在播放 (${activePlayer.playbackRate}x)`);
      if (playPauseIcon) playPauseIcon.className = 'fas fa-pause';
      if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-pause';
      startProgressBarUpdate();
      showControls();
    });
    
    xgPlayerInstance.on('pause', () => {
      stopProgressBarUpdate();
      if (!isSeeking && !isKeyboardSeeking) {
        updateStatus('stopped', '播放已暂停');
      }
      if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
      if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
      showControls();
    });
    
    xgPlayerInstance.on('ended', () => handleVideoEnded());
    xgPlayerInstance.on('seeked', globalSeekedHandler);
    
    xgPlayerInstance.on('error', (e) => {
      console.error('XGPlayer错误:', e);
      let errorMsg = 'FLV播放失败';
      if (e && e.message) {
        if (e.message.includes('403')) {
          showPlayError('forbidden', null, url);
        } else if (e.message.includes('404')) {
          showPlayError('notfound', null, url);
        } else if (e.message.includes('CORS')) {
          showPlayError('cors', null, url);
        } else {
          errorMsg = e.message;
          showPlayError('flv_error', errorMsg, url);
        }
      } else {
        showPlayError('flv_error', null, url);
      }
    });
    
    xgPlayerInstance.on('loadeddata', () => {
      if (seekSlider) seekSlider.max = activePlayer.duration;
      if (inVideoSeekSlider) inVideoSeekSlider.max = activePlayer.duration;
      if (durationDisplay) durationDisplay.textContent = formatTime(activePlayer.duration);
      if (inVideoDurationDisplay) inVideoDurationDisplay.textContent = formatTime(activePlayer.duration);
      setTimeout(updateResolutionDisplay, 100);
    });
    
    xgPlayerInstance.on('volumechange', () => {
      const vol = activePlayer.volume;
      const percent = Math.round(vol * 100);
      if (volumeSlider) volumeSlider.value = percent;
      if (inVideoVolumeSlider) inVideoVolumeSlider.value = percent;
      if (volumePercentageDisplay) volumePercentageDisplay.textContent = `${percent}%`;
      if (inVideoVolumePercentageDisplay) inVideoVolumePercentageDisplay.textContent = `${percent}%`;
      localStorage.setItem('volumePercentage', percent);
      if (vol > 0) {
        savedVolumeBeforeMute = vol;
        localStorage.setItem('savedVolumeBeforeMute', savedVolumeBeforeMute.toString());
      }
      const iconClass = vol === 0 ? 'fas fa-volume-off' : (vol < 0.5 ? 'fas fa-volume-down' : 'fas fa-volume-up');
      if (volumeIcon) volumeIcon.className = iconClass;
      if (inVideoVolumeIcon) inVideoVolumeIcon.className = iconClass;
      if (muteButtonIcon) muteButtonIcon.className = iconClass;
    });
    
    const savedRate = localStorage.getItem('playbackRate');
    if (savedRate) activePlayer.playbackRate = parseFloat(savedRate);
    applyVideoTransformations();
    applyVideoFilters();
    
    xgPlayerInstance.play().catch(e => {
      console.error('XGPlayer自动播放失败:', e);
      if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
      if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
      updateStatus('stopped', '点击播放');
    });
  } catch(e) {
    console.error('XGPlayer初始化失败:', e);
    showPlayError('flv_error', '播放器初始化失败', url);
  }
}

// ==================== 播放核心函数 ====================
function playCore(url, fileObject = null, isLocal = false) {
  stopPlaybackInternal(true, true);
  currentVideoUrl = url;
  
  updateStatus('loading', '正在加载视频...');
  if (uploadPlaceholder) uploadPlaceholder.classList.add('hidden');
  if (videoContainerElement) videoContainerElement.classList.add('visible');
  
  // 协议检测
  const urlLower = url.toLowerCase();
  if (urlLower.startsWith('rtsp://') || urlLower.startsWith('rtmp://')) {
    showPlayError('protocol', url.split(':')[0], url);
    return;
  }
  
  const ext = getFileExtension(url);
  const isFlv = ext === 'flv' || url.includes('.flv');
  const isM3U8 = ext === 'm3u8' || url.includes('.m3u8');
  const isMkv = ext === 'mkv' || url.includes('.mkv');
  
  // 获取最终URL（代理处理）
  let finalUrl = url;
  if (useProxy && !isLocal && !url.startsWith('blob:') && !url.includes('proxy.php')) {
    finalUrl = getProxyUrl(url);
  }
  
  // XGPlayer用于FLV/MKV
  if ((isFlv || isMkv) && typeof Player !== 'undefined') {
    playWithXGPlayer(finalUrl, fileObject);
  } else {
    playWithNativePlayer(finalUrl, isM3U8, fileObject);
  }
}

// ==================== 外部播放接口 ====================
function play(url) {
  const originalUrl = url;
  
  let playUrl = originalUrl;
  if (useProxy && !originalUrl.startsWith('blob:') && !originalUrl.includes('proxy.php')) {
    playUrl = getProxyUrl(originalUrl);
  }
  
  // 查找是否已存在相同URL的记录
  const existingIdx = playbackHistory.findIndex(item => item.type === 'remote' && item.url === originalUrl);
  
  if (existingIdx !== -1) {
    // 已存在：移动到第一位
    const existingItem = playbackHistory[existingIdx];
    playbackHistory.splice(existingIdx, 1);
    existingItem.timestamp = new Date().toISOString();
    playbackHistory.unshift(existingItem);
  } else {
    // 不存在：新增到第一位
    playbackHistory.unshift({ 
      title: originalUrl, 
      url: originalUrl, 
      fileName: null, 
      type: 'remote', 
      timestamp: new Date().toISOString() 
    });
    if (playbackHistory.length > 20) playbackHistory.pop();
  }
  
  localStorage.setItem('playbackHistory', JSON.stringify(playbackHistory));
  renderHistory();
  
  currentPlayingHistoryIndex = 0; // 当前播放的是第一位
  
  const urlInput = document.getElementById('videoURL');
  if (urlInput) urlInput.value = originalUrl;
  
  playCore(playUrl, null, false, null);
}

function playLocalVideo(files) {
  const fileArray = Array.from(files);
  let firstItem = null;
  
  fileArray.forEach(file => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!supportedFormats.includes(ext)) return;
    const fileURL = URL.createObjectURL(file);
    
    // 查找是否已存在相同文件名的记录
    const existingIdx = playbackHistory.findIndex(item => item.type === 'local' && item.fileName === file.name);
    const newItem = { 
      title: `本地文件: ${file.name}`, 
      url: fileURL, 
      fileName: file.name, 
      type: 'local', 
      fileObject: file, 
      timestamp: new Date().toISOString() 
    };
    
    if (existingIdx !== -1) {
      // 已存在：移动到第一位
      playbackHistory.splice(existingIdx, 1);
      playbackHistory.unshift(newItem);
    } else {
      // 不存在：新增到第一位
      playbackHistory.unshift(newItem);
      if (playbackHistory.length > 20) playbackHistory.pop();
    }
    
    if (!firstItem) firstItem = newItem;
  });
  
  if (firstItem) {
    localStorage.setItem('playbackHistory', JSON.stringify(playbackHistory, (k,v) => k === 'fileObject' ? undefined : v));
    renderHistory();
    currentPlayingHistoryIndex = 0; // 当前播放的是第一位
    
    const urlInput = document.getElementById('videoURL');
    if (urlInput) urlInput.value = firstItem.title;
    
    playCore(firstItem.url, firstItem.fileObject, true, firstItem.fileName);
    if (fileArray.length > 1 && currentLoopMode === 'none') setLoopMode('list');
  }
}

function togglePlayPause() {
  if (activePlayer) {
    if (activePlayer.paused) {
      activePlayer.play();
    } else {
      activePlayer.pause();
    }
  } else {
    alert('请先加载视频！');
  }
}

function reloadVideo() {
  if (currentPlayingHistoryIndex !== -1 && playbackHistory[currentPlayingHistoryIndex]) {
    const item = playbackHistory[currentPlayingHistoryIndex];
    if (item.type === 'local' && !item.fileObject) {
      alert('本地视频文件已丢失，请重新选择');
      return;
    }
    playFromHistory(currentPlayingHistoryIndex);
  }
}

// ==================== 键盘事件 ====================
function setupKeyboardEvents() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.key === ' ' && activePlayer) {
      e.preventDefault();
      togglePlayPause();
    }
    
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && activePlayer) {
      e.preventDefault();
      
      if (!isKeyboardSeeking) {
        isKeyboardSeeking = true;
        wasPlayingBeforeSeek = !activePlayer.paused;
        activePlayer.pause();
        stopProgressBarUpdate();
        keyboardSeekCurrentTime = activePlayer.currentTime;
      }
      
      clearTimeout(keyboardSeekTimeout);
      const delta = e.key === 'ArrowRight' ? 5 : -5;
      keyboardSeekCurrentTime = Math.max(0, Math.min(activePlayer.duration || 0, keyboardSeekCurrentTime + delta));
      
      if (seekSlider) seekSlider.value = keyboardSeekCurrentTime;
      if (inVideoSeekSlider) inVideoSeekSlider.value = keyboardSeekCurrentTime;
      if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(keyboardSeekCurrentTime);
      if (inVideoCurrentTimeDisplay) inVideoCurrentTimeDisplay.textContent = formatTime(keyboardSeekCurrentTime);
      
      keyboardSeekTimeout = setTimeout(() => {
        if (activePlayer) {
          pendingSeekTime = keyboardSeekCurrentTime;
          activePlayer.currentTime = keyboardSeekCurrentTime;
        }
      }, 200);
    }
  });
}

// ==================== 历史记录 ====================
function renderHistory() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;
  
  if (currentlyEditingIndex !== -1) saveEditMode(currentlyEditingIndex);
  currentlyEditingIndex = -1;
  
  if (!playbackHistory || playbackHistory.length === 0) {
    historyList.innerHTML = '<div class="empty-history">暂无播放历史</div>';
    return;
  }
  
  historyList.innerHTML = '';
  playbackHistory.forEach((item, idx) => {
    const div = document.createElement('div'); 
    div.className = 'history-item'; 
    div.id = `historyItem_${idx}`;
    let format = item.type === 'local' ? '本地' : (() => {
      const ext = getFileExtension(item.url);
      if (ext) return ext.toUpperCase();
      if (item.url.includes('.m3u8') || item.url.includes('m3u8')) return 'M3U8';
      if (item.url.includes('.flv')) return 'FLV';
      return '视频';
    })();
    // 使用 window.playFromHistory 和 window.removeHistoryItem
div.innerHTML = `
  <div class="title-wrapper">
    <span class="history-title-display">${escapeHtml(item.title)}</span>
    <input type="text" class="history-title-edit" value="${escapeHtml(item.title)}" style="display:none;">
  </div>
  <div class="actions">
    <button class="btn btn-icon" onclick="window.playFromHistory(${idx})"><i class="fas fa-play"></i><span class="button-label">播放</span></button>
    <button class="btn btn-icon edit-save-btn" data-index="${idx}" data-action="edit"><i class="fas fa-edit"></i><span class="button-label">备注</span></button>
    <button class="btn btn-icon" onclick="window.removeHistoryItem(${idx})"><i class="fas fa-trash"></i><span class="button-label">删除</span></button>
    <div class="format-tag" style="margin-left: auto;">${format}</div>
  </div>
`;
    historyList.appendChild(div);
  });
}

function playFromHistory(index) {
  console.log('playFromHistory called, index:', index);
  const item = playbackHistory[index];
  if (!item) return;
  
  // 如果不是第一个，将该项移到第一位
  if (index !== 0) {
    playbackHistory.splice(index, 1);
    item.timestamp = new Date().toISOString();
    playbackHistory.unshift(item);
    localStorage.setItem('playbackHistory', JSON.stringify(playbackHistory, (k,v) => k === 'fileObject' ? undefined : v));
    renderHistory();
    currentPlayingHistoryIndex = 0;
  } else {
    currentPlayingHistoryIndex = index;
  }
  
  if (item.type === 'local' && !item.fileObject) { 
    alert('本地视频文件已丢失'); 
    return; 
  }
  
  const urlInput = document.getElementById('videoURL');
  if (urlInput) urlInput.value = item.title;
  
  let playUrl = item.url;
  if (useProxy && item.type === 'remote' && !item.url.startsWith('blob:') && !item.url.includes('proxy.php?action=')) {
    playUrl = getProxyUrl(item.url);
  }
  
  playCore(playUrl, item.fileObject || null, item.type === 'local');
}

function removeHistoryItem(index) {
  console.log('removeHistoryItem called, index:', index);  // 添加调试日志
  playbackHistory.splice(index, 1);
  localStorage.setItem('playbackHistory', JSON.stringify(playbackHistory, (k,v) => k === 'fileObject' ? undefined : v));
  renderHistory();
  if (currentPlayingHistoryIndex === index) currentPlayingHistoryIndex = -1;
  else if (currentPlayingHistoryIndex > index) currentPlayingHistoryIndex--;
}

function removeHistoryItem(index) {
  playbackHistory.splice(index, 1);
  localStorage.setItem('playbackHistory', JSON.stringify(playbackHistory, (k, v) => k === 'fileObject' ? undefined : v));
  renderHistory();
  if (currentPlayingHistoryIndex === index) {
    currentPlayingHistoryIndex = -1;
  } else if (currentPlayingHistoryIndex > index) {
    currentPlayingHistoryIndex--;
  }
}

function clearHistory() {
  if (confirm('确定要清空所有播放历史吗？')) {
    playbackHistory = [];
    localStorage.removeItem('playbackHistory');
    renderHistory();
    currentPlayingHistoryIndex = -1;
  }
}

function startEditMode(index) {
  if (currentlyEditingIndex !== -1 && currentlyEditingIndex !== index) {
    saveEditMode(currentlyEditingIndex);
  }
  
  const item = document.getElementById(`historyItem_${index}`);
  if (!item) return;
  
  const display = item.querySelector('.history-title-display');
  const input = item.querySelector('.history-title-edit');
  const btn = item.querySelector('.edit-save-btn');
  
  if (!display || !input || !btn) return;
  
  display.style.display = 'none';
  input.style.display = 'inline-block';
  input.value = display.textContent;
  input.focus();
  
  btn.dataset.action = 'save';
  const icon = btn.querySelector('i');
  const label = btn.querySelector('.button-label');
  if (icon) icon.className = 'fas fa-check';
  if (label) label.textContent = '保存';
  
  currentlyEditingIndex = index;
  
  const saveHandler = (e) => {
    if (e.key === 'Enter') saveEditMode(index);
  };
  input.addEventListener('keypress', saveHandler);
  input._saveHandler = saveHandler;
}

function saveEditMode(index) {
  if (currentlyEditingIndex !== index) return;
  
  const item = document.getElementById(`historyItem_${index}`);
  if (!item) return;
  
  const display = item.querySelector('.history-title-display');
  const input = item.querySelector('.history-title-edit');
  const btn = item.querySelector('.edit-save-btn');
  
  if (!display || !input || !btn) return;
  
  const newTitle = input.value.trim();
  if (newTitle) playbackHistory[index].title = newTitle;
  display.textContent = playbackHistory[index].title;
  
  display.style.display = 'inline-block';
  input.style.display = 'none';
  
  btn.dataset.action = 'edit';
  const icon = btn.querySelector('i');
  const label = btn.querySelector('.button-label');
  if (icon) icon.className = 'fas fa-edit';
  if (label) label.textContent = '备注';
  
  if (input._saveHandler) input.removeEventListener('keypress', input._saveHandler);
  
  localStorage.setItem('playbackHistory', JSON.stringify(playbackHistory, (k, v) => k === 'fileObject' ? undefined : v));
  currentlyEditingIndex = -1;
}

// ==================== 循环模式 ====================
function setLoopMode(mode) {
  currentLoopMode = currentLoopMode === mode ? 'none' : mode;
  localStorage.setItem('loopMode', currentLoopMode);
  updateLoopModeButtons();
  
  let message = '';
  switch(currentLoopMode) {
    case 'single': message = '已开启单曲循环'; break;
    case 'list': message = '已开启列表循环'; break;
    case 'shuffle': message = '已开启随机播放'; break;
    default: message = '已关闭循环模式';
  }
  updateStatus('stopped', message);
}

function updateLoopModeButtons() {
  document.querySelectorAll('.history-loop-controls .btn').forEach(btn => {
    if (btn.dataset.loopMode === currentLoopMode) {
      btn.classList.add('active-loop-mode');
    } else {
      btn.classList.remove('active-loop-mode');
    }
  });
}

// ==================== 视频设置UI ====================
function setupVideoSettings() {
  // 旋转
  const rotateBtn = document.getElementById('rotate90Btn');
  if (rotateBtn) {
    rotateBtn.addEventListener('click', () => {
      transformSettings.rotate = (transformSettings.rotate + 90) % 360;
      applyVideoTransformations();
      saveAllSettings();
    });
  }
  
  // 水平镜像
  const flipXBtn = document.getElementById('flipXBtn');
  if (flipXBtn) {
    flipXBtn.addEventListener('click', () => {
      transformSettings.scaleX *= -1;
      applyVideoTransformations();
      saveAllSettings();
    });
  }
  
  // 垂直镜像
  const flipYBtn = document.getElementById('flipYBtn');
  if (flipYBtn) {
    flipYBtn.addEventListener('click', () => {
      transformSettings.scaleY *= -1;
      applyVideoTransformations();
      saveAllSettings();
    });
  }
  
  // 缩放
  const zoomSlider = document.getElementById('zoomSlider');
  const zoomValue = document.getElementById('zoomValue');
  if (zoomSlider && zoomValue) {
    zoomSlider.addEventListener('input', () => {
      transformSettings.zoom = parseInt(zoomSlider.value);
      zoomValue.textContent = `${transformSettings.zoom}%`;
      applyVideoTransformations();
      saveAllSettings();
    });
  }
  
  // 重置变换
  const resetTransform = document.getElementById('resetTransformBtn');
  if (resetTransform) {
    resetTransform.addEventListener('click', () => {
      transformSettings = { rotate: 0, scaleX: 1, scaleY: 1, zoom: 100 };
      if (zoomSlider) zoomSlider.value = 100;
      if (zoomValue) zoomValue.textContent = '100%';
      applyVideoTransformations();
      saveAllSettings();
    });
  }
  
  // 滤镜
  const brightness = document.getElementById('brightnessSlider');
  const contrast = document.getElementById('contrastSlider');
  const saturation = document.getElementById('saturationSlider');
  const sharpen = document.getElementById('sharpenSlider');
  const brightnessVal = document.getElementById('brightnessValue');
  const contrastVal = document.getElementById('contrastValue');
  const saturationVal = document.getElementById('saturationValue');
  const sharpenVal = document.getElementById('sharpenValue');
  
  if (brightness && brightnessVal) {
    brightness.addEventListener('input', () => {
      filterSettings.brightness = parseInt(brightness.value);
      brightnessVal.textContent = `${filterSettings.brightness}%`;
      applyVideoFilters();
      saveAllSettings();
    });
  }
  
  if (contrast && contrastVal) {
    contrast.addEventListener('input', () => {
      filterSettings.contrast = parseInt(contrast.value);
      contrastVal.textContent = `${filterSettings.contrast}%`;
      applyVideoFilters();
      saveAllSettings();
    });
  }
  
  if (saturation && saturationVal) {
    saturation.addEventListener('input', () => {
      filterSettings.saturation = parseInt(saturation.value);
      saturationVal.textContent = `${filterSettings.saturation}%`;
      applyVideoFilters();
      saveAllSettings();
    });
  }
  
  if (sharpen && sharpenVal) {
    sharpen.addEventListener('input', () => {
      filterSettings.sharpen = parseInt(sharpen.value);
      sharpenVal.textContent = filterSettings.sharpen;
      applyVideoFilters();
      saveAllSettings();
    });
  }
  
  // 重置滤镜
  const resetFilter = document.getElementById('resetFilterBtn');
  if (resetFilter) {
    resetFilter.addEventListener('click', () => {
      filterSettings = { brightness: 100, contrast: 100, saturation: 100, sharpen: 0 };
      if (brightness) brightness.value = 100;
      if (contrast) contrast.value = 100;
      if (saturation) saturation.value = 100;
      if (sharpen) sharpen.value = 0;
      if (brightnessVal) brightnessVal.textContent = '100%';
      if (contrastVal) contrastVal.textContent = '100%';
      if (saturationVal) saturationVal.textContent = '100%';
      if (sharpenVal) sharpenVal.textContent = '0';
      applyVideoFilters();
      saveAllSettings();
    });
  }
  
  // 滤镜预设
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = filterPresets[btn.dataset.preset];
      if (preset) {
        Object.assign(filterSettings, preset);
        if (brightness) brightness.value = preset.brightness;
        if (contrast) contrast.value = preset.contrast;
        if (saturation) saturation.value = preset.saturation;
        if (sharpen) sharpen.value = preset.sharpen;
        if (brightnessVal) brightnessVal.textContent = `${preset.brightness}%`;
        if (contrastVal) contrastVal.textContent = `${preset.contrast}%`;
        if (saturationVal) saturationVal.textContent = `${preset.saturation}%`;
        if (sharpenVal) sharpenVal.textContent = preset.sharpen;
        applyVideoFilters();
        saveAllSettings();
      }
    });
  });
}

function setupBackgroundSettings() {
  const urlInput = document.getElementById('backgroundURL');
  const blurSlider = document.getElementById('backgroundBlurSlider');
  const blurValue = document.getElementById('backgroundBlurValue');
  
  if (urlInput) urlInput.value = backgroundSettings.url;
  if (blurSlider) blurSlider.value = backgroundSettings.blur;
  if (blurValue) blurValue.textContent = `${backgroundSettings.blur}px`;
  applyBackground();
  
  const applyBtn = document.getElementById('applyBackgroundBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      if (urlInput) backgroundSettings.url = urlInput.value.trim();
      applyBackground();
      saveAllSettings();
    });
  }
  
  if (blurSlider && blurValue) {
    blurSlider.addEventListener('input', () => {
      backgroundSettings.blur = parseInt(blurSlider.value);
      blurValue.textContent = `${backgroundSettings.blur}px`;
      applyBackground();
      saveAllSettings();
    });
  }
  
  const resetBtn = document.getElementById('resetBackgroundBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      backgroundSettings = { url: 'https://my.bing.xo.je/302/uhd_302.php', blur: 0 };
      if (urlInput) urlInput.value = backgroundSettings.url;
      if (blurSlider) blurSlider.value = 0;
      if (blurValue) blurValue.textContent = '0px';
      applyBackground();
      saveAllSettings();
    });
  }
}

// ==================== 速度下拉菜单 ====================
function setupSpeedDropdown() {
  const speedBtn = document.getElementById('speedBtn');
  const speedDropdown = document.getElementById('speedDropdown');
  const speedMenu = document.getElementById('speedMenu');
  
  if (speedBtn && speedMenu) {
    speedBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      speedDropdown?.classList.toggle('open');
    });
    
    speedMenu.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const speed = parseFloat(this.dataset.speed);
        if (activePlayer) {
          activePlayer.playbackRate = speed;
          speedMenu.querySelectorAll('button').forEach(b => b.classList.remove('active-speed-btn'));
          this.classList.add('active-speed-btn');
          if (!activePlayer.paused) {
            updateStatus('playing', `正在播放 (${speed}x)`);
          }
          saveAllSettings();
        }
        speedDropdown?.classList.remove('open');
      });
    });
    
    document.addEventListener('click', function() {
      speedDropdown?.classList.remove('open');
    });
  }
}

// ==================== 拖放上传 ====================
function setupDragAndDrop() {
  const area = uploadPlaceholder;
  if (!area) return;
  
  const preventDefaults = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    area.addEventListener(eventName, preventDefaults);
    document.body.addEventListener(eventName, preventDefaults);
  });
  
  area.addEventListener('dragenter', () => area.classList.add('drag-over'));
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const videoFiles = Array.from(files).filter(file => {
        return file.type.startsWith('video/') || /\.(mkv|mp4|webm|avi|mov|flv|m3u8|ts)$/i.test(file.name);
      });
      if (videoFiles.length > 0) {
        playLocalVideo(videoFiles);
      } else {
        alert('请拖放视频文件');
      }
    }
  });
  
  area.addEventListener('click', () => {
    if (!videoContainerElement.classList.contains('visible')) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'video/*,.mkv,.flv,.m3u8,.ts';
      fileInput.multiple = true;
      fileInput.onchange = (e) => {
        if (e.target.files.length > 0) playLocalVideo(e.target.files);
      };
      fileInput.click();
    }
  });
}

// ==================== 主题加载 ====================
function loadTheme() {
  const darkMode = localStorage.getItem('darkMode') === 'true';
  if (darkMode) document.body.classList.add('dark-mode');
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const icon = themeToggle.querySelector('i');
    if (icon) icon.className = darkMode ? 'fas fa-sun' : 'fas fa-moon';
  }
}

function loadAllSettings() {
  // 加载变换设置
  const savedTrans = localStorage.getItem('transformSettings');
  if (savedTrans) {
    Object.assign(transformSettings, JSON.parse(savedTrans));
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomValue = document.getElementById('zoomValue');
    if (zoomSlider) zoomSlider.value = transformSettings.zoom;
    if (zoomValue) zoomValue.textContent = `${transformSettings.zoom}%`;
    applyVideoTransformations();
  }
  
  // 加载滤镜设置
  const savedFilter = localStorage.getItem('filterSettings');
  if (savedFilter) {
    Object.assign(filterSettings, JSON.parse(savedFilter));
    const brightness = document.getElementById('brightnessSlider');
    const contrast = document.getElementById('contrastSlider');
    const saturation = document.getElementById('saturationSlider');
    const sharpen = document.getElementById('sharpenSlider');
    const brightnessVal = document.getElementById('brightnessValue');
    const contrastVal = document.getElementById('contrastValue');
    const saturationVal = document.getElementById('saturationValue');
    const sharpenVal = document.getElementById('sharpenValue');
    
    if (brightness) brightness.value = filterSettings.brightness;
    if (contrast) contrast.value = filterSettings.contrast;
    if (saturation) saturation.value = filterSettings.saturation;
    if (sharpen) sharpen.value = filterSettings.sharpen;
    if (brightnessVal) brightnessVal.textContent = `${filterSettings.brightness}%`;
    if (contrastVal) contrastVal.textContent = `${filterSettings.contrast}%`;
    if (saturationVal) saturationVal.textContent = `${filterSettings.saturation}%`;
    if (sharpenVal) sharpenVal.textContent = filterSettings.sharpen;
    applyVideoFilters();
  }
  
  // 加载背景设置
  const savedBg = localStorage.getItem('backgroundSettings');
  if (savedBg) {
    Object.assign(backgroundSettings, JSON.parse(savedBg));
    const urlInput = document.getElementById('backgroundURL');
    const blurSlider = document.getElementById('backgroundBlurSlider');
    const blurValue = document.getElementById('backgroundBlurValue');
    if (urlInput) urlInput.value = backgroundSettings.url;
    if (blurSlider) blurSlider.value = backgroundSettings.blur;
    if (blurValue) blurValue.textContent = `${backgroundSettings.blur}px`;
    applyBackground();
  }
  
  // 加载循环模式
  currentLoopMode = localStorage.getItem('loopMode') || 'none';
  updateLoopModeButtons();
  
  // 加载代理设置
  useProxy = localStorage.getItem('useProxy') === 'true';
  proxyConfig = {
    host: localStorage.getItem('proxyHost') || '',
    port: localStorage.getItem('proxyPort') || '',
    user: localStorage.getItem('proxyUser') || '',
    pass: localStorage.getItem('proxyPass') || ''
  };
  updateProxyButtonUI();
  
  // 加载历史记录
  const savedHistory = localStorage.getItem('playbackHistory');
  if (savedHistory) {
    try {
      playbackHistory = JSON.parse(savedHistory).map(item => ({ ...item, fileObject: null }));
    } catch(e) {
      playbackHistory = [];
    }
  }
  renderHistory();
}

// ==================== 面板位置 ====================
function adjustPanelTop(panel) {
  const header = document.querySelector('.header');
  if (header && panel) {
    const headerHeight = header.offsetHeight;
    const bodyPaddingTop = parseFloat(getComputedStyle(document.body).paddingTop);
    panel.style.top = `${headerHeight + bodyPaddingTop + 10}px`;
    panel.style.maxHeight = `calc(100vh - ${headerHeight + bodyPaddingTop + 20}px)`;
  }
}



// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
  // 获取DOM元素
  nativeVideoPlayer = document.getElementById('videoPlayer');
  xgplayerContainerElement = document.getElementById('xgplayerContainer');
  activePlayer = nativeVideoPlayer;
  
  playPauseBtn = document.getElementById('playPauseBtn');
  if (playPauseBtn) playPauseIcon = playPauseBtn.querySelector('i');
  
  uploadPlaceholder = document.getElementById('uploadPlaceholder');
  videoContainerElement = document.getElementById('videoContainer');
  seekSlider = document.getElementById('seekSlider');
  currentTimeDisplay = document.getElementById('currentTimeDisplay');
  durationDisplay = document.getElementById('durationDisplay');
  volumeSlider = document.getElementById('volumeSlider');
  volumeIcon = document.getElementById('volumeIcon');
  muteButtonIcon = document.getElementById('muteButtonIcon');
  volumePercentageDisplay = document.getElementById('volumePercentageDisplay');
  systemTimeDisplayElement = document.getElementById('systemTimeDisplay');
  toggleSystemTimeBtn = document.getElementById('toggleSystemTimeBtn');
  settingsPanel = document.getElementById('settingsPanel');
  historyPanel = document.getElementById('historyPanel');
  inVideoControls = document.getElementById('inVideoControls');
  inVideoPlayPauseBtn = document.getElementById('inVideoPlayPauseBtn');
  if (inVideoPlayPauseBtn) inVideoPlayPauseIcon = inVideoPlayPauseBtn.querySelector('i');
  inVideoSeekSlider = document.getElementById('inVideoSeekSlider');
  inVideoCurrentTimeDisplay = document.getElementById('inVideoCurrentTimeDisplay');
  inVideoDurationDisplay = document.getElementById('inVideoDurationDisplay');
  inVideoVolumeSlider = document.getElementById('inVideoVolumeSlider');
  inVideoVolumeIcon = document.getElementById('inVideoVolumeIcon');
  inVideoVolumePercentageDisplay = document.getElementById('inVideoVolumePercentageDisplay');
  inVideoFullscreenBtn = document.getElementById('inVideoFullscreenBtn');
  resolutionDisplay = document.getElementById('resolutionDisplay');
  // 初始隐藏分辨率和帧率
if (resolutionDisplay) resolutionDisplay.classList.add('hidden');
const fpsDisplay = document.getElementById('fpsDisplay');
if (fpsDisplay) fpsDisplay.classList.add('hidden');
  // 初始化
  loadTheme();
  setupDragAndDrop();
  setupVolumeSync();
  setupVideoSettings();
  setupBackgroundSettings();
  createSharpenSVGElements();
  loadAllSettings();
  startSystemTimeUpdate();
  loadSystemTimeVisibility();
  setupSpeedDropdown();
  setupSeekEvents();  // 进度条事件必须在播放器初始化后设置
  setupKeyboardEvents();
  
  updateStatus('stopped', '播放器已就绪');
  
  // 代理开关
  const toggleProxyBtn = document.getElementById('toggleProxyBtn');
  if (toggleProxyBtn) {
    updateProxyButtonUI();
    toggleProxyBtn.addEventListener('click', () => {
      useProxy = !useProxy;
      localStorage.setItem('useProxy', useProxy);
      updateProxyButtonUI();
      updateStatus('playing', useProxy ? '代理已开启' : '代理已关闭');
      setTimeout(() => updateStatus('stopped', '播放器已停止'), 2000);
    });
  }
  
// 代理设置面板开关 - 使用 class 控制，确保不会被覆盖
const showProxySettingsBtn = document.getElementById('showProxySettingsBtn');
const proxySettingsPanel = document.getElementById('proxySettingsPanel');

if (showProxySettingsBtn && proxySettingsPanel) {
  // 移除可能存在的旧监听器（避免重复绑定）
  const newBtn = showProxySettingsBtn.cloneNode(true);
  showProxySettingsBtn.parentNode.replaceChild(newBtn, showProxySettingsBtn);
  const freshBtn = document.getElementById('showProxySettingsBtn');
  
  freshBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    proxySettingsPanel.classList.toggle('open');
    //console.log('代理面板切换:', proxySettingsPanel.classList.contains('open')); // 调试日志
  });
}
  
  // 代理输入框
  const proxyHost = document.getElementById('proxyHost');
  const proxyPort = document.getElementById('proxyPort');
  const proxyUser = document.getElementById('proxyUser');
  const proxyPass = document.getElementById('proxyPass');
  if (proxyHost) proxyHost.value = proxyConfig.host;
  if (proxyPort) proxyPort.value = proxyConfig.port;
  if (proxyUser) proxyUser.value = proxyConfig.user;
  if (proxyPass) proxyPass.value = proxyConfig.pass;
  
  const testProxyBtn = document.getElementById('testProxyBtn');
  const saveProxyBtn = document.getElementById('saveProxyBtn');
  if (testProxyBtn) testProxyBtn.addEventListener('click', testProxyConnection);
  if (saveProxyBtn) saveProxyBtn.addEventListener('click', saveProxyConfig);
  
  // 按钮事件
  if (toggleSystemTimeBtn) toggleSystemTimeBtn.addEventListener('click', toggleSystemTimeVisibility);
  
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
  
  const stopBtn = document.getElementById('stopPlaybackBtn');
  if (stopBtn) stopBtn.addEventListener('click', stopPlayback);
  
  const loadBtn = document.getElementById('loadVideoBtn');
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const urlInput = document.getElementById('videoURL');
      const url = urlInput ? urlInput.value.trim() : '';
      if (url) play(url);
      else alert('请输入视频URL');
    });
  }
  
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
  if (inVideoPlayPauseBtn) inVideoPlayPauseBtn.addEventListener('click', togglePlayPause);
  if (inVideoFullscreenBtn) inVideoFullscreenBtn.addEventListener('click', toggleFullscreen);
  
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);
  
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
      if (settingsPanel) settingsPanel.classList.remove('open');
    });
  }
  
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
      if (historyPanel) historyPanel.classList.remove('open');
    });
  }
  
  const headerSettingsBtn = document.getElementById('headerSettingsToggleBtn');
  if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsPanel) settingsPanel.classList.toggle('open');
      if (historyPanel) historyPanel.classList.remove('open');
      adjustPanelTop(settingsPanel);
    });
  }
  
  const headerHistoryBtn = document.getElementById('headerHistoryToggleBtn');
  if (headerHistoryBtn) {
    headerHistoryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (historyPanel) historyPanel.classList.toggle('open');
      if (settingsPanel) settingsPanel.classList.remove('open');
      adjustPanelTop(historyPanel);
    });
  }
  

// 点击外部关闭面板
document.addEventListener('click', function(e) {
  if (settingsPanel && headerSettingsBtn && !settingsPanel.contains(e.target) && !headerSettingsBtn.contains(e.target)) {
    settingsPanel.classList.remove('open');
  }
  if (historyPanel && headerHistoryBtn && !historyPanel.contains(e.target) && !headerHistoryBtn.contains(e.target)) {
    historyPanel.classList.remove('open');
  }
  // 修复：使用 class 移除而不是直接设置 display
  if (proxySettingsPanel && showProxySettingsBtn && !proxySettingsPanel.contains(e.target) && !showProxySettingsBtn.contains(e.target)) {
    proxySettingsPanel.classList.remove('open');
  }
});
  
  // 主题切换
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
      const icon = themeToggle.querySelector('i');
      if (icon) {
        icon.className = document.body.classList.contains('dark-mode') ? 'fas fa-sun' : 'fas fa-moon';
      }
    });
  }
  
  // 循环模式按钮
  const loopBtns = document.querySelectorAll('.history-loop-controls .btn');
  loopBtns.forEach(btn => {
    if (btn.dataset.loopMode) {
      btn.addEventListener('click', () => setLoopMode(btn.dataset.loopMode));
    }
  });
  
  // 历史记录编辑
  const historyListEl = document.getElementById('historyList');
  if (historyListEl) {
    historyListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.edit-save-btn');
      if (btn) {
        const idx = parseInt(btn.dataset.index);
        if (btn.dataset.action === 'edit') {
          startEditMode(idx);
        } else if (btn.dataset.action === 'save' && currentlyEditingIndex === idx) {
          saveEditMode(idx);
        }
      }
    });
  }
  
  // 视频容器事件
  if (nativeVideoPlayer) nativeVideoPlayer.addEventListener('dblclick', toggleFullscreen);
  if (xgplayerContainerElement) xgplayerContainerElement.addEventListener('dblclick', toggleFullscreen);
  
  if (videoContainerElement) {
    videoContainerElement.addEventListener('click', (e) => {
      if (!e.target.closest('#inVideoControls button, #inVideoControls input')) {
        togglePlayPause();
      }
    });
    if (window.innerWidth > 768) {
      videoContainerElement.addEventListener('mousemove', showControls);
    }
  }
  
  // 全屏状态变化
  document.addEventListener('fullscreenchange', function() {
    if (document.fullscreenElement) {
      if (videoContainerElement) videoContainerElement.classList.add('fullscreen-active');
    } else {
      if (videoContainerElement) videoContainerElement.classList.remove('fullscreen-active');
    }
  });
  
  // URL参数支持
  const srcParam = new URLSearchParams(window.location.search).get('src');
  if (srcParam && srcParam.startsWith('http')) {
    setTimeout(() => play(decodeURIComponent(srcParam)), 100);
  }
});

// 暴露全局函数
window.playFromHistory = playFromHistory;
window.removeHistoryItem = removeHistoryItem;
window.clearHistory = clearHistory;
window.stopPlayback = stopPlayback;
window.toggleFullscreen = toggleFullscreen;
window.togglePlayPause = togglePlayPause;
window.changeSpeed = changeSpeed;