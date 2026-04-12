import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// CORS helper
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, subject, html, invoiceNumber, pdfBase64, pdfFilename, fromName } = req.body;

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }

  // Build "Display Name <sender@domain.com>" — RESEND_FROM env var holds the
  // verified sender address; falls back to Resend's shared testing address.
  const senderEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
  const from = `${fromName || 'My Business'} <${senderEmail}>`;

  try {
    const attachments = pdfBase64
      ? [{ filename: pdfFilename || `${invoiceNumber || 'invoice'}.pdf`, content: pdfBase64 }]
      : [];

    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
      attachments,
    });

    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
