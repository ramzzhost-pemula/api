const fetch = global.fetch;
const { URLSearchParams } = require('url');
const crypto = require("crypto");
const QRCode = require('qrcode');
const { ImageUploadService } = require('node-upload-images');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ==================== PROXY INDONESIA CONFIG ====================
// WAJIB: OrderKuota hanya bisa diakses dari IP Indonesia
// Gunakan proxy Indonesia yang reliable
const PROXY_LIST_ID = [
  // HTTP/HTTPS Proxies Indonesia (gratis/berbayar)
  'http://103.76.233.210:8080',
  'http://103.78.170.13:83',
  'http://103.78.170.13:3125',
  'http://103.121.22.2:8080',
  'http://103.121.22.1:8080',
  // SOCKS5 Proxies Indonesia
  'socks5://103.76.233.210:1080',
  'socks5://103.78.170.13:1080',
  // Backup: WebShare premium proxies (lebih stabil)
  // 'http://user:pass@id.proxyserver.com:8080'
];

// ==================== PROXY MANAGER ====================
class ProxyManager {
  constructor(proxyList = PROXY_LIST_ID) {
    this.proxyList = proxyList;
    this.currentProxy = null;
    this.failedProxies = new Set();
    this.proxyIndex = 0;
  }

  getNextProxy() {
    // Filter proxy yang belum failed
    const availableProxies = this.proxyList.filter(p => !this.failedProxies.has(p));
    
    if (availableProxies.length === 0) {
      // Reset failed proxies jika semua sudah dicoba
      this.failedProxies.clear();
      console.log('[PROXY] Resetting failed proxy list');
      return this.proxyList[0];
    }

    this.proxyIndex = (this.proxyIndex + 1) % availableProxies.length;
    this.currentProxy = availableProxies[this.proxyIndex];
    return this.currentProxy;
  }

  markProxyFailed(proxy) {
    this.failedProxies.add(proxy);
    console.log(`[PROXY] Marked as failed: ${proxy}`);
  }

