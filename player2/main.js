// ==================== 全局变量 ====================
let hlsInstance = null;
let xgPlayerInstance = null;
let nativeVideoPlayer = null;
let xgplayerContainerElement = null;
let activePlayer = null;
let currentPlayingMethod = 'none';
let currentVideoUrl = null;

let currentLoopMode = 'none';
let currentPlayingHistoryIndex = -1;

let isSeeking = false;
let wasPlayingBeforeSeek = false;
let pendingSeekTime = null;
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

// 播放列表相关
let playlistData = { groups: [] };
let epgData = {};
let currentSelectedChannel = null;
let programUpdateInterval = null;
let currentEpgUrl = null;  // 保存当前 EPG 地址

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
let settingsPanel, systemTimeDisplayElement, toggleSystemTimeBtn;

let waitingTimer = null;
let currentPlayingChannel = null;
// 修改全局变量，保存当前播放的频道的完整信息
let currentPlayingChannelInfo = null;  // 保存 { groupName, channelName, channelUrl }

let currentChannelUrls = [];  // 当前频道的所有线路
let currentChannelIndex = 0;  // 当前播放的线路索引
let currentChannelName = '';   // 当前频道名称
let currentCatchupConfig = null;  // 当前频道的回看配置

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



// ==================== EPG功能 ====================
// 修改 parseEpgXml 函数
function parseEpgXml(xmlText) {
  console.log('开始解析 XML，长度:', xmlText.length);
  
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    console.error('XML 解析错误:', parserError.textContent);
    return {};
  }
  
  const programmes = xmlDoc.querySelectorAll('programme');
  console.log('找到 programme 标签数量:', programmes.length);
  
  // 先建立 channel id 到 display-name 的映射
  const channels = xmlDoc.querySelectorAll('channel');
  const channelNameMap = {};
  channels.forEach(ch => {
    const id = ch.getAttribute('id');
    const displayName = ch.querySelector('display-name')?.textContent || id;
    channelNameMap[id] = displayName;
    //console.log('频道映射:', id, '->', displayName);
  });
  console.log('找到 channel 标签数量:', channels.length);
  
  const epgMap = {};
  
  programmes.forEach(prog => {
    const channelId = prog.getAttribute('channel');
    const start = prog.getAttribute('start');
    const stop = prog.getAttribute('stop');
    const title = prog.querySelector('title')?.textContent || '';
    const desc = prog.querySelector('desc')?.textContent || '';
    
    // 使用 channel id 作为 key
    if (!epgMap[channelId]) epgMap[channelId] = [];
    epgMap[channelId].push({
      start: start,
      end: stop,
      title: title,
      desc: desc
    });
    
    // 同时也用 display-name 作为 key（方便匹配）
    const displayName = channelNameMap[channelId];
    if (displayName && displayName !== channelId) {
      if (!epgMap[displayName]) epgMap[displayName] = [];
      epgMap[displayName].push({
        start: start,
        end: stop,
        title: title,
        desc: desc
      });
    }
  });
  
  // 按时间排序
  for (const channel in epgMap) {
    epgMap[channel].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  }
  
  console.log('解析完成，频道数量:', Object.keys(epgMap).length);
  console.log('可用频道示例:', Object.keys(epgMap).slice(0, 20));
  
  return epgMap;
}

// 修改 formatEpgTime 函数 - 只显示时间
function formatEpgTime(timeStr) {
  if (!timeStr) return '';
  
  // EPG 时间格式通常是: 20240101120000 (14位: YYYYMMDDHHMMSS)
  if (timeStr.length >= 14) {
    const hour = timeStr.slice(8, 10);
    const minute = timeStr.slice(10, 12);
    return `${hour}:${minute}`;
  }
  
  // 如果是 HHMM 格式（4位）
  if (timeStr.length === 4) {
    return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
  }
  
  return timeStr;
}

