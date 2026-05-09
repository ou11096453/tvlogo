<?php
/**
 * 直播源批量扫描专用API
 * - 支持SOCKS5代理
 * - 支持hosts绑定
 * - 优化扫描性能
 * - 减少不必要的数据返回
 * - 【新增】强制使用IPv4解析（在使用SOCKS5代理时）
 */

ob_start();
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

set_time_limit(30);
ini_set('max_execution_time', 30);
ini_set('memory_limit', '128M');
error_reporting(0);
ini_set('display_errors', 0);

// 简单日志函数
function logError($message) {
    $logFile = __DIR__ . '/api_error.log';
    $timestamp = date('Y-m-d H:i:s');
    @file_put_contents($logFile, "[$timestamp] $message\n", FILE_APPEND);
}

function returnJson($data, $status = 200) {
    ob_end_clean();
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function returnError($message, $code = 500, $isProxyTimeout = false) {
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
        'error_type' => $isProxyTimeout ? 'proxy_timeout' : ($code == 504 ? 'url_timeout' : 'general_error'),
        'proxy_error' => $isProxyTimeout,
        'error_details' => $message,
        'proxy_used' => false
    ];
    
    returnJson($errorResponse, $code);
}

// 处理预检请求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    ob_end_clean();
    http_response_code(200);
    exit;
}

// 只接受POST请求
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    returnError('只允许POST请求', 405);
}

// 读取输入
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

// 解析hosts映射
function parseHostsMap($text) {
    $map = [];
    $lines = preg_split('/\r?\n/', $text);
    
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;

        $parts = preg_split('/\s+/', $line);
        if (count($parts) === 2) {
            if (filter_var($parts[0], FILTER_VALIDATE_IP)) {
                $map[$parts[1]] = $parts[0];
            } elseif (filter_var($parts[1], FILTER_VALIDATE_IP)) {
                $map[$parts[0]] = $parts[1];
            }
        }
    }
    
    return $map;
}

// 准备参数
$hostsMap = parseHostsMap($data['host'] ?? '');
$url = $data['url'];
$method = strtoupper($data['method'] ?? 'GET');
$timeout = max(1, min(30, (int)($data['timeout'] ?? 5)));
$proxy_address = trim($data['proxy'] ?? '');
$proxy_username = trim($data['proxy_username'] ?? '');
$proxy_password = trim($data['proxy_password'] ?? '');
$follow_redirects = (bool)($data['follow_redirects'] ?? true);
$max_redirects = max(0, min(10, (int)($data['max_redirects'] ?? 5)));
$request_headers = (array)($data['headers'] ?? []);
$scan_mode = (bool)($data['scan_mode'] ?? false);

try {
    // 执行请求
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
        $max_redirects,
        $scan_mode
    );
    
    returnJson($result);
    
} catch (Exception $e) {
    returnError('服务器处理错误: ' . $e->getMessage(), 500);
}

