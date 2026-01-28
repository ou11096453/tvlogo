<?php
/**
 * SOCKS5代理测试API（增强版）
 * 支持：SOCKS5代理（可选） + 直播源测试 + 自定义 User-Agent + 批量测试 + 强制IPv4 + 跳转链追踪 + Referer支持
 */

// 设置响应头
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// 处理预检请求
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 只接受POST请求
if ($_SERVER['REQUEST_METHOD'] != 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => '只支持POST请求']);
    exit;
}

// 获取请求体
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    echo json_encode(['success' => false, 'error' => '无效的JSON数据']);
    exit;
}

$testType = $data['test_type'] ?? '';
$response = [];

// 自定义 User-Agent 和 Referer（可能为空）
$customUA = $data['user_agent'] ?? '';
$referer = $data['referer'] ?? '';
$timeout = $data['timeout'] ?? 8;

try {
    switch ($testType) {
        case 'test_proxy':
            $response = testSocks5Proxy($data);
            break;

        case 'batch_test_m3u8_via_proxy':
            $response = batchTestM3U8ViaProxy($data, $customUA, $referer, $timeout);
            break;

        default:
            $response = ['success' => false, 'error' => '未知的测试类型'];
            break;
    }
} catch (Exception $e) {
    $response = ['success' => false, 'error' => $e->getMessage()];
}

echo json_encode($response);


/**
 * SOCKS5代理连通性测试
 */
function testSocks5Proxy($data) {
    $proxyHost = $data['proxy_host'] ?? '';
    $proxyPort = $data['proxy_port'] ?? 1080;
    $proxyUsername = $data['proxy_username'] ?? '';
    $proxyPassword = $data['proxy_password'] ?? '';

    if (!$proxyHost || !$proxyPort) {
        return ['success' => false, 'error' => '代理主机和端口不能为空'];
    }

    $startTime = microtime(true);

    $socket = @fsockopen($proxyHost, $proxyPort, $errno, $errstr, 10);

    if (!$socket) {
        return [
            'success' => false,
            'error' => "无法连接到代理服务器: $errstr ($errno)",
            'response_time' => round((microtime(true) - $startTime) * 1000, 2)
        ];
    }

    stream_set_timeout($socket, 5);

    fwrite($socket, "\x05\x01\x00");
    $response = fread($socket, 2);

    if ($response !== "\x05\x00") {
        fclose($socket);
        return ['success' => false, 'error' => 'SOCKS5握手失败'];
    }

    // 如果需要鉴权
    if (!empty($proxyUsername)) {
        fwrite($socket, "\x05" . chr(strlen($proxyUsername)) . $proxyUsername . chr(strlen($proxyPassword)) . $proxyPassword);
        $authResponse = fread($socket, 2);
        if ($authResponse !== "\x05\x00") {
            fclose($socket);
            return ['success' => false, 'error' => 'SOCKS5身份验证失败'];
        }
    }

    fclose($socket);

    return [
        'success' => true,
        'protocol' => 'SOCKS5',
        'response_time' => round((microtime(true) - $startTime) * 1000, 2)
    ];
}

/**
 * 批量测试M3U8（支持代理和直连模式）- 修复版
 */