// 修复获取当前时间字符串的函数
function getCurrentTimeStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}${second}`;
}

// 修复获取今天日期的函数
function getTodayStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// 修复格式化 EPG 时间的函数（处理时区）
function formatEpgTimeForCompare(timeStr) {
  if (!timeStr) return '';
  // 去掉时区部分 (+0800)
  let cleanTime = timeStr.split(' ')[0];
  // 如果是 14 位格式
  if (cleanTime.length >= 14) {
    return cleanTime.slice(0, 14);
  }
  return cleanTime;
}

function displayEpgForChannel(channelName) {
  const epgChannelName = document.getElementById('epgChannelName');
  const epgPrograms = document.getElementById('epgPrograms');
  
  if (!epgChannelName || !epgPrograms) return;
  
  epgChannelName.textContent = channelName;
  
  if (!epgData || Object.keys(epgData).length === 0) {
    epgPrograms.innerHTML = '<div style="padding: 20px; text-align: center;">暂无节目单信息<br><small>请先导入包含 EPG 链接的 M3U 文件</small></div>';
    return;
  }
  
  let programs = null;
  let currentChannelMatchKeys = [];
  
  for (const group of playlistData.groups) {
    for (const channel of group.channels) {
      if (channel.name === channelName || channel.tvgName === channelName) {
        currentChannelMatchKeys = channel.matchKeys || [channel.tvgId, channel.tvgName, channel.name];
        break;
      }
    }
  }
  
  for (const key of currentChannelMatchKeys) {
    if (!key) continue;
    
    if (epgData[key]) {
      programs = epgData[key];
      break;
    }
    
    const lowerKey = key.toLowerCase();
    for (const epgKey of Object.keys(epgData)) {
      if (epgKey.toLowerCase() === lowerKey) {
        programs = epgData[epgKey];
        break;
      }
    }
    if (programs) break;
    
    const numbers = key.match(/\d+/g);
    if (numbers) {
      for (const num of numbers) {
        if (epgData[num]) {
          programs = epgData[num];
          break;
        }
      }
      if (programs) break;
    }
  }
  
  if (!programs || programs.length === 0) {
    epgPrograms.innerHTML = `<div style="padding: 20px; text-align: center;">暂无节目单信息</div>`;
    return;
  }
  
  const sortedPrograms = [...programs].sort((a, b) => {
    const aTime = formatEpgTimeForCompare(a.start);
    const bTime = formatEpgTimeForCompare(b.start);
    if (!aTime) return 1;
    if (!bTime) return -1;
    return aTime.localeCompare(bTime);
  });
  
  const todayStr = getTodayStr();
  const nowStr = getCurrentTimeStr();
  
  const todayPrograms = sortedPrograms.filter(prog => {
    if (!prog.start) return false;
    const progDate = formatEpgTimeForCompare(prog.start).slice(0, 8);
    return progDate === todayStr;
  });
  
  console.log('今日节目数量:', todayPrograms.length);
  console.log('当前时间:', nowStr);
  
  epgPrograms.innerHTML = '';
  
  let currentProgramElement = null;
  // 用于定位的参考时间：优先使用回看时间，否则使用当前时间
  let referenceTime = nowStr;
  if (window.currentCatchupTime) {
    referenceTime = formatTimestamp(window.currentCatchupTime, 'yyyyMMddHHmmss');
    console.log('使用回看时间定位:', referenceTime);
  }
  
  const meaninglessDesc = ['暂无节目描述', '暂无描述', '无描述', '暂无', '无节目详情', '节目信息暂无'];
  
  function hasValidDesc(desc) {
    if (!desc || !desc.trim()) return false;
    const trimmedDesc = desc.trim();
    for (const keyword of meaninglessDesc) {
      if (trimmedDesc === keyword || trimmedDesc.includes(keyword)) {
        return false;
      }
    }
    if (trimmedDesc.length < 5) return false;
    return true;
  }
  
  // 获取频道的回看配置和 URL
  let channelCatchupConfig = null;
  let channelUrl = null;
  
  for (const group of playlistData.groups) {
    for (const channel of group.channels) {
      if (channel.name === channelName || channel.tvgName === channelName) {
        channelUrl = channel.urls?.[0]?.url;
        if (channel.catchupSource) {
          channelCatchupConfig = {
            source: channel.catchupSource,
            type: channel.catchupType || 'append',
            days: channel.catchupDays
          };
        }
        break;
      }
    }
  }
  
  todayPrograms.forEach((prog, index) => {
    const progStart = formatEpgTimeForCompare(prog.start);
    const progEnd = formatEpgTimeForCompare(prog.end);
    
    // 判断是否为当前播放的节目（使用参考时间）
    let isCurrent = false;
    if (progStart && progStart <= referenceTime) {
      if (!progEnd || progEnd > referenceTime) {
        isCurrent = true;
      }
    }
    
    const startTime = formatEpgTime(prog.start);
    const endTime = formatEpgTime(prog.end);
    
    const div = document.createElement('div');
    div.className = 'epg-program-item';
    if (isCurrent) {
      div.style.background = 'rgba(106, 141, 255, 0.15)';
      div.style.borderLeft = '3px solid var(--primary-color)';
      currentProgramElement = div;
      console.log('定位到节目:', index, prog.title, progStart, progEnd);
    }
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'epg-title';
    titleSpan.textContent = prog.title;
    
    if (hasValidDesc(prog.desc)) {
      titleSpan.style.cursor = 'help';
      titleSpan.title = prog.desc;
      
      const detailIcon = document.createElement('i');
      detailIcon.className = 'fas fa-info-circle';
      detailIcon.style.fontSize = '11px';
      detailIcon.style.marginLeft = '6px';
      detailIcon.style.opacity = '0.6';
      titleSpan.appendChild(detailIcon);
    }
    
    div.innerHTML = `<div class="epg-time">${startTime} - ${endTime}</div>`;
    div.querySelector('.epg-time').after(titleSpan);
    
    // 添加回看按钮（仅对已结束的节目）
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'epg-actions';
    
    if (progEnd && progEnd < nowStr && channelUrl) {
      const replayBtn = document.createElement('button');
      replayBtn.className = 'epg-replay-btn';
      replayBtn.innerHTML = '<i class="fas fa-undo-alt"></i>';
      replayBtn.title = '回看此节目';
      replayBtn.onclick = async (e) => {
        e.stopPropagation();
        const startDateTime = parseEpgTimeToDate(prog.start);
        const endDateTime = parseEpgTimeToDate(prog.end);
        if (startDateTime) {
          // 传递频道信息用于高亮显示
          const channelDivInfo = {
            channelDiv: null,
            channelName: channelName,
            channelUrl: channelUrl,
            groupName: null
          };
          
          // 获取当前频道的 DOM 元素
          const channelDivs = document.querySelectorAll('.playlist-channel');
          for (const div of channelDivs) {
            const nameSpan = div.querySelector('.channel-name');
            const nameText = nameSpan ? nameSpan.childNodes[0]?.nodeValue || nameSpan.textContent : '';
            if (nameText.trim() === channelName || div.dataset.channelUrl === channelUrl) {
              channelDivInfo.channelDiv = div;
              channelDivInfo.groupName = div.dataset.groupName;
              break;
            }
          }
          
          playCatchup(channelUrl, startDateTime, endDateTime, channelCatchupConfig, channelDivInfo);
        } else {
          play(channelUrl);
        }
      };
      actionsDiv.appendChild(replayBtn);
    }
    
    div.appendChild(actionsDiv);
    epgPrograms.appendChild(div);
  });
  
  if (todayPrograms.length === 0) {
    epgPrograms.innerHTML = '<div style="padding: 20px; text-align: center;">今日暂无节目信息</div>';
  }
  
  // 滚动到定位的节目
  if (currentProgramElement) {
    setTimeout(() => {
      currentProgramElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  } else {
    console.log('未找到定位节目');
  }
}

// 修复 updateChannelsProgram 函数
function updateChannelsProgram() {
  const channelItems = document.querySelectorAll('.playlist-channel');
  
  if (!epgData || Object.keys(epgData).length === 0) {
    channelItems.forEach(item => {
      const programSpan = item.querySelector('.channel-program');
      if (programSpan) programSpan.textContent = 'EPG未加载';
    });
    return;
  }
  
  const todayStr = getTodayStr();
  const nowStr = getCurrentTimeStr();
  
  channelItems.forEach(item => {
    const channelName = item.dataset.channelName;
    if (!channelName) return;
    
    let matchKeys = [];
    
    for (const group of playlistData.groups) {
      for (const channel of group.channels) {
        if (channel.name === channelName || channel.tvgName === channelName) {
          matchKeys = channel.matchKeys || [channel.tvgId, channel.tvgName, channel.name];
          break;
        }
      }
    }
    
    let currentProgram = null;
    
    for (const key of matchKeys) {
      if (!key) continue;
      let programs = epgData[key];
      
      if (!programs) {
        const lowerKey = key.toLowerCase();
        for (const epgKey of Object.keys(epgData)) {
          if (epgKey.toLowerCase() === lowerKey) {
            programs = epgData[epgKey];
            break;
          }
        }
      }
      
      if (!programs) {
        const numbers = key.match(/\d+/g);
        if (numbers) {
          for (const num of numbers) {
            if (epgData[num]) {
              programs = epgData[num];
              break;
            }
          }
        }
      }
      
      if (programs && programs.length > 0) {
        const sortedPrograms = [...programs].sort((a, b) => {
          const aTime = formatEpgTimeForCompare(a.start);
          const bTime = formatEpgTimeForCompare(b.start);
          if (!aTime) return 1;
          if (!bTime) return -1;
          return aTime.localeCompare(bTime);
        });
        
        const todayPrograms = sortedPrograms.filter(prog => {
          if (!prog.start) return false;
          const progDate = formatEpgTimeForCompare(prog.start).slice(0, 8);
          return progDate === todayStr;
        });
        
        for (const prog of todayPrograms) {
          const progStart = formatEpgTimeForCompare(prog.start);
          const progEnd = formatEpgTimeForCompare(prog.end);
          if (progStart && progStart <= nowStr) {
            if (!progEnd || progEnd > nowStr) {
              currentProgram = prog;
              break;
            }
          }
        }
        
        if (currentProgram) break;
      }
    }
    
    const programSpan = item.querySelector('.channel-program');
    if (programSpan) {
      if (currentProgram && currentProgram.title) {
        programSpan.textContent = currentProgram.title;
      } else {
        programSpan.textContent = '暂无节目信息';
      }
    }
  });
}

async function loadEpgWithProxy(epgUrl) {
  const epgStatus = document.getElementById('epgStatus');
  if (epgStatus) {
    epgStatus.textContent = '正在加载EPG...';
    epgStatus.style.color = 'var(--warning-color)';
  }
  
  try {
    const proxyUrl = `${proxyPhpUrl}?action=epg&url=${encodeURIComponent(epgUrl)}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const xmlText = await response.text();
    if (!xmlText || xmlText.trim().length === 0) throw new Error('返回内容为空');
    
    const trimmed = xmlText.trim();
    if (trimmed.substring(0, 5) !== '<?xml' && trimmed.substring(0, 3) !== '<tv') {
      throw new Error('返回内容不是有效的 XML 格式');
    }
    
    epgData = parseEpgXml(xmlText);
    
    if (epgStatus) {
      epgStatus.textContent = `EPG加载成功！共 ${Object.keys(epgData).length} 个频道`;
      epgStatus.style.color = 'var(--success-color)';
    }
    
    localStorage.setItem('epgUrl', epgUrl);
    currentEpgUrl = epgUrl;
    
    if (currentSelectedChannel) displayEpgForChannel(currentSelectedChannel);
    updateChannelsProgram();
    
    setTimeout(() => {
      if (epgStatus && epgStatus.textContent.includes('成功')) epgStatus.textContent = '';
    }, 3000);
  } catch (e) {
    console.error('EPG加载失败:', e);
    if (epgStatus) {
      epgStatus.textContent = `EPG加载失败: ${e.message}`;
      epgStatus.style.color = 'var(--danger-color)';
    }
  }
}

// ==================== 播放列表功能 ====================
// 新增：解析 M3U 行，提取 URL 和标签
function parseChannelUrl(urlLine) {
  // 格式: http://xxx.m3u8$1080 或 http://xxx.m3u8
  const parts = urlLine.split('$');
  const url = parts[0];
  const label = parts[1] || '';
  return { url, label };
}

// 新增：合并相同频道的多个线路
function mergeChannels(groups) {
  const mergedGroups = [];
  
  for (const group of groups) {
    const channelMap = new Map();  // key: channel id 或 name
    
    for (const channel of group.channels) {
      const key = channel.tvgId || channel.name;
      
      if (channelMap.has(key)) {
        // 已存在，添加线路
        const existing = channelMap.get(key);
        const { url, label } = parseChannelUrl(channel.url);
        existing.urls.push({ url, label: label || `线路${existing.urls.length + 1}` });
        // 保留第一个有效的 logo
        if (!existing.logo && channel.logo) existing.logo = channel.logo;
      } else {
        // 新频道
        const { url, label } = parseChannelUrl(channel.url);
        channelMap.set(key, {
          ...channel,
          urls: [{ url, label: label || '线路1' }],
          url: undefined  // 移除单 url
        });
      }
    }
    
    // 转换回数组
    const mergedChannels = Array.from(channelMap.values());
    mergedGroups.push({
      name: group.name,
      collapsed: group.collapsed,
      channels: mergedChannels
    });
  }
  
  return mergedGroups;
}

