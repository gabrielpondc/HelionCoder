import * as https from "https";
import * as vscode from "vscode";

const RELEASES_LATEST_URL =
  "https://api.github.com/repos/gabrielpondc/HelionCoder/releases/latest";

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
  }>;
}

export async function checkForUpdates(
  currentVersion: string,
  output: vscode.OutputChannel,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "正在检查 HelionCoder 更新",
      cancellable: false,
    },
    async () => {
      try {
        const release = await fetchLatestRelease();
        const latestVersion = normalizeVersion(release.tag_name || release.name);
        if (!latestVersion) {
          throw new Error("GitHub Release 没有可识别的版本号。");
        }

        const releaseUrl =
          release.html_url ||
          `https://github.com/gabrielpondc/HelionCoder/releases/tag/${encodeURIComponent(latestVersion)}`;
        const vsixUrl = findVsixDownloadUrl(release);
        const comparison = compareVersions(latestVersion, currentVersion);

        if (comparison <= 0) {
          void vscode.window.showInformationMessage(
            `HelionCoder 已是最新版本：${currentVersion}`,
          );
          return;
        }

        const openRelease = "打开发布页";
        const downloadVsix = vsixUrl ? "下载 VSIX" : undefined;
        const picked = await vscode.window.showInformationMessage(
          `HelionCoder 有新版本：${latestVersion}，当前版本：${currentVersion}`,
          ...(downloadVsix ? [downloadVsix, openRelease] : [openRelease]),
        );

        if (picked === downloadVsix && vsixUrl) {
          await vscode.env.openExternal(vscode.Uri.parse(vsixUrl));
        } else if (picked === openRelease) {
          await vscode.env.openExternal(vscode.Uri.parse(releaseUrl));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[update] ${message}`);
        void vscode.window.showErrorMessage(`检查更新失败：${message}`);
      }
    },
  );
}

function fetchLatestRelease(): Promise<GitHubRelease> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      RELEASES_LATEST_URL,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "helion-coder-vscode",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (!response.statusCode || response.statusCode >= 400) {
            reject(
              new Error(
                `GitHub 返回 HTTP ${response.statusCode ?? "unknown"}：${body.slice(0, 240)}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(body) as GitHubRelease);
          } catch {
            reject(new Error("GitHub Release 响应不是有效 JSON。"));
          }
        });
      },
    );
    request.setTimeout(10_000, () => {
      request.destroy(new Error("请求 GitHub Release 超时。"));
    });
    request.on("error", reject);
  });
}

function findVsixDownloadUrl(release: GitHubRelease): string | undefined {
  return release.assets?.find((asset) => asset.name?.endsWith(".vsix"))
    ?.browser_download_url;
}

function normalizeVersion(value: string | undefined): string | undefined {
  return value?.trim().match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1];
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] > right[index] ? 1 : -1;
    }
  }
  return 0;
}

function versionParts(value: string): [number, number, number] {
  const normalized = normalizeVersion(value) ?? "0.0.0";
  const [major = "0", minor = "0", patch = "0"] = normalized
    .split(/[+-]/)[0]
    .split(".");
  return [
    Number.parseInt(major, 10) || 0,
    Number.parseInt(minor, 10) || 0,
    Number.parseInt(patch, 10) || 0,
  ];
}