function batchTestM3U8ViaProxy($data, $customUA = '', $referer = '', $timeout = 8) {
    $urlsText = $data['urls'] ?? '';
    $proxyHost = $data['proxy_host'] ?? '';
    $proxyPort = $data['proxy_port'] ?? 1080;
    $proxyUsername = $data['proxy_username'] ?? '';
    $proxyPassword = $data['proxy_password'] ?? '';
    $forceIPv4 = $data['force_ipv4'] ?? false;
    $hosts = $data['hosts'] ?? [];

    if (!$urlsText) return ['success' => false, 'error' => 'URL列表不能为空'];
    
    // 解析URL列表（一行一个）
    $urls = explode("\n", trim($urlsText));
    $urls = array_map('trim', $urls);
    $urls = array_filter($urls); // 移除空行
    
    if (empty($urls)) {
        return ['success' => false, 'error' => '没有有效的URL'];
    }

    // 解析hosts映射
    $hostsMap = [];
    if (!empty($hosts)) {
        foreach ($hosts as $hostEntry) {
            if (isset($hostEntry['hostname']) && isset($hostEntry['ip'])) {
                $hostname = $hostEntry['hostname'];
                $ip = $hostEntry['ip'];
                $hostsMap[$hostname] = $ip;
            }
        }
    }

    $results = [];
    $successCount = 0;
    $failedCount = 0;
    $validM3U8Count = 0;

    foreach ($urls as $index => $url) {
        $urlNumber = $index + 1;
        $totalUrls = count($urls);
        
        // 检查URL是否为空
        if (empty($url)) {
            $results[] = [
                'url' => $url,
                'success' => false,
                'error' => 'URL为空',
                'status_code' => 0,
                'is_m3u8' => false,
                'm3u8_valid' => false,
                'redirect_chain' => []
            ];
            $failedCount++;
            continue;
        }

        $startTime = microtime(true);
        
        // 执行请求（支持重定向）
        $requestResult = executeRequestWithHosts(
            $url,
            $hostsMap,
            $timeout,
            $proxyHost,
            $proxyPort,
            $proxyUsername,
            $proxyPassword,
            $forceIPv4,
            $customUA,
            $referer
        );

        $httpCode = $requestResult['status_code'];
        $contentType = $requestResult['content_type'] ?? '';
        $error = $requestResult['error'] ?? null;
        $responseTime = $requestResult['response_time'] ?? 0;
        $redirectChain = $requestResult['redirect_chain'] ?? [];
        $effectiveUrl = $requestResult['effective_url'] ?? $url;
        $responseBody = $requestResult['body'] ?? '';
        $hostsApplied = $requestResult['hosts_applied'] ?? [];
        $headers = $requestResult['headers'] ?? [];

        // 检查是否是状态码200
        if ($httpCode !== 200) {
            $results[] = [
                'url' => $url,
                'success' => false,
                'status_code' => $httpCode,
                'response_time' => $responseTime,
                'error' => $error ?: "HTTP错误码: $httpCode",
                'is_m3u8' => false,
                'm3u8_valid' => false,
                'redirect_chain' => $redirectChain,
                'effective_url' => $effectiveUrl,
                'hosts_applied' => $hostsApplied,
                'headers' => $headers
            ];
            $failedCount++;
            continue;
        }

        // 第二步：检查是否为M3U8文件
        $isM3U8 = false;
        $m3u8Valid = false;
        $m3u8Info = null;

        // 检查Content-Type或URL扩展名
        $urlLower = strtolower($effectiveUrl);
        if (strpos($contentType, 'application/vnd.apple.mpegurl') !== false ||
            strpos($contentType, 'application/x-mpegurl') !== false ||
            strpos($urlLower, '.m3u8') !== false) {
            $isM3U8 = true;

            // 检查M3U8内容是否有效
            $m3u8Valid = validateM3U8Content($responseBody);
            $m3u8Info = analyzeM3U8Content($responseBody);
        }

        $success = ($httpCode === 200);
        if ($success) {
            $successCount++;
            if ($isM3U8 && $m3u8Valid) {
                $validM3U8Count++;
            }
        } else {
            $failedCount++;
        }

        $results[] = [
            'url' => $url,
            'success' => $success,
            'status_code' => $httpCode,
            'response_time' => $responseTime,
            'content_type' => $contentType,
            'is_m3u8' => $isM3U8,
            'm3u8_valid' => $m3u8Valid,
            'm3u8_info' => $m3u8Info,
            'redirect_chain' => $redirectChain,
            'effective_url' => $effectiveUrl,
            'hosts_applied' => $hostsApplied,
            'headers' => $headers,
            'error' => $success ? null : ($error ?: "HTTP错误码: $httpCode")
        ];
    }

    return [
        'success' => true,
        'total_urls' => count($urls),
        'success_count' => $successCount,
        'failed_count' => $failedCount,
        'valid_m3u8_count' => $validM3U8Count,
        'results' => $results,
        'summary' => [
            '成功率' => round(($successCount / count($urls)) * 100, 2) . '%',
            '有效M3U8率' => count($urls) > 0 ? round(($validM3U8Count / count($urls)) * 100, 2) . '%' : '0%'
        ]
    ];
}

/**
 * 执行单个请求（支持重定向和hosts解析）- 修复版
 */