function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const groups = {};
  let currentGroup = '默认分组';
  let currentChannel = null;
  let epgUrl = null;
  
  // 全局 catchup 配置（从 #EXTM3U 行获取）
  let globalCatchupType = null;
  let globalCatchupSource = null;
  
  // 先解析第一行获取全局配置
  const firstLine = lines[0] || '';
  if (firstLine.includes('#EXTM3U')) {
    const catchupMatch = firstLine.match(/catchup="([^"]*)"/);
    if (catchupMatch) globalCatchupType = catchupMatch[1];
    
    const sourceMatch = firstLine.match(/catchup-source="([^"]*)"/);
    if (sourceMatch) globalCatchupSource = sourceMatch[1];
    
    const epgMatch = firstLine.match(/x-tvg-url="([^"]*)"/);
    if (epgMatch) {
      epgUrl = epgMatch[1];
      currentEpgUrl = epgUrl;
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (line.includes('group-title=')) {
      const groupMatch = line.match(/group-title="([^"]*)"/);
      if (groupMatch) currentGroup = groupMatch[1];
    }
    
    if (line.startsWith('#EXTINF:')) {
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      const nameMatch = line.match(/,\s*(.+)$/);
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      
      // 解析频道自己的回看配置
      let catchupType = null;
      let catchupSource = null;
      let catchupDays = null;
      
      const catchupMatch = line.match(/catchup="([^"]*)"/);
      if (catchupMatch) catchupType = catchupMatch[1];
      
      const sourceMatch = line.match(/catchup-source="([^"]*)"/);
      if (sourceMatch) catchupSource = sourceMatch[1];
      
      const daysMatch = line.match(/catchup-days="([^"]*)"/);
      if (daysMatch) catchupDays = parseInt(daysMatch[1]);
      
      const logo = logoMatch ? logoMatch[1] : '';
      const tvgName = tvgNameMatch ? tvgNameMatch[1] : '';
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';
      const displayName = nameMatch ? nameMatch[1] : tvgName;
      
      if (!groups[currentGroup]) groups[currentGroup] = [];
      
      currentChannel = {
        name: displayName,
        logo: logo,
        url: '',
        tvgName: tvgName,
        tvgId: tvgId,
        matchKeys: [tvgId, tvgName, displayName].filter(k => k && k.length > 0),
        catchupType: catchupType || globalCatchupType,
        catchupSource: catchupSource || globalCatchupSource,
        catchupDays: catchupDays
      };
      continue;
    }
    
    if (currentChannel && (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('/'))) {
      currentChannel.url = line;
      groups[currentGroup].push({ ...currentChannel });
      currentChannel = null;
    }
  }
  
  const result = [];
  for (const [name, channels] of Object.entries(groups)) {
    if (channels.length > 0) {
      result.push({ name, channels, collapsed: true });
    }
  }
  
  if (epgUrl) {
    setTimeout(() => loadEpgWithProxy(epgUrl), 500);
  }
  
  const mergedResult = mergeChannels(result);
  return mergedResult;
}

function importM3U() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.m3u,.m3u8';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      const groups = parseM3U(content);
      
      if (groups.length > 0) {
        playlistData.groups = groups;
        localStorage.setItem('playlistData', JSON.stringify(playlistData));
        renderPlaylist();
        updateStatus('playing', `成功导入 ${groups.reduce((sum, g) => sum + g.channels.length, 0)} 个频道`);
      } else {
        alert('未解析到有效频道');
      }
    };
    reader.readAsText(file, 'UTF-8');
  };
  input.click();
}

function renderPlaylist() {
  const container = document.getElementById('playlistGroups');
  if (!container) return;
  
  if (!playlistData.groups || playlistData.groups.length === 0) {
    container.innerHTML = '<div class="empty-history">暂无播放列表，请导入 M3U 文件</div>';
    return;
  }
  
  container.innerHTML = '';
  
  playlistData.groups.forEach((group, groupIdx) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'playlist-group';
    groupDiv.dataset.groupName = group.name;
    
    const header = document.createElement('div');
    header.className = `playlist-group-header ${group.collapsed ? 'collapsed' : ''}`;
    header.innerHTML = `
      <i class="fas fa-chevron-down"></i>
      <span>${escapeHtml(group.name)}</span>
      <span style="margin-left: auto; font-size: 12px; opacity: 0.7;">${group.channels.length}个频道</span>
    `;
    header.onclick = (e) => {
  e.stopPropagation();
  group.collapsed = !group.collapsed;
  renderPlaylist();
  // 页面加载后，让焦点离开所有按钮
setTimeout(() => {
  // 如果有焦点在按钮上，移除它
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
    document.activeElement.blur();
  }
  // 让视频容器获得焦点（或者 body）
  if (videoContainerElement) {
    videoContainerElement.setAttribute('tabindex', '-1');
    videoContainerElement.focus();
  } else {
    document.body.focus();
  }
}, 100);
};
    groupDiv.appendChild(header);
    
    if (!group.collapsed) {
      const channelsDiv = document.createElement('div');
      channelsDiv.className = 'playlist-channels';
      
      group.channels.forEach((channel, chIdx) => {
        const currentProgram = getCurrentProgramFromEpg(channel);
        const channelDiv = document.createElement('div');
        channelDiv.className = 'playlist-channel';
        channelDiv.dataset.channelName = channel.tvgName || channel.name;
        channelDiv.dataset.channelUrl = channel.urls?.[0]?.url || '';
        channelDiv.dataset.groupName = group.name;
        
        // 检查是否需要高亮
        const isPlaying = currentPlayingChannelInfo && 
          ((currentPlayingChannelInfo.channelUrl === channel.urls?.[0]?.url) ||
           (currentPlayingChannelInfo.channelName === (channel.tvgName || channel.name)));
        
        if (isPlaying) {
          channelDiv.classList.add('playing-channel');
          if (currentPlayingChannelInfo) {
            currentPlayingChannelInfo.channelDiv = channelDiv;
          }
        }
        
        // 显示线路数量
        const lineCount = channel.urls ? channel.urls.length : 1;
        const lineBadge = lineCount > 1 ? `<span class="line-badge">${lineCount}</span>` : '';
        
        channelDiv.onclick = (e) => {
          e.stopPropagation();
          if (!e.target.closest('.channel-play-btn')) {
            currentSelectedChannel = channel.tvgName || channel.name;
            displayEpgForChannel(currentSelectedChannel);
            document.querySelector('.tab-btn[data-tab="epg"]').click();
          }
        };
        
        const img = document.createElement('img');
        img.className = 'channel-logo';
        img.alt = '';
        if (channel.logo && (channel.logo.startsWith('http://') || channel.logo.startsWith('https://'))) {
          img.src = channel.logo;
        } else {
          img.style.visibility = 'hidden';
          img.style.opacity = '0';
        }
        img.onerror = function() {
          this.style.visibility = 'hidden';
          this.style.opacity = '0';
        };
        
        channelDiv.appendChild(img);
        
        const channelInfo = document.createElement('div');
        channelInfo.className = 'channel-info';
        channelInfo.innerHTML = `
          <div class="channel-name">${escapeHtml(channel.name)} ${lineBadge}</div>
          <div class="channel-program">${currentProgram ? escapeHtml(currentProgram.title) : '暂无节目信息'}</div>
        `;
        channelDiv.appendChild(channelInfo);
        
            // 保存回看配置到 channelDiv 的 dataset
  if (channel.catchupSource) {
    channelDiv.dataset.catchupSource = channel.catchupSource;
    channelDiv.dataset.catchupType = channel.catchupType || '';
    channelDiv.dataset.catchupDays = channel.catchupDays || '';
  }
  
        const playBtn = document.createElement('button');
        playBtn.className = 'channel-play-btn';
        playBtn.onclick = (e) => {
  e.stopPropagation();
  
  // 清除之前的高亮
  clearCurrentPlayingChannel();
  
  // 保存当前频道的所有线路
  currentChannelUrls = channel.urls || [{ url: channel.url, label: '线路1' }];
  currentChannelIndex = 0;
  currentChannelName = channel.tvgName || channel.name;
  
  // 播放并传递频道信息
  play(currentChannelUrls[0].url, {
    channelDiv: channelDiv,
    channelName: channel.tvgName || channel.name,
    channelUrl: currentChannelUrls[0].url,
    groupName: group.name
  });
  

  // 更新线路选择器
  setTimeout(updateLineSelector, 100);
};
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
        channelDiv.appendChild(playBtn);
        
        channelsDiv.appendChild(channelDiv);
      });
      
      groupDiv.appendChild(channelsDiv);
    }
    
    container.appendChild(groupDiv);
  });
  
  setTimeout(applyPendingHighlight, 50);
}

// 修复 getCurrentProgramFromEpg 函数
function getCurrentProgramFromEpg(channel) {
  if (!epgData || Object.keys(epgData).length === 0) return null;
  
  const todayStr = getTodayStr();
  const nowStr = getCurrentTimeStr();
  const matchKeys = channel.matchKeys || [channel.tvgId, channel.tvgName, channel.name];
  
  for (const key of matchKeys) {
    if (!key) continue;
    let programs = epgData[key];
    
    if (!programs) {
      const lowerKey = key.toLowerCase();
      for (const epgKey of Object.keys(epgData)) {
        if (epgKey.toLowerCase() === lowerKey) {
          programs = epgData[epgKey];
          break;
        }
      }
    }
    
    if (!programs) {
      const numbers = key.match(/\d+/g);
      if (numbers) {
        for (const num of numbers) {
          if (epgData[num]) {
            programs = epgData[num];
            break;
          }
        }
      }
    }
    
    if (programs && programs.length > 0) {
      // 按开始时间排序
      const sortedPrograms = [...programs].sort((a, b) => {
        const aTime = formatEpgTimeForCompare(a.start);
        const bTime = formatEpgTimeForCompare(b.start);
        if (!aTime) return 1;
        if (!bTime) return -1;
        return aTime.localeCompare(bTime);
      });
      
      // 只查找今天的节目
      const todayPrograms = sortedPrograms.filter(prog => {
        if (!prog.start) return false;
        const progDate = formatEpgTimeForCompare(prog.start).slice(0, 8);
        return progDate === todayStr;
      });
      
      // 查找当前节目
      for (const prog of todayPrograms) {
        const progStart = formatEpgTimeForCompare(prog.start);
        const progEnd = formatEpgTimeForCompare(prog.end);
        if (progStart && progStart <= nowStr) {
          if (!progEnd || progEnd > nowStr) {
            return prog;
          }
        }
      }
      
      // 如果没有当前节目，返回今天第一个未来的节目
      for (const prog of todayPrograms) {
        const progStart = formatEpgTimeForCompare(prog.start);
        if (progStart && progStart > nowStr) {
          return prog;
        }
      }
    }
  }
  return null;
}

