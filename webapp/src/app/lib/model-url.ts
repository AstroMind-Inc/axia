// Client-supplied model server URLs.
//
// The playground lets a user type in the URL of a model server, and the routes
// used to forward it to the service as `model_api_url`. The service then POSTs
// the user's prompt and event list to that URL. On a shared deployment this
// means any signed-in user can make the backend send requests anywhere they
// like: to hosts on the internal docker network, to the cloud metadata
// endpoint, or (via the shared model_config document) to their own server,
// carrying every other user's data.
//
// So by default the server ignores client URLs and the service uses its own
// MODEL_SERVER_URL / PROJECTOR_URL. A single-user or local deployment that
// wants the old behaviour sets ALLOW_CUSTOM_MODEL_URL=true.

export function customModelUrlsAllowed(): boolean {
  return process.env.ALLOW_CUSTOM_MODEL_URL === 'true';
}

/**
 * The `model_api_url` to forward to the service for this request: the
 * client's value when custom URLs are allowed, otherwise undefined so the
 * service falls back to its configured URL.
 */
export function forwardableModelUrl(clientUrl: unknown): string | undefined {
  if (!customModelUrlsAllowed()) return undefined;
  if (typeof clientUrl !== 'string' || !clientUrl.trim()) return undefined;
  return clientUrl;
}

export const CUSTOM_MODEL_URL_DISABLED_MESSAGE =
  'Custom model server URLs are disabled on this deployment. ' +
  'The server uses its configured model server. Set ALLOW_CUSTOM_MODEL_URL=true to enable them.';