function executeRequestWithHosts($url, $hostsMap, $timeout, $proxyHost, $proxyPort, $proxyUsername, $proxyPassword, $forceIPv4, $customUA, $referer) {
    $maxRedirects = 10;
    $redirectCount = 0;
    $currentUrl = $url;
    $redirectChain = [];
    $hostsApplied = [];
    
    while (true) {
        // 解析当前URL
        $parsedUrl = parse_url($currentUrl);
        if (!$parsedUrl || !isset($parsedUrl['host'])) {
            return [
                'status_code' => 400,
                'error' => '无效的URL格式: ' . $currentUrl,
                'response_time' => 0,
                'redirect_chain' => $redirectChain,
                'effective_url' => $currentUrl,
                'hosts_applied' => $hostsApplied
            ];
        }
        
        $scheme = $parsedUrl['scheme'];
        $host = $parsedUrl['host'];
        $port = $parsedUrl['port'] ?? ($scheme === 'https' ? 443 : 80);
        $path = ($parsedUrl['path'] ?? '/') . (isset($parsedUrl['query']) ? '?' . $parsedUrl['query'] : '');
        
        // 检查hosts映射
        $targetIp = $hostsMap[$host] ?? null;
        $requestUrl = $currentUrl;
        
        $ch = curl_init();
        
        if ($targetIp) {
            // 使用hosts映射的IP，但保持Host头为原始域名
            $requestUrl = "{$scheme}://{$targetIp}:{$port}{$path}";
            // 设置CURLOPT_RESOLVE，让cURL将域名解析到指定IP
            curl_setopt($ch, CURLOPT_RESOLVE, ["{$host}:{$port}:{$targetIp}"]);
            
            // 记录应用的hosts
            $hostsApplied[] = [
                'hostname' => $host,
                'ip' => $targetIp,
                'type' => ($currentUrl === $url) ? 'initial' : 'redirect',
                'url' => $currentUrl
            ];
        }
        
        // 基础cURL选项
        $curlOptions = [
            CURLOPT_URL => $requestUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_NOBODY => false,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_FOLLOWLOCATION => false, // 手动处理重定向
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => $customUA ?: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Safari/537.36',
            CURLOPT_FAILONERROR => false,
        ];
        
        // 强制IPv4
        if ($forceIPv4) {
            curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
        }
        
        // 设置Referer
        if (!empty($referer)) {
            $curlOptions[CURLOPT_REFERER] = $referer;
        }
        
        // 设置代理
        if ($proxyHost && $proxyPort) {
            curl_setopt($ch, CURLOPT_PROXY, "$proxyHost:$proxyPort");
            
            // 根据是否有目标IP选择代理类型
            if ($targetIp) {
                // 有目标IP地址，使用普通SOCKS5
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
            } else {
                // 没有目标IP，使用SOCKS5_HOSTNAME让代理解析域名
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
            }
            
            if (!empty($proxyUsername) && !empty($proxyPassword)) {
                curl_setopt($ch, CURLOPT_PROXYUSERPWD, "$proxyUsername:$proxyPassword");
            }
        }
        
        // 设置Host头（重要！确保服务器知道我们要访问哪个域名）
        $headers = ["Host: {$host}", "Connection: close"];
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        
        curl_setopt_array($ch, $curlOptions);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $curlError = curl_error($ch);
        $curlErrno = curl_errno($ch);
        $responseTime = round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000, 0);
        
        // 获取响应头和响应体
        $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $headerStr = substr($response, 0, $headerSize);
        $body = substr($response, $headerSize);
        
        // 解析响应头
        $headers = parseHeaders($headerStr);
        
        curl_close($ch);
        
        // 检查是否应该跟随重定向
        $shouldFollowRedirect = ($httpCode >= 300 && $httpCode < 400) && 
                                isset($headers['location']) && 
                                $redirectCount < $maxRedirects;
        
        if ($shouldFollowRedirect) {
            // 记录重定向
            $redirectChain[] = [
                'status' => $httpCode,
                'url' => $currentUrl,
                'redirect_to' => $headers['location']
            ];
            
            // 解析重定向URL
            $newUrl = $headers['location'];
            if (!isAbsoluteUrl($newUrl)) {
                $newUrl = resolveRelativeUrl($currentUrl, $newUrl);
            }
            
            // 更新当前URL
            $currentUrl = $newUrl;
            $redirectCount++;
            continue;
        }
        
        // 请求完成
        return [
            'status_code' => $httpCode,
            'content_type' => $contentType,
            'error' => $curlError ?: null,
            'response_time' => $responseTime,
            'redirect_chain' => $redirectChain,
            'effective_url' => $currentUrl,
            'body' => $body,
            'hosts_applied' => $hostsApplied,
            'headers' => $headers
        ];
    }
}

/**
 * 解析响应头
 */
function parseHeaders($headerStr) {
    $headers = [];
    $lines = explode("\r\n", $headerStr);
    
    foreach ($lines as $line) {
        if (strpos($line, ':') !== false) {
            list($key, $value) = explode(':', $line, 2);
            $key = strtolower(trim($key));
            $value = trim($value);
            $headers[$key] = $value;
        }
    }
    
    return $headers;
}