function clearPlaylist() {
  if (confirm('确定清空所有播放列表吗？')) {
    playlistData.groups = [];
    localStorage.removeItem('playlistData');
    renderPlaylist();
  }
}

function loadPlaylist() {
  const saved = localStorage.getItem('playlistData');
  if (saved) {
    try {
      playlistData = JSON.parse(saved);
      renderPlaylist();
    } catch(e) {}
  }
  const savedEpgUrl = localStorage.getItem('epgUrl');
  if (savedEpgUrl && !currentEpgUrl) {
    setTimeout(() => loadEpgWithProxy(savedEpgUrl), 1000);
  }
}

function startProgramUpdate() {
  if (programUpdateInterval) clearInterval(programUpdateInterval);
  programUpdateInterval = setInterval(() => {
    updateChannelsProgram();
    if (currentSelectedChannel) displayEpgForChannel(currentSelectedChannel);
  }, 60000);
}

function initPlaylist() {
  loadPlaylist();
  startProgramUpdate();
  
  const headerPlaylistToggleBtn = document.getElementById('headerPlaylistToggleBtn');
  const playlistPanel = document.getElementById('playlistPanel');
  const closePlaylistBtn = document.getElementById('closePlaylistBtn');
  
  if (headerPlaylistToggleBtn && playlistPanel) {
    headerPlaylistToggleBtn.addEventListener('click', () => {
      playlistPanel.classList.toggle('open');
    });
  }
  if (closePlaylistBtn && playlistPanel) {
    closePlaylistBtn.addEventListener('click', () => {
      playlistPanel.classList.remove('open');
    });
  }
  
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabs = {
    channels: document.getElementById('channelsTab'),
    epg: document.getElementById('epgTab')
  };
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.keys(tabs).forEach(id => {
        if (tabs[id]) tabs[id].style.display = id === tabId ? 'block' : 'none';
      });
    });
  });
  
  const importBtn = document.getElementById('importM3uBtn');
  const clearBtn = document.getElementById('clearPlaylistBtn');
  if (importBtn) importBtn.addEventListener('click', importM3U);
  if (clearBtn) clearBtn.addEventListener('click', clearPlaylist);
  
  const refreshEpgBtn = document.getElementById('refreshEpgBtn');
  if (refreshEpgBtn) {
    refreshEpgBtn.addEventListener('click', async () => {
      if (!currentEpgUrl) {
        alert('当前播放列表中没有检测到 EPG 地址\n\n请确保导入的 M3U 文件包含 x-tvg-url 属性');
        return;
      }
      const btn = refreshEpgBtn;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> 刷新中...';
      btn.disabled = true;
      await loadEpgWithProxy(currentEpgUrl);
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    });
  }
}

// 新增线路切换相关函数
function updateLineSelector() {
  const lineSelector = document.getElementById('lineSelector');
  const lineInfo = document.getElementById('lineInfo');
  const prevLineBtn = document.getElementById('prevLineBtn');
  const nextLineBtn = document.getElementById('nextLineBtn');
  
  if (!lineSelector) return;
  
  if (currentChannelUrls.length > 1) {
    lineSelector.style.display = 'flex';
    const currentLabel = currentChannelUrls[currentChannelIndex].label || `线路${currentChannelIndex + 1}`;
    lineInfo.textContent = `${currentLabel} (${currentChannelIndex + 1}/${currentChannelUrls.length})`;
  } else {
    lineSelector.style.display = 'none';
  }
}

function switchToLine(index) {
  if (index < 0) index = currentChannelUrls.length - 1;
  if (index >= currentChannelUrls.length) index = 0;
  if (index === currentChannelIndex) return;
  
  currentChannelIndex = index;
  const newUrl = currentChannelUrls[currentChannelIndex].url;
  const currentTime = activePlayer ? activePlayer.currentTime : 0;
  const wasPlaying = activePlayer && !activePlayer.paused;
  
  // 切换线路
  playCore(newUrl, null, false);
  
  // 尝试恢复播放位置
  if (activePlayer && wasPlaying) {
    activePlayer.addEventListener('loadedmetadata', function onLoaded() {
      if (currentTime > 0 && currentTime < activePlayer.duration) {
        activePlayer.currentTime = currentTime;
      }
      activePlayer.play();
      activePlayer.removeEventListener('loadedmetadata', onLoaded);
    }, { once: true });
  }
  
  updateLineSelector();
  
  // 更新当前播放频道信息中的 URL
  if (currentPlayingChannelInfo) {
    currentPlayingChannelInfo.channelUrl = newUrl;
  }
}

// 在 DOMContentLoaded 中添加线路切换按钮事件
function initLineSelector() {
  const prevLineBtn = document.getElementById('prevLineBtn');
  const nextLineBtn = document.getElementById('nextLineBtn');
  
  if (prevLineBtn) {
    prevLineBtn.addEventListener('click', () => {
      if (currentChannelUrls.length > 0) {
        switchToLine(currentChannelIndex - 1);
      }
    });
  }
  
  if (nextLineBtn) {
    nextLineBtn.addEventListener('click', () => {
      if (currentChannelUrls.length > 0) {
        switchToLine(currentChannelIndex + 1);
      }
    });
  }
}

// ==================== 分辨率显示 ====================
function updateResolutionDisplay() {
  if (!resolutionDisplay) return;
  
  if (activePlayer && activePlayer.videoWidth && activePlayer.videoHeight) {
    resolutionDisplay.textContent = `${activePlayer.videoWidth}×${activePlayer.videoHeight}`;
    resolutionDisplay.classList.remove('hidden');
    
    let frameRate = null;
    let bitrateMbps = null;
    
    if (hlsInstance && hlsInstance.levels && hlsInstance.levels.length > 0) {
      let currentLevelIndex = hlsInstance.currentLevel;
      if (currentLevelIndex === -1 && hlsInstance.levels.length > 0) currentLevelIndex = 0;
      
      if (currentLevelIndex !== -1 && hlsInstance.levels[currentLevelIndex]) {
        const level = hlsInstance.levels[currentLevelIndex];
        if (level.frameRate) frameRate = level.frameRate;
        if (level.bitrate && level.bitrate > 0) bitrateMbps = (level.bitrate / 1000000).toFixed(1);
      }
    }
    
    const fpsDisplay = document.getElementById('fpsDisplay');
    if (fpsDisplay) {
      let displayText = '';
      if (frameRate) displayText = `${Number.isInteger(frameRate) ? Math.round(frameRate) : frameRate.toFixed(1)}P`;
      if (bitrateMbps) displayText += displayText ? `/${bitrateMbps}M` : `${bitrateMbps}M`;
      
      if (displayText) {
        fpsDisplay.textContent = displayText;
        fpsDisplay.classList.remove('hidden');
      } else {
        fpsDisplay.textContent = '';
        fpsDisplay.classList.add('hidden');
      }
    }
    
    if (inVideoControls && inVideoControls.classList.contains('controls-visible')) {
      resolutionDisplay.classList.remove('hidden');
      if (fpsDisplay && fpsDisplay.textContent) fpsDisplay.classList.remove('hidden');
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
          host: document.getElementById('proxyHost').value,
          port: parseInt(document.getElementById('proxyPort').value),
          user: document.getElementById('proxyUser').value,
          pass: document.getElementById('proxyPass').value
        }
      })
    });
    const result = await response.json();
    if (result.success) {
      updateStatus('playing', result.ip ? `✓ 代理测试成功！出口IP: ${result.ip}` : '✓ 代理测试成功！');
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
  if (originalUrl.startsWith('blob:') || originalUrl.startsWith('data:') || originalUrl.includes('proxy.php')) return originalUrl;
  
  let proxyUrl = `${proxyPhpUrl}?action=stream&url=${encodeURIComponent(originalUrl)}`;
  if (proxyConfig.host && proxyConfig.port) proxyUrl += `&proxy_host=${proxyConfig.host}&proxy_port=${proxyConfig.port}`;
  if (proxyConfig.user) proxyUrl += `&proxy_user=${encodeURIComponent(proxyConfig.user)}`;
  if (proxyConfig.pass) proxyUrl += `&proxy_pass=${encodeURIComponent(proxyConfig.pass)}`;
  return proxyUrl;
}

// ==================== 画面变换与滤镜 ====================
function applyVideoTransformations() {
  const transform = `rotate(${transformSettings.rotate}deg) scaleX(${transformSettings.scaleX}) scaleY(${transformSettings.scaleY}) scale(${transformSettings.zoom / 100})`;
  if (nativeVideoPlayer && currentPlayingMethod !== 'xgplayer') nativeVideoPlayer.style.transform = transform;
  if (xgPlayerInstance && xgPlayerInstance.video && currentPlayingMethod === 'xgplayer') xgPlayerInstance.video.style.transform = transform;
}

