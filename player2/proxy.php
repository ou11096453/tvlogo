<?php
/**
 * 视频/EPG/图片代理服务脚本
 */

// 禁用输出缓冲
while (ob_get_level()) ob_end_clean();
ob_implicit_flush(true);
error_reporting(0);
ini_set('display_errors', 0);

// 配置常量
define('CURL_TIMEOUT', 30);
define('CURL_MAX_REDIRS', 10);
define('USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

// 参数解析
$action = isset($_GET['action']) ? $_GET['action'] : 'stream';
$url = isset($_GET['url']) ? urldecode($_GET['url']) : '';
$proxyHost = isset($_GET['proxy_host']) ? $_GET['proxy_host'] : '';
$proxyPort = isset($_GET['proxy_port']) ? $_GET['proxy_port'] : '';
$proxyUser = isset($_GET['proxy_user']) ? $_GET['proxy_user'] : '';
$proxyPass = isset($_GET['proxy_pass']) ? $_GET['proxy_pass'] : '';

$script_url = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https://' : 'http://')
              . $_SERVER['HTTP_HOST']
              . $_SERVER['SCRIPT_NAME'];
              
// ======================== 测试 SOCKS5 代理连接 ========================
if ($action === 'test') {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (!$data) {
        echo json_encode(['success' => false, 'error' => '无效的请求数据']);
        exit;
    }
    
    $proxy = isset($data['proxy']) ? $data['proxy'] : [];
    $testUrl = isset($data['testUrl']) ? $data['testUrl'] : 'https://httpbin.org/ip';
    
    $testProxyHost = isset($proxy['host']) ? $proxy['host'] : '';
    $testProxyPort = isset($proxy['port']) ? $proxy['port'] : '';
    $testProxyUser = isset($proxy['user']) ? $proxy['user'] : '';
    $testProxyPass = isset($proxy['pass']) ? $proxy['pass'] : '';
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $testUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    curl_setopt($ch, CURLOPT_USERAGENT, USER_AGENT);
    
    if (!empty($testProxyHost) && !empty($testProxyPort)) {
        $proxyAddr = $testProxyHost . ':' . $testProxyPort;
        curl_setopt($ch, CURLOPT_PROXY, $proxyAddr);
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
        if (!empty($testProxyUser)) {
            curl_setopt($ch, CURLOPT_PROXYUSERPWD, $testProxyUser . ':' . $testProxyPass);
        }
    }
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        echo json_encode(['success' => false, 'error' => $error]);
    } else {
        $ipData = json_decode($response, true);
        echo json_encode([
            'success' => true,
            'ip' => isset($ipData['origin']) ? $ipData['origin'] : (isset($ipData['ip']) ? $ipData['ip'] : 'unknown'),
            'httpCode' => $httpCode
        ]);
    }
    exit;
}

// ======================== EPG XML 获取接口（手动解压） ========================
if ($action === 'epg') {
    if (empty($url)) {
        http_response_code(400);
        echo '缺少URL参数';
        exit;
    }
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => CURL_MAX_REDIRS,
        CURLOPT_TIMEOUT => CURL_TIMEOUT,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => USER_AGENT,
        // 不设置 CURLOPT_ENCODING，获取原始数据
    ]);
    
    $data = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error || $data === false) {
        http_response_code(502);
        echo "获取失败: " . $error;
        exit;
    }
    
    if ($httpCode >= 400) {
        http_response_code($httpCode);
        echo "HTTP {$httpCode} 错误";
        exit;
    }
    
    // 检查是否是 gzip 数据（前两个字节是 0x1F 0x8B）
    $isGzip = (strlen($data) >= 2 && ord($data[0]) === 0x1F && ord($data[1]) === 0x8B);
    
    if ($isGzip) {
        // 手动解压 gzip
        $decompressed = @gzdecode($data);
        if ($decompressed !== false) {
            $data = $decompressed;
        } else {
            // 如果 gzdecode 失败，尝试使用 gzinflate
            $decompressed = @gzinflate(substr($data, 10));
            if ($decompressed !== false) {
                $data = $decompressed;
            }
        }
    }
    
    // 直接返回 XML
    header('Content-Type: application/xml; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Cache-Control: public, max-age=3600');
    echo $data;
    exit;
}

