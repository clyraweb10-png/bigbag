/** Untrusted generated code must never inherit the builder's provider credentials. */
export function generatedProcessEnvironment(nodeEnv: "development" | "production"): NodeJS.ProcessEnv {
  const allowed = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
    "SystemRoot", "windir", "ComSpec", "PATHEXT", "APPDATA", "LOCALAPPDATA"] as const;
  const environment: NodeJS.ProcessEnv = { NODE_ENV: nodeEnv };
  for (const name of allowed) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
