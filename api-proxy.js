const functionPrefix = '/.netlify/functions/api-proxy';

exports.handler = async (event) => {
  const backendUrl = process.env.BACKEND_API_URL?.trim();
  if (!backendUrl) {
    return jsonResponse(503, {
      success: false,
      message: 'The inquiry service is not configured yet. Please contact the site owner.',
    });
  }

  const method = event.httpMethod;
  if (!['GET', 'POST', 'PATCH', 'OPTIONS'].includes(method)) {
    return jsonResponse(405, { success: false, message: 'Method not allowed.' });
  }

  const requestPath = event.path.startsWith(functionPrefix)
    ? event.path.slice(functionPrefix.length)
    : event.path;
  const apiPath =
    requestPath === '/api' || requestPath.startsWith('/api/')
      ? requestPath
      : `/api${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters || {})) {
    if (value !== undefined && value !== null) query.set(key, value);
  }

  const target = `${backendUrl.replace(/\/+$/, '')}${apiPath}${query.size ? `?${query}` : ''}`;
  const headers = {};
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'];
  const authorization = event.headers?.authorization || event.headers?.Authorization;
  const stripeSignature =
    event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
  if (contentType) headers['content-type'] = contentType;
  if (authorization) headers.authorization = authorization;
  if (stripeSignature) headers['stripe-signature'] = stripeSignature;

  try {
    const response = await fetch(target, {
      method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(method)
        ? undefined
        : event.isBase64Encoded
          ? Buffer.from(event.body || '', 'base64')
          : event.body || undefined,
      signal: AbortSignal.timeout(15000),
    });

    return {
      statusCode: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
      body: await response.text(),
    };
  } catch (error) {
    console.error('[API PROXY ERROR]:', error.message);
    return jsonResponse(502, {
      success: false,
      message: 'The inquiry service is temporarily unavailable. Please try again later.',
    });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}
