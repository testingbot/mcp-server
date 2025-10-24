export class TestingBotMCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestingBotMCPError";
  }
}

export class AuthenticationError extends TestingBotMCPError {
  constructor(message = "Authentication failed. Please check your credentials.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class APIError extends TestingBotMCPError {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class ValidationError extends TestingBotMCPError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