  async testProxy(proxy) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const agent = this.createAgent(proxy);
      const response = await fetch('https://api.ipify.org?format=json', {
        agent,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[PROXY] Working: ${proxy} - IP: ${data.ip}`);
        return true;
      }
      return false;
    } catch (err) {
      console.log(`[PROXY] Test failed for ${proxy}: ${err.message}`);
      return false;
    }
  }

  createAgent(proxy) {
    if (proxy.startsWith('socks')) {
      return new SocksProxyAgent(proxy);
    }
    return new HttpsProxyAgent(proxy);
  }

  async getWorkingProxy() {
    // Coba proxy yang tersedia
    for (let i = 0; i < this.proxyList.length; i++) {
      const proxy = this.getNextProxy();
      
      if (this.failedProxies.has(proxy)) continue;
      
      const isWorking = await this.testProxy(proxy);
      if (isWorking) {
        return proxy;
      } else {
        this.markProxyFailed(proxy);
      }
    }

    // Jika semua proxy gratis gagal, coba tanpa proxy dengan warning
    console.warn('[PROXY] All proxies failed, attempting direct connection (will likely fail)');
    return null;
  }
}

// ==================== ORDERKUOTA CLASS (ENHANCED) ====================
class OrderKuota {
  static API_URL = 'https://app.orderkuota.com/api/v2';
  static HOST = 'app.orderkuota.com';
  
  // Pool identitas device Indonesia (Xiaomi, Samsung, Oppo, Vivo popular di Indo)
  static DEVICE_POOL = [
    {
      model: '23124RA7EO',
      brand: 'Xiaomi',
      android: '14',
      userAgent: 'okhttp/4.12.0',
      uuid: crypto.randomUUID()
    },
    {
      model: 'SM-A356E',
      brand: 'Samsung',
      android: '15',
      userAgent: 'okhttp/4.12.0',
      uuid: crypto.randomUUID()
    },
    {
      model: 'CPH2581',
      brand: 'Oppo',
      android: '14',
      userAgent: 'okhttp/4.11.0',
      uuid: crypto.randomUUID()
    },
    {
      model: 'V2354',
      brand: 'Vivo',
      android: '15',
      userAgent: 'okhttp/4.12.0',
      uuid: crypto.randomUUID()
    },
    {
      model: 'RMX3851',
      brand: 'Realme',
      android: '14',
      userAgent: 'okhttp/4.11.0',
      uuid: crypto.randomUUID()
    },
    {
      model: 'M2007J3SG',
      brand: 'Xiaomi',
      android: '13',
      userAgent: 'okhttp/4.12.0',
      uuid: crypto.randomUUID()
    }
  ];

  // Versi app yang umum di Indonesia
  static APP_VERSIONS = [
    { name: '25.09.18', code: '250918' },
    { name: '25.09.17', code: '250917' },
    { name: '25.09.16', code: '250916' },
    { name: '25.09.15', code: '250915' }
  ];

  static APP_REG_IDS = [
    'cdzXkBynRECkAODZEHwkeV:APA91bHRyLlgNSlpVrC4Yv3xBgRRaePSaCYruHnNwrEK8_pX3kzitxzi0CxIDFc2oztCwcw7-zPgwE-6v_-rJCJdTX8qE_ADiSnWHNeZ5O7_BIlgS_1N8tw',
    'eYxAlCmBQFSlDPEYIGxmfW:APA91bGSsMktPKlWrD5Zx4yChSScfQVbDZsIvIoTGxM8_qY4lAjz0zD1EzIFdD2t0AuEwdB8A-hRhF-K_wMJDKdUZ9rF_ADkTpXIOfAa6P8_CKmgU_2O9ux',
    'fYxBmCnCSFSlEPEZIGxnfX:APA91bHTtNlQlWMqS6Zy5zDiTtdgWEdCtkJwPuITyN9_rZ5mBk0A0E1FgIGeE3u1BvFxeC9B-iSiG-L_xNKELeVa0sG_BElUqYQjPbBb7Q9_DLnhV_3P9vy'
  ];

  constructor(username = null, authToken = null, proxyManager = null) {
    this.username = username;
    this.authToken = authToken;
    this.proxyManager = proxyManager;
    
    // Random device setiap session
    this.randomizeDevice();
  }

  randomizeDevice() {
    const device = OrderKuota.DEVICE_POOL[Math.floor(Math.random() * OrderKuota.DEVICE_POOL.length)];
    const appVersion = OrderKuota.APP_VERSIONS[Math.floor(Math.random() * OrderKuota.APP_VERSIONS.length)];
    const appRegId = OrderKuota.APP_REG_IDS[Math.floor(Math.random() * OrderKuota.APP_REG_IDS.length)];

    this.phoneModel = device.model;
    this.phoneBrand = device.brand;
    this.phoneAndroidVersion = device.android;
    this.userAgent = device.userAgent;
    this.phoneUuid = crypto.randomUUID();
    this.appVersionName = appVersion.name;
    this.appVersionCode = appVersion.code;
    this.appRegId = appRegId;
  }

  async delay(min = 500, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min) + min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  buildHeaders() {
    const headers = {
      'Host': OrderKuota.HOST,
      'User-Agent': this.userAgent,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.1',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'X-Requested-With': 'com.orderkuota.app',
      'X-App-Version': this.appVersionName,
      'X-Device-Model': this.phoneModel,
      'X-Device-Brand': this.phoneBrand,
      'X-Android-Version': this.phoneAndroidVersion
    };

    return headers;
  }

  async request(method, url, body = null, retries = 3) {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Dapatkan proxy Indonesia yang working
        const proxy = await this.proxyManager?.getWorkingProxy();
        
        const options = {
          method,
          headers: this.buildHeaders(),
          body: body ? body.toString() : null,
          timeout: 30000,
        };

        if (proxy) {
          const agent = this.proxyManager.createAgent(proxy);
          options.agent = agent;
          console.log(`[PROXY] Using: ${proxy}`);
        } else {
          console.warn('[PROXY] No proxy available, direct connection will likely be blocked');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        options.signal = controller.signal;

        const res = await fetch(url, options);
        clearTimeout(timeout);

        // Handle Cloudflare/security blocks
        if (res.status === 403 || res.status === 503) {
          const text = await res.text();
          if (text.includes('Cloudflare') || text.includes('Attention Required')) {
            throw new Error('BLOCKED_BY_SECURITY: IP bukan dari Indonesia atau terdeteksi sebagai bot');
          }
        }

        // Handle rate limiting
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '10');
          console.log(`[RATE LIMIT] Waiting ${retryAfter} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          this.randomizeDevice(); // Ganti identitas
          continue;
        }

        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          
          // Check untuk error geo-blocking
          if (data.error && (data.error.includes('region') || data.error.includes('location'))) {
            throw new Error('GEO_BLOCKED: Layanan hanya tersedia untuk pengguna Indonesia');
          }
          
          return data;
        } else {
          const text = await res.text();
          if (text.includes('blocked') || text.includes('tidak tersedia')) {
            throw new Error('GEO_BLOCKED: Akses dibatasi untuk wilayah Indonesia');
          }
          return text;
        }
      } catch (err) {
        lastError = err;
        console.log(`[RETRY] Attempt ${attempt + 1} failed: ${err.message}`);
        
        if (err.message.includes('BLOCKED') || err.message.includes('GEO_BLOCKED')) {
          // Coba proxy berbeda
          this.proxyManager?.markProxyFailed(this.proxyManager?.currentProxy);
        }
        
        if (attempt < retries - 1) {
          await this.delay(1000, 3000);
          this.randomizeDevice();
        }
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }

  // ... (sisanya sama seperti sebelumnya)
  async loginRequest(username, password) {
    const payload = new URLSearchParams({
      username,
      password,
      request_time: Date.now(),
      app_reg_id: this.appRegId,
      phone_android_version: this.phoneAndroidVersion,
      app_version_code: this.appVersionCode,
      phone_uuid: this.phoneUuid
    });
    return await this.request('POST', `${OrderKuota.API_URL}/login`, payload);
  }

  async getAuthToken(username, otp) {
    const payload = new URLSearchParams({
      username,
      password: otp,
      request_time: Date.now(),
      app_reg_id: this.appRegId,
      phone_android_version: this.phoneAndroidVersion,
      app_version_code: this.appVersionCode,
      phone_uuid: this.phoneUuid
    });
    return await this.request('POST', `${OrderKuota.API_URL}/login`, payload);
  }

  async getTransactionQris(type = '', page = 1) {
    const userId = this.authToken?.split(':')[0];
    
    const payload = new URLSearchParams({
      request_time: Date.now(),
      app_reg_id: this.appRegId,
      phone_android_version: this.phoneAndroidVersion,
      app_version_code: this.appVersionCode,
      phone_uuid: this.phoneUuid,
      auth_username: this.username,
      auth_token: this.authToken,
      'requests[qris_history][jumlah]': '',
      'requests[qris_history][jenis]': type,
      'requests[qris_history][page]': page.toString(),
      'requests[qris_history][dari_tanggal]': '',
      'requests[qris_history][ke_tanggal]': '',
      'requests[qris_history][keterangan]': '',
      'requests[0]': 'account',
      app_version_name: this.appVersionName,
      ui_mode: 'light',
      phone_model: this.phoneModel
    });
    
    const endpoint = userId ? 
      `${OrderKuota.API_URL}/qris/mutasi/${userId}` : 
      `${OrderKuota.API_URL}/get`;
    
    return await this.request('POST', endpoint, payload);
  }

  async generateQr(amount = '') {
    const payload = new URLSearchParams({
      request_time: Date.now(),
      app_reg_id: this.appRegId,
      phone_android_version: this.phoneAndroidVersion,
      app_version_code: this.appVersionCode,
      phone_uuid: this.phoneUuid,
      auth_username: this.username,
      auth_token: this.authToken,
      'requests[qris_merchant_terms][jumlah]': amount,
      'requests[0]': 'qris_merchant_terms',
      app_version_name: this.appVersionName,
      phone_model: this.phoneModel
    });

    const response = await this.request('POST', `${OrderKuota.API_URL}/get`, payload);
    
    if (response.success && response.qris_merchant_terms?.results) {
      return response.qris_merchant_terms.results;
    }
    return response;
  }

  async withdrawalQris(amount = '') {
    const payload = new URLSearchParams({
      request_time: Date.now(),
      app_reg_id: this.appRegId,
      phone_android_version: this.phoneAndroidVersion,
      app_version_code: this.appVersionCode,
      phone_uuid: this.phoneUuid,
      auth_username: this.username,
      auth_token: this.authToken,
      'requests[qris_withdraw][amount]': amount,
      'requests[0]': 'account',
      app_version_name: this.appVersionName,
      ui_mode: 'light',
      phone_model: this.phoneModel
    });

    return await this.request('POST', `${OrderKuota.API_URL}/get`, payload);
  }
}