function applyVideoFilters() {
  let filter = `brightness(${filterSettings.brightness}%) contrast(${filterSettings.contrast}%) saturate(${filterSettings.saturation}%)`;
  if (filterSettings.sharpen > 0) filter += ` url(#sharpen-filter-${filterSettings.sharpen})`;
  if (nativeVideoPlayer && currentPlayingMethod !== 'xgplayer') nativeVideoPlayer.style.filter = filter;
  if (xgPlayerInstance && xgPlayerInstance.video && currentPlayingMethod === 'xgplayer') xgPlayerInstance.video.style.filter = filter;
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
  updateResolutionDisplay();
  
  if (resolutionDisplay && resolutionDisplay.textContent && resolutionDisplay.textContent.trim() !== '') resolutionDisplay.classList.remove('hidden');
  
  const fpsDisplay = document.getElementById('fpsDisplay');
  if (fpsDisplay && fpsDisplay.textContent && fpsDisplay.textContent.trim() !== '') fpsDisplay.classList.remove('hidden');
  
  clearTimeout(controlsHideTimeout);
  const shouldAutoHide = window.innerWidth > 768 || (activePlayer && !activePlayer.paused);
  if (shouldAutoHide) controlsHideTimeout = setTimeout(() => hideControls(), 3000);
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
      case 403: case 401: errorMessage = `视频地址拒绝访问 (HTTP ${httpStatus})，可能是防盗链`; break;
      case 404: errorMessage = `视频地址不存在 (HTTP ${httpStatus})`; break;
      case 500: case 502: case 503: errorMessage = `服务器错误 (HTTP ${httpStatus})，请稍后重试`; break;
      default: errorMessage = httpStatus >= 400 && httpStatus < 500 ? `客户端错误 (HTTP ${httpStatus})` : `HTTP ${httpStatus} 错误`;
    }
  } else {
    switch(errorType) {
      case 'protocol': errorMessage = `${details}协议不被浏览器支持`; break;
      case 'network': errorMessage = '网络连接失败，请检查网络'; break;
      case 'cors': errorMessage = useProxy ? '跨域访问被阻止，代理可能未正确配置' : '【跨域限制】视频源禁止了当前域名的访问 (CORS)，可尝试开启代理。'; break;
      case 'decode': errorMessage = '视频解码失败，格式可能不兼容'; break;
      case 'format': errorMessage = details || '视频格式不支持'; break;
      default: errorMessage = details || '播放失败';
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
    if (activePlayer.src && activePlayer.src.startsWith('blob:')) URL.revokeObjectURL(activePlayer.src);
    if (currentPlayingMethod !== 'xgplayer') {
      activePlayer.removeAttribute('src');
      activePlayer.load();
    }
  }
  
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  if (xgPlayerInstance) { try { xgPlayerInstance.destroy(); } catch(e) {} xgPlayerInstance = null; }
  
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

// 修改 stopPlayback 函数，清除高亮
function stopPlayback() {
  stopPlaybackInternal(false, true);
  clearCurrentPlayingChannel();
  // 清除线路信息
  currentChannelUrls = [];
  currentChannelIndex = 0;
  // 清除回看时间
  window.currentCatchupTime = null;
  const lineSelector = document.getElementById('lineSelector');
  if (lineSelector) lineSelector.style.display = 'none';
}

// ==================== 视频结束处理 ====================
function handleVideoEnded() {
  stopProgressBarUpdate();
  updateStatus('stopped', '播放已结束');
  if (currentLoopMode === 'single' && activePlayer) {
    activePlayer.currentTime = 0;
    activePlayer.play();
    updateStatus('playing', '单曲循环中...');
  }
}

function globalSeekedHandler() {
  if (activePlayer) {
    if (wasPlayingBeforeSeek) {
      activePlayer.play().catch(e => console.error('播放失败:', e));
      wasPlayingBeforeSeek = false;
    }
    isSeeking = false;
    isKeyboardSeeking = false;
    pendingSeekTime = null;
    startProgressBarUpdate();
  }
}

// ==================== 进度条事件 ====================
function setupSeekEvents() {
  const syncSliders = (time) => {
    if (seekSlider) seekSlider.value = time;
    if (inVideoSeekSlider) inVideoSeekSlider.value = time;
    if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(time);
    if (inVideoCurrentTimeDisplay) inVideoCurrentTimeDisplay.textContent = formatTime(time);
  };

  const handleSeekStart = function() {
    isSeeking = true;
    if (activePlayer) {
      wasPlayingBeforeSeek = !activePlayer.paused;
      activePlayer.pause();
      stopProgressBarUpdate();
    }
  };

  const handleSeekEnd = function() {
    if (activePlayer && isSeeking) {
      pendingSeekTime = parseFloat(this.value);
      activePlayer.currentTime = pendingSeekTime;
    }
  };

  const handleSeekInput = function() { syncSliders(parseFloat(this.value)); };

  if (seekSlider) {
    seekSlider.addEventListener('mousedown', handleSeekStart);
    seekSlider.addEventListener('mouseup', handleSeekEnd);
    seekSlider.addEventListener('input', handleSeekInput);
    seekSlider.addEventListener('change', handleSeekEnd);
    seekSlider.addEventListener('touchstart', handleSeekStart, { passive: true });
    seekSlider.addEventListener('touchend', handleSeekEnd, { passive: true });
  }

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
    document.querySelectorAll('#speedBtnGroup .btn, #speedMenu button').forEach(btn => btn.classList.remove('active-speed-btn'));
    if (buttonElement) buttonElement.classList.add('active-speed-btn');
    if (!activePlayer.paused) updateStatus('playing', `正在播放 (${speed}x)`);
    saveAllSettings();
  }
}

// ==================== 全屏 ====================
function isMobileDevice() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }

function toggleFullscreen() {
  if (!videoContainerElement) return;
  
  if (document.fullscreenElement) {
    document.exitFullscreen();
    videoContainerElement.classList.remove('fullscreen-active');
    if (isMobileDevice() && screen.orientation?.unlock) screen.orientation.unlock();
  } else {
    videoContainerElement.requestFullscreen();
    videoContainerElement.classList.add('fullscreen-active');
    if (isMobileDevice() && screen.orientation?.lock) screen.orientation.lock('landscape').catch(e => console.warn(e));
  }
}

// ==================== 播放核心 ====================
function playWithNativePlayer(url, isM3U8, fileObject = null) {
  currentPlayingMethod = 'native';
  if (nativeVideoPlayer) nativeVideoPlayer.style.display = 'block';
  if (xgplayerContainerElement) xgplayerContainerElement.style.display = 'none';
  activePlayer = nativeVideoPlayer;
  
  const savedVolume = localStorage.getItem('volumePercentage');
  const volumeValue = savedVolume ? parseInt(savedVolume) : 100;
  activePlayer.volume = volumeValue / 100;
  if (activePlayer.volume > 0) savedVolumeBeforeMute = activePlayer.volume;
  
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  
  if (url.indexOf('rtmp://') === 0 || url.indexOf('rtsp://') === 0) {
    showPlayError('protocol', url.split(':')[0], url);
    return;
  }
  
  let finalUrl = url;
  if (useProxy && !fileObject && !url.startsWith('blob:') && !url.includes('proxy.php')) finalUrl = getProxyUrl(url);
  
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
    if (!isSeeking && !isKeyboardSeeking) updateStatus('stopped', '播放已暂停');
    if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
    if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
    showControls();
  };
  
  const handleWaiting = () => {
    if (!isSeeking && !isKeyboardSeeking && activePlayer && !activePlayer.paused) {
      updateStatus('loading', '缓冲中...');
      if (waitingTimer) clearTimeout(waitingTimer);
      waitingTimer = setTimeout(() => {
        if (activePlayer && !activePlayer.paused && activePlayer.currentTime > 0) updateStatus('playing', `正在播放 (${activePlayer.playbackRate}x)`);
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
  
  nativeVideoPlayer.addEventListener('play', handlePlay);
  nativeVideoPlayer.addEventListener('pause', handlePause);
  nativeVideoPlayer.addEventListener('waiting', handleWaiting);
  nativeVideoPlayer.addEventListener('loadedmetadata', handleLoadedMetadata);
  nativeVideoPlayer.addEventListener('resize', handleResize);
  nativeVideoPlayer.addEventListener('ended', handleEnded);
  nativeVideoPlayer.addEventListener('seeked', globalSeekedHandler);
  
  nativeVideoPlayer._handlers = { handlePlay, handlePause, handleWaiting, handleLoadedMetadata, handleResize, handleEnded };
  
  if (isM3U8 && Hls.isSupported()) {
    currentPlayingMethod = 'hls';
    hlsInstance = new Hls({ startFragPrefetch: true, maxBufferLength: 60, maxMaxBufferLength: 120, minBufferLength: 15, debug: false });
    hlsInstance.loadSource(finalUrl);
    hlsInstance.attachMedia(nativeVideoPlayer);
    
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      nativeVideoPlayer.currentTime = 0.01;
      nativeVideoPlayer.play().catch(e => { console.log('HLS自动播放被阻止:', e); updateStatus('stopped', '点击播放按钮开始播放'); });
    });
    
    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      let httpStatus = 0;
      if (data.response?.code) httpStatus = data.response.code;
      else if (data.xhr?.status) httpStatus = data.xhr.status;
      
      if (!data.fatal) return;
      
      let errorMsg = '', errorType = 'hls_error';
      if (data.details === 'manifestLoadError' && httpStatus === 0) {
        errorMsg = window.location.protocol === 'https:' && data.url?.startsWith('http:') ? '【安全限制】HTTPS 页面无法直接加载 HTTP 视频流，可尝试开启代理或使用 HTTPS 链接。' : '【跨域限制】视频源禁止了当前域名的访问 (CORS)，可尝试开启代理。';
        errorType = 'cors';
      } else errorMsg = data.details || '播放失败';
      
      showPlayError(errorType, errorMsg, finalUrl, httpStatus);
      if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    });
  } else {
    nativeVideoPlayer.src = fileObject ? URL.createObjectURL(fileObject) : finalUrl;
    nativeVideoPlayer.currentTime = 0.01;
    nativeVideoPlayer.play().catch(e => {
      let isCorsError = false;
      try { if (window.location.origin !== new URL(finalUrl).origin) isCorsError = true; } catch(e) {}
      if (isCorsError) showPlayError('cors', null, finalUrl);
      else if (e.name === 'NotSupportedError') showPlayError('format', null, finalUrl);
      else if (e.name === 'NetworkError') showPlayError('network', null, finalUrl);
      else showPlayError('unknown', e.message, finalUrl);
    });
  }
  
  const savedRate = localStorage.getItem('playbackRate');
  if (savedRate) activePlayer.playbackRate = parseFloat(savedRate);
  applyVideoTransformations();
  applyVideoFilters();
}

