/**
 * Process Discord message attachments into Gemini-compatible image parts.
 * @param {import('discord.js').Collection} attachments - message.attachments
 * @returns {Promise<Array<{ inlineData: { data: string, mimeType: string } }>>}
 */
async function processImages(attachments) {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
  const imageAttachments = attachments.filter(
    a => a.contentType && supportedTypes.includes(a.contentType)
  );

  const imageParts = [];

  for (const [, attachment] of imageAttachments) {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) continue;

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      // Skip images larger than 15MB (Gemini inline limit is 20MB total)
      if (arrayBuffer.byteLength > 15 * 1024 * 1024) {
        console.warn(`Skipping image ${attachment.name}: too large (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }

      imageParts.push({
        base64,
        mimeType: attachment.contentType,
      });
    } catch (err) {
      console.error(`Failed to process image ${attachment.name}:`, err.message);
    }
  }

  return imageParts;
}

module.exports = { processImages };
