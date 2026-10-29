export function previewUrl(sandboxId) {
    const label = process.env.SANDBOX_HOST_STYLE === 'flat'
        ? `preview-${sandboxId}`
        : `${sandboxId}.preview`;

    return `https://${label}.projectrs.me`;
}