function playWithXGPlayer(url, fileObject = null) {
  currentPlayingMethod = 'xgplayer';
  if (nativeVideoPlayer) nativeVideoPlayer.style.display = 'none';
  if (xgplayerContainerElement) xgplayerContainerElement.style.display = 'block';
  
  try {
    if (xgPlayerInstance) { xgPlayerInstance.destroy(); xgPlayerInstance = null; }
    
    const savedVolume = localStorage.getItem('volumePercentage');
    const volumeValue = savedVolume ? parseInt(savedVolume) : 100;
    
    const config = {
      id: 'xgplayerContainer', url: url, playsinline: true, fluid: true,
      controls: false, autoplay: true, isLive: true, volume: volumeValue / 100,
      height: '100%', width: '100%'
    };
    
    const ext = getFileExtension(url);
    const isFlv = ext === 'flv' || url.includes('.flv');
    
    if (isFlv && typeof FlvPlayer !== 'undefined') {
      config.plugins = [FlvPlayer];
      config.flvConfig = { enableWorker: true, enableStashBuffer: true, stashInitialSize: 128, isLive: true, lazyLoad: true, lazyLoadMaxDuration: 180, lazyLoadRecoverDuration: 30 };
    }
    
    xgPlayerInstance = new Player(config);
    activePlayer = xgPlayerInstance;
    
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
      if (!isSeeking && !isKeyboardSeeking) updateStatus('stopped', '播放已暂停');
      if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
      if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
      showControls();
    });
    
    xgPlayerInstance.on('ended', () => handleVideoEnded());
    xgPlayerInstance.on('seeked', globalSeekedHandler);
    xgPlayerInstance.on('error', (e) => showPlayError('flv_error', e?.message || 'FLV播放失败', url));
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
      if (vol > 0) { savedVolumeBeforeMute = vol; localStorage.setItem('savedVolumeBeforeMute', savedVolumeBeforeMute.toString()); }
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
      if (playPauseIcon) playPauseIcon.className = 'fas fa-play';
      if (inVideoPlayPauseIcon) inVideoPlayPauseIcon.className = 'fas fa-play';
      updateStatus('stopped', '点击播放');
    });
  } catch(e) { showPlayError('flv_error', '播放器初始化失败', url); }
}

function playCore(url, fileObject = null, isLocal = false) {
  stopPlaybackInternal(true, true);
  currentVideoUrl = url;
  
  updateStatus('loading', '正在加载视频...');
  if (uploadPlaceholder) uploadPlaceholder.classList.add('hidden');
  if (videoContainerElement) videoContainerElement.classList.add('visible');
  
  const urlLower = url.toLowerCase();
  if (urlLower.startsWith('rtsp://') || urlLower.startsWith('rtmp://')) {
    showPlayError('protocol', url.split(':')[0], url);
    return;
  }
  
  const ext = getFileExtension(url);
  const isFlv = ext === 'flv' || url.includes('.flv');
  const isM3U8 = ext === 'm3u8' || url.includes('.m3u8');
  const isMkv = ext === 'mkv' || url.includes('.mkv');
  
  let finalUrl = url;
  if (useProxy && !isLocal && !url.startsWith('blob:') && !url.includes('proxy.php')) finalUrl = getProxyUrl(url);
  
  if ((isFlv || isMkv) && typeof Player !== 'undefined') playWithXGPlayer(finalUrl, fileObject);
  else playWithNativePlayer(finalUrl, isM3U8, fileObject);
}

function play(url, channelInfo = null) {
  const originalUrl = url;
  
  // 如果不是通过频道列表播放，清空线路信息和高亮
  if (!channelInfo) {
    currentChannelUrls = [];
    currentChannelIndex = 0;
    currentPlayingChannelInfo = null;
    const lineSelector = document.getElementById('lineSelector');
    if (lineSelector) lineSelector.style.display = 'none';
    // 清除所有频道的高亮
    document.querySelectorAll('.playlist-channel').forEach(ch => {
      ch.classList.remove('playing-channel');
    });
  }
  
  let playUrl = originalUrl;
  if (useProxy && !originalUrl.startsWith('blob:') && !originalUrl.includes('proxy.php')) {
    playUrl = getProxyUrl(originalUrl);
  }
  
  const urlInput = document.getElementById('videoURL');
  if (urlInput) urlInput.value = originalUrl;
  
  playCore(playUrl, null, false);
  
  if (channelInfo && channelInfo.channelDiv) {
    setCurrentPlayingChannel(channelInfo.channelDiv, channelInfo.channelName, channelInfo.channelUrl, channelInfo.groupName);
  } else if (channelInfo && channelInfo.channelName) {
    // 如果没有 channelDiv，通过名称查找
    const channelDivs = document.querySelectorAll('.playlist-channel');
    for (const div of channelDivs) {
      const nameSpan = div.querySelector('.channel-name');
      const nameText = nameSpan ? nameSpan.childNodes[0]?.nodeValue || nameSpan.textContent : '';
      if (nameText.trim() === channelInfo.channelName) {
        setCurrentPlayingChannel(div, channelInfo.channelName, channelInfo.channelUrl, channelInfo.groupName);
        break;
      }
    }
  }
}

function setCurrentPlayingChannel(channelDiv, channelName, channelUrl, groupName) {
  // 清除之前的高亮
  clearCurrentPlayingChannel();
  
  currentPlayingChannelInfo = {
    channelDiv: channelDiv,
    channelName: channelName,
    channelUrl: channelUrl,
    groupName: groupName
  };
  
  if (channelDiv) {
    channelDiv.classList.add('playing-channel');
  }
}

// 修改 clearCurrentPlayingChannel 函数
function clearCurrentPlayingChannel() {
  // 清除 DOM 上的高亮
  if (currentPlayingChannelInfo && currentPlayingChannelInfo.channelDiv) {
    currentPlayingChannelInfo.channelDiv.classList.remove('playing-channel');
  }
  // 同时清除所有可能残留的高亮
  document.querySelectorAll('.playlist-channel.playing-channel').forEach(ch => {
    ch.classList.remove('playing-channel');
  });
  currentPlayingChannelInfo = null;
}

// 新增：重新渲染后恢复当前播放频道的高亮
function restorePlayingChannelHighlight() {
  if (!currentPlayingChannelInfo) return;
  
  const { groupName, channelName, channelUrl } = currentPlayingChannelInfo;
  
  // 重新查找对应的频道元素
  for (const group of playlistData.groups) {
    if (group.name === groupName) {
      for (const channel of group.channels) {
        if (channel.name === channelName || channel.url === channelUrl) {
          // 重新渲染时，channelDiv 会被重新创建，无法直接使用
          // 保存需要高亮的频道标识
          currentPlayingChannelInfo.pendingHighlight = { groupName, channelName, channelUrl };
          break;
        }
      }
      break;
    }
  }
}

// 新增：在 renderPlaylist 完成后恢复高亮
// 正确的 applyPendingHighlight 函数（只有这一个）
function applyPendingHighlight() {
  if (!currentPlayingChannelInfo) return;
  
  const { channelName, channelUrl } = currentPlayingChannelInfo;
  
  const channelDivs = document.querySelectorAll('.playlist-channel');
  for (const div of channelDivs) {
    const nameSpan = div.querySelector('.channel-name');
    const nameText = nameSpan ? nameSpan.childNodes[0]?.nodeValue || nameSpan.textContent : '';
    if (nameText.trim() === channelName || div.dataset.channelUrl === channelUrl) {
      div.classList.add('playing-channel');
      currentPlayingChannelInfo.channelDiv = div;
      break;
    }
  }
}

function playLocalVideo(files) {
  const fileArray = Array.from(files);
  let firstItem = null;
  
  fileArray.forEach(file => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!supportedFormats.includes(ext)) return;
    const fileURL = URL.createObjectURL(file);
    if (!firstItem) firstItem = { title: `本地文件: ${file.name}`, url: fileURL, fileObject: file };
  });
  
  if (firstItem) {
    const urlInput = document.getElementById('videoURL');
    if (urlInput) urlInput.value = firstItem.title;
    playCore(firstItem.url, firstItem.fileObject, true);
  }
}