function executeRequest($url, $method, $request_headers, $hostsMap, $timeout, $proxy_address, $proxy_username, $proxy_password, $follow_redirects, $max_redirects, $scan_mode = false) {
    $redirects = [];
    $redirect_count = 0;
    $current_url = $url;

    $final_headers = [];
    $final_body = '';
    $final_status = 0;
    $final_time = 0;

    while (true) {
        $parsed = parse_url($current_url);
        if (!$parsed || !isset($parsed['scheme']) || !isset($parsed['host'])) {
            return [
                'url' => $url,
                'final_url' => $current_url,
                'status_code' => 400,
                'headers' => [],
                'body' => '',
                'size' => 0,
                'time' => 0,
                'redirect_count' => $redirect_count,
                'redirects' => $redirects,
                'error_type' => 'url_invalid',
                'proxy_error' => false,
                'error_details' => 'URL格式无效',
                'proxy_used' => !empty($proxy_address)
            ];
        }

        $scheme = $parsed['scheme'];
        $host = $parsed['host'];
        $port = $parsed['port'] ?? ($scheme === 'https' ? 443 : 80);
        $path = ($parsed['path'] ?? '/') . (isset($parsed['query']) ? '?' . $parsed['query'] : '');

        // 扫描模式：如果是M3U8文件，限制body大小
        $isM3U8Url = false;
        if ($scan_mode) {
            $urlPath = $parsed['path'] ?? '';
            if ($urlPath && (strtolower(substr($urlPath, -5)) === '.m3u8' || strtolower(substr($urlPath, -4)) === '.m3u')) {
                $isM3U8Url = true;
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
            // 尝试解析域名为IPv4地址
            $resolvedIp = resolveToIPv4($host);
            if ($resolvedIp) {
                $target_ip = $resolvedIp;
                $dnsResolved = true;
            }
        }

        if ($target_ip) {
            if ($dnsResolved) {
                // 对于DNS解析的IP，我们需要使用IP地址构建URL，但设置正确的Host头
                $request_url = "{$scheme}://{$target_ip}:{$port}{$path}";
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
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_FRESH_CONNECT => true,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => $request_headers['User-Agent'] ?? 'Okhttp/3.15',
            CURLOPT_FAILONERROR => false,
            CURLOPT_NOBODY => false,
        ];
        
        // 强制IPv4解析（总是启用）
        curl_setopt($ch, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
        
        // 扫描模式优化 - 增加限制到更大的值，避免中断正常响应
        if ($scan_mode && $isM3U8Url) {
            curl_setopt($ch, CURLOPT_BUFFERSIZE, 256);
            curl_setopt($ch, CURLOPT_NOPROGRESS, false);
            curl_setopt($ch, CURLOPT_PROGRESSFUNCTION, function($resource, $download_size, $downloaded, $upload_size, $uploaded) {
                // 增加限制到10KB，避免过早中断正常的M3U8响应
                if ($downloaded > 10240) { // 10KB
                    return 1; // 中断下载
                }
                return 0;
            });
            
            // 设置更大的超时时间用于下载M3U8文件
            curl_setopt($ch, CURLOPT_TIMEOUT, max($timeout, 10));
        }

        curl_setopt_array($ch, $curlOptions);

        // 设置代理
        if ($proxy_address) {
            // 根据是否有目标IP选择代理类型
            if ($target_ip) {
                // 有目标IP地址，使用普通SOCKS5（连接IP地址）
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
            } else {
                // 没有目标IP，使用SOCKS5_HOSTNAME让代理解析域名
                curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
            }
            
            curl_setopt($ch, CURLOPT_PROXY, $proxy_address);
            
            if (!empty($proxy_username) && !empty($proxy_password)) {
                curl_setopt($ch, CURLOPT_PROXYUSERPWD, $proxy_username . ':' . $proxy_password);
            }
            
            curl_setopt($ch, CURLOPT_PROXYTIMEOUT, 3);
        }

        // 添加其他请求头
        foreach ($request_headers as $k => $v) {
            if (!in_array(strtolower($k), ['host', 'connection'])) {
                $headers_array[] = "{$k}: {$v}";
            }
        }
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers_array);

        // 执行请求
        $resp = curl_exec($ch);
        $info = curl_getinfo($ch);
        $error = curl_error($ch);
        $errno = curl_errno($ch);
        curl_close($ch);

        $isProxyTimeout = false;
        $errorDetails = '';
        $errorType = 'general_error';
        
        if ($resp === false) {
            $status_code = 504;
            
            // 更详细的错误处理
            if ($errno == CURLE_COULDNT_CONNECT || $errno == CURLE_COULDNT_RESOLVE_PROXY) {
                if ($proxy_address) {
                    $isProxyTimeout = true;
                    $errorType = 'proxy_timeout';
                    $errorDetails = "无法连接到SOCKS5代理服务器: $error";
                } else {
                    $errorType = 'url_timeout';
                    $errorDetails = "无法连接到目标服务器: $error";
                }
            } elseif ($errno == CURLE_OPERATION_TIMEDOUT) {
                if ($proxy_address) {
                    $isProxyTimeout = true;
                    $errorType = 'proxy_timeout';
                    $errorDetails = "SOCKS5代理连接超时: $error";
                } else {
                    $errorType = 'url_timeout';
                    $errorDetails = "目标URL访问超时: $error";
                }
            } elseif ($errno == CURLE_ABORTED_BY_CALLBACK) {
                // 回调中断，通常是因为扫描模式限制了body大小
                $errorType = 'callback_aborted';
                $errorDetails = "请求被中断（可能是扫描模式限制）: $error";
            } else {
                $errorType = 'general_error';
                $errorDetails = "请求失败: $error";
            }
            
            $body = '';
            $header_str = '';
            $headers = [];
        } else {
            $header_size = $info['header_size'];
            $header_str = substr($resp, 0, $header_size);
            $body = substr($resp, $header_size);
            
            // 扫描模式：如果是M3U8，只保留前2KB内容（增加限制）
            if ($scan_mode && $isM3U8Url && strlen($body) > 2048) {
                $body = substr($body, 0, 2048);
            }
            
            $headers = parseHeaders($header_str);
            $status_code = $info['http_code'];
            
            // 如果是504状态码，但响应时间很短，说明是服务器快速返回的504
            if ($status_code === 504 && $info['total_time'] < 2) {
                $errorType = 'server_fast_504';
                $errorDetails = "服务器快速返回504（${info['total_time']}秒）";
            } else {
                $errorType = null;
                $errorDetails = null;
            }
        }
        
        $redirects[] = [
            'url' => $current_url,
            'status_code' => $status_code,
            'time' => $info['total_time'],
        ];

        if ($resp === false) {
            return [
                'url' => $url,
                'final_url' => $current_url,
                'status_code' => $status_code,
                'headers' => $headers,
                'body' => $body,
                'size' => strlen($body),
                'time' => $info['total_time'],
                'redirect_count' => $redirect_count,
                'redirects' => $redirects,
                'error_type' => $errorType,
                'proxy_error' => $isProxyTimeout,
                'error_details' => $errorDetails,
                'curl_error_code' => $errno,
                'curl_error_message' => $error,
                'proxy_used' => !empty($proxy_address),
                'dns_resolved' => $dnsResolved, // 添加DNS解析信息
                'resolved_ip' => $resolvedIp
            ];
        }

        $final_headers = $headers;
        $final_body = $body;
        $final_status = $status_code;
        $final_time = $info['total_time'];

        // 处理重定向
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
        'error_type' => $errorType,
        'proxy_error' => false,
        'error_details' => $errorDetails,
        'curl_error_code' => null,
        'curl_error_message' => null,
        'proxy_used' => !empty($proxy_address),
        'dns_resolved' => $dnsResolved, // 添加DNS解析信息
        'resolved_ip' => $resolvedIp
    ];
}

/**
 * 解析域名为IPv4地址
 */
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