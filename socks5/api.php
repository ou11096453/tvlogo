<?php
/**
 * SOCKS5代理批量验证专用API
 * - 支持SOCKS5代理测试
 * - 支持代理匿名性检测
 * - 支持通过代理测试直播源
 * - 优化批量测试性能
 * - 支持302重定向跟随
 * - 强制使用IPv4解析域名
 * - 支持自定义请求头
 * - 集成IP归属地查询（通过ip_query.php）
 */

ob_start();
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS, HEAD');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

set_time_limit(30);
ini_set('max_execution_time', 30);
ini_set('memory_limit', '128M');
error_reporting(0);
ini_set('display_errors', 0);

// 包含IP查询模块 - 保持单独文件
require_once 'ip_query.php';

// 简单错误日志（可选）
function logError($message) {
    // 不创建日志文件，仅用于内部记录
    return;
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
        'redirects' => [],
        'error_type' => $isProxyTimeout ? 'proxy_timeout' : ($code == 504 ? 'url_timeout' : 'general_error'),
        'proxy_error' => $isProxyTimeout,
        'error_details' => $message,
        'proxy_used' => false,
        'is_anonymous' => false,
        'real_ip' => null,
        'ip_location' => null,
        'real_ip_location' => null
    ];
    
    returnJson($errorResponse, $code);
}

// 处理预检请求
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS' || $_SERVER['REQUEST_METHOD'] === 'HEAD') {
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

if (!$data) {
    returnError('无效的请求数据', 400);
}

// 检查测试类型
$testType = isset($data['test_type']) ? $data['test_type'] : 'proxy';
$testAnonymity = isset($data['test_anonymity']) ? (bool)$data['test_anonymity'] : false;

try {
    if ($testType === 'proxy') {
        // 代理连通性测试
        $result = testProxyConnectivity($data, $testAnonymity);
    } else if ($testType === 'stream') {
        // 通过代理测试直播源
        $result = testStreamWithProxy($data);
    } else {
        returnError('未知的测试类型: ' . $testType, 400);
    }
    
    returnJson($result);
    
} catch (Exception $e) {
    returnError('服务器处理错误: ' . $e->getMessage(), 500);
}

/**
 * 测试代理连通性
 */
