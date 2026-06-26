// OpenNext configuration for deploying to Cloudflare Workers.
// Default config is enough here — the app has no runtime database (data is baked
// into the build), so no incremental cache / KV / R2 bindings are required.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
