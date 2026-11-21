// OTP delivery. Pick a provider with the OTP_PROVIDER variable:
//   "whatsapp" — Meta WhatsApp Cloud API, using an approved AUTHENTICATION template
//   "msg91"    — MSG91 SMS OTP API (DLT-registered template)
//   "dev"      — no message is sent; the code is returned to the page (testing only)

export async function sendOtp(env, phone10, code) {
  const provider = (env.OTP_PROVIDER || 'dev').toLowerCase();

  if (provider === 'whatsapp') {
    const url = `https://graph.facebook.com/v21.0/${env.WA_PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.WA_ACCESS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `91${phone10}`,
        type: 'template',
        template: {
          name: env.WA_TEMPLATE_NAME || 'unity_otp',
          language: { code: env.WA_TEMPLATE_LANG || 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            // Authentication templates carry a "copy code" button that also needs the code
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
    return { channel: 'whatsapp' };
  }

  if (provider === 'msg91') {
    const qs = new URLSearchParams({ template_id: env.MSG91_TEMPLATE_ID, mobile: `91${phone10}`, otp: code });
    const res = await fetch(`https://control.msg91.com/api/v5/otp?${qs}`, {
      method: 'POST',
      headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
    });
    if (!res.ok) throw new Error(`MSG91 send failed: ${res.status} ${await res.text()}`);
    return { channel: 'sms' };
  }

  return { channel: 'dev', devCode: code };
}
