const VIEWER_QUERY_KEYS = ["daemonUrl", "sessionId", "view", "actionId", "artifactId"] as const;

export function shouldShowViewer(search: string) {
  const params = new URLSearchParams(search);
  return VIEWER_QUERY_KEYS.some((key) => params.has(key));
}
