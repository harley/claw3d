export function createSecretRedactor({ actions = process.env.GITHUB_ACTIONS === 'true', log = console.log } = {}) {
  const values = [];
  return {
    add(value) {
      if (!value || typeof value !== 'string') return;
      values.push(value);
      if (actions) log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
    },
    redact(value) {
      return values.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), String(value));
    },
  };
}
