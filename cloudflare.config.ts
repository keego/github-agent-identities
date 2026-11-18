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
      env: {
        DB: bindings.d1({
          name: staging ? "github-agent-identities-staging" : "github-agent-identities",
        }),
        MCP_PUBLIC_HOSTNAME: bindings.text(process.env.MCP_PUBLIC_HOSTNAME || "unconfigured.invalid"),
        // Must be set in operator deployment environment after enabling
        // Cloudflare Access Managed OAuth on this specific Worker.
        ACCESS_ISSUER: bindings.text(process.env.ACCESS_ISSUER || ""),
        ACCESS_AUDIENCE: bindings.text(process.env.ACCESS_AUDIENCE || ""),
        ALLOWED_ACCESS_EMAILS: bindings.text(process.env.ALLOWED_ACCESS_EMAILS || ""),
      },
    },
  };
});