// ... (fungsi utility tetap sama)

// ==================== ROUTE EXPORT ====================
module.exports = [
  {
    name: "Get OTP",
    desc: "Get OTP Orderkuota via Proxy Indonesia",
    category: "Orderkuota",
    path: "/orderkuota/getotp",
    async run(req, res) {
      const { apikey, username, password } = req.query;
      
      if (!global.apikey?.includes(apikey)) {
        return res.status(401).json({ status: false, error: 'Invalid API key' });
      }
      if (!username || !password) {
        return res.status(400).json({ status: false, error: 'Missing username/password' });
      }

      try {
        // Inisialisasi Proxy Manager
        const proxyManager = new ProxyManager(PROXY_LIST_ID);
        
        // Buat instance dengan proxy Indonesia
        const ok = new OrderKuota(null, null, proxyManager);
        const login = await ok.loginRequest(username, password);
        
        res.json({ 
          status: true, 
          result: login.results,
          info: 'Menggunakan proxy Indonesia'
        });
      } catch (err) {
        res.status(500).json({ 
          status: false, 
          error: err.message,
          solution: 'Pastikan menggunakan proxy Indonesia yang valid'
        });
      }
    }
  },
  {
    name: "Get Token",
    desc: "Get Auth Token Orderkuota via Proxy Indonesia",
    category: "Orderkuota",
    path: "/orderkuota/gettoken",
    async run(req, res) {
      const { apikey, username, otp } = req.query;
      
      if (!global.apikey?.includes(apikey)) {
        return res.status(401).json({ status: false, error: 'Invalid API key' });
      }
      if (!username || !otp) {
        return res.status(400).json({ status: false, error: 'Missing username/otp' });
      }

      try {
        const proxyManager = new ProxyManager(PROXY_LIST_ID);
        const ok = new OrderKuota(null, null, proxyManager);
        const login = await ok.getAuthToken(username, otp);
        
        res.json({ status: true, result: login.results });
      } catch (err) {
        res.status(500).json({ status: false, error: err.message });
      }
    }
  },
  // ... (endpoint lainnya sama, selalu gunakan ProxyManager)

  // ==================== PROXY TESTING ENDPOINT ====================
  {
    name: "Test Proxy Indonesia",
    desc: "Cek ketersediaan proxy Indonesia",
    category: "System",
    path: "/orderkuota/test-proxy",
    async run(req, res) {
      const proxyManager = new ProxyManager(PROXY_LIST_ID);
      
      const results = [];
      for (const proxy of PROXY_LIST_ID) {
        const isWorking = await proxyManager.testProxy(proxy);
        results.push({ proxy, status: isWorking ? '✅ Working' : '❌ Failed' });
      }
      
      res.json({
        status: true,
        results,
        note: 'Gunakan proxy yang working untuk akses OrderKuota'
      });
    }
  }
];

// Export untuk testing
module.exports.OrderKuota = OrderKuota;
module.exports.ProxyManager = ProxyManager;
module.exports.PROXY_LIST_ID = PROXY_LIST_ID;
