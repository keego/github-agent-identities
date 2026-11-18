import { bindings, defineConfig } from "cf/config";

/**
 * Public pilot scaffold only. All MCP access stays disabled until #16
 * supplies real, verified user authentication.
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
        ENABLE_UNAUTHENTICATED_DEMO: bindings.text("false"),
      },
    },
  };
});
