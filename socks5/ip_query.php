<?php
/**
 * IP归属地查询模块（适配ip9.com.cn API）
 * 支持缓存机制，减少API调用
 */

// 缓存目录
define('CACHE_DIR', __DIR__ . '/cache/');
define('CACHE_EXPIRE', 3600 * 24 * 30); // 缓存30天

// 确保缓存目录存在
if (!file_exists(CACHE_DIR)) {
    @mkdir(CACHE_DIR, 0755, true);
}

/**
 * 获取缓存文件名（使用IP格式：112_12_23_32）
 */
function getCacheFilename($ip) {
    // 替换点号为下划线
    $safeFilename = str_replace('.', '_', $ip);
    return CACHE_DIR . $safeFilename . '.json';
}

/**
 * 查询IP归属地信息
 * @param string $ip IP地址
 * @return array IP信息
 */
function queryIPInfo($ip) {
    // 验证IP格式
    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        return [
            'success' => false,
            'error' => '无效的IP地址'
        ];
    }
    
    // 检查缓存
    $cacheFile = getCacheFilename($ip);
    if (file_exists($cacheFile)) {
        $cacheData = json_decode(file_get_contents($cacheFile), true);
        
        // 检查缓存是否过期
        if (isset($cacheData['cache_time']) && 
            (time() - $cacheData['cache_time']) < CACHE_EXPIRE) {
            return [
                'success' => true,
                'data' => $cacheData,
                'from_cache' => true
            ];
        }
    }
    
    // 调用API查询 - 使用新的API地址
    $apiUrl = "https://ip9.com.cn/get?ip=" . urlencode($ip);
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error || $httpCode !== 200) {
        // API调用失败，尝试备用API
        return queryIPInfoBackup($ip);
    }
    
    $data = json_decode($response, true);
    
    // 检查新的API返回格式
    if (!$data || !isset($data['ret']) || $data['ret'] !== 200) {
        // 如果新API失败，尝试备用API
        return queryIPInfoBackup($ip);
    }
    
    // 处理返回数据格式
    $processedData = processIPDataNewFormat($data);
    $processedData['cache_time'] = time();
    
    // 保存到缓存（使用IP格式文件名）
    file_put_contents($cacheFile, json_encode($processedData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    
    return [
        'success' => true,
        'data' => $processedData,
        'from_cache' => false
    ];
}

/**
 * 处理新API格式的IP数据
 * @param array $apiData API返回的数据
 * @return array 处理后的数据
 */
function processIPDataNewFormat($apiData) {
    $ipData = $apiData['data'] ?? [];
    
    // 构建地址信息
    $locationParts = [];
    
    if (!empty($ipData['country'])) {
        $locationParts[] = $ipData['country'];
    }
    
    if (!empty($ipData['prov']) && $ipData['prov'] !== $ipData['city']) {
        $locationParts[] = $ipData['prov'];
    }
    
    if (!empty($ipData['city'])) {
        $locationParts[] = $ipData['city'];
    }
    
    $location = implode('-', $locationParts);
    
    // 获取ISP
    $isp = $ipData['isp'] ?? '';
    
    // 构建完整文本：位置-运营商（优化显示逻辑）
    $fullText = $location;
    if (!empty($isp)) {
        $fullText .= '-' . $isp;
    }
    
    return [
        'ip' => $ipData['ip'] ?? '',
        'country' => $ipData['country'] ?? '',
        'province' => $ipData['prov'] ?? '',
        'city' => $ipData['city'] ?? '',
        'isp' => $isp,
        'location' => $location,
        'full_text' => $fullText,
        'country_code' => $ipData['country_code'] ?? '',
        'post_code' => $ipData['post_code'] ?? '',
        'lng' => $ipData['lng'] ?? '',
        'lat' => $ipData['lat'] ?? '',
        'big_area' => $ipData['big_area'] ?? '',
        'raw_data' => $apiData
    ];
}

/**
 * 备用API查询（当主API失败时使用）
 */
function queryIPInfoBackup($ip) {
    // 备用API：使用ip-api.com
    $apiUrl = "http://ip-api.com/json/{$ip}?lang=zh-CN";
    
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ]);
    
    $response = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($response === false || $error) {
        return [
            'success' => false,
            'error' => '所有API查询都失败: ' . $error
        ];
    }
    
    $data = json_decode($response, true);
    
    if (!$data || $data['status'] !== 'success') {
        return [
            'success' => false,
            'error' => '备用API返回数据异常'
        ];
    }
    
    // 处理备用API数据
    $processedData = processBackupIPData($data);
    $processedData['cache_time'] = time();
    
    return [
        'success' => true,
        'data' => $processedData,
        'from_cache' => false
    ];
}