// ======================== 图片代理 ========================
if ($action === 'image') {
    if (empty($url)) {
        http_response_code(400);
        exit;
    }
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => CURL_MAX_REDIRS,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => USER_AGENT,
    ]);
    
    $data = curl_exec($ch);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error || $data === false || $httpCode >= 400) {
        http_response_code(502);
        header('Content-Type: image/svg+xml');
        echo '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="#999"><path d="M3 3v18l15-9-15-9z"/></svg>';
        exit;
    }
    
    header('Content-Type: ' . $contentType);
    header('Cache-Control: public, max-age=86400');
    header('Access-Control-Allow-Origin: *');
    echo $data;
    exit;
}

// ======================== 视频片段 ========================
if ($action === 'segment') {
    if (empty($url)) {
        http_response_code(400);
        exit;
    }
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => CURL_MAX_REDIRS,
        CURLOPT_TIMEOUT => CURL_TIMEOUT,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => USER_AGENT,
    ]);
    
    if (!empty($proxyHost) && !empty($proxyPort)) {
        curl_setopt($ch, CURLOPT_PROXY, $proxyHost . ':' . $proxyPort);
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
        if (!empty($proxyUser)) {
            curl_setopt($ch, CURLOPT_PROXYUSERPWD, $proxyUser . ':' . $proxyPass);
        }
    }
    
    if (isset($_SERVER['HTTP_RANGE'])) {
        curl_setopt($ch, CURLOPT_RANGE, $_SERVER['HTTP_RANGE']);
    }
    
    $data = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $content_type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error || $data === false) {
        http_response_code(502);
        header('Content-Type: text/plain');
        echo "片段获取失败: " . $error;
        exit;
    }
    
    if ($http_code == 206) {
        http_response_code(206);
    } else {
        http_response_code(200);
    }
    
    $content_type = $content_type ?: 'video/MP2T';
    header('Content-Type: ' . $content_type);
    header('Content-Length: ' . strlen($data));
    header('Accept-Ranges: bytes');
    header('Cache-Control: public, max-age=86400');
    header('Access-Control-Allow-Origin: *');
    echo $data;
    exit;
}

// ======================== 视频流 ========================
if ($action === 'stream' && !empty($url)) {
    $decodedUrl = urldecode($url);
    while (strpos($decodedUrl, '%') !== false && preg_match('/%[0-9A-Fa-f]{2}/', $decodedUrl)) {
        $decoded = urldecode($decodedUrl);
        if ($decoded === $decodedUrl) break;
        $decodedUrl = $decoded;
    }
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $decodedUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => CURL_MAX_REDIRS,
        CURLOPT_TIMEOUT => CURL_TIMEOUT,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => USER_AGENT,
    ]);
    
    if (!empty($proxyHost) && !empty($proxyPort)) {
        curl_setopt($ch, CURLOPT_PROXY, $proxyHost . ':' . $proxyPort);
        curl_setopt($ch, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
        if (!empty($proxyUser)) {
            curl_setopt($ch, CURLOPT_PROXYUSERPWD, $proxyUser . ':' . $proxyPass);
        }
    }
    
    $content = curl_exec($ch);
    $final_url = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $content_type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error || $content === false || $http_code >= 400) {
        http_response_code(502);
        header('Content-Type: text/plain');
        echo "无法获取视频流: " . $error;
        exit;
    }
    
    $is_m3u8 = (stripos($content, '#EXTM3U') !== false);
    
    if ($is_m3u8) {
        $new_content = rewrite_m3u8($content, $final_url, $proxyHost, $proxyPort, $proxyUser, $proxyPass, $script_url);
        header('Content-Type: application/vnd.apple.mpegurl');
        header('Content-Length: ' . strlen($new_content));
        header('Cache-Control: no-cache, must-revalidate');
        header('Access-Control-Allow-Origin: *');
        echo $new_content;
    } else {
        $content_type = $content_type ?: 'application/octet-stream';
        header('Content-Type: ' . $content_type);
        header('Content-Length: ' . strlen($content));
        header('Cache-Control: public, max-age=3600');
        header('Access-Control-Allow-Origin: *');
        echo $content;
    }
    exit;
}

