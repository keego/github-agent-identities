/**
 * Local-only MCP development server.
 * Binds to loopback and applies the SDK's localhost Host/Origin guards.
 * No GitHub credentials or public write tools are available at this stage.
 */
import { createServer } from "node:http";
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { IdentityRouter, MemoryBindingStore, exampleIdentities } from "./core.ts";
import { createIdentityMcpServer } from "./server.ts";

const store = new MemoryBindingStore();
const router = new IdentityRouter(store, exampleIdentities);
const handler = createMcpHandler(() => createIdentityMcpServer(router), {
  responseMode: "json",
});

const toNode = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const server = createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void toNode(req, res);
});

server.listen(8787, "127.0.0.1", () => {
  console.log("Local identity MCP available at http://127.0.0.1:8787/mcp");
});