/**
 * 处理备用API数据格式
 */
function processBackupIPData($apiData) {
    // 构建地址信息
    $locationParts = [];
    
    if (!empty($apiData['country'])) {
        $locationParts[] = $apiData['country'];
    }
    
    if (!empty($apiData['regionName'])) {
        $locationParts[] = $apiData['regionName'];
    }
    
    if (!empty($apiData['city'])) {
        $locationParts[] = $apiData['city'];
    }
    
    $location = implode('-', $locationParts);
    
    // 获取ISP
    $isp = $apiData['isp'] ?? $apiData['org'] ?? '';
    
    // 构建完整文本：位置-运营商
    $fullText = $location;
    if (!empty($isp)) {
        $fullText .= '-' . $isp;
    }
    
    return [
        'ip' => $apiData['query'] ?? '',
        'country' => $apiData['country'] ?? '',
        'province' => $apiData['regionName'] ?? '',
        'city' => $apiData['city'] ?? '',
        'isp' => $isp,
        'location' => $location,
        'full_text' => $fullText,
        'country_code' => $apiData['countryCode'] ?? '',
        'post_code' => $apiData['zip'] ?? '',
        'lng' => $apiData['lon'] ?? '',
        'lat' => $apiData['lat'] ?? '',
        'big_area' => '',
        'raw_data' => $apiData
    ];
}

/**
 * 批量查询IP信息（减少API调用）
 * @param array $ips IP地址数组
 * @return array IP信息映射
 */
function batchQueryIPInfo($ips) {
    $results = [];
    $toQuery = [];
    
    // 先检查缓存
    foreach ($ips as $ip) {
        $cacheFile = getCacheFilename($ip);
        
        if (file_exists($cacheFile)) {
            $cacheData = json_decode(file_get_contents($cacheFile), true);
            
            if (isset($cacheData['cache_time']) && 
                (time() - $cacheData['cache_time']) < CACHE_EXPIRE) {
                $results[$ip] = [
                    'success' => true,
                    'data' => $cacheData,
                    'from_cache' => true
                ];
            } else {
                $toQuery[] = $ip;
            }
        } else {
            $toQuery[] = $ip;
        }
    }
    
    // 批量查询（单线程，但减少连接数）
    foreach ($toQuery as $ip) {
        $results[$ip] = queryIPInfo($ip);
    }
    
    return $results;
}

/**
 * 获取IP信息的格式化文本（优化显示）
 * @param array $ipInfo IP信息数组
 * @return string 格式化文本
 */
function formatIPInfo($ipInfo) {
    if (!$ipInfo || !isset($ipInfo['success']) || !$ipInfo['success']) {
        return '未知';
    }
    
    $data = $ipInfo['data'];
    
    // 检查是否为国内IP且是否有省市信息
    $isChina = ($data['country'] === '中国' || $data['country'] === 'China');
    
    if ($isChina) {
        // 国内IP，检查是否有省/市信息
        $hasProvince = !empty($data['province']) && $data['province'] !== $data['city'];
        $hasCity = !empty($data['city']);
        
        // 构建显示文本
        $displayParts = [];
        
        // 只有省份没有城市，或者有城市时显示省份+城市
        if ($hasProvince && $hasCity) {
            $displayParts[] = $data['province'] . '-' . $data['city'];
        } elseif ($hasProvince) {
            $displayParts[] = $data['province'];
        } elseif ($hasCity) {
            $displayParts[] = $data['city'];
        } else {
            // 没有省市信息，显示国家
            $displayParts[] = $data['country'];
        }
        
        // 添加运营商信息
        if (!empty($data['isp'])) {
            $displayParts[] = $data['isp'];
        }
        
        return implode('-', $displayParts);
    } else {
        // 国外IP，显示国家-省市区-运营商
        // 返回完整格式：位置-运营商
        if (!empty($data['full_text'])) {
            return $data['full_text'];
        }
        
        // 如果没有完整文本，尝试组合
        $text = '';
        if (!empty($data['location'])) {
            $text .= $data['location'];
        }
        
        if (!empty($data['isp'])) {
            if (!empty($text)) {
                $text .= '-';
            }
            $text .= $data['isp'];
        }
        
        return $text ?: '未知';
    }
}

// 直接调用示例（用于测试）
if (isset($_GET['test_ip'])) {
    header('Content-Type: application/json; charset=utf-8');
    $ip = $_GET['test_ip'];
    $result = queryIPInfo($ip);
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}