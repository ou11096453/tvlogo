# TVBox 接口解密工具 v1.0

本地 TVBox / 影视配置解密与规范化工具。

## 能力

- 拉取远程配置 URL 并解密
- 粘贴 JSON / hex / base64 / 密文
- 多算法爆破：AES-128/256 CBC&ECB、DES、3DES、XOR
- 支持 hex / base64 / gzip 嵌套编码
- 相对路径补全（spider/jar/api/lives）
- 自定义密钥：`keys/custom-keys.json`

## 启动

```bash
cd "D:\codex\新建文件夹\work\tvbox-jiemi-v1"
node server.js
```

打开：http://127.0.0.1:8787

## CLI

```bash
node cli.js --url "https://example.com/tvbox.json"
node cli.js --file .\sample.enc
node cli.js --text "...."
```

## 自定义密钥

编辑 `keys/custom-keys.json`：

```json
[
  {
    "name": "my-key",
    "key": "16byteslength!!",
    "iv": "16byteslength!!",
    "keySize": 16,
    "algs": ["aes-128-cbc", "aes-128-ecb"]
  }
]
```

## API

`POST /api/decrypt`

```json
{ "url": "https://example.com/config.json" }
```

或

```json
{ "content": "...", "baseUrl": "https://example.com/config.json" }
```

## 说明

- 内置密钥是公开常见预设，不是某个闭源网站的私有密钥全集
- 若目标源使用私有算法/私有密钥，把密钥填进 custom-keys.json 即可扩展
- 请仅用于你有权处理的配置内容
