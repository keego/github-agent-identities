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
/** Deliberately limited to safe statuses/booleans; no upstream body or auth fields. */
export type GitHubReadDiagnostics = Readonly<{
  pullRequest: { kind: "http" | "transport" | "invalid_json"; status: number | null };
  repository: { status: number | null };
  installation: { status: number | null; repositorySelected: boolean | null; listComplete: boolean | null };
}>;
type RequestFailure = GitHubReadDiagnostics["pullRequest"];

export class GithubOperationError extends Error {
  constructor(public readonly code:
    "NOT_AUTHENTICATED" | "IDENTITY_NOT_BOUND" | "APP_NOT_CONFIGURED" |
    "REPOSITORY_NOT_ALLOWED" | "INVALID_ARGUMENT" | "GITHUB_REQUEST_FAILED" |
    "APP_REGISTRY_FAILED" | AppTokenErrorCode |
    "GITHUB_REQUEST_UNAUTHORIZED" | "GITHUB_REQUEST_FORBIDDEN" |
    "GITHUB_RESOURCE_NOT_FOUND_OR_INACCESSIBLE" | "GITHUB_RATE_LIMITED" |
    "GITHUB_BAD_REQUEST" | "GITHUB_SERVICE_UNAVAILABLE",
    public readonly requestFailure?: RequestFailure,
    public readonly diagnostics?: GitHubReadDiagnostics,
  ) {
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
      throw new GithubOperationError("GITHUB_REQUEST_FAILED", { kind: "transport", status: null });
    }
    if (!response.ok) {
      // Fixed status only: GitHub 404 may indicate missing OR inaccessible.
      const failure: RequestFailure = { kind: "http", status: response.status };
      if (response.status === 401) throw new GithubOperationError("GITHUB_REQUEST_UNAUTHORIZED", failure);
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
        throw new GithubOperationError("GITHUB_RATE_LIMITED", failure);
      }
      if (response.status === 403) throw new GithubOperationError("GITHUB_REQUEST_FORBIDDEN", failure);
      if (response.status === 404) throw new GithubOperationError("GITHUB_RESOURCE_NOT_FOUND_OR_INACCESSIBLE", failure);
      if (response.status === 429) throw new GithubOperationError("GITHUB_RATE_LIMITED", failure);
      if (response.status === 400 || response.status === 422) throw new GithubOperationError("GITHUB_BAD_REQUEST", failure);
      if (response.status >= 500) throw new GithubOperationError("GITHUB_SERVICE_UNAVAILABLE", failure);
      throw new GithubOperationError("GITHUB_REQUEST_FAILED", failure);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new GithubOperationError("GITHUB_REQUEST_FAILED", { kind: "invalid_json", status: response.status });
    }
  }

  /**
   * After a failed authorized PR read, reuse its App token for two bounded GETs.
   * This helps distinguish missing repo selection, denied PR access and network
   * errors in one MCP response. No raw GitHub API data is returned or logged.
   */
  private async diagnoseReadFailure(
    identity: AppIdentity, repository: string, pullRequest: RequestFailure,
  ): Promise<GitHubReadDiagnostics> {
    const unavailable: GitHubReadDiagnostics = {
      pullRequest,
      repository: { status: null },
      installation: { status: null, repositorySelected: null, listComplete: null },
    };
    let token: string;
    try { token = await this.tokens.forApp(identity); } catch { return unavailable; }
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "github-agent-identities",
    };
    const probe = async (path: string): Promise<Response | null> => {
      try {
        return await this.httpFetch("https://api.github.com" + path, {
          method: "GET", headers, signal: AbortSignal.timeout(7_000),
        });
      } catch {
        return null;
      }
    };
    const [repoResponse, scopeResponse] = await Promise.all([
      probe("/repos/" + repository),
      probe("/installation/repositories?per_page=100"),
    ]);
    let repositorySelected: boolean | null = null;
    let listComplete: boolean | null = null;
    if (scopeResponse?.ok) {
      try {
        const data: unknown = await scopeResponse.json();
        if (data && typeof data === "object" &&
            "total_count" in data && "repositories" in data) {
          const { total_count, repositories } = data;
          if (typeof total_count === "number" && Number.isSafeInteger(total_count) &&
              total_count >= 0 && Array.isArray(repositories) &&
              repositories.length <= 100) {
            listComplete = total_count === repositories.length;
            const found = repositories.some((entry: unknown) =>
              entry !== null && typeof entry === "object" &&
              "full_name" in entry && typeof entry.full_name === "string" &&
              entry.full_name.toLowerCase() === repository.toLowerCase());
            repositorySelected = found ? true : listComplete ? false : null;
          }
        }
      } catch { /* Unknown, not proof of omission. */ }
    }
    return {
      pullRequest,
      repository: { status: repoResponse?.status ?? null },
      installation: {
        status: scopeResponse?.status ?? null, repositorySelected, listComplete,
      },
    };
  }

  async getPullRequest(caller: VerifiedCaller, repository: string, number: number): Promise<PullRequestSummary> {
    if (!Number.isSafeInteger(number) || number <= 0) throw new GithubOperationError("INVALID_ARGUMENT");
    const identity = await this.selectedApp(caller, repository);
    let data: {
      number: number; title: string; state: string; html_url: string;
      body: string | null; user?: { login: string };
    };
    try {
      data = await this.githubRequest<typeof data>(identity, "/repos/" + repository + "/pulls/" + number, "GET");
    } catch (error) {
      // No probe until the chat is bound and the repository allowlist passes.
      // Token errors do not probe; only a failed GitHub request is eligible.
      if (error instanceof GithubOperationError && error.requestFailure) {
        const diagnostics = await this.diagnoseReadFailure(identity, repository, error.requestFailure);
        throw new GithubOperationError(error.code, error.requestFailure, diagnostics);
      }
      throw error;
    }
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
