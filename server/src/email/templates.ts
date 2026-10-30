// Plantillas de correo transaccional. Texto plano + HTML con los colores de la landing.
// Todo valor dinámico pasa por esc() antes de entrar en el HTML.

export type EmailType =
  | 'verify_email'
  | 'welcome'
  | 'purchase_confirmed'
  | 'license_key'
  | 'renewal_confirmed'
  | 'payment_failed'
  | 'grace_period'
  | 'subscription_canceled'
  | 'access_expired'
  | 'license_suspended'
  | 'license_reactivated'
  | 'password_reset'
  | 'account_exists';

export type EmailData = {
  name: string;
  appUrl: string;
  supportEmail: string;
  link?: string;
  product?: string;
  plan?: string;
  platform?: string;
  licenseKey?: string;
  date?: string; // fecha ya formateada
  amount?: string;
};

export type Rendered = { subject: string; text: string; html: string };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Block = { p: string } | { key: string } | { button: { label: string; href: string } } | { steps: string[] };

function render(subject: string, title: string, blocks: Block[], d: EmailData): Rendered {
  const text: string[] = [`Hola, ${d.name}:`, ''];
  const html: string[] = [];
  for (const b of blocks) {
    if ('p' in b) {
      text.push(b.p, '');
      html.push(`<p style="margin:0 0 16px;color:#a3adc2;line-height:1.6">${esc(b.p)}</p>`);
    } else if ('key' in b) {
      text.push(`Clave de activación: ${b.key}`, '');
      html.push(
        `<p style="margin:0 0 6px;color:#6f7a91;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Clave de activación</p>` +
          `<p style="margin:0 0 20px;padding:14px 16px;background:#121826;border:1px solid rgba(200,214,240,.22);border-radius:8px;` +
          `font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:16px;color:#f5c84b;word-break:break-all">${esc(b.key)}</p>`,
      );
    } else if ('button' in b) {
      text.push(`${b.button.label}: ${b.button.href}`, '');
      html.push(
        `<p style="margin:8px 0 24px"><a href="${esc(b.button.href)}" style="display:inline-block;padding:12px 20px;` +
          `background:#5ee08a;color:#06080d;border-radius:999px;font-weight:600;text-decoration:none">${esc(b.button.label)}</a></p>`,
      );
    } else {
      b.steps.forEach((s, i) => text.push(`${i + 1}. ${s}`));
      text.push('');
      html.push(
        `<ol style="margin:0 0 16px;padding-left:20px;color:#a3adc2;line-height:1.6">${b.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`,
      );
    }
  }
  text.push(`¿Dudas? Escríbenos a ${d.supportEmail}.`, '', 'RT Magneto');
  const body =
    `<!doctype html><html lang="es"><body style="margin:0;background:#06080d;font-family:Archivo,system-ui,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06080d;padding:32px 16px"><tr><td align="center">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0b0f18;border:1px solid rgba(200,214,240,.12);border-radius:12px">` +
    `<tr><td style="padding:28px 28px 8px;color:#e9edf5;font-weight:700;letter-spacing:.04em">RT MAGNETO</td></tr>` +
    `<tr><td style="padding:8px 28px 28px">` +
    `<h1 style="margin:0 0 16px;font-size:22px;color:#e9edf5">${esc(title)}</h1>` +
    `<p style="margin:0 0 16px;color:#e9edf5">Hola, ${esc(d.name)}:</p>` +
    html.join('') +
    `<p style="margin:24px 0 0;color:#6f7a91;font-size:13px">¿Dudas? Escríbenos a <a href="mailto:${esc(d.supportEmail)}" style="color:#34d6f0">${esc(d.supportEmail)}</a>.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject, text: text.join('\n'), html: body };
}

const panel = (d: EmailData) => ({ button: { label: 'Ir a mi cuenta', href: `${d.appUrl}/cuenta/` } });

export function renderEmail(type: EmailType, d: EmailData): Rendered {
  const product = d.product ?? 'RT Magneto';
  switch (type) {
    case 'verify_email':
      return render('Confirma tu correo', 'Confirma tu correo', [
        { p: 'Pulsa el botón para confirmar tu dirección. El enlace caduca en 48 horas.' },
        { button: { label: 'Confirmar correo', href: d.link! } },
        { p: 'Si no creaste una cuenta en RT Magneto, ignora este mensaje.' },
      ], d);
    case 'account_exists':
      return render('Ya tienes una cuenta', 'Ya tienes una cuenta', [
        { p: 'Alguien intentó registrarse con este correo, que ya tiene una cuenta. Si fuiste tú, inicia sesión o recupera tu contraseña.' },
        { button: { label: 'Recuperar contraseña', href: `${d.appUrl}/entrar/?recuperar=1` } },
      ], d);
    case 'welcome':
      return render('Bienvenido a RT Magneto', 'Tu cuenta está lista', [
        { p: 'Ya puedes elegir un plan y gestionar tus licencias desde tu panel.' },
        panel(d),
      ], d);
    case 'purchase_confirmed':
      return render(`Compra confirmada: ${product}`, 'Compra confirmada', [
        { p: `Hemos confirmado el pago de tu suscripción a ${product} (${d.plan}). Importe: ${d.amount}.` },
        { p: 'En unos minutos recibirás tu clave de activación en otro correo.' },
        panel(d),
      ], d);
    case 'license_key':
      return render(`Tu clave de ${product}`, 'Tu clave de activación', [
        { p: `Plan: ${d.plan}. Plataforma: ${d.platform}. Acceso hasta: ${d.date}.` },
        { key: d.licenseKey! },
        { steps: [
          `Instala ${product} en ${d.platform} siguiendo las instrucciones de tu panel.`,
          'Añade el indicador a un gráfico.',
          'Introduce la clave cuando el indicador la solicite.',
        ] },
        { p: 'La clave es personal. No la compartas: queda vinculada a tu equipo.' },
        panel(d),
      ], d);
    case 'renewal_confirmed':
      return render(`Renovación confirmada: ${product}`, 'Suscripción renovada', [
        { p: `Cobramos ${d.amount} y tu licencia sigue activa con la misma clave hasta el ${d.date}.` },
        panel(d),
      ], d);
    case 'payment_failed':
      return render('No pudimos cobrar tu suscripción', 'Pago no realizado', [
        { p: `PayPal no pudo cobrar la renovación de ${product}. PayPal volverá a intentarlo; revisa tu método de pago para no perder el acceso.` },
        { button: { label: 'Revisar en PayPal', href: 'https://www.paypal.com/myaccount/autopay/' } },
      ], d);
    case 'grace_period':
      return render('Tu acceso está en periodo de gracia', 'Periodo de gracia', [
        { p: `Tu licencia de ${product} seguirá funcionando hasta el ${d.date}. Si el pago no se regulariza antes, se suspenderá.` },
        panel(d),
      ], d);
    case 'subscription_canceled':
      return render('Suscripción cancelada', 'Suscripción cancelada', [
        { p: `Cancelamos la renovación de ${product}. Conservas el acceso hasta el ${d.date}.` },
        panel(d),
      ], d);
    case 'access_expired':
      return render(`Tu acceso a ${product} ha terminado`, 'Acceso finalizado', [
        { p: `El periodo pagado de ${product} terminó y la licencia se desactivó. Puedes volver a suscribirte cuando quieras.` },
        panel(d),
      ], d);
    case 'license_suspended':
      return render(`Licencia suspendida: ${product}`, 'Licencia suspendida', [
        { p: `Hemos suspendido tu licencia de ${product}. Si crees que es un error, contesta a este correo.` },
        panel(d),
      ], d);
    case 'license_reactivated':
      return render(`Licencia reactivada: ${product}`, 'Licencia reactivada', [
        { p: `Tu licencia de ${product} vuelve a estar activa hasta el ${d.date}, con la misma clave.` },
        panel(d),
      ], d);
    case 'password_reset':
      return render('Restablece tu contraseña', 'Restablece tu contraseña', [
        { p: 'Pulsa el botón para elegir una contraseña nueva. El enlace caduca en 1 hora.' },
        { button: { label: 'Elegir contraseña', href: d.link! } },
        { p: 'Si no lo pediste tú, ignora este mensaje: tu contraseña no cambia.' },
      ], d);
  }
}