function togglePlayPause() {
  if (activePlayer) activePlayer.paused ? activePlayer.play() : activePlayer.pause();
  else alert('请先加载视频！');
}

// ==================== 键盘事件 ====================
function setupKeyboardEvents() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ' && activePlayer) { e.preventDefault(); togglePlayPause(); }
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
      keyboardSeekTimeout = setTimeout(() => { if (activePlayer) activePlayer.currentTime = keyboardSeekCurrentTime; }, 200);
    }
  });
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
    if (btn.dataset.loopMode === currentLoopMode) btn.classList.add('active-loop-mode');
    else btn.classList.remove('active-loop-mode');
  });
}

// ==================== 视频设置UI ====================
function setupVideoSettings() {
  const rotateBtn = document.getElementById('rotate90Btn');
  if (rotateBtn) rotateBtn.addEventListener('click', () => { transformSettings.rotate = (transformSettings.rotate + 90) % 360; applyVideoTransformations(); saveAllSettings(); });
  
  const flipXBtn = document.getElementById('flipXBtn');
  if (flipXBtn) flipXBtn.addEventListener('click', () => { transformSettings.scaleX *= -1; applyVideoTransformations(); saveAllSettings(); });
  
  const flipYBtn = document.getElementById('flipYBtn');
  if (flipYBtn) flipYBtn.addEventListener('click', () => { transformSettings.scaleY *= -1; applyVideoTransformations(); saveAllSettings(); });
  
  const zoomSlider = document.getElementById('zoomSlider');
  const zoomValue = document.getElementById('zoomValue');
  if (zoomSlider && zoomValue) {
    zoomSlider.addEventListener('input', () => { transformSettings.zoom = parseInt(zoomSlider.value); zoomValue.textContent = `${transformSettings.zoom}%`; applyVideoTransformations(); saveAllSettings(); });
  }
  
  const resetTransform = document.getElementById('resetTransformBtn');
  if (resetTransform) resetTransform.addEventListener('click', () => {
    transformSettings = { rotate: 0, scaleX: 1, scaleY: 1, zoom: 100 };
    if (zoomSlider) zoomSlider.value = 100;
    if (zoomValue) zoomValue.textContent = '100%';
    applyVideoTransformations();
    saveAllSettings();
  });
  
  const brightness = document.getElementById('brightnessSlider');
  const contrast = document.getElementById('contrastSlider');
  const saturation = document.getElementById('saturationSlider');
  const sharpen = document.getElementById('sharpenSlider');
  const brightnessVal = document.getElementById('brightnessValue');
  const contrastVal = document.getElementById('contrastValue');
  const saturationVal = document.getElementById('saturationValue');
  const sharpenVal = document.getElementById('sharpenValue');
  
  if (brightness && brightnessVal) brightness.addEventListener('input', () => { filterSettings.brightness = parseInt(brightness.value); brightnessVal.textContent = `${filterSettings.brightness}%`; applyVideoFilters(); saveAllSettings(); });
  if (contrast && contrastVal) contrast.addEventListener('input', () => { filterSettings.contrast = parseInt(contrast.value); contrastVal.textContent = `${filterSettings.contrast}%`; applyVideoFilters(); saveAllSettings(); });
  if (saturation && saturationVal) saturation.addEventListener('input', () => { filterSettings.saturation = parseInt(saturation.value); saturationVal.textContent = `${filterSettings.saturation}%`; applyVideoFilters(); saveAllSettings(); });
  if (sharpen && sharpenVal) sharpen.addEventListener('input', () => { filterSettings.sharpen = parseInt(sharpen.value); sharpenVal.textContent = filterSettings.sharpen; applyVideoFilters(); saveAllSettings(); });
  
  const resetFilter = document.getElementById('resetFilterBtn');
  if (resetFilter) resetFilter.addEventListener('click', () => {
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
  if (applyBtn) applyBtn.addEventListener('click', () => { if (urlInput) backgroundSettings.url = urlInput.value.trim(); applyBackground(); saveAllSettings(); });
  
  if (blurSlider && blurValue) blurSlider.addEventListener('input', () => { backgroundSettings.blur = parseInt(blurSlider.value); blurValue.textContent = `${backgroundSettings.blur}px`; applyBackground(); saveAllSettings(); });
  
  const resetBtn = document.getElementById('resetBackgroundBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    backgroundSettings = { url: 'https://my.bing.xo.je/302/uhd_302.php', blur: 0 };
    if (urlInput) urlInput.value = backgroundSettings.url;
    if (blurSlider) blurSlider.value = 0;
    if (blurValue) blurValue.textContent = '0px';
    applyBackground();
    saveAllSettings();
  });
}

function setupSpeedDropdown() {
  const speedBtn = document.getElementById('speedBtn');
  const speedDropdown = document.getElementById('speedDropdown');
  const speedMenu = document.getElementById('speedMenu');
  
  if (speedBtn && speedMenu) {
    speedBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); speedDropdown?.classList.toggle('open'); });
    speedMenu.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const speed = parseFloat(this.dataset.speed);
        if (activePlayer) {
          activePlayer.playbackRate = speed;
          speedMenu.querySelectorAll('button').forEach(b => b.classList.remove('active-speed-btn'));
          this.classList.add('active-speed-btn');
          if (!activePlayer.paused) updateStatus('playing', `正在播放 (${speed}x)`);
          saveAllSettings();
        }
        speedDropdown?.classList.remove('open');
      });
    });
    document.addEventListener('click', () => speedDropdown?.classList.remove('open'));
  }
}

function setupDragAndDrop() {
  const area = uploadPlaceholder;
  if (!area) return;
  
  const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };
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
      const videoFiles = Array.from(files).filter(file => file.type.startsWith('video/') || /\.(mkv|mp4|webm|avi|mov|flv|m3u8|ts)$/i.test(file.name));
      if (videoFiles.length > 0) playLocalVideo(videoFiles);
      else alert('请拖放视频文件');
    }
  });
  area.addEventListener('click', () => {
    if (!videoContainerElement.classList.contains('visible')) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'video/*,.mkv,.flv,.m3u8,.ts';
      fileInput.multiple = true;
      fileInput.onchange = (e) => { if (e.target.files.length > 0) playLocalVideo(e.target.files); };
      fileInput.click();
    }
  });
}

function loadTheme() {
  const darkMode = localStorage.getItem('darkMode') === 'true';
  if (darkMode) document.body.classList.add('dark-mode');
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.querySelector('i').className = darkMode ? 'fas fa-sun' : 'fas fa-moon';
}

function loadAllSettings() {
  const savedTrans = localStorage.getItem('transformSettings');
  if (savedTrans) {
    Object.assign(transformSettings, JSON.parse(savedTrans));
    const zoomSlider = document.getElementById('zoomSlider');
    if (zoomSlider) zoomSlider.value = transformSettings.zoom;
    applyVideoTransformations();
  }
  
  const savedFilter = localStorage.getItem('filterSettings');
  if (savedFilter) {
    Object.assign(filterSettings, JSON.parse(savedFilter));
    const brightness = document.getElementById('brightnessSlider');
    const contrast = document.getElementById('contrastSlider');
    const saturation = document.getElementById('saturationSlider');
    const sharpen = document.getElementById('sharpenSlider');
    if (brightness) brightness.value = filterSettings.brightness;
    if (contrast) contrast.value = filterSettings.contrast;
    if (saturation) saturation.value = filterSettings.saturation;
    if (sharpen) sharpen.value = filterSettings.sharpen;
    applyVideoFilters();
  }
  
  const savedBg = localStorage.getItem('backgroundSettings');
  if (savedBg) {
    Object.assign(backgroundSettings, JSON.parse(savedBg));
    const urlInput = document.getElementById('backgroundURL');
    const blurSlider = document.getElementById('backgroundBlurSlider');
    if (urlInput) urlInput.value = backgroundSettings.url;
    if (blurSlider) blurSlider.value = backgroundSettings.blur;
    applyBackground();
  }
  
  currentLoopMode = localStorage.getItem('loopMode') || 'none';
  updateLoopModeButtons();
  
  useProxy = localStorage.getItem('useProxy') === 'true';
  proxyConfig = {
    host: localStorage.getItem('proxyHost') || '',
    port: localStorage.getItem('proxyPort') || '',
    user: localStorage.getItem('proxyUser') || '',
    pass: localStorage.getItem('proxyPass') || ''
  };
  updateProxyButtonUI();
}

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
  
  if (resolutionDisplay) resolutionDisplay.classList.add('hidden');
  const fpsDisplayElem = document.getElementById('fpsDisplay');
  if (fpsDisplayElem) fpsDisplayElem.classList.add('hidden');
  
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
  setupSeekEvents();
  setupKeyboardEvents();
  initPlaylist();
  initLineSelector();
  
  updateStatus('stopped', '播放器已就绪');
  
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
  
  const showProxySettingsBtn = document.getElementById('showProxySettingsBtn');
  const proxySettingsPanel = document.getElementById('proxySettingsPanel');
  
  if (showProxySettingsBtn && proxySettingsPanel) {
    const newBtn = showProxySettingsBtn.cloneNode(true);
    showProxySettingsBtn.parentNode.replaceChild(newBtn, showProxySettingsBtn);
    const freshBtn = document.getElementById('showProxySettingsBtn');
    freshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      proxySettingsPanel.classList.toggle('open');
    });
  }
  
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
  
  if (toggleSystemTimeBtn) toggleSystemTimeBtn.addEventListener('click', toggleSystemTimeVisibility);
  
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
  
  const stopBtn = document.getElementById('stopPlaybackBtn');
  if (stopBtn) stopBtn.addEventListener('click', stopPlayback);
  
