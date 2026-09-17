export class SandboxSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxSetupError";
  }
}

export class GeneratedAppBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratedAppBuildError";
  }
}
