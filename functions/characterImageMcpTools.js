'use strict';

const TOOLS = [{
  name: 'character_image_import',
  description: 'Import an already-created image into ImageKit and link it to an existing My Portal character. Requires explicit user permission and confirm=true. Supply one publicly reachable HTTPS imageUrl (not sandbox:/, file IDs or local paths), or inline base64 for a small image. Only use images authorized for public ImageKit hosting; do not submit private or sensitive materials. After successful import this tool updates the character assets[] itself; do not separately overwrite assets via portal_update.',
  inputSchema: {
    type: 'object',
    properties: {
      characterId: { type: 'string', minLength: 1, maxLength: 160, description: 'Existing My Portal characters collection document ID.' },
      imageUrl: { type: 'string', maxLength: 4000, description: 'Public, directly downloadable HTTPS image (max 8 MiB; redirects are rejected). A ChatGPT sandbox path is not a public URL.' },
      imageBase64: { type: 'string', maxLength: 4194310, description: 'Raw base64 or data:image/...;base64 payload, max 3 MiB decoded. Do not use for large images.' },
      role: { type: 'string', enum: ['auto', 'avatar', 'reference'], default: 'auto', description: 'auto makes the first imported image an avatar; avatar explicitly promotes the image and demotes other avatars.' },
      confirm: { type: 'boolean', description: 'Must be true after the user explicitly requests this specific image import.' },
    },
    required: ['characterId', 'confirm'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
}];

module.exports = { TOOLS };