// 在 DOMContentLoaded 中找到 loadBtn 的事件
const loadBtn = document.getElementById('loadVideoBtn');
if (loadBtn) {
  loadBtn.addEventListener('click', () => {
    const urlInput = document.getElementById('videoURL');
    const url = urlInput ? urlInput.value.trim() : '';
    if (url) {
      // 清除播放列表高亮
      clearCurrentPlayingChannel();
      play(url);
    } else {
      alert('请输入视频URL');
    }
  });
}
  
  if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);
  if (inVideoPlayPauseBtn) inVideoPlayPauseBtn.addEventListener('click', togglePlayPause);
  if (inVideoFullscreenBtn) inVideoFullscreenBtn.addEventListener('click', toggleFullscreen);
  
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => { if (settingsPanel) settingsPanel.classList.remove('open'); });
  
  const headerSettingsBtn = document.getElementById('headerSettingsToggleBtn');
  if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (settingsPanel) settingsPanel.classList.toggle('open');
      adjustPanelTop(settingsPanel);
    });
  }
  
document.addEventListener('click', function(e) {
  // 设置抽屉关闭
  if (settingsPanel && headerSettingsBtn && !settingsPanel.contains(e.target) && !headerSettingsBtn.contains(e.target)) {
    settingsPanel.classList.remove('open');
  }
  
  // 代理设置面板关闭
  if (proxySettingsPanel && showProxySettingsBtn && !proxySettingsPanel.contains(e.target) && !showProxySettingsBtn.contains(e.target)) {
    proxySettingsPanel.classList.remove('open');
  }
  
  // 播放列表抽屉关闭（新增）
  const playlistPanel = document.getElementById('playlistPanel');
  const headerPlaylistToggleBtn = document.getElementById('headerPlaylistToggleBtn');
  if (playlistPanel && headerPlaylistToggleBtn && !playlistPanel.contains(e.target) && !headerPlaylistToggleBtn.contains(e.target)) {
    playlistPanel.classList.remove('open');
  }
});
  
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
      themeToggle.querySelector('i').className = document.body.classList.contains('dark-mode') ? 'fas fa-sun' : 'fas fa-moon';
    });
  }
  
  const loopBtns = document.querySelectorAll('.history-loop-controls .btn');
  loopBtns.forEach(btn => { if (btn.dataset.loopMode) btn.addEventListener('click', () => setLoopMode(btn.dataset.loopMode)); });
  
  if (nativeVideoPlayer) nativeVideoPlayer.addEventListener('dblclick', toggleFullscreen);
  if (xgplayerContainerElement) xgplayerContainerElement.addEventListener('dblclick', toggleFullscreen);
  
  if (videoContainerElement) {
    videoContainerElement.addEventListener('click', (e) => { if (!e.target.closest('#inVideoControls button, #inVideoControls input')) togglePlayPause(); });
    if (window.innerWidth > 768) videoContainerElement.addEventListener('mousemove', showControls);
  }
  
  document.addEventListener('fullscreenchange', function() {
    if (document.fullscreenElement) videoContainerElement.classList.add('fullscreen-active');
    else videoContainerElement.classList.remove('fullscreen-active');
  });
  
  const srcParam = new URLSearchParams(window.location.search).get('src');
  if (srcParam && srcParam.startsWith('http')) setTimeout(() => play(decodeURIComponent(srcParam)), 100);
});

// ==================== 回看功能 ====================

// 解析 EPG 时间为 Date 对象
function parseEpgTimeToDate(timeStr) {
  if (!timeStr) return null;
  // 去掉时区部分 (+0800)
  let cleanTime = timeStr.split(' ')[0];
  if (cleanTime.length >= 14) {
    const year = parseInt(cleanTime.slice(0, 4));
    const month = parseInt(cleanTime.slice(4, 6)) - 1;
    const day = parseInt(cleanTime.slice(6, 8));
    const hour = parseInt(cleanTime.slice(8, 10));
    const minute = parseInt(cleanTime.slice(10, 12));
    const second = parseInt(cleanTime.slice(12, 14));
    return new Date(year, month, day, hour, minute, second);
  }
  return null;
}

// 格式化时间戳为指定格式
function formatTimestamp(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  
  return format
    .replace('yyyy', year)
    .replace('MM', month)
    .replace('dd', day)
    .replace('HH', hour)
    .replace('mm', minute)
    .replace('ss', second);
}

// 生成回看 URL
function generateCatchupUrl(originalUrl, startTime, endTime, catchupConfig) {
  let url = originalUrl;
  
  // 1. 如果有 catchup-source 模板，使用模板替换
  if (catchupConfig && catchupConfig.source) {
    let template = catchupConfig.source;
    
    // 10位时间戳 (Unix timestamp in seconds)
    const start10 = Math.floor(startTime.getTime() / 1000);
    const end10 = Math.floor(endTime.getTime() / 1000);
    
    console.log('回看时间戳 - 开始:', start10, '结束:', end10);
    
    // 标准格式: ${(b)10} 和 ${(e)10}
    template = template.replace(/\$\{\(b\)10\}/g, start10);
    template = template.replace(/\$\{\(e\)10\}/g, end10);
    
    // 开始时间占位符
    template = template.replace(/\$\{start\}/g, start10);
    template = template.replace(/\$\{starttime\}/g, start10);
    template = template.replace(/\$\{\(b\)\}/g, startTime.getTime());
    template = template.replace(/\$\{\(b\)yyyyMMddHHmmss\}/g, formatTimestamp(startTime, 'yyyyMMddHHmmss'));
    template = template.replace(/\$\{\(b\)yyyyMMddHHmm\}/g, formatTimestamp(startTime, 'yyyyMMddHHmm'));
    template = template.replace(/\$\{\(b\)HHmmss\}/g, formatTimestamp(startTime, 'HHmmss'));
    template = template.replace(/\$\{\(b\)HHmm\}/g, formatTimestamp(startTime, 'HHmm'));
    
    // 结束时间占位符
    template = template.replace(/\$\{end\}/g, end10);
    template = template.replace(/\$\{endtime\}/g, end10);
    template = template.replace(/\$\{timestamp\}/g, end10);  // timestamp 通常是结束时间
    template = template.replace(/\$\{\(e\)\}/g, endTime.getTime());
    template = template.replace(/\$\{\(e\)yyyyMMddHHmmss\}/g, formatTimestamp(endTime, 'yyyyMMddHHmmss'));
    template = template.replace(/\$\{\(e\)yyyyMMddHHmm\}/g, formatTimestamp(endTime, 'yyyyMMddHHmm'));
    template = template.replace(/\$\{\(e\)HHmmss\}/g, formatTimestamp(endTime, 'HHmmss'));
    template = template.replace(/\$\{\(e\)HHmm\}/g, formatTimestamp(endTime, 'HHmm'));
    
    // 根据 catchup 类型决定是追加还是替换
    if (catchupConfig.type === 'append') {
      // append: 在原 URL 后追加参数
      let finalTemplate = template;
      const separator = url.includes('?') ? '&' : '?';
      
      // 如果模板已经以 ? 或 & 开头，需要处理
      if (finalTemplate.startsWith('?')) {
        finalTemplate = finalTemplate.substring(1);
      }
      if (finalTemplate.startsWith('&')) {
        finalTemplate = finalTemplate.substring(1);
      }
      
      const resultUrl = url + separator + finalTemplate;
      console.log('回看 URL (append):', resultUrl);
      return resultUrl;
    } else {
      // 直接返回模板作为完整 URL
      console.log('回看 URL (replace):', template);
      return template;
    }
  }
  
  // 2. 检查是否是 PLTV 源
  if (url.includes('/PLTV/')) {
    url = url.replace('/PLTV/', '/TVOD/');
    const startStr = formatTimestamp(startTime, 'yyyyMMddHHmmss');
    const endStr = formatTimestamp(endTime, 'yyyyMMddHHmmss');
    url += (url.includes('?') ? '&' : '?') + `playseek=${startStr}-${endStr}`;
    console.log('回看 URL (PLTV):', url);
    return url;
  }
  
  // 3. 默认：在原 URL 后追加 starttime/endtime 参数（使用10位时间戳）
  const start10 = Math.floor(startTime.getTime() / 1000);
  const end10 = Math.floor(endTime.getTime() / 1000);
  const separator = url.includes('?') ? '&' : '?';
  url = url + separator + `starttime=${start10}&endtime=${end10}`;
  console.log('回看 URL (默认):', url);
  
  return url;
}

// 回看播放函数
function playCatchup(url, startTime, endTime, catchupConfig, channelInfo = null) {
  const catchupUrl = generateCatchupUrl(url, startTime, endTime, catchupConfig);
  console.log('回看 URL:', catchupUrl);
  
  // 保存回看信息，用于节目单定位
  window.currentCatchupTime = startTime;
  
  // 播放并传递频道信息（用于高亮）
  play(catchupUrl, channelInfo);
}

window.play = play;
window.stopPlayback = stopPlayback;
window.toggleFullscreen = toggleFullscreen;
window.togglePlayPause = togglePlayPause;
window.changeSpeed = changeSpeed;