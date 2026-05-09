<?php
/**
 * PHP代理后端（增强版）
 * - 支持 SOCKS5
 * - 支持 hosts 绑定（等价系统 hosts）
 * - 支持重定向后域名继续命中 hosts
 * - 保证 headers 永远可统计
 * - 支持大文件下载
 * - 大文件（>2MB）和流媒体不获取响应体
 * - 非流媒体响应超过2000字符提供下载
 * - 修复JSON响应中断问题
 * - 增强错误处理
 * - 【新增】详细区分SOCKS5代理超时和URL访问超时
 * - 【新增】识别SOCKS5代理认证失败
 */

ob_start();
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS, HEAD');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

set_time_limit(120);
ini_set('max_execution_time', 120);
ini_set('memory_limit', '256M');
error_reporting(0);
ini_set('display_errors', 0);


function logRequest($message, $data = null) {
    $logDir = __DIR__ . '/logs';
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0755, true);
    }
    
    $logFile = $logDir . '/proxy_debug.log';
    $timestamp = date('Y-m-d H:i:s');
    $logMessage = "[$timestamp] $message";
    
    if ($data !== null) {
        $logMessage .= " - " . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    
    $logMessage .= "\n";
    @file_put_contents($logFile, $logMessage, FILE_APPEND);
}