/**
 * 判断是否为绝对URL
 */
function isAbsoluteUrl($url) {
    return preg_match('/^https?:\/\//i', $url);
}

/**
 * 解析相对URL
 */
function resolveRelativeUrl($baseUrl, $relativeUrl) {
    $base = parse_url($baseUrl);
    
    if (isAbsoluteUrl($relativeUrl)) {
        return $relativeUrl;
    }
    
    if (strpos($relativeUrl, '//') === 0) {
        return $base['scheme'] . ':' . $relativeUrl;
    }
    
    if ($relativeUrl[0] === '/') {
        return $base['scheme'] . '://' . $base['host'] . 
               (isset($base['port']) ? ':' . $base['port'] : '') . $relativeUrl;
    }
    
    $path = isset($base['path']) ? $base['path'] : '/';
    $dir = rtrim(dirname($path), '/') . '/';
    return $base['scheme'] . '://' . $base['host'] . 
           (isset($base['port']) ? ':' . $base['port'] : '') . $dir . $relativeUrl;
}

/**
 * 验证M3U8内容是否有效（支持主播放列表和媒体播放列表）
 */
function validateM3U8Content($content) {
    if (empty($content)) {
        return false;
    }

    // 检查是否是有效的M3U8文件
    $lines = explode("\n", trim($content));
    
    // 检查第一行是否是 #EXTM3U
    if (empty($lines) || strpos(trim($lines[0]), '#EXTM3U') !== 0) {
        return false;
    }

    // 检查是否包含至少一个有效的M3U8标签
    // 主播放列表包含 #EXT-X-STREAM-INF
    // 媒体播放列表包含 #EXTINF
    $hasValidTag = false;
    foreach ($lines as $line) {
        $trimmedLine = trim($line);
        if (strpos($trimmedLine, '#EXTINF:') === 0 || 
            strpos($trimmedLine, '#EXT-X-STREAM-INF') === 0) {
            $hasValidTag = true;
            break;
        }
    }

    return $hasValidTag;
}

/**
 * 分析M3U8内容
 */
function analyzeM3U8Content($content) {
    $lines = explode("\n", trim($content));
    $info = [
        'total_lines' => count($lines),
        'extinf_count' => 0,
        'ts_segments' => 0,
        'duration' => 0,
        'has_endlist' => false,
        'has_playlist' => false,
        'max_bitrate' => 0,
        'avg_duration' => 0
    ];

    $durations = [];
    $currentDuration = 0;

    foreach ($lines as $line) {
        $trimmedLine = trim($line);
        
        if (strpos($trimmedLine, '#EXTINF:') === 0) {
            $info['extinf_count']++;
            
            // 提取持续时间
            preg_match('/#EXTINF:([\d\.]+)/', $trimmedLine, $matches);
            if (isset($matches[1])) {
                $duration = floatval($matches[1]);
                $durations[] = $duration;
                $info['duration'] += $duration;
            }
        } 
        elseif (strpos($trimmedLine, '.ts') !== false || 
                strpos($trimmedLine, '.m4s') !== false ||
                strpos($trimmedLine, '.mp4') !== false) {
            $info['ts_segments']++;
        }
        elseif (strpos($trimmedLine, '#EXT-X-ENDLIST') === 0) {
            $info['has_endlist'] = true;
        }
        elseif (strpos($trimmedLine, '#EXT-X-STREAM-INF') === 0) {
            $info['has_playlist'] = true;
            
            // 提取比特率
            preg_match('/BANDWIDTH=(\d+)/', $trimmedLine, $matches);
            if (isset($matches[1])) {
                $bitrate = intval($matches[1]);
                if ($bitrate > $info['max_bitrate']) {
                    $info['max_bitrate'] = $bitrate;
                }
            }
        }
    }

    // 计算平均持续时间
    if ($info['extinf_count'] > 0) {
        $info['avg_duration'] = round($info['duration'] / $info['extinf_count'], 2);
    }

    // 格式化比特率
    if ($info['max_bitrate'] > 0) {
        if ($info['max_bitrate'] >= 1000000) {
            $info['max_bitrate_formatted'] = round($info['max_bitrate'] / 1000000, 2) . ' Mbps';
        } else {
            $info['max_bitrate_formatted'] = round($info['max_bitrate'] / 1000, 2) . ' Kbps';
        }
    } else {
        $info['max_bitrate_formatted'] = '未知';
    }

    return $info;
}

?>