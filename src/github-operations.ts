import { type ClientMetadata, IdentityRouter } from "./core.ts";
import { AppTokenError, type AppTokenErrorCode } from "./github-auth.ts";
import { type AppIdentity, type AppRegistry, assertRepositoryAllowed } from "./github-apps.ts";

export interface TokenProvider {
  forApp(identity: AppIdentity): Promise<string>;
}

export interface VerifiedCaller {
  /** MUST come from validated MCP authentication, never a tool input. */
  tenantId: string;
  metadata: ClientMetadata;
}

export type PullRequestSummary = {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  body: string | null;
};
export type CommentSummary = { id: number; url: string; author: string | null };

export class GithubOperationError extends Error {
  constructor(public readonly code:
    "NOT_AUTHENTICATED" | "IDENTITY_NOT_BOUND" | "APP_NOT_CONFIGURED" |
    "REPOSITORY_NOT_ALLOWED" | "INVALID_ARGUMENT" | "GITHUB_REQUEST_FAILED" |
    "APP_REGISTRY_FAILED" | AppTokenErrorCode) {
    super(code);
  }
}

export class GitHubOperations {
  constructor(
    private readonly router: IdentityRouter,
    private readonly registry: AppRegistry,
    private readonly tokens: TokenProvider,
    private readonly httpFetch: typeof fetch = fetch,
  ) {}

  private async selectedApp(caller: VerifiedCaller, repository: string) {
    if (!caller.tenantId) throw new GithubOperationError("NOT_AUTHENTICATED");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        repository.includes("..")) {
      throw new GithubOperationError("INVALID_ARGUMENT");
    }
    const current = await this.router.identify(caller.metadata, caller.tenantId);
    if (!current.identity) throw new GithubOperationError("IDENTITY_NOT_BOUND");
    let identity: AppIdentity | null;
    try {
      identity = await this.registry.getForTenant(caller.tenantId, current.identity.id);
    } catch {
      throw new GithubOperationError("APP_REGISTRY_FAILED");
    }
    if (!identity) throw new GithubOperationError("APP_NOT_CONFIGURED");
    try {
      assertRepositoryAllowed(identity, repository);
    } catch {
      throw new GithubOperationError("REPOSITORY_NOT_ALLOWED");
    }
    return identity;
  }

  private async githubRequest<T>(
    identity: AppIdentity,
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<T> {
    let token: string;
    try {
      token = await this.tokens.forApp(identity);
    } catch (error) {
      if (error instanceof AppTokenError) throw new GithubOperationError(error.code);
      throw error;
    }
    let response: Response;
    try {
      response = await this.httpFetch("https://api.github.com" + path, {
        method,
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": "Bearer " + token,
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "github-agent-identities",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new GithubOperationError("GITHUB_REQUEST_FAILED");
    }
    if (!response.ok) {
      // Never surface untrusted GitHub error bodies or credential-bearing headers.
      throw new GithubOperationError("GITHUB_REQUEST_FAILED");
    }
    try {
      return await response.json() as T;
    } catch {
      throw new GithubOperationError("GITHUB_REQUEST_FAILED");
    }
  }

  async getPullRequest(caller: VerifiedCaller, repository: string, number: number): Promise<PullRequestSummary> {
    if (!Number.isSafeInteger(number) || number <= 0) throw new GithubOperationError("INVALID_ARGUMENT");
    const identity = await this.selectedApp(caller, repository);
    const data = await this.githubRequest<{
      number: number; title: string; state: string; html_url: string;
      body: string | null; user?: { login: string };
    }>(identity, "/repos/" + repository + "/pulls/" + number, "GET");
    return {
      number: data.number, title: data.title, state: data.state,
      url: data.html_url, body: data.body, author: data.user?.login ?? null,
    };
  }

  async commentOnPullRequest(
    caller: VerifiedCaller,
    repository: string,
    number: number,
    comment: string,
  ): Promise<CommentSummary> {
    if (!Number.isSafeInteger(number) || number <= 0 ||
        typeof comment !== "string" || comment.trim().length === 0 || comment.length > 60_000) {
      throw new GithubOperationError("INVALID_ARGUMENT");
    }
    const identity = await this.selectedApp(caller, repository);
    const data = await this.githubRequest<{ id: number; html_url: string; user?: { login: string } }>(
      identity,
      "/repos/" + repository + "/issues/" + number + "/comments",
      "POST",
      { body: comment },
    );
    return { id: data.id, url: data.html_url, author: data.user?.login ?? null };
  }
}