function testProxyConnectivity($data, $testAnonymity = false) {
    $proxy_address = trim($data['proxy'] ?? '');
    $proxy_username = trim($data['proxy_username'] ?? '');
    $proxy_password = trim($data['proxy_password'] ?? '');
    $timeout = max(1, min(30, (int)($data['timeout'] ?? 5)));
    
    if (empty($proxy_address)) {
        returnError('代理地址不能为空', 400);
    }
    
    // 解析代理地址
    $proxy_parts = explode(':', $proxy_address);
    if (count($proxy_parts) < 2) {
        returnError('代理地址格式错误，应为 IP:PORT', 400);
    }
    
    $proxy_ip = $proxy_parts[0];
    $proxy_port = intval($proxy_parts[1]);
    
    // 查询代理IP的归属地 - 调用ip_query.php的函数
    $proxyIPInfo = queryIPInfo($proxy_ip);
    $proxyLocation = formatIPInfo($proxyIPInfo);
    
    // 测试代理的连通性
    $startTime = microtime(true);
    
    try {
        // 创建一个简单的HTTP请求来测试代理
        $testUrl = 'http://httpbin.org/ip'; // 用于测试代理匿名性
        $ch = curl_init();
        
        $curlOptions = [
            CURLOPT_URL => $testUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROXYTYPE => CURLPROXY_SOCKS5,
            CURLOPT_PROXY => $proxy_address,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            CURLOPT_FAILONERROR => false,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, // 强制使用IPv4解析
        ];
        
        // 如果代理需要认证
        if (!empty($proxy_username) && !empty($proxy_password)) {
            $curlOptions[CURLOPT_PROXYUSERPWD] = $proxy_username . ':' . $proxy_password;
        }
        
        curl_setopt_array($ch, $curlOptions);
        
        $response = curl_exec($ch);
        $info = curl_getinfo($ch);
        $error = curl_error($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        
        $elapsed = round((microtime(true) - $startTime) * 1000);
        
        $isProxyTimeout = false;
        $isAnonymous = true;
        $realIp = null;
        $realIPLocation = null;
        
        if ($response === false) {
            // 代理连接失败
            $isProxyTimeout = true;
            
            $errorDetails = '';
            if ($errno == CURLE_COULDNT_CONNECT || $errno == CURLE_COULDNT_RESOLVE_PROXY) {
                $errorDetails = "无法连接到SOCKS5代理服务器";
            } elseif ($errno == CURLE_OPERATION_TIMEDOUT) {
                $errorDetails = "代理连接超时";
            } else {
                $errorDetails = "代理连接失败: " . $error;
            }
            
            return [
                'success' => false,
                'proxy' => $proxy_address,
                'response_time' => $elapsed,
                'error' => $errorDetails,
                'curl_error_code' => $errno,
                'curl_error_message' => $error,
                'is_anonymous' => false,
                'real_ip' => null,
                'ip_location' => $proxyLocation,
                'real_ip_location' => null,
                'test_type' => 'proxy_connectivity',
                'proxy_used' => true,
                'status' => 'failed'
            ];
        }
        
        // 解析响应
        $header_size = $info['header_size'];
        $header_str = substr($response, 0, $header_size);
        $body = substr($response, $header_size);
        
        // 检查匿名性
        if ($testAnonymity && !empty($body)) {
            try {
                $ipData = json_decode($body, true);
                if ($ipData && isset($ipData['origin'])) {
                    $realIp = $ipData['origin'];
                    
                    // 查询真实IP的归属地 - 调用ip_query.php的函数
                    $realIPInfo = queryIPInfo($realIp);
                    $realIPLocation = formatIPInfo($realIPInfo);
                    
                    // 检查返回的IP是否与代理IP相同（简单匿名性检查）
                    $isAnonymous = ($realIp !== $proxy_ip);
                }
            } catch (Exception $e) {
                // JSON解析失败，跳过匿名性检查
            }
        }
        
        return [
            'success' => true,
            'proxy' => $proxy_address,
            'response_time' => $elapsed,
            'status_code' => $info['http_code'],
            'headers' => parseHeaders($header_str),
            'body' => $body,
            'size' => strlen($body),
            'is_anonymous' => $isAnonymous,
            'real_ip' => $realIp,
            'ip_location' => $proxyLocation,
            'real_ip_location' => $realIPLocation,
            'test_type' => 'proxy_connectivity',
            'proxy_used' => true,
            'status' => 'success',
            'details' => '代理连接测试成功' . ($testAnonymity ? ($isAnonymous ? '（匿名代理）' : '（可能不是匿名代理）') : '')
        ];
        
    } catch (Exception $e) {
        $elapsed = round((microtime(true) - $startTime) * 1000);
        
        return [
            'success' => false,
            'proxy' => $proxy_address,
            'response_time' => $elapsed,
            'error' => '代理测试异常: ' . $e->getMessage(),
            'is_anonymous' => false,
            'real_ip' => null,
            'ip_location' => $proxyLocation,
            'real_ip_location' => null,
            'test_type' => 'proxy_connectivity',
            'proxy_used' => true,
            'status' => 'failed'
        ];
    }
}

/**
 * 通过代理测试直播源（支持302重定向，强制IPv4解析，自定义请求头）
 */
function testStreamWithProxy($data) {
    $url = $data['url'] ?? '';
    $proxy_address = trim($data['proxy'] ?? '');
    $proxy_username = trim($data['proxy_username'] ?? '');
    $proxy_password = trim($data['proxy_password'] ?? '');
    $timeout = max(1, min(30, (int)($data['timeout'] ?? 8)));
    $request_headers = (array)($data['headers'] ?? []);
    $checkM3U8 = isset($data['check_m3u8']) ? (bool)$data['check_m3u8'] : true;
    
    if (empty($url)) {
        returnError('直播源URL不能为空', 400);
    }
    
    if (empty($proxy_address)) {
        returnError('代理地址不能为空', 400);
    }
    
    // 解析代理地址
    $proxy_parts = explode(':', $proxy_address);
    if (count($proxy_parts) < 2) {
        returnError('代理地址格式错误，应为 IP:PORT', 400);
    }
    
    $startTime = microtime(true);
    
    try {
        // 解析目标URL
        $parsed = parse_url($url);
        if (!$parsed || !isset($parsed['scheme']) || !isset($parsed['host'])) {
            return [
                'success' => false,
                'url' => $url,
                'final_url' => $url,
                'proxy' => $proxy_address,
                'response_time' => 0,
                'error' => 'URL格式无效',
                'test_type' => 'stream_test',
                'proxy_used' => true,
                'status' => 'failed',
                'is_m3u8' => false,
                'is_valid_m3u8' => false,
                'redirect_count' => 0
            ];
        }
        
        $scheme = $parsed['scheme'];
        $host = $parsed['host'];
        $port = $parsed['port'] ?? ($scheme === 'https' ? 443 : 80);
        $path = ($parsed['path'] ?? '/') . (isset($parsed['query']) ? '?' . $parsed['query'] : '');
        
        // 解析域名为IPv4地址（强制IPv4）
        $resolvedIp = resolveToIPv4($host);
        $dnsResolved = false;
        $requestUrl = $url;
        
        $ch = curl_init();
        
        if ($resolvedIp) {
            // 使用解析到的IPv4地址构建URL
            $requestUrl = "{$scheme}://{$resolvedIp}:{$port}{$path}";
            $dnsResolved = true;
            $headers_array = ["Host: {$host}", "Connection: close"];
        } else {
            // 无法解析IPv4地址，使用原始域名
            $headers_array = ["Host: {$host}", "Connection: close"];
        }
        
        $curlOptions = [
            CURLOPT_URL => $requestUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_FOLLOWLOCATION => true, // 启用302重定向跟随
            CURLOPT_MAXREDIRS => 5, // 最大重定向次数
            CURLOPT_USERAGENT => $request_headers['User-Agent'] ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            CURLOPT_FAILONERROR => false,
            CURLOPT_NOBODY => false,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, // 强制使用IPv4解析
        ];
        
        // 设置代理
        if ($proxy_address) {
            if ($dnsResolved && $resolvedIp) {
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
        }
        
        // 添加其他请求头
        foreach ($request_headers as $k => $v) {
            if (!in_array(strtolower($k), ['host', 'connection'])) {
                $headers_array[] = "{$k}: {$v}";
            }
        }
        
        $curlOptions[CURLOPT_HTTPHEADER] = $headers_array;
        
        // 如果是M3U8检查，限制响应体大小
        if ($checkM3U8 && (strpos($url, '.m3u8') !== false || strpos($url, '.m3u') !== false)) {
            $curlOptions[CURLOPT_BUFFERSIZE] = 256;
            $curlOptions[CURLOPT_NOPROGRESS] = false;
            $curlOptions[CURLOPT_PROGRESSFUNCTION] = function($resource, $download_size, $downloaded, $upload_size, $uploaded) {
                // 限制M3U8文件大小为50KB（比之前更大，因为有些M3U8文件较大）
                if ($downloaded > 51200) {
                    return 1; // 中断下载
                }
                return 0;
            };
        }
        
        curl_setopt_array($ch, $curlOptions);
        
        $response = curl_exec($ch);
        $info = curl_getinfo($ch);
        $error = curl_error($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        
        $elapsed = round((microtime(true) - $startTime) * 1000);
        
        if ($response === false) {
            // 请求失败
            $isProxyTimeout = false;
            $errorDetails = '';
            
            if ($errno == CURLE_COULDNT_CONNECT || $errno == CURLE_COULDNT_RESOLVE_PROXY) {
                $isProxyTimeout = true;
                $errorDetails = "无法通过代理连接到直播源服务器";
            } elseif ($errno == CURLE_OPERATION_TIMEDOUT) {
                $errorDetails = "请求超时";
            } elseif ($errno == CURLE_ABORTED_BY_CALLBACK) {
                $errorDetails = "响应被中断（可能是M3U8文件过大）";
            } elseif ($errno == CURLE_TOO_MANY_REDIRECTS) {
                $errorDetails = "重定向次数过多（可能陷入了重定向循环）";
            } else {
                $errorDetails = "请求失败: " . $error;
            }
            
            return [
                'success' => false,
                'url' => $url,
                'final_url' => $info['url'] ?? $url,
                'proxy' => $proxy_address,
                'response_time' => $elapsed,
                'error' => $errorDetails,
                'curl_error_code' => $errno,
                'curl_error_message' => $error,
                'test_type' => 'stream_test',
                'proxy_used' => true,
                'status' => 'failed',
                'is_m3u8' => false,
                'is_valid_m3u8' => false,
                'redirect_count' => $info['redirect_count'] ?? 0,
                'dns_resolved' => $dnsResolved,
                'resolved_ip' => $resolvedIp
            ];
        }
        
        // 解析响应
        $header_size = $info['header_size'];
        $header_str = substr($response, 0, $header_size);
        $body = substr($response, $header_size);
        $headers = parseHeaders($header_str);
        
        $isM3U8 = false;
        $isValidM3U8 = false;
        $contentType = isset($headers['content-type']) ? strtolower($headers['content-type']) : '';
        
        // 检查是否为M3U8
        if ($checkM3U8) {
            // 通过URL判断
            if (strpos($info['url'] ?? $url, '.m3u8') !== false || 
                strpos($info['url'] ?? $url, '.m3u') !== false ||
                strpos($url, '.m3u8') !== false || 
                strpos($url, '.m3u') !== false) {
                $isM3U8 = true;
            }
            
            // 通过Content-Type判断
            $m3u8ContentTypes = [
                'application/x-mpegurl',
                'application/vnd.apple.mpegurl',
                'audio/x-mpegurl',
                'application/mpegurl',
                'application/x-mpegURL',
                'application/octet-stream' // 有些服务器使用这个content-type
            ];
            
            foreach ($m3u8ContentTypes as $m3u8Type) {
                if (strpos($contentType, $m3u8Type) !== false) {
                    $isM3U8 = true;
                    break;
                }
            }
            
            // 通过内容特征判断
            if (!$isM3U8 && !empty($body)) {
                $firstLine = substr(trim($body), 0, 100);
                if (strpos($firstLine, '#EXTM3U') !== false) {
                    $isM3U8 = true;
                }
            }
            
            // 检查内容是否为有效的M3U8
            if ($isM3U8 && !empty($body)) {
                $trimmedBody = trim($body);
                if (strpos($trimmedBody, '#EXTM3U') === 0) {
                    $isValidM3U8 = true;
                    
                    // 检查是否包含有效的媒体信息
                    if (strpos($trimmedBody, '#EXTINF') !== false) {
                        $isValidM3U8 = true;
                    } else {
                        // 也可能是master playlist，包含#EXT-X-STREAM-INF
                        if (strpos($trimmedBody, '#EXT-X-STREAM-INF') !== false) {
                            $isValidM3U8 = true;
                        } else {
                            $isValidM3U8 = false;
                        }
                    }
                } else {
                    $isValidM3U8 = false;
                }
            }
        }
        
        $success = ($info['http_code'] == 200 || $info['http_code'] == 206);
        
        return [
            'success' => $success,
            'url' => $url,
            'final_url' => $info['url'] ?? $url,
            'proxy' => $proxy_address,
            'response_time' => $elapsed,
            'status_code' => $info['http_code'],
            'headers' => $headers,
            'body' => $body,
            'size' => strlen($body),
            'test_type' => 'stream_test',
            'proxy_used' => true,
            'status' => $success ? 'success' : 'failed',
            'is_m3u8' => $isM3U8,
            'is_valid_m3u8' => $isValidM3U8,
            'content_type' => $contentType,
            'redirect_count' => $info['redirect_count'] ?? 0,
            'details' => $success ? 
                ($isM3U8 ? ($isValidM3U8 ? '有效的M3U8直播源' : 'M3U8格式但内容可能无效') : '直播源访问成功') . 
                ($info['redirect_count'] > 0 ? " (重定向{$info['redirect_count']}次)" : '') : 
                '直播源访问失败',
            'dns_resolved' => $dnsResolved,
            'resolved_ip' => $resolvedIp
        ];
        
    } catch (Exception $e) {
        $elapsed = round((microtime(true) - $startTime) * 1000);
        
        return [
            'success' => false,
            'url' => $url,
            'final_url' => $url,
            'proxy' => $proxy_address,
            'response_time' => $elapsed,
            'error' => '直播源测试异常: ' . $e->getMessage(),
            'test_type' => 'stream_test',
            'proxy_used' => true,
            'status' => 'failed',
            'is_m3u8' => false,
            'is_valid_m3u8' => false,
            'redirect_count' => 0
        ];
    }
}

/**
 * 解析域名为IPv4地址
 */
function resolveToIPv4($domain) {
    // 如果是IP地址，直接返回
    if (filter_var($domain, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return $domain;
    }
    
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

/**
 * 解析响应头
 */
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

/**
 * 验证IP地址格式
 */
function isValidIP($ip) {
    return filter_var($ip, FILTER_VALIDATE_IP) !== false;
}

/**
 * 验证端口号
 */
function isValidPort($port) {
    $port = intval($port);
    return $port >= 1 && $port <= 65535;
}