// 默认帮助
header('Content-Type: text/html; charset=utf-8');
echo '<h1>视频代理服务</h1>';
echo '<p>使用方式:</p>';
echo '<ul>';
echo '<li>视频代理: proxy.php?action=stream&url=视频地址</li>';
echo '<li>EPG获取: proxy.php?action=epg&url=EPG地址</li>';
echo '<li>图片代理: proxy.php?action=image&url=图片地址</li>';
echo '</ul>';

// ======================== 辅助函数 ========================
function absolute_url($path, $base_url) {
    if (preg_match('/^https?:\/\//i', $path)) return $path;
    $base_parts = parse_url($base_url);
    if (!$base_parts) return $path;
    $scheme = isset($base_parts['scheme']) ? $base_parts['scheme'] : 'http';
    $host = isset($base_parts['host']) ? $base_parts['host'] : '';
    $port = isset($base_parts['port']) ? ':' . $base_parts['port'] : '';
    $path_part = isset($base_parts['path']) ? $base_parts['path'] : '';
    if (strlen($path) > 0 && $path[0] === '/') {
        return "{$scheme}://{$host}{$port}{$path}";
    }
    if (strrpos($path_part, '/') !== false) {
        $base_dir = substr($path_part, 0, strrpos($path_part, '/') + 1);
    } else {
        $base_dir = '/';
    }
    return "{$scheme}://{$host}{$port}{$base_dir}{$path}";
}

function build_proxy_url($target_url, $proxyHost, $proxyPort, $proxyUser, $proxyPass, $action, $script_url) {
    $params = http_build_query([
        'action' => $action,
        'url' => $target_url,
        'proxy_host' => $proxyHost,
        'proxy_port' => $proxyPort,
        'proxy_user' => $proxyUser,
        'proxy_pass' => $proxyPass
    ]);
    return $script_url . '?' . $params;
}

function rewrite_m3u8($content, $base_url, $proxyHost, $proxyPort, $proxyUser, $proxyPass, $script_url) {
    $lines = explode("\n", $content);
    $new_lines = [];
    foreach ($lines as $line) {
        $line = rtrim($line, "\r");
        $trimmed = trim($line);
        if ($trimmed === '') {
            $new_lines[] = $line;
            continue;
        }
        if ($trimmed[0] === '#') {
            if (stripos($trimmed, '#EXT-X-KEY:') === 0 && preg_match('/URI="([^"]+)"/i', $trimmed, $matches)) {
                $absoluteUri = absolute_url($matches[1], $base_url);
                $proxyUrl = build_proxy_url($absoluteUri, $proxyHost, $proxyPort, $proxyUser, $proxyPass, 'segment', $script_url);
                $new_line = str_replace($matches[0], 'URI="' . $proxyUrl . '"', $trimmed);
                $new_lines[] = $new_line;
            } elseif (stripos($trimmed, '#EXT-X-MEDIA:') === 0 && preg_match('/URI="([^"]+)"/i', $trimmed, $matches)) {
                $absoluteUri = absolute_url($matches[1], $base_url);
                $proxyUrl = build_proxy_url($absoluteUri, $proxyHost, $proxyPort, $proxyUser, $proxyPass, 'stream', $script_url);
                $new_line = str_replace($matches[0], 'URI="' . $proxyUrl . '"', $trimmed);
                $new_lines[] = $new_line;
            } elseif (stripos($trimmed, '#EXT-X-MAP:') === 0 && preg_match('/URI="([^"]+)"/i', $trimmed, $matches)) {
                $absoluteUri = absolute_url($matches[1], $base_url);
                $proxyUrl = build_proxy_url($absoluteUri, $proxyHost, $proxyPort, $proxyUser, $proxyPass, 'segment', $script_url);
                $new_line = str_replace($matches[0], 'URI="' . $proxyUrl . '"', $trimmed);
                $new_lines[] = $new_line;
            } else {
                $new_lines[] = $line;
            }
            continue;
        }
        $absolute = absolute_url($trimmed, $base_url);
        if (preg_match('/\.m3u8($|\?)/i', $absolute)) {
            $proxy_url = build_proxy_url($absolute, $proxyHost, $proxyPort, $proxyUser, $proxyPass, 'stream', $script_url);
        } else {
            $proxy_url = build_proxy_url($absolute, $proxyHost, $proxyPort, $proxyUser, $proxyPass, 'segment', $script_url);
        }
        $new_lines[] = $proxy_url;
    }
    return implode("\n", $new_lines);
}
?>