const DEFAULT_FROM_EMAIL = 'varis@varis.kr';
const DEFAULT_FROM_NAME = 'VARIS';

export async function sendBrevoTransactional(env, {to, subject, textContent, htmlContent, tags = []}) {
  const apiKey = String(env?.BREVO_API_KEY || '').trim();
  if (!apiKey) return {ok:false, status:'not_configured', reason:'missing_brevo_api_key'};
  if (!to) return {ok:false, status:'not_requested', reason:'missing_recipient'};

  const senderEmail = String(env.EMAIL_FROM || DEFAULT_FROM_EMAIL).trim();
  const senderName = String(env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME).trim();
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        sender: {name: senderName, email: senderEmail},
        to: [{email: to}],
        subject,
        textContent,
        htmlContent,
        ...(tags.length ? {tags} : {}),
      }),
    });
    if (!response.ok) {
      return {ok:false, status:'failed', reason:`provider_http_${response.status}`};
    }
    const data = await response.json().catch(() => ({}));
    return {ok:true, status:'sent', message_id:data?.messageId ? String(data.messageId) : null};
  } catch {
    return {ok:false, status:'failed', reason:'network_error'};
  }
}
