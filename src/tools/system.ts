import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function registerSystemTools(server: McpServer): void {

  server.registerTool(
    "docker_run",
    {
      title: "Run Docker Container on MCP Server VM",
      description: `Start a Docker container on the local VM (where this MCP server runs).
Useful for deploying demo workloads (e.g. Arcadia app) directly on the VM.

Args:
  - name: Container name (--name)
  - image: Docker image (e.g. reg.edgecnf.com/fintech/arcadia-frontend:v2.0-2tier)
  - ports: Port mappings e.g. ["8080:9080"]
  - env: Environment variables e.g. {"service_name": "frontend"}
  - detach: Run in background (default true)
  - remove_existing: docker rm -f existing container before running`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Container name"),
        image: z.string().min(1).describe("Docker image to run"),
        ports: z.array(z.string()).optional().describe("Port mappings e.g. ['8080:9080']"),
        env: z.record(z.string()).optional().describe("Environment variables"),
        detach: z.boolean().default(true).describe("Run in background (-d)"),
        remove_existing: z.boolean().default(true).describe("Remove existing container with same name before starting"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ name, image, ports, env, detach, remove_existing }) => {
      try {
        if (remove_existing) {
          await execFileAsync("docker", ["rm", "-f", name]).catch(() => {});
        }

        const args: string[] = ["run"];
        if (detach) args.push("-d");
        args.push("--restart", "unless-stopped");
        args.push("--name", name);
        for (const p of ports ?? []) args.push("-p", p);
        for (const [k, v] of Object.entries(env ?? {})) args.push("-e", `${k}=${v}`);
        args.push(image);

        const { stdout, stderr } = await execFileAsync("docker", args, { timeout: 60_000 });
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, container_id: stdout.trim(), stderr: stderr.trim() || undefined }, null, 2) }],
          structuredContent: { success: true, container_id: stdout.trim() },
        };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: e.stderr || e.message || String(err) }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "docker_ps",
    {
      title: "List Docker Containers on MCP Server VM",
      description: "List running (or all) Docker containers on the local VM.",
      inputSchema: z.object({
        all: z.boolean().default(false).describe("Show all containers including stopped ones"),
        filter: z.string().optional().describe("Filter by name substring"),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ all, filter }) => {
      try {
        const args = ["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"];
        if (all) args.push("-a");
        if (filter) args.push("--filter", `name=${filter}`);
        const { stdout } = await execFileAsync("docker", args, { timeout: 10_000 });
        const rows = stdout.trim().split("\n").filter(Boolean).map(line => {
          const [name, image, status, ports] = line.split("\t");
          return { name, image, status, ports };
        });
        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          structuredContent: { containers: rows },
        };
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        return { content: [{ type: "text", text: `Error: ${e.stderr || e.message || String(err)}` }], isError: true };
      }
    },
  );
}