function returnError($message, $code = 500, $isProxyTimeout = false, $isProxyAuthError = false) {
    ob_end_clean();
    http_response_code($code);
    
    $errorResponse = [
        'error' => $message,
        'url' => '',
        'final_url' => '',
        'status_code' => $code,
        'headers' => [],
        'body' => '',
        'size' => 0,
        'time' => 0,
        'redirect_count' => 0,
        'redirects' => [],
        'error_type' => $isProxyAuthError ? 'proxy_auth_failed' : ($isProxyTimeout ? 'proxy_timeout' : ($code == 504 ? 'url_timeout' : 'general_error')),
        'proxy_error' => $isProxyTimeout || $isProxyAuthError,
        'proxy_auth_failed' => $isProxyAuthError,
        'error_details' => $message,
        'proxy_used' => false
    ];
    
    logRequest("ERROR: $message", [
        'code' => $code, 
        'proxy_error' => $isProxyTimeout || $isProxyAuthError,
        'error_type' => $errorResponse['error_type']
    ]);
    
    echo json_encode($errorResponse, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (isset($_GET['download'])) {
    try {
        ob_end_clean();
        $cacheFile = preg_replace('/[^a-f0-9]/', '', $_GET['download']);
        $cachePath = sys_get_temp_dir() . '/proxy_cache_' . $cacheFile . '.json';
        
        if (file_exists($cachePath) && filesize($cachePath) > 0) {
            $cacheData = json_decode(file_get_contents($cachePath), true);
            
            if ($cacheData && isset($cacheData['body'])) {
                // 从缓存数据中获取文件名
                $filename = isset($cacheData['suggested_filename']) ? $cacheData['suggested_filename'] : 'downloaded_file';
                
                // 获取内容类型
                $contentType = isset($cacheData['headers']['content-type']) ? $cacheData['headers']['content-type'] : 'application/octet-stream';
                
                // 设置响应头
                header('Content-Type: ' . $contentType);
                header('Content-Disposition: attachment; filename="' . basename($filename) . '"');
                header('Content-Length: ' . strlen($cacheData['body']));
                header('Cache-Control: no-cache, no-store, must-revalidate');
                header('Pragma: no-cache');
                header('Expires: 0');
                
                echo $cacheData['body'];
                @unlink($cachePath);
                exit;
            }
        }
        
        returnError('下载链接已过期或无效', 404);
        
    } catch (Exception $e) {
        returnError('下载处理失败: ' . $e->getMessage(), 500);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS' || $_SERVER['REQUEST_METHOD'] === 'HEAD') {
    ob_end_clean();
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    returnError('只允许POST请求', 405);
}

try {
    $input = file_get_contents('php://input');
    
    if (empty($input)) {
        returnError('请求数据为空', 400);
    }
    
    $data = json_decode($input, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        returnError('JSON解析失败: ' . json_last_error_msg(), 400);
    }
    
    if (!$data || empty($data['url'])) {
        returnError('无效的请求数据: URL不能为空', 400);
    }
    
} catch (Exception $e) {
    returnError('请求数据读取失败: ' . $e->getMessage(), 400);
}

function parseHostsMap($text) {
    $map = [];
    foreach (preg_split('/\r?\n/', $text) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;

        $p = preg_split('/\s+/', $line);
        if (count($p) === 2) {
            if (filter_var($p[0], FILTER_VALIDATE_IP)) {
                $map[$p[1]] = $p[0];
            } elseif (filter_var($p[1], FILTER_VALIDATE_IP)) {
                $map[$p[0]] = $p[1];
            }
        }
    }
    return $map;
}

$hostsMap = parseHostsMap($data['host'] ?? '');
$url = $data['url'];
$method = strtoupper($data['method'] ?? 'GET');
$timeout = max(1, min(120, (int)($data['timeout'] ?? 30)));
$proxy_address = trim($data['proxy'] ?? '');
$proxy_username = trim($data['proxy_username'] ?? '');
$proxy_password = trim($data['proxy_password'] ?? '');
$follow_redirects = (bool)($data['follow_redirects'] ?? true);
$max_redirects = max(0, min(50, (int)($data['max_redirects'] ?? 10)));
$request_headers = (array)($data['headers'] ?? []);

logRequest("收到请求", [
    'url' => $url,
    'method' => $method,
    'timeout' => $timeout,
    'has_proxy' => !empty($proxy_address),
    'proxy' => $proxy_address ?: '无',
    'follow_redirects' => $follow_redirects,
    'max_redirects' => $max_redirects
]);

try {
    $result = executeRequest(
        $url,
        $method,
        $request_headers,
        $hostsMap,
        $timeout,
        $proxy_address,
        $proxy_username,
        $proxy_password,
        $follow_redirects,
        $max_redirects
    );
    
    if (!is_array($result)) {
        $result = [
            'url' => $url,
            'final_url' => $url,
            'status_code' => 500,
            'headers' => [],
            'body' => '后端处理错误：返回结果不是有效的数组',
            'size' => 0,
            'time' => 0,
            'redirect_count' => 0,
            'redirects' => [],
            'error_type' => 'server_error',
            'proxy_error' => false,
            'proxy_auth_failed' => false,
            'error_details' => '服务器内部处理错误',
            'proxy_used' => !empty($proxy_address)
        ];
    }
    
    // 检查是否为代理认证失败
    if ($result['status_code'] == 502 && !empty($result['body']) && strpos($result['body'], 'SOCKS5 authentication failed') !== false) {
        $result['error_type'] = 'proxy_auth_failed';
        $result['proxy_error'] = true;
        $result['proxy_auth_failed'] = true;
        $result['error_details'] = 'SOCKS5代理认证失败: ' . extractProxyAuthError($result['body']);
    }
    
    $isMediaFile = false;
    $isLargeFile = false;
    $contentType = isset($result['headers']['content-type']) ? strtolower($result['headers']['content-type']) : '';
    
    $mediaExtensions = [
        '.flv', '.mp4', '.m4v', '.mov', '.avi', '.wmv', '.mkv', '.webm', '.ts', '.mts', '.m2ts',
        '.3gp', '.3g2', '.f4v', '.vob', '.ogv', '.divx',
        '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
        '.mpd'
    ];
    
    function isMediaUrl($url) {
        global $mediaExtensions;
        $urlPath = parse_url($url, PHP_URL_PATH);
        if (!$urlPath) return false;
        
        $lowerPath = strtolower($urlPath);
        foreach ($mediaExtensions as $ext) {
            if (strlen($lowerPath) >= strlen($ext) && substr($lowerPath, -strlen($ext)) === $ext) {
                return true;
            }
        }
        return false;
    }
    
    function isMediaContentType($contentType) {
        $m3u8Types = [
            'application/x-mpegurl',
            'application/vnd.apple.mpegurl',
            'audio/x-mpegurl'
        ];
        
        foreach ($m3u8Types as $m3u8Type) {
            if (strpos($contentType, $m3u8Type) !== false) {
                return false;
            }
        }
        
        return strpos($contentType, 'video/') === 0 || 
               strpos($contentType, 'audio/') === 0;
    }
    
    function isM3U8File($url, $contentType) {
        $urlPath = parse_url($url, PHP_URL_PATH);
        if ($urlPath) {
            $lowerPath = strtolower($urlPath);
            if (substr($lowerPath, -5) === '.m3u8' || substr($lowerPath, -4) === '.m3u') {
                return true;
            }
        }
        
        $m3u8Types = [
            'application/x-mpegurl',
            'application/vnd.apple.mpegurl',
            'audio/x-mpegurl'
        ];
        
        foreach ($m3u8Types as $m3u8Type) {
            if (strpos($contentType, $m3u8Type) !== false) {
                return true;
            }
        }
        
        global $result;
        if (isset($result['body']) && strpos(trim($result['body']), '#EXTM3U') === 0) {
            return true;
        }
        
        return false;
    }
    
function generateSuggestedFilename($url, $contentType, $headers) {
    // 清理content-type，移除字符集部分
    $cleanContentType = explode(';', $contentType)[0];
    $cleanContentType = trim($cleanContentType);
    
    // 1. 尝试从 Content-Disposition 获取
    if (isset($headers['content-disposition'])) {
        $disposition = $headers['content-disposition'];
        if (preg_match('/filename\*?=["\']?(?:UTF-8\'\')?([^"\'\s;]+)/i', $disposition, $matches) ||
            preg_match('/filename=["\']?([^"\'\s;]+)/i', $disposition, $matches)) {
            $filename = urldecode($matches[1]);
            if ($filename && $filename !== '') {
                return ensureFileExtension($filename, $cleanContentType);
            }
        }
    }
    
    // 2. 尝试从 URL 路径获取最后一个非空段
    $parsed = parse_url($url);
    if ($parsed && isset($parsed['path'])) {
        $path = $parsed['path'];
        if ($path && $path !== '/') {
            $parts = explode('/', $path);
            $filteredParts = array_filter($parts, function($part) {
                return $part !== '' && $part !== '/' && !preg_match('/^\d+$/', $part);
            });
            
            if (!empty($filteredParts)) {
                $lastPart = end($filteredParts);
                
                // 检查是否是常见API端点名称
                $apiEndpoints = [
                    'GetChannelsList', 'GetChannelList', 'GetPrograms', 'GetEPG',
                    'getLiveSource', 'getConfig', 'getToken', 'getPlaylist'
                ];
                
                // 如果最后一个部分是API端点名称
                if (in_array($lastPart, $apiEndpoints) || preg_match('/^[A-Z][a-zA-Z]+$/', $lastPart)) {
                    $filename = $lastPart . getExtensionFromContentType($cleanContentType);
                    return $filename;
                }
                
                // 如果已经有扩展名
                if (strpos($lastPart, '.') !== false) {
                    return $lastPart;
                }
                
                // 没有扩展名，添加扩展名
                $filename = $lastPart . getExtensionFromContentType($cleanContentType);
                return $filename;
            }
        }
    }
    
    // 3. 尝试从查询参数获取有用信息
    if ($parsed && isset($parsed['query'])) {
        parse_str($parsed['query'], $queryParams);
        
        // 检查是否有表示操作或资源的参数
        $resourceParams = ['action', 'method', 'type', 'resource', 'endpoint', 'api'];
        foreach ($resourceParams as $param) {
            if (isset($queryParams[$param]) && !empty($queryParams[$param])) {
                $value = $queryParams[$param];
                if (is_string($value) && strlen($value) < 50 && !strpos($value, '=')) {
                    $filename = $value . getExtensionFromContentType($cleanContentType);
                    return $filename;
                }
            }
        }
        
        // 检查是否有包含"list"、"data"、"info"等关键词的参数值
        foreach ($queryParams as $key => $value) {
            if (is_string($value) && 
                (preg_match('/(list|data|info|config|source|token|auth|channel|program|epg)$/i', $key) ||
                 preg_match('/(list|data|info|config|source|token|auth|channel|program|epg)$/i', $value)) &&
                strlen($value) < 30) {
                $filename = $value . getExtensionFromContentType($cleanContentType);
                return $filename;
            }
        }
    }
    
    // 4. 从主机名生成文件名
    if ($parsed && isset($parsed['host'])) {
        $host = $parsed['host'];
        $hostParts = explode('.', $host);
        $domain = $hostParts[0] ?? 'response';
        
        // 生成有意义的文件名
        $timestamp = date('Ymd_His');
        $filename = $domain . '_' . $timestamp . getExtensionFromContentType($cleanContentType);
        return $filename;
    }
    
    // 5. 最后回退方案
    $timestamp = date('Ymd_His');
    return 'response_' . $timestamp . getExtensionFromContentType($cleanContentType);
}
    
    $isM3U8 = isM3U8File($result['final_url'] ?? $url, $contentType);
    $isMediaByUrl = isMediaUrl($url) || isMediaUrl($result['final_url'] ?? $url);
    $isMediaByContent = isMediaContentType($contentType);
    $isMediaFile = ($isMediaByUrl || $isMediaByContent) && !$isM3U8;
    
    $contentLength = isset($result['headers']['content-length']) ? intval($result['headers']['content-length']) : 0;
    $bodySize = isset($result['body']) ? strlen($result['body']) : 0;
    
    if ($contentLength > 2 * 1024 * 1024) {
        $isLargeFile = true;
    } elseif ($bodySize > 2 * 1024 * 1024) {
        $isLargeFile = true;
    }
    
    // 生成建议的文件名
    $suggestedFilename = generateSuggestedFilename($result['final_url'] ?? $url, $contentType, $result['headers'] ?? []);
    
    if (($isLargeFile || $isMediaFile) && !$isM3U8) {
        $result['body'] = '[文件信息]' . "\n\n";
        $result['body'] .= '文件类型: ' . ($isMediaFile ? '媒体文件' : '大文件') . "\n";
        $result['body'] .= '内容类型: ' . ($contentType ?: '未指定') . "\n";
        
        if ($contentLength > 0) {
            $result['body'] .= '文件大小: ' . formatBytes($contentLength) . "\n";
        } elseif (isset($result['size'])) {
            $result['body'] .= '响应大小: ' . formatBytes($result['size']) . "\n";
        }
        
        if (isset($result['final_url'])) {
            $result['body'] .= '最终URL: ' . $result['final_url'] . "\n";
        }
        
        $result['body'] .= "\n" . '提示: 此文件为' . ($isMediaFile ? '媒体文件' : '大文件') . '，为节省资源不获取完整响应体。';
        
        $result['skip_body'] = true;
        $result['file_type'] = $isMediaFile ? 'media' : 'large_file';
        $result['download_available'] = false;
    } else {
        if ($isM3U8) {
            $result['download_url'] = null;
            $result['truncated'] = false;
            $result['download_available'] = false;
            
            if ($bodySize > 2000) {
                $cacheId = md5(uniqid() . $url . microtime(true));
                $cachePath = sys_get_temp_dir() . '/proxy_cache_' . $cacheId . '.json';
                
                if (file_put_contents($cachePath, json_encode([
                    'body' => $result['body'],
                    'headers' => $result['headers'],
                    'suggested_filename' => $suggestedFilename,  // 添加建议的文件名
                    'original_url' => $result['final_url'] ?? $url
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))) {
                    // 替换生成下载链接的部分
$script_name = basename($_SERVER['PHP_SELF']);
$result['download_url'] = $script_name . '?download=' . $cacheId;
                    $result['download_available'] = true;
                    $result['suggested_filename'] = $suggestedFilename;  // 添加到结果中
                    cleanupOldCacheFiles(300);
                }
            }
        } else {
            if ($bodySize > 2000) {
                $cacheId = md5(uniqid() . $url . microtime(true));
                $cachePath = sys_get_temp_dir() . '/proxy_cache_' . $cacheId . '.json';
                
                if (file_put_contents($cachePath, json_encode([
                    'body' => $result['body'],
                    'headers' => $result['headers'],
                    'suggested_filename' => $suggestedFilename,  // 添加建议的文件名
                    'original_url' => $result['final_url'] ?? $url
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))) {
                    // 替换生成下载链接的部分
$script_name = basename($_SERVER['PHP_SELF']);
$result['download_url'] = $script_name . '?download=' . $cacheId;
                    $result['body'] = substr($result['body'], 0, 2000) . "\n\n... (响应体超过2000字符，已截断前2000字符，请下载完整文件查看) ...";
                    $result['truncated'] = true;
                    $result['download_available'] = true;
                    $result['suggested_filename'] = $suggestedFilename;  // 添加到结果中
                    cleanupOldCacheFiles(300);
                } else {
                    $result['body'] = substr($result['body'], 0, 2000) . "\n\n... (响应体超过2000字符，已截断前2000字符，但无法生成下载链接) ...";
                    $result['truncated'] = true;
                    $result['download_available'] = false;
                }
            } else {
                $result['download_url'] = null;
                $result['truncated'] = false;
                $result['download_available'] = false;
            }
        }
    }
    
    $result['is_m3u8'] = $isM3U8;
    $result['proxy_used'] = !empty($proxy_address);
    
    $result = array_merge([
        'url' => $url,
        'final_url' => $url,
        'status_code' => 0,
        'headers' => [],
        'body' => '',
        'size' => 0,
        'time' => 0,
        'redirect_count' => 0,
        'redirects' => [],
        'download_url' => null,
        'truncated' => false,
        'download_available' => false,
        'skip_body' => false,
        'file_type' => '',
        'is_m3u8' => false,
        'error_type' => null,
        'proxy_error' => false,
        'proxy_auth_failed' => false,
        'error_details' => null,
        'curl_error_code' => null,
        'curl_error_message' => null,
        'proxy_used' => false,
        'suggested_filename' => $suggestedFilename  // 确保有这个字段
    ], $result);
    
    logRequest("请求完成", [
        'url' => $url,
        'status' => $result['status_code'],
        'proxy_used' => $result['proxy_used'],
        'error_type' => $result['error_type'] ?: '无',
        'proxy_auth_failed' => $result['proxy_auth_failed'] ?? false,
        'filename' => $suggestedFilename
    ]);
    
    ob_end_clean();
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    
} catch (Exception $e) {
    returnError('服务器处理错误: ' . $e->getMessage(), 500);
}

function cleanupOldCacheFiles($maxAge = 300) {
    try {
        $tempDir = sys_get_temp_dir();
        $files = glob($tempDir . '/proxy_cache_*.json');
        $now = time();
        
        foreach ($files as $file) {
            if (filemtime($file) < $now - $maxAge) {
                @unlink($file);
            }
        }
    } catch (Exception $e) {
    }
}

function formatBytes($bytes) {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $bytes = max($bytes, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    $bytes /= pow(1024, $pow);
    
    return round($bytes, 2) . ' ' . $units[$pow];
}

function extractProxyAuthError($body) {
    // 尝试从HTML中提取错误信息
    if (preg_match('/<p>(.*?)<\/p>/s', $body, $matches)) {
        return htmlspecialchars_decode(trim($matches[1]));
    }
    
    // 如果不是HTML格式，直接返回前200个字符
    $cleanBody = strip_tags($body);
    $cleanBody = trim($cleanBody);
    
    if (strlen($cleanBody) > 200) {
        $cleanBody = substr($cleanBody, 0, 200) . '...';
    }
    
    return $cleanBody;
}

// 修改executeRequest函数中的DNS解析部分

function executeRequest($url, $method, $request_headers, $hostsMap, $timeout, $proxy_address, $proxy_username, $proxy_password, $follow_redirects, $max_redirects) {
    $redirects = [];
    $redirect_count = 0;
    $current_url = $url;

    $final_headers = [];
    $final_body = '';
    $final_status = 0;
    $final_time = 0;

    // 新增函数：解析域名为IPv4地址
    function resolveToIPv4($domain) {
        // 使用dns_get_record获取A记录（IPv4地址）
        $records = @dns_get_record($domain, DNS_A);
        if ($records && isset($records[0]['ip'])) {
            return $records[0]['ip'];
        }
        
        // 备用方法：使用gethostbyname
        $ip = @gethostbyname($domain);
        if ($ip !== $domain && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return $ip;
        }
        
        return null;
    }

    while (true) {
        $parsed = parse_url($current_url);
        if (!$parsed || !isset($parsed['scheme']) || !isset($parsed['host'])) {
            return [
                'url' => $url,
                'final_url' => $current_url,
                'status_code' => 400,
                'headers' => [],
                'body' => '无效的URL格式: ' . $current_url,
                'size' => 0,
                'time' => 0,
                'redirect_count' => $redirect_count,
                'redirects' => $redirects,
                'error_type' => 'url_invalid',
                'proxy_error' => false,
                'proxy_auth_failed' => false,
                'error_details' => 'URL格式无效',
                'proxy_used' => !empty($proxy_address)
            ];
        }

        $scheme = $parsed['scheme'];
        $host = $parsed['host'];
        $port = $parsed['port'] ?? ($scheme === 'https' ? 443 : 80);
        $path = ($parsed['path'] ?? '/') . (isset($parsed['query']) ? '?' . $parsed['query'] : '');

        $isMediaUrl = false;
        $urlPath = $parsed['path'] ?? '';
        $mediaExtensions = ['.flv', '.mp4', '.ts', '.avi', '.mkv', '.mov', '.wmv', '.webm'];
        
        if ($urlPath) {
            $lowerPath = strtolower($urlPath);
            foreach ($mediaExtensions as $ext) {
                if (strlen($lowerPath) >= strlen($ext) && substr($lowerPath, -strlen($ext)) === $ext) {
                    $isMediaUrl = true;
                    break;
                }
            }
        }

        $target_ip = $hostsMap[$host] ?? null;
        $request_url = $current_url;

        $ch = curl_init();

        // 新增：当使用SOCKS5代理时，如果没有hosts映射，尝试解析域名为IPv4地址
        $dnsResolved = false;
        $originalHost = $host; // 保存原始主机名
        $resolvedIp = null;
        
        if ($proxy_address && !$target_ip) {
            // 强制解析域名为IPv4地址
            $resolvedIp = resolveToIPv4($host);
            if ($resolvedIp) {
                $target_ip = $resolvedIp;
                $dnsResolved = true;
                // 记录解析结果（用于调试）
                $hostsMap[$host] = $resolvedIp; // 临时添加到hostsMap
                logRequest("DNS解析结果", [
                    'host' => $host,
                    'ip' => $resolvedIp,
                    'proxy' => $proxy_address
                ]);
            }
        }

        if ($target_ip) {
            // 如果hosts映射或DNS解析提供了IP地址
            if ($dnsResolved) {
                // 对于DNS解析的IP，我们需要使用IP地址构建URL，但设置正确的Host头
                $request_url = "{$scheme}://{$target_ip}:{$port}{$path}";
                
                // 注意：对于SOCKS5代理，我们不能使用CURLOPT_RESOLVE，因为我们要通过代理连接IP地址
                // 而是直接使用IP地址构建URL
                
                // 标记这是DNS解析的结果
                $headers_array = ["Host: {$originalHost}", "Connection: close"];
            } else {
                // 原始hosts映射的处理
                $request_url = "{$scheme}://{$target_ip}:{$port}{$path}";
                curl_setopt($ch, CURLOPT_RESOLVE, ["{$host}:{$port}:{$target_ip}"]);
                $headers_array = ["Host: {$host}", "Connection: close"];
            }
        } else {
            // 没有IP地址，使用原始URL
            $request_url = $current_url;
            $headers_array = ["Host: {$host}", "Connection: close"];
        }

        $curlOptions = [
            CURLOPT_URL => $request_url,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 16,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_FRESH_CONNECT => true,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => $request_headers['User-Agent'] ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            CURLOPT_FAILONERROR => false,
        ];
        
        // 强制IPv4解析（影响代理服务器和目标服务器的连接）
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
        
        if ($isMediaUrl) {
            $curlOptions[CURLOPT_NOBODY] = true;
            $curlOptions[CURLOPT_CUSTOMREQUEST] = 'HEAD';
        }

        curl_setopt_array($ch, $curlOptions);

        if ($proxy_address) {
            curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
            curl_setopt($ch, CURLOPT_PROXY, $proxy_address);
            
            // 当有目标IP地址时，使用普通SOCKS5代理（连接IP地址）
            // 当没有目标IP地址时，使用SOCKS5_HOSTNAME让代理解析域名
            if ($target_ip) {
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
            } else {
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
            }
            
            if (!empty($proxy_username) && !empty($proxy_password)) {
                curl_setopt($ch, CURLOPT_PROXYUSERPWD, $proxy_username . ':' . $proxy_password);
            }
            
            curl_setopt($ch, CURLOPT_PROXYTIMEOUT, 10);
        }

        // 添加其他请求头
        foreach ($request_headers as $k => $v) {
            if (!in_array(strtolower($k), ['host', 'connection'])) {
                $headers_array[] = "{$k}: {$v}";
            }
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers_array);

        $resp = curl_exec($ch);
        $info = curl_getinfo($ch);
        $error = curl_error($ch);
        $errno = curl_errno($ch);
        curl_close($ch);

        $isProxyTimeout = false;
        $isProxyAuthError = false;
        $isUrlTimeout = false;
        $errorDetails = '';
        $errorType = 'general_error';
        
        if ($resp === false) {
            $status_code = 504;
            
            switch ($errno) {
                case CURLE_COULDNT_CONNECT:
                case CURLE_COULDNT_RESOLVE_PROXY:
                    if ($proxy_address) {
                        $isProxyTimeout = true;
                        $errorType = 'proxy_timeout';
                        $errorDetails = "无法连接到SOCKS5代理服务器: {$proxy_address}";
                    } else {
                        $errorType = 'url_timeout';
                        $errorDetails = "无法连接到目标服务器: {$error}";
                    }
                    break;
                    
                case CURLE_OPERATION_TIMEDOUT:
                    if ($proxy_address && $info['connect_time'] > 0 && $info['pretransfer_time'] == 0) {
                        $isProxyTimeout = true;
                        $errorType = 'proxy_timeout';
                        $errorDetails = "SOCKS5代理连接超时: 连接到代理服务器 {$proxy_address} 超时 ({$timeout}s)";
                    } else if ($info['http_code'] == 0 && $info['total_time'] >= $timeout) {
                        if ($proxy_address) {
                            $errorType = 'proxy_timeout';
                            $errorDetails = "通过SOCKS5代理访问目标URL超时";
                            $isProxyTimeout = true;
                        } else {
                            $errorType = 'url_timeout';
                            $errorDetails = "目标URL访问超时: ({$timeout}s)";
                        }
                    } else {
                        $errorType = 'url_timeout';
                        $errorDetails = "请求超时: {$error}";
                    }
                    break;
                    
                case CURLE_GOT_NOTHING:
                    if ($proxy_address) {
                        $errorType = 'proxy_timeout';
                        $errorDetails = "通过SOCKS5代理访问时服务器未返回数据";
                        $isProxyTimeout = true;
                    } else {
                        $errorType = 'url_timeout';
                        $errorDetails = "服务器未返回数据: {$error}";
                    }
                    break;
                    
                default:
                    if ($proxy_address) {
                        $errorType = 'proxy_timeout';
                        $errorDetails = "通过SOCKS5代理访问失败: {$error} (CURL错误码: {$errno})";
                        if (strpos($error, 'proxy') !== false || strpos($error, 'socks') !== false) {
                            $isProxyTimeout = true;
                        }
                    } else {
                        $errorType = 'url_timeout';
                        $errorDetails = "请求失败: {$error} (CURL错误码: {$errno})";
                    }
            }
            
            $body = $errorDetails;
            $header_str = '';
        } else {
            $header_size = $info['header_size'];
            $header_str = substr($resp, 0, $header_size);
            $body = $isMediaUrl ? '' : substr($resp, $header_size);
            $headers = parseHeaders($header_str);
            $status_code = $info['http_code'];
            
            // 检查是否为代理认证失败
            if ($status_code == 502 && strpos($body, 'SOCKS5 authentication failed') !== false) {
                $isProxyAuthError = true;
                $errorType = 'proxy_auth_failed';
                $errorDetails = extractProxyAuthError($body);
            }
        }
        
        $redirects[] = [
            'url' => $current_url,
            'status_code' => $status_code,
            'response_headers' => $headers ?? [],
            'time' => $info['total_time'],
            'error_details' => $errorDetails ?? null,
            'is_proxy_error' => $isProxyTimeout || $isProxyAuthError,
            'is_proxy_auth_failed' => $isProxyAuthError,
            'curl_error_code' => $errno ?? null,
            'curl_error_message' => $error ?? null,
            'dns_resolved' => $dnsResolved, // 记录DNS解析信息
            'resolved_ip' => $resolvedIp // 记录解析的IP地址
        ];

        if ($resp === false || $isProxyAuthError) {
            return [
                'url' => $url,
                'final_url' => $current_url,
                'status_code' => $status_code,
                'headers' => $headers ?? [],
                'body' => $body,
                'size' => strlen($body),
                'time' => $info['total_time'],
                'redirect_count' => $redirect_count,
                'redirects' => $redirects,
                'error_type' => $errorType,
                'proxy_error' => $isProxyTimeout || $isProxyAuthError,
                'proxy_auth_failed' => $isProxyAuthError,
                'error_details' => $errorDetails,
                'curl_error_code' => $errno,
                'curl_error_message' => $error,
                'proxy_used' => !empty($proxy_address),
                'dns_resolved' => $dnsResolved, // 添加DNS解析信息
                'resolved_ip' => $resolvedIp
            ];
        }

        $final_headers = $headers ?? [];
        $final_body = $body;
        $final_status = $status_code;
        $final_time = $info['total_time'];

        if ($follow_redirects &&
            $final_status >= 300 &&
            $final_status < 400 &&
            isset($final_headers['location']) &&
            $redirect_count < $max_redirects) {
            
            $new_url = is_absolute_url($final_headers['location'])
                ? $final_headers['location']
                : resolve_relative_url($current_url, $final_headers['location']);
            
            $current_url = $new_url;
            $redirect_count++;
            continue;
        }

        break;
    }

    return [
        'url' => $url,
        'final_url' => $current_url,
        'status_code' => $final_status,
        'headers' => $final_headers ?: [],
        'body' => $final_body,
        'size' => strlen($final_body),
        'time' => $final_time,
        'redirect_count' => $redirect_count,
        'redirects' => $redirects,
        'error_type' => null,
        'proxy_error' => false,
        'proxy_auth_failed' => false,
        'error_details' => null,
        'curl_error_code' => null,
        'curl_error_message' => null,
        'proxy_used' => !empty($proxy_address),
        'dns_resolved' => $dnsResolved, // 添加DNS解析信息
        'resolved_ip' => $resolvedIp
    ];
}

function is_absolute_url($url) {
    return preg_match('/^https?:\/\//i', $url);
}

function resolve_relative_url($base_url, $relative_url) {
    $base = parse_url($base_url);
    if (is_absolute_url($relative_url)) return $relative_url;
    if (strpos($relative_url, '//') === 0) return $base['scheme'] . ':' . $relative_url;
    if ($relative_url[0] === '/') {
        return $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '') . $relative_url;
    }
    $path = rtrim(dirname($base['path'] ?? '/'), '/') . '/' . $relative_url;
    return $base['scheme'] . '://' . $base['host'] . (isset($base['port']) ? ':' . $base['port'] : '') . $path;
}

function parseHeaders($header_str) {
    $headers = [];
    foreach (explode("\r\n", $header_str) as $line) {
        if (strpos($line, ':') !== false) {
            [$k, $v] = explode(':', $line, 2);
            $headers[strtolower(trim($k))] = trim($v);
        }
    }
    return $headers;
}

// 新增辅助函数：根据内容类型获取扩展名
function getExtensionFromContentType($contentType) {
    $contentType = strtolower($contentType);
    
    $extensions = [
        'application/json' => '.json',
        'text/json' => '.json',
        'application/javascript' => '.js',
        'text/javascript' => '.js',
        'application/xml' => '.xml',
        'text/xml' => '.xml',
        'text/html' => '.html',
        'text/plain' => '.txt',
        'text/css' => '.css',
        'application/pdf' => '.pdf',
        'image/jpeg' => '.jpg',
        'image/png' => '.png',
        'image/gif' => '.gif',
        'image/webp' => '.webp',
        'image/svg+xml' => '.svg',
        'application/x-mpegurl' => '.m3u8',
        'application/vnd.apple.mpegurl' => '.m3u8',
        'audio/x-mpegurl' => '.m3u8',
        'video/mp4' => '.mp4',
        'video/mpeg' => '.mpeg',
        'video/quicktime' => '.mov',
        'video/x-msvideo' => '.avi',
        'video/x-flv' => '.flv',
        'video/x-matroska' => '.mkv',
        'video/webm' => '.webm',
        'audio/mpeg' => '.mp3',
        'audio/ogg' => '.ogg',
        'audio/wav' => '.wav',
        'audio/webm' => '.weba',
        'audio/aac' => '.aac',
        'audio/x-aac' => '.aac',
        'audio/flac' => '.flac',
        'application/zip' => '.zip',
        'application/x-gzip' => '.gz',
        'application/x-tar' => '.tar',
        'application/x-rar-compressed' => '.rar',
        'application/x-7z-compressed' => '.7z',
    ];
    
    return $extensions[$contentType] ?? '.bin';
}

// 新增辅助函数：确保文件名有正确的扩展名
function ensureFileExtension($filename, $contentType) {
    // 检查是否已有扩展名
    if (strpos($filename, '.') !== false) {
        return $filename;
    }
    
    // 没有扩展名，添加一个
    $extension = getExtensionFromContentType($contentType);
    return $filename . $extension;
}