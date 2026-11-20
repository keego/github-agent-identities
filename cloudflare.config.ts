import { bindings, defineConfig } from "cf/config";

/**
 * Private pilot configuration. All MCP access stays disabled until the
 * operator explicitly configures Cloudflare Access Managed OAuth and an
 * allowlist. Even then, GitHub write tools stay unregistered until #17.
 *
 * Production and staging use DIFFERENT Worker and D1 resource names. Set
 * MCP_PUBLIC_HOSTNAME explicitly in each deployment environment.
 */
export default defineConfig(({ mode }) => {
  const staging = mode === "staging";
  return {
    worker: {
      name: staging ? "github-agent-identities-staging" : "github-agent-identities",
      entrypoint: "./src/worker.ts",
      compatibilityDate: "2026-11-18",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: true,
      // Private hosted instances must never expose version/preview URLs.
      // Without this explicit setting, workers.dev deployments can turn them on.
      previewUrls: false,
      env: {
        DB: bindings.d1({
          name: staging ? "github-agent-identities-staging" : "github-agent-identities",
          // Explicit ID is required for --no-provision remote deployment.
          // Build-only CI intentionally leaves it unset.
          id: staging ? process.env.STAGING_D1_DATABASE_ID : process.env.PRODUCTION_D1_DATABASE_ID,
        }),
        MCP_PUBLIC_HOSTNAME: bindings.text(process.env.MCP_PUBLIC_HOSTNAME || "unconfigured.invalid"),
        // Must be set in operator deployment environment after enabling
        // Cloudflare Access Managed OAuth on this specific Worker.
        ACCESS_ISSUER: bindings.text(process.env.ACCESS_ISSUER || ""),
        ACCESS_AUDIENCE: bindings.text(process.env.ACCESS_AUDIENCE || ""),
        ALLOWED_ACCESS_EMAILS: bindings.text(process.env.ALLOWED_ACCESS_EMAILS || ""),
        // Must be explicitly enabled after authenticated staging and App setup.
        GH_APP_READONLY_ENABLED: bindings.text(process.env.GH_APP_READONLY_ENABLED === "true" ? "true" : "false"),
        // Separately approved one-owner/one-target staging comment pilot.
        GH_APP_COMMENT_PILOT_ENABLED: bindings.text(process.env.GH_APP_COMMENT_PILOT_ENABLED === "true" ? "true" : "false"),
        GH_APP_COMMENT_PILOT_OWNER_TENANT_ID: bindings.text(process.env.GH_APP_COMMENT_PILOT_OWNER_TENANT_ID || ""),
        GH_APP_COMMENT_PILOT_REPOSITORY: bindings.text(process.env.GH_APP_COMMENT_PILOT_REPOSITORY || ""),
        GH_APP_COMMENT_PILOT_NUMBER: bindings.text(process.env.GH_APP_COMMENT_PILOT_NUMBER || ""),
      },
    },
  };
});
