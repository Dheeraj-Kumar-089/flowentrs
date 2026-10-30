const flatHosts = import.meta.env.VITE_SANDBOX_HOST_STYLE === 'flat'

export function sandboxHost(sandboxId, service) {
  if (!['agent', 'preview'].includes(service)) throw new Error('Invalid sandbox service')
  const label = flatHosts ? `${service}-${sandboxId}` : `${sandboxId}.${service}`
  return `https://${label}.projectrs.me`
}
