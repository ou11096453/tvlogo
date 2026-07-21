#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { decodeConfig, decryptFromUrl } = require('./lib/decryptor');

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(`Usage:
  node cli.js --url <configUrl>
  node cli.js --file <path>
  node cli.js --text "<cipher or json>"
`);
    process.exit(0);
  }

  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  const customKeysPath = path.join(__dirname, 'keys', 'custom-keys.json');
  let result;
  if (get('--url')) {
    result = await decryptFromUrl(get('--url'), { customKeysPath });
  } else if (get('--file')) {
    const p = get('--file');
    const buf = fs.readFileSync(p);
    result = decodeConfig(buf, { customKeysPath, baseUrl: get('--base') || '' });
  } else if (get('--text')) {
    result = decodeConfig(get('--text'), { customKeysPath, baseUrl: get('--base') || '' });
  } else {
    throw new Error('provide --url / --file / --text');
  }

  const out = result.normalized ? JSON.stringify(result.normalized, null, 2) : (result.text || '');
  console.log(out);
  if (!result.ok) {
    console.error(`\n[warn] score=${result.score} mode=${result.mode} alg=${result.algorithm} key=${result.keyName}`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
