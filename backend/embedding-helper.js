/**
 * Embedding Helper for YoYo Extension
 * จัดการ embedding generation พร้อม retry logic สำหรับ yoyo extension
 */

const https = require('https');
const http = require('http');

// Configuration
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000; // 1 second
const DEFAULT_TIMEOUT = 30000; // 30 seconds

// Retryable status codes (5xx errors, 530 Cloudflare errors)
const RETRYABLE_STATUS_CODES = [500, 502, 503, 504, 530, 408, 429];

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff delay calculation
 */
function calculateBackoffDelay(attempt, baseDelay = DEFAULT_RETRY_DELAY) {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  // With jitter to prevent thundering herd
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, 60000); // Max 60 seconds
}

/**
 * Check if error is retryable
 */
function isRetryableError(error, statusCode) {
  // Network errors
  if (error && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || 
      error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED')) {
    return true;
  }
  
  // HTTP status codes
  if (statusCode && RETRYABLE_STATUS_CODES.includes(statusCode)) {
    return true;
  }
  
  return false;
}

/**
 * Make HTTP request with retry logic
 */
async function makeRequestWithRetry(options, data = null, maxRetries = DEFAULT_MAX_RETRIES) {
  const protocol = options.protocol === 'https:' ? https : http;
  let lastError = null;
  let lastStatusCode = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = protocol.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(responseData);
                resolve({ statusCode: res.statusCode, data: parsed, headers: res.headers });
              } catch (e) {
                resolve({ statusCode: res.statusCode, data: responseData, headers: res.headers });
              }
            } else {
              reject({
                statusCode: res.statusCode,
                message: `Request failed with status code ${res.statusCode}`,
                response: responseData
              });
            }
          });
        });
        
        req.on('error', (error) => {
          reject(error);
        });
        
        req.setTimeout(DEFAULT_TIMEOUT, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        
        if (data) {
          req.write(typeof data === 'string' ? data : JSON.stringify(data));
        }
        
        req.end();
      });
      
      return result;
      
    } catch (error) {
      lastError = error;
      lastStatusCode = error.statusCode || null;
      
      // Log attempt (only for debugging, can be removed in production)
      // Silent retry - don't log unless DEBUG_EMBEDDING is set
      if (process.env.DEBUG_EMBEDDING) {
        console.log(`⚠️  Embedding generation attempt ${attempt}/${maxRetries} failed:`, 
          error.message || error.statusCode || 'Unknown error');
      }
      
      // Check if should retry
      if (attempt < maxRetries && isRetryableError(error, lastStatusCode)) {
        const delay = calculateBackoffDelay(attempt);
        if (process.env.DEBUG_EMBEDDING) {
          console.log(`⏳ Retrying in ${Math.round(delay)}ms...`);
        }
        await sleep(delay);
        continue;
      } else {
        // Not retryable or max retries reached
        break;
      }
    }
  }
  
  // All retries exhausted
  throw new Error(
    `Failed to generate embeddings after ${maxRetries} attempts. ` +
    `Last error: ${lastError?.message || 'Unknown error'} ` +
    `(Status: ${lastStatusCode || 'N/A'})`
  );
}

/**
 * Generate embedding with retry logic
 * Compatible with YoYo extension API format
 */
async function generateEmbedding(text, options = {}) {
  const {
    apiUrl = process.env.EMBEDDING_API_URL,
    apiKey = process.env.EMBEDDING_API_KEY,
    model = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
    maxRetries = DEFAULT_MAX_RETRIES,
    timeout = DEFAULT_TIMEOUT
  } = options;
  
  if (!apiUrl) {
    throw new Error('Embedding API URL is not configured. Set EMBEDDING_API_URL environment variable.');
  }
  
  if (!text || typeof text !== 'string') {
    throw new Error('Text input is required and must be a string');
  }
  
  const url = new URL(apiUrl);
  
  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    protocol: url.protocol,
    timeout: timeout,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Claude-Dashboard/1.0.0'
    }
  };
  
  // Add API key if provided
  if (apiKey) {
    requestOptions.headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  const requestData = {
    input: text,
    model: model
  };
  
  try {
    const response = await makeRequestWithRetry(requestOptions, requestData, maxRetries);
    
    // Extract embedding from response (support multiple API formats)
    if (response.data && response.data.data && Array.isArray(response.data.data)) {
      return response.data.data[0].embedding || response.data.data[0];
    } else if (response.data && Array.isArray(response.data)) {
      return response.data[0].embedding || response.data[0];
    } else if (response.data && response.data.embedding) {
      return response.data.embedding;
    }
    
    return response.data;
    
  } catch (error) {
    // Only log error if DEBUG_EMBEDDING is set, otherwise silent
    // Error will be handled by caller
    if (process.env.DEBUG_EMBEDDING) {
      console.error('❌ Error generating embedding:', error.message);
    }
    throw error;
  }
}

module.exports = {
  generateEmbedding,
  makeRequestWithRetry,
  isRetryableError,
  calculateBackoffDelay
};